// procgen/kit: a kit we make (docs/procedural.md). kits/<name>/source.yaml names its generator, a module beside it
// (`generator: models.mjs`) that exports `palette` (procgen/atlas.mjs palette()) and `models` ({name: () => Mesh}).
// generateKit writes the models and the atlas into cache/<kit>/<version>/, where build.mjs reads them like a fetched
// kit's files. The version is a hash of this library and the kit's directory, so an edit to either makes a new one,
// and the same sources always write the same bytes (build.mjs --check holds dist/ to that).
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { atlas, uv } from './atlas.mjs';
import { normal } from './mesh.mjs';

const io = new NodeIO();
const LIB = new URL('.', import.meta.url);

/** toDoc: a Mesh as a glTF document: one mesh, one primitive, flat normals, UVs in each face's cell. */
export function toDoc(mesh, name = 'model') {
  const [lo, hi] = mesh.bounds(), pos = [], nor = [], tex = [];
  for (const t of mesh.tris) {
    const n = normal(t.p);
    for (const p of t.p) {
      pos.push(...p); nor.push(...n);
      tex.push(...uv(t.cell, hi[1] > lo[1] ? (hi[1] - p[1]) / (hi[1] - lo[1]) : 0.5));
    }
  }
  const doc = new Document(), buf = doc.createBuffer();
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(new Float32Array(arr)).setBuffer(buf);
  const prim = doc.createPrimitive().setAttribute('POSITION', acc('VEC3', pos)).setAttribute('NORMAL', acc('VEC3', nor))
    .setAttribute('TEXCOORD_0', acc('VEC2', tex)).setMaterial(doc.createMaterial('procgen').setRoughnessFactor(1).setMetallicFactor(0));
  doc.createScene().addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  return doc;
}

/** load: a kit's generator module and its version: a hash of every .mjs file of the library and of the kit's own
 *  directory (its module and any helper it imports from there), so an edit to either makes a new version. */
export async function load(root, kit) {
  const dir = join(root, 'kits', kit.name), file = join(dir, kit.generator);
  const h = createHash('sha256');
  const hashDir = async (d, label) => {
    for (const f of (await readdir(d)).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs')).sort()) h.update(`${label}/${f}\0`).update(await readFile(join(d, f)));
  };
  await hashDir(fileURLToPath(LIB), 'procgen');
  await hashDir(dir, kit.name);
  const mod = await import(pathToFileURL(file).href);
  if (!mod.palette || !mod.models) throw new Error(`${kit.name}: ${kit.generator} exports no palette or no models`);
  return { mod, version: h.digest('hex').slice(0, 16) };
}

/** generateKit: write the kit's listed models and its atlas into cache/<kit>/<version>/ (older versions removed) →
 *  {models: {name: file}, atlas: file, palette}. */
export async function generateKit(root, kit) {
  const { mod, version } = await load(root, kit);
  const unknown = kit.models.filter((m) => !mod.models[m]);
  if (unknown.length) throw new Error(`${kit.name}: ${unknown.join(', ')} not made by ${kit.generator} (it makes ${Object.keys(mod.models).join(', ')})`);
  const base = join(root, 'cache', kit.name), dir = join(base, version);
  await mkdir(dir, { recursive: true });
  for (const old of await readdir(base)) if (old !== version) await rm(join(base, old), { recursive: true, force: true });
  // a temporary name of this process's own: two runs at once (a build and a check) never rename each other's file
  const tmp = `${process.pid}.${randomBytes(4).toString('hex')}.part`;
  const put = async (name, bytes) => { const f = join(dir, name); await writeFile(`${f}.${tmp}`, bytes); await rename(`${f}.${tmp}`, f); return f; };
  const models = {};
  for (const name of kit.models) {
    const mesh = mod.models[name]();
    const bad = mesh.problems();
    if (bad.length) throw new Error(`${kit.name}/${name}: ${bad.slice(0, 3).join('; ')}`);
    const { json, resources } = await io.writeJSON(toDoc(mesh, name));
    json.buffers[0].uri = `${name}.bin`;
    await put(`${name}.bin`, Object.values(resources)[0]);
    models[name] = await put(`${name}.gltf`, JSON.stringify(json));
  }
  return { models, atlas: await put('atlas.png', atlas(mod.palette)), palette: mod.palette };
}
