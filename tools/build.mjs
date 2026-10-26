#!/usr/bin/env node
// build: kits (kits/*/source.yaml) and the catalog (catalog/*.yaml) into dist/, the files the game embeds:
//   dist/models/<kit>/<name>.glb      a kit's model, imported (model.mjs)
//   dist/models/recipe/<id>.glb        a kitbash (catalog/recipes.yaml)
//   dist/models/plot/<civ>.glb         the floor under a civ's buildings (catalog/civs.yaml plot), lying on the tile
//   dist/models/dress/<civ>-<n>.glb    a civ's seeded dressing (catalog/civs.yaml dress)
//   dist/styles/<style>/<kit>.png      a kit's atlas in a style (style.mjs): the kits the style's civs draw, and
//                                      hexagon (the tiles and construction states every civ shares)
//   dist/manifest.json                 what is where: kits and licences, models (tris, bounds, footprint), styles, civs
// Then it validates: every catalog reference resolves, a civ draws from its own kit only and has a product, every civ
// draws each of its roles in every age, buildings, plots and dressing fit a hex, and no model is over its triangle
// budget.
//   --lock   write kits/*/lock.json from what the pins fetch (review the diff)
//   --check  build into a temporary directory and fail unless it equals dist/ byte for byte (determinism, freshness)
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { PNG } from 'pngjs';
import { parse } from 'yaml';
import { fetchKit } from './fetch.mjs';
import { generateKit } from './procgen/kit.mjs';
import { rng } from './procgen/random.mjs';
import { build, io } from './model.mjs';
import { paint } from './style.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const args = new Set(process.argv.slice(2));
const yaml = async (p) => parse(await readFile(join(ROOT, p), 'utf8'));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// a building fits its hex (2 flat-to-flat, pointy along z): no vertex farther than 10% past the hex's edge (KayKit's
// own buildings overhang their tile a little: they are drawn for it). The town centre may take a little more.
// A plot stays inside its hex (a neighbour's would overlap it at the same height), and a building on a plot stays
// inside the plot, so the plot shows around it.
const FOOTPRINT = { building: 1.1, 'town-centre': 1.25, plot: 1.0, 'on-plot': 0.9 };
// the roles a building can have: atlas's functions, but the land (plan/13 §1)
const ROLES = ['town-centre', 'houses', 'workshop', 'economy', 'utility', 'defence', 'trade', 'barracks', 'product'];
// any model; a building (the town draws about 80) has a tighter one, so a district stays inside the town's budget
const MAX_TRIS = 8000, MAX_BUILDING_TRIS = 4500;

