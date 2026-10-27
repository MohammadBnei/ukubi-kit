#!/usr/bin/env bun
// build: kits (kits/*/source.yaml) and the catalog (catalog/*.yaml) into dist/, the files the game embeds:
//   dist/models/<kit>/<name>.glb      a kit's model, imported (model.mjs)
//   dist/models/recipe/<id>.glb        a kitbash (catalog/recipes.yaml)
//   dist/models/plot/<civ>.glb         the floor under a civ's buildings (catalog/civs.yaml plot), lying on the tile
//   dist/models/dress/<civ>-<n>.glb    a civ's seeded dressing (catalog/civs.yaml dress)
//   dist/styles/<style>/<kit>.png      a kit's atlas in a style (style.mjs): the kits the style's civs draw, and
//                                      the world kit (catalog/civs.yaml world: the tiles and construction states
//                                      every civ shares)
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
import { COLS, ROWS } from './procgen/atlas.mjs';
import { rng } from './procgen/random.mjs';
import { kindOf, sources } from './sources.mjs';
import { build, io } from './model.mjs';
import { character, clips } from './character.mjs';
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
// a character (one skinned draw: its body, its hat or cape baked in, nothing held)
const MAX_CHARACTER_TRIS = 5500;

async function run(out) {
  const kits = {};
  for (const k of (await readdir(join(ROOT, 'kits'))).sort()) kits[k] = await yaml(`kits/${k}/source.yaml`);
  const recipes = await yaml('catalog/recipes.yaml'), styles = await yaml('catalog/styles.yaml'), { states, world, ...civs } = await yaml('catalog/civs.yaml');
  const SHAPES = Object.keys(await yaml('catalog/shapes.yaml'));
  const errors = [], manifest = { kits: {}, models: {}, styles: {}, civs: {}, states: {}, characters: {}, clips: null };

  const files = {}, atlases = {};
  // a character kit (kits/<kit>/source.yaml characters:) is the town's people: its own path (characters()), never a
  // civ's model kit: no style paints it, no role draws it
  const people = Object.fromEntries(Object.entries(kits).filter(([, k]) => kindOf(k) === 'characters'));
  for (const name of Object.keys(people)) delete kits[name];
  for (const [name, kit] of Object.entries(kits)) { // in the kits' order, whatever their kinds (the manifest's order)
    const source = sources[kindOf(kit)], f = await source.load(ROOT, kit, { lock: args.has('--lock') });
    files[name] = f.models;
    if (f.palette) { // a made kit: its cells are its palette's, and a style may name them (catalog/styles.yaml)
      kit.palette = f.palette;
      kit.swatches = Object.values(f.palette).map((c) => c.cell);
    }
    atlases[name] = await readFile(f.atlas);
    manifest.kits[name] = { ...source.origin(kit), licence: kit.licence, scale: kit.scale, turns: kit.turns };
    if (![2, 4, 6].includes(kit.turns)) errors.push(`kit ${name}: turns ${kit.turns} is not 2, 4 or 6`);
  }
  // the world kit (catalog/civs.yaml world): a model kit, its tiles its models, its two cells on the grid; without it
  // nothing else can be checked
  const cell = /^\d,\d$/, worldErrors = [
    !files[world?.kit] && `world: kit ${world?.kit} is not a model kit in kits/`,
    ...(world?.tiles || []).filter((t) => !files[world?.kit]?.[t]).map((t) => `world: tile ${t} is not a ${world?.kit} model`),
    !(world?.tiles || []).length && 'world: no tiles',
    ...['ground', 'team'].filter((k) => !cell.test(world?.[k])).map((k) => `world: ${k} ${world?.[k]} is not "col,row"`),
  ].filter(Boolean);
  if (worldErrors.length) return worldErrors;
  const tile = (kit, name) => kit === world.kit && world.tiles.includes(name); // a tile lies at its own origin
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
    for (const name of Object.keys(models)) await emit(`${kit}/${name}`, kit, [{ file: models[name] }], { ground: !tile(kit, name) });
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

  // a style paints the kits its civs draw, and the world kit (tiles, construction); a style no civ uses (pack) paints all
  const painted = {};
  for (const c of Object.values(civs)) for (const st of c.styles || []) (painted[st] ||= new Set([world.kit])).add(c.kit);
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
        if (!(c >= 0 && c < COLS && r >= 0 && r < ROWS) || !/^#[0-9a-f]{6}$/i.test(colour)) errors.push(`style ${id}: ${kit} cell ${key}: ${colour} is not "col,row" (${COLS}×${ROWS}) to #rrggbb`);
        else if (kits[kit]?.swatches && !kits[kit].swatches.includes(key)) errors.push(`style ${id}: ${kit} cell ${key} is not one of its swatches (recolouring it would cut a seam through its image)`);
      }
    }
  }

  await characters(people, write, manifest, errors);

  // the checks after the build, as ordered lists (mountain plan/15: a list that grows is a registry): a civ is resolved
  // first (its roles' model ids), then each check reads it and writes nothing, then its manifest entry is assembled.
  // The lists' order is the order the errors print in.
  const isModel = (ref, where) => { if (!manifest.models[ref]) errors.push(`${where}: ${ref} is not a model`); };
  const ages = civs.default.styles.length;
  // a role's model, in an age: {ref, where, m (its manifest entry), civ, c, role}
  const refChecks = [
    function known({ ref, where }) { isModel(ref, where); },
    function ownKit({ ref, where, m, civ, c }) { if (m && m.kit !== c.kit) errors.push(`${where}: ${ref} is a ${m.kit} model, and ${civ} draws ${c.kit} only`); },
    function buildingTris({ ref, where, m, role }) { if (m && role !== 'town-centre' && m.tris > MAX_BUILDING_TRIS) errors.push(`${where}: ${ref} has ${m.tris} triangles, over ${MAX_BUILDING_TRIS} for a building`); },
    function footprint({ ref, where, m, c, role }) {
      const limit = FOOTPRINT[role === 'town-centre' ? 'town-centre' : c.plot ? 'on-plot' : 'building'];
      if (m && m.reach > limit) errors.push(`${where}: ${ref} reaches ${m.reach} of its hex, over ${limit}`);
    },
  ];
  // a civ: {civ, c (its catalog entry), roles (resolved)}
  const civChecks = [
    function product({ civ, c }) { if (civ !== 'default' && !c.roles.product) errors.push(`${civ}: no product (a role it doesn't list draws its product)`); },
    function styleAges({ civ, c }) { if (c.styles.length !== ages) errors.push(`${civ}: ${c.styles.length} styles, the default has ${ages} ages`); },
    function stylesKnown({ civ, c }) { for (const s of c.styles) if (!styles[s]) errors.push(`${civ}: style ${s} is not in styles.yaml`); },
    function roles({ civ, c, roles }) {
      for (const [role, perAge] of Object.entries(c.roles)) {
        if (!ROLES.includes(role)) errors.push(`${civ}: ${role} is not a role (${ROLES.join(', ')})`);
        if (perAge.length !== ages) errors.push(`${civ}/${role}: ${perAge.length} ages, want ${ages}`);
        roles[role].forEach((refs, age) => {
          for (const ref of refs) for (const check of refChecks) check({ ref, where: `${civ}/${role}/${age + 1}`, m: manifest.models[ref], civ, c, role });
        });
      }
    },
    // shapes: one per variant, from the vocabulary, on a variant this civ draws
    function shapes({ civ, c, roles }) {
      const drawn = new Set(Object.values(roles).flat(2));
      for (const [ref, shape] of Object.entries(c.shapes || {})) {
        if (!SHAPES.includes(shape)) errors.push(`${civ}: shape ${shape} (${ref}) is not one of ${SHAPES.join(', ')}`);
        if (!drawn.has(ref)) errors.push(`${civ}: shape on ${ref}, which none of its roles draws`);
      }
    },
    function landReach({ civ, c }) {
      for (const id of [c.plot && `plot/${civ}`, ...dressOf(civ, c)].filter(Boolean)) {
        const limit = id.startsWith('plot/') ? FOOTPRINT.plot : FOOTPRINT.building;
        if (manifest.models[id]?.reach > limit) errors.push(`${id} reaches ${manifest.models[id].reach} of its hex, over ${limit}`);
      }
    },
    // its district's ground is the world's tile in its style: the style must colour the tile's ground cell, and, but
    // for the town's own, the team cell the shared construction props show
    function groundCells({ civ, c }) {
      for (const st of c.styles) for (const cell of civ === 'default' ? [world.ground] : [world.ground, world.team]) {
        if (!styles[st]?.cells?.[world.kit]?.[cell]) errors.push(`${civ}: style ${st} has no ${world.kit} cell ${cell} (its ground and construction colours)`);
      }
    },
  ];
  const dressOf = (civ, c) => (c.dress ? Array.from({ length: c.dress.count }, (_, n) => `dress/${civ}-${n}`) : []);
  for (const [civ, c] of Object.entries(civs)) {
    if (!kits[c.kit]) continue; // reported above
    const roles = Object.fromEntries(Object.entries(c.roles).map(([role, perAge]) => [role, perAge.map((v) => [v].flat())]));
    for (const check of civChecks) check({ civ, c, roles });
    const shapes = Object.fromEntries(Object.entries(c.shapes || {}));
    manifest.civs[civ] = { kit: c.kit, styles: c.styles, roles, ...(Object.keys(shapes).length && { shapes }), ...(c.plot && { plot: `plot/${civ}` }),
      dress: dressOf(civ, c) };
  }
  for (const [state, refs] of Object.entries(states)) manifest.states[state] = [...refs];
  // the town's own
  const checks = [
    function defaultRoles() { for (const role of manifest.civs.default ? ROLES : []) if (!manifest.civs.default.roles[role]) errors.push(`default: no ${role}`); },
    function stateModels() {
      for (const [state, refs] of Object.entries(states)) {
        for (const r of refs) isModel(r, `states/${state}`);
        for (const r of refs) if (manifest.models[r]?.reach > FOOTPRINT.building) errors.push(`states/${state}: ${r} reaches ${manifest.models[r].reach} of its hex`);
        // a wonder stands on the town centre's ring like a building: the building's triangle budget
        for (const r of state === 'wonder' ? refs : []) if (manifest.models[r]?.tris > MAX_BUILDING_TRIS) errors.push(`states/wonder: ${r} has ${manifest.models[r].tris} triangles, over ${MAX_BUILDING_TRIS}`);
      }
    },
  ];
  for (const check of checks) check();
  manifest.roles = ROLES;
  manifest.shapes = SHAPES;

  await write('manifest.json', JSON.stringify(manifest, null, 1) + '\n');
  return errors;
}

