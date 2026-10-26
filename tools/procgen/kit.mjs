// procgen/kit: a kit we make (docs/procedural.md). kits/<name>/source.yaml names its generator, a module beside it
// (`generator: models.mjs`) that exports `palette` (procgen/atlas.mjs palette()) and `models` ({name: () => Mesh}).
// generateKit writes the models and the atlas into cache/<kit>/<version>/, where build.mjs reads them like a fetched
// kit's files. The version is a hash of this library and the module, so an edit to either makes a new one, and the
// same sources always write the same bytes (build.mjs --check holds dist/ to that).
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

/** load: a kit's generator module and its version (a hash of the library's files and the module). */
export async function load(root, kit) {
  const file = join(root, 'kits', kit.name, kit.generator);
  const h = createHash('sha256');
  for (const f of (await readdir(LIB)).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs')).sort()) h.update(f).update(await readFile(new URL(f, LIB)));
  h.update(await readFile(file));
  const mod = await import(pathToFileURL(file).href);
  if (!mod.palette || !mod.models) throw new Error(`${kit.name}: ${kit.generator} exports no palette or no models`);
  return { mod, version: h.digest('hex').slice(0, 16) };
}

/** generateKit: write the kit's listed models and its atlas into cache/ → {models: {name: file}, atlas: file}. */
export async function generateKit(root, kit) {
  const { mod, version } = await load(root, kit);
  const unknown = kit.models.filter((m) => !mod.models[m]);
  if (unknown.length) throw new Error(`${kit.name}: ${unknown.join(', ')} not made by ${kit.generator} (it makes ${Object.keys(mod.models).join(', ')})`);
  const dir = join(root, 'cache', kit.name, version);
  await mkdir(dir, { recursive: true });
  const put = async (name, bytes) => { const f = join(dir, name); await writeFile(`${f}.part`, bytes); await rename(`${f}.part`, f); return f; };
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
  return { models, atlas: await put('atlas.png', atlas(mod.palette)) };
}
