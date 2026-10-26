#!/usr/bin/env node
// build: kits (kits/*/source.yaml) and the catalog (catalog/*.yaml) into dist/, the files the game embeds:
//   dist/models/<kit>/<name>.glb      a kit's model, imported (model.mjs)
//   dist/models/recipe/<id>.glb        a kitbash (catalog/recipes.yaml)
//   dist/models/dress/<id>-<n>.glb     seeded dressing (catalog/civs.yaml dress)
//   dist/styles/<style>/<kit>.png      a kit's atlas in a style (style.mjs), for every style and kit
//   dist/manifest.json                 what is where: kits and licences, models (tris, bounds, footprint), styles, civs
// Then it validates: every catalog reference resolves, every civ draws each of its roles in every age, buildings fit a
// hex, and no model is over its triangle budget.
//   --lock   write kits/*/lock.json from what the pins fetch (review the diff)
//   --check  build into a temporary directory and fail unless it equals dist/ byte for byte (determinism, freshness)
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { PNG } from 'pngjs';
import { parse } from 'yaml';
import { fetchKit } from './fetch.mjs';
import { build, io } from './model.mjs';
import { paint } from './style.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const args = new Set(process.argv.slice(2));
const yaml = async (p) => parse(await readFile(join(ROOT, p), 'utf8'));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// a building fits its hex (2 flat-to-flat, pointy along z): no vertex farther than 10% past the hex's edge (KayKit's
// own buildings overhang their tile a little: they are drawn for it). The town centre may take a little more.
const FOOTPRINT = { building: 1.1, 'town-centre': 1.25 };
// the roles a building can have: atlas's functions, but the land (plan/13 §1)
const ROLES = ['town-centre', 'houses', 'workshop', 'economy', 'utility', 'defence', 'trade', 'barracks', 'product'];
const MAX_TRIS = 8000;

async function run(out) {
  const kits = {};
  for (const k of (await readdir(join(ROOT, 'kits'))).sort()) kits[k] = await yaml(`kits/${k}/source.yaml`);
  const recipes = await yaml('catalog/recipes.yaml'), styles = await yaml('catalog/styles.yaml'), civs = await yaml('catalog/civs.yaml');
  const errors = [], manifest = { kits: {}, models: {}, styles: {}, civs: {}, states: {}, dress: {} };

  const files = {}, atlases = {};
  for (const [name, kit] of Object.entries(kits)) {
    const f = await fetchKit(ROOT, kit, { lock: args.has('--lock') });
    files[name] = f.models;
    atlases[name] = await readFile(f.atlas);
    manifest.kits[name] = { repo: kit.repo, commit: kit.commit, licence: kit.licence, scale: kit.scale };
  }
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
  for (const [id, d] of Object.entries(civs.dress || {})) {
    for (let n = 0; n < d.count; n++) {
      const rnd = mulberry32(hash32(`${id}/${n}`)), parts = [];
      const bad = d.parts.filter((ref) => !part(ref) || part(ref).kit !== d.kit);
      if (bad.length) { errors.push(`dress ${id}: ${bad.join(', ')} not ${d.kit} models`); break; }
      for (let i = 0, k = 3 + Math.floor(rnd() * 3); i < k; i++) {
        const p = part(d.parts[Math.floor(rnd() * d.parts.length)]);
        const a = rnd() * Math.PI * 2, r = 0.15 + rnd() * 0.55;
        parts.push({ file: p.file, at: [Math.cos(a) * r, 0, Math.sin(a) * r], rot: rnd() * Math.PI * 2, scale: 0.8 + rnd() * 0.4 });
      }
      await emit(`dress/${id}-${n}`, d.kit, parts);
    }
    manifest.dress[id] = Array.from({ length: d.count }, (_, n) => `dress/${id}-${n}`);
  }

  for (const [id, st] of Object.entries(styles)) {
    manifest.styles[id] = {};
    for (const kit of Object.keys(kits)) {
      const file = `styles/${id}/${kit}.png`;
      await write(file, paint(atlases[kit], st, st.cells?.[kit] || {}));
      manifest.styles[id][kit] = file;
    }
    for (const [kit, cells] of Object.entries(st.cells || {})) {
      if (!kits[kit]) errors.push(`style ${id}: cells for an unknown kit ${kit}`);
      for (const [key, colour] of Object.entries(cells)) {
        const [c, r] = key.split(',').map(Number);
        if (!(c >= 0 && c < 8 && r >= 0 && r < 4) || !/^#[0-9a-f]{6}$/i.test(colour)) errors.push(`style ${id}: ${kit} cell ${key}: ${colour} is not "col,row" (8×4) to #rrggbb`);
      }
    }
  }

  const model = (ref, where) => {
    if (!manifest.models[ref]) errors.push(`${where}: ${ref} is not a model`);
    return ref;
  };
  const ages = civs.default.styles.length;
  for (const [civ, c] of Object.entries(civs)) {
    if (['states', 'dress'].includes(civ)) continue;
    if (c.styles.length !== ages) errors.push(`${civ}: ${c.styles.length} styles, the default has ${ages} ages`);
    for (const s of c.styles) if (!styles[s]) errors.push(`${civ}: style ${s} is not in styles.yaml`);
    const roles = {};
    for (const [role, perAge] of Object.entries(c.roles)) {
      if (!ROLES.includes(role)) errors.push(`${civ}: ${role} is not a role (${ROLES.join(', ')})`);
      if (perAge.length !== ages) errors.push(`${civ}/${role}: ${perAge.length} ages, want ${ages}`);
      roles[role] = perAge.map((v, age) => [v].flat().map((ref) => {
        const id = model(ref, `${civ}/${role}/${age + 1}`), m = manifest.models[id];
        const limit = FOOTPRINT[role === 'town-centre' ? 'town-centre' : 'building'];
        if (m && m.reach > limit) errors.push(`${civ}/${role}/${age + 1}: ${ref} reaches ${m.reach} of its hex, over ${limit}`);
        return id;
      }));
    }
    manifest.civs[civ] = { styles: c.styles, roles };
  }
  for (const [civ, c] of Object.entries(manifest.civs)) {
    if (civ !== 'default') continue;
    for (const role of ROLES) {
      if (!c.roles[role]) errors.push(`default: no ${role}`);
    }
  }
  for (const [state, refs] of Object.entries(civs.states)) {
    manifest.states[state] = refs.map((r) => model(r, `states/${state}`));
    for (const r of refs) if (manifest.models[r]?.reach > FOOTPRINT.building) errors.push(`states/${state}: ${r} reaches ${manifest.models[r].reach} of its hex`);
  }
  for (const [id, vs] of Object.entries(manifest.dress)) for (const v of vs) if (manifest.models[v]?.reach > FOOTPRINT.building) errors.push(`dress ${id}: ${v} reaches ${manifest.models[v].reach}`);
  manifest.roles = ROLES;

  await write('manifest.json', JSON.stringify(manifest, null, 1) + '\n');
  return errors;
}

// hash32 and mulberry32: a seeded PRNG, so a variant is the same on every build and machine
function hash32(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

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