async function run(out) {
  const kits = {};
  for (const k of (await readdir(join(ROOT, 'kits'))).sort()) kits[k] = await yaml(`kits/${k}/source.yaml`);
  const recipes = await yaml('catalog/recipes.yaml'), styles = await yaml('catalog/styles.yaml'), { states, ...civs } = await yaml('catalog/civs.yaml');
  const SHAPES = Object.keys(await yaml('catalog/shapes.yaml'));
  const errors = [], manifest = { kits: {}, models: {}, styles: {}, civs: {}, states: {} };

  const files = {}, atlases = {};
  for (const [name, kit] of Object.entries(kits)) {
    const f = kit.generator ? await generateKit(ROOT, kit) : await fetchKit(ROOT, kit, { lock: args.has('--lock') }); // a kit of our own is made (procgen), not fetched
    files[name] = f.models;
    if (f.palette) { // a made kit: its cells are its palette's, and a style may name them (catalog/styles.yaml)
      kit.palette = f.palette;
      kit.swatches = Object.values(f.palette).map((c) => c.cell);
    }
    atlases[name] = await readFile(f.atlas);
    manifest.kits[name] = { ...(kit.generator ? { generator: kit.generator } : { repo: kit.repo, commit: kit.commit }), licence: kit.licence, scale: kit.scale, turns: kit.turns };
    if (![2, 4, 6].includes(kit.turns)) errors.push(`kit ${name}: turns ${kit.turns} is not 2, 4 or 6`);
  }
  // a style's cells for a kit, "col,row" -> colour; a made kit's may be named by its palette ("team": its cell), which
  // keeps a style right when the palette moves a name to another cell
  const cellsOf = (st, kit) => Object.fromEntries(Object.entries(st.cells?.[kit] || {}).map(([key, colour]) => {
    if (/^\d,\d$/.test(key)) return [key, colour];
    const cell = kits[kit]?.palette?.[key]?.cell;
    if (!cell) errors.push(`a style names ${kit} cell ${key}, which is not in its palette`);
    return [cell || key, colour];
  }));
  const write = async (rel, bytes) => { await mkdir(join(out, rel, '..'), { recursive: true }); await writeFile(join(out, rel), bytes); };
  const emit = async (id, kit, parts, opts) => {
    const { doc, tris, bounds, reach, meshes, prims } = await build(parts, kits[kit].scale, opts);
    const bytes = Buffer.from(await io.writeBinary(doc)), file = `models/${id}.glb`;
    await write(file, bytes);
    if (meshes !== 1 || prims !== 1) errors.push(`${id}: ${meshes} meshes and ${prims} primitives, not one (a client draws one geometry per model)`);
    manifest.models[id] = { kit, file, bytes: bytes.length, sha256: sha256(bytes), tris,
      size: [0, 1, 2].map((i) => +(bounds.max[i] - bounds.min[i]).toFixed(3)), reach: +reach.toFixed(3) };
    if (tris > MAX_TRIS) errors.push(`${id}: ${tris} triangles, over ${MAX_TRIS}`);
  };
  const part = (ref) => { const [kit, name] = ref.split('/'); return files[kit]?.[name] && { kit, file: files[kit][name] }; };

  for (const [kit, models] of Object.entries(files)) {
    for (const name of Object.keys(models)) await emit(`${kit}/${name}`, kit, [{ file: models[name] }], { ground: !name.startsWith('hex_') });
  }
  for (const [id, r] of Object.entries(recipes)) {
    const parts = r.parts.map((p) => ({ ...p, file: files[r.kit]?.[p.model] }));
    if (parts.some((p) => !p.file)) { errors.push(`recipe ${id}: a part is not a ${r.kit} model`); continue; }
    await emit(`recipe/${id}`, r.kit, parts);
  }
  // a civ's plot and its dressing, from its own kit
  for (const [civ, c] of Object.entries(civs)) {
    if (!kits[c.kit]) { errors.push(`${civ}: kit ${c.kit} is not in kits/`); continue; }
    if (c.plot) {
      const p = part(c.plot.model);
      if (!p || p.kit !== c.kit) errors.push(`${civ}: plot ${c.plot.model} is not a ${c.kit} model`);
      else await emit(`plot/${civ}`, c.kit, [{ file: p.file, scale: c.plot.scale || 1 }], { ground: 'top' });
    }
    const d = c.dress;
    if (!d) continue;
    const bad = d.parts.filter((ref) => !part(ref) || part(ref).kit !== c.kit);
    if (bad.length) { errors.push(`${civ}: dress ${bad.join(', ')} not ${c.kit} models`); continue; }
    for (let n = 0; n < d.count; n++) {
      const rnd = rng(`${civ}/${n}`), parts = [], unit = 1 / kits[c.kit].scale; // offsets in hex units
      for (let i = 0, k = 3 + Math.floor(rnd() * 3); i < k; i++) {
        const p = part(d.parts[Math.floor(rnd() * d.parts.length)]);
        const a = rnd() * Math.PI * 2, r = (0.15 + rnd() * 0.55) * unit;
        parts.push({ file: p.file, at: [Math.cos(a) * r, 0, Math.sin(a) * r], rot: rnd() * Math.PI * 2, scale: (d.scale || 1) * (0.8 + rnd() * 0.4) });
      }
      // not grounded: the packs' props stand on their own origin (a tree's roots go below it)
      await emit(`dress/${civ}-${n}`, c.kit, parts, { ground: false });
    }
  }

  // a style paints the kits its civs draw, and hexagon (tiles, construction); a style no civ uses (pack) paints all
  const painted = {};
  for (const c of Object.values(civs)) for (const st of c.styles || []) (painted[st] ||= new Set(['hexagon'])).add(c.kit);
  for (const [id, st] of Object.entries(styles)) {
    manifest.styles[id] = {};
    for (const kit of Object.keys(kits)) {
      if (painted[id] && !painted[id].has(kit)) continue;
      const file = `styles/${id}/${kit}.png`;
      await write(file, paint(atlases[kit], st, cellsOf(st, kit)));
      manifest.styles[id][kit] = file;
    }
    for (const kit of Object.keys(st.cells || {})) {
      if (!kits[kit]) { errors.push(`style ${id}: cells for an unknown kit ${kit}`); continue; }
      for (const [key, colour] of Object.entries(cellsOf(st, kit))) {
        const [c, r] = key.split(',').map(Number);
        if (!(c >= 0 && c < 8 && r >= 0 && r < 4) || !/^#[0-9a-f]{6}$/i.test(colour)) errors.push(`style ${id}: ${kit} cell ${key}: ${colour} is not "col,row" (8×4) to #rrggbb`);
        else if (kits[kit]?.swatches && !kits[kit].swatches.includes(key)) errors.push(`style ${id}: ${kit} cell ${key} is not one of its swatches (recolouring it would cut a seam through its image)`);
      }
    }
  }

  const model = (ref, where) => {
    if (!manifest.models[ref]) errors.push(`${where}: ${ref} is not a model`);
    return ref;
  };
  const ages = civs.default.styles.length;
  for (const [civ, c] of Object.entries(civs)) {
    if (!kits[c.kit]) continue; // reported above
    if (civ !== 'default' && !c.roles.product) errors.push(`${civ}: no product (a role it doesn't list draws its product)`);
    if (c.styles.length !== ages) errors.push(`${civ}: ${c.styles.length} styles, the default has ${ages} ages`);
    for (const s of c.styles) if (!styles[s]) errors.push(`${civ}: style ${s} is not in styles.yaml`);
    const roles = {};
    for (const [role, perAge] of Object.entries(c.roles)) {
      if (!ROLES.includes(role)) errors.push(`${civ}: ${role} is not a role (${ROLES.join(', ')})`);
      if (perAge.length !== ages) errors.push(`${civ}/${role}: ${perAge.length} ages, want ${ages}`);
      roles[role] = perAge.map((v, age) => [v].flat().map((ref) => {
        const id = model(ref, `${civ}/${role}/${age + 1}`), m = manifest.models[id];
        if (m && m.kit !== c.kit) errors.push(`${civ}/${role}/${age + 1}: ${ref} is a ${m.kit} model, and ${civ} draws ${c.kit} only`);
        if (m && role !== 'town-centre' && m.tris > MAX_BUILDING_TRIS) errors.push(`${civ}/${role}/${age + 1}: ${ref} has ${m.tris} triangles, over ${MAX_BUILDING_TRIS} for a building`);
        const limit = FOOTPRINT[role === 'town-centre' ? 'town-centre' : c.plot ? 'on-plot' : 'building'];
        if (m && m.reach > limit) errors.push(`${civ}/${role}/${age + 1}: ${ref} reaches ${m.reach} of its hex, over ${limit}`);
        return id;
      }));
    }
    // shapes: one per variant, from the vocabulary, on a variant this civ draws
    const drawn = new Set(Object.values(roles).flat(2)), shapes = {};
    for (const [ref, shape] of Object.entries(c.shapes || {})) {
      if (!SHAPES.includes(shape)) errors.push(`${civ}: shape ${shape} (${ref}) is not one of ${SHAPES.join(', ')}`);
      if (!drawn.has(ref)) errors.push(`${civ}: shape on ${ref}, which none of its roles draws`);
      shapes[ref] = shape;
    }
    manifest.civs[civ] = { kit: c.kit, styles: c.styles, roles, ...(Object.keys(shapes).length && { shapes }), ...(c.plot && { plot: `plot/${civ}` }),
      dress: c.dress ? Array.from({ length: c.dress.count }, (_, n) => `dress/${civ}-${n}`) : [] };
    for (const id of [manifest.civs[civ].plot, ...manifest.civs[civ].dress].filter(Boolean)) {
      const limit = id.startsWith('plot/') ? FOOTPRINT.plot : FOOTPRINT.building;
      if (manifest.models[id]?.reach > limit) errors.push(`${id} reaches ${manifest.models[id].reach} of its hex, over ${limit}`);
    }
    // its district's ground is the hex tile in its style: the style must colour the tile's grass (0,2), and, but for
    // the town's own, the team cell (0,3) the shared construction props show
    for (const st of c.styles) for (const cell of civ === 'default' ? ['0,2'] : ['0,2', '0,3']) {
      if (!styles[st]?.cells?.hexagon?.[cell]) errors.push(`${civ}: style ${st} has no hexagon cell ${cell} (its ground and construction colours)`);
    }
  }
  for (const [civ, c] of Object.entries(manifest.civs)) {
    if (civ !== 'default') continue;
    for (const role of ROLES) {
      if (!c.roles[role]) errors.push(`default: no ${role}`);
    }
  }
  for (const [state, refs] of Object.entries(states)) {
    manifest.states[state] = refs.map((r) => model(r, `states/${state}`));
    for (const r of refs) if (manifest.models[r]?.reach > FOOTPRINT.building) errors.push(`states/${state}: ${r} reaches ${manifest.models[r].reach} of its hex`);
  }
  manifest.roles = ROLES;
  manifest.shapes = SHAPES;

  await write('manifest.json', JSON.stringify(manifest, null, 1) + '\n');
  return errors;
}

// tree: every file under dir by its content hash; a PNG by its decoded pixels, since zlib's deflate output may differ
// between Node builds while the image does not
async function tree(dir) {
  const out = {};
  const hash = async (p) => { const b = await readFile(p); return sha256(p.endsWith('.png') ? PNG.sync.read(b).data : b); };
  const walk = async (d) => { for (const e of await readdir(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) await walk(p); else out[relative(dir, p)] = await hash(p); } };
  await walk(dir).catch(() => {});
  return out;
}

const dist = join(ROOT, 'dist');
if (args.has('--check')) {
  const tmp = await mkdtemp(join(tmpdir(), 'ukubi-kit-'));
  const errors = await run(tmp);
  const [a, b] = [await tree(dist), await tree(tmp)];
  for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[f] !== b[f]) errors.push(`dist/${f} is ${a[f] ? (b[f] ? 'stale' : 'extra') : 'missing'}: run npm run build`);
  await rm(tmp, { recursive: true, force: true });
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log(`check: dist/ is current (${Object.keys(a).length} files)`);
} else {
  await rm(dist, { recursive: true, force: true });
  const errors = await run(dist);
  const files = await tree(dist);
  console.log(`build: ${Object.keys(files).length} files in dist/`);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
}