// characters: each character kit's people (dist/characters/<name>.glb, its texture <png>.png, one per image) and the
// clip file (dist/characters/clips.glb: the rig and the named clips), checked: every character on the clips' rig, by
// joint name and order, and within its triangle budget.
async function characters(people, write, manifest, errors) {
  for (const [kitName, kit] of Object.entries(people)) {
    const source = sources.characters, f = await source.load(ROOT, kit, { lock: args.has('--lock') });
    manifest.kits[kitName] = { ...source.origin(kit), licence: kit.licence, characters: true };
    const fileOf = (model) => f.models[model.split('/').pop().replace(/\.glb$/, '')];
    const rig = await clips(fileOf(kit.characters[kit.clips.from].model), kit.clips.names);
    const cbytes = Buffer.from(await io.writeBinary(rig.doc));
    await write('characters/clips.glb', cbytes);
    if (manifest.clips) errors.push(`${kitName}: a second clip file (one rig for the town)`);
    manifest.clips = { kit: kitName, file: 'characters/clips.glb', bytes: cbytes.length, sha256: sha256(cbytes), names: kit.clips.names, joints: rig.joints.length };
    const textures = {};
    let bind; // the clips' character's inverse bind matrices: every character's must match (the clips carry its bones' rest)
    for (const [name, c] of Object.entries({ [kit.clips.from]: kit.characters[kit.clips.from], ...kit.characters })) {
      const ch = await character(fileOf(c.model), c.keep);
      if (ch.joints.join() !== rig.joints.join()) errors.push(`character ${name}: its rig is not the clips' (${ch.joints.length} joints)`);
      bind ||= ch.ibms;
      if (ch.ibms.length !== bind.length || ch.ibms.some((x, i) => Math.abs(x - bind[i]) > 1e-4)) errors.push(`character ${name}: its bones are not the clips' rig (inverse bind matrices differ)`);
      if (ch.tris > MAX_CHARACTER_TRIS) errors.push(`character ${name}: ${ch.tris} triangles, over ${MAX_CHARACTER_TRIS}`);
      const bytes = Buffer.from(await io.writeBinary(ch.doc)), file = `characters/${name}.glb`, h = sha256(ch.png);
      textures[h] ||= `characters/${name}.png`; // characters sharing an image share its file
      if (textures[h] === `characters/${name}.png`) await write(textures[h], ch.png);
      await write(file, bytes);
      manifest.characters[name] = { kit: kitName, file, texture: textures[h], bytes: bytes.length, sha256: sha256(bytes), tris: ch.tris, height: ch.height };
    }
  }
}

// tree: every file under dir by its content hash; a PNG by its decoded pixels, since zlib's deflate output may differ
// between engines and platforms while the image does not
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
  for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[f] !== b[f]) errors.push(`dist/${f} is ${a[f] ? (b[f] ? 'stale' : 'extra') : 'missing'}: run bun run build`);
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
