// model: a KayKit .gltf as one of the kit's .glb files, and kitbashing several into one. Textures are dropped (the
// game paints every model with its civ's style through the model's UVs, which are kept), the meshes are flattened and
// joined into one mesh with one primitive, scaled by the kit's normalising scale, and quantized (KHR_mesh_quantization
// only: the consumer's CSP blocks the WASM decoders Draco and meshopt need).
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Document, getBounds, Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  flatten,
  join as joinMeshes,
  mergeDocuments,
  prune,
  quantize,
  transformMesh,
  unpartition
} from '@gltf-transform/functions';

export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const quiet = new Logger(Logger.Verbosity.WARN);

/** read a cached .gltf with its buffers (its images and textures dropped before glTF-Transform sees them), or a .glb. */
export async function readGLTF(file) {
  if (file.endsWith('.glb')) {
    // binary glTF: its embedded images go after the read, before anything uses them
    const doc = await io.read(file);
    for (const t of doc.getRoot().listTextures()) t.dispose();
    return doc;
  }
  const json = JSON.parse(await readFile(file, 'utf8'));
  for (const m of json.materials || []) {
    if (m.pbrMetallicRoughness) delete m.pbrMetallicRoughness.baseColorTexture;
    for (const k of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) delete m[k];
  }
  delete json.images;
  delete json.textures;
  delete json.samplers;
  const resources = {};
  for (const b of json.buffers || []) resources[b.uri] = new Uint8Array(await readFile(join(dirname(file), b.uri)));
  return io.readJSON({ json, resources });
}

const TRS = (at = [0, 0, 0], rot = 0, scale = 1) => {
  const c = Math.cos(rot),
    s = Math.sin(rot); // about +y, then translate
  return [c * scale, 0, -s * scale, 0, 0, scale, 0, 0, s * scale, 0, c * scale, 0, at[0], at[1], at[2], 1];
};

/**
 * build: parts [{file, at, rot, scale, stack}] (one part is a plain import) → {doc, tris, bounds}. A part with stack
 * sits on the previous part's top. The kit's scale applies to the whole.
 */
export async function build(parts, kitScale = 1, { ground = true } = {}) {
  const doc = new Document();
  doc.setLogger(quiet);
  doc.createBuffer();
  const scene = doc.createScene();
  let top = 0;
  for (const p of parts) {
    const part = await readGLTF(p.file);
    part.setLogger(quiet);
    // one material for the whole part: the style paints every model of a kit with one texture, and a pack's
    // per-node material copies (a chest's lid) would otherwise keep its meshes apart
    const [mat] = part.getRoot().listMaterials();
    // and one set of attributes: what the style needs (some packs carry TANGENT or COLOR_0, which join won't mix)
    for (const mesh of part.getRoot().listMeshes())
      for (const prim of mesh.listPrimitives()) {
        prim.setMaterial(mat);
        for (const sem of prim.listSemantics())
          if (!['POSITION', 'NORMAL', 'TEXCOORD_0'].includes(sem)) prim.setAttribute(sem, null);
      }
    await part.transform(flatten(), joinMeshes(), prune({ keepAttributes: true })); // keep the UVs: no texture uses them here, the style does at runtime
    const b = getBounds(part.getRoot().getDefaultScene() || part.getRoot().listScenes()[0]);
    const at = [...(p.at || [0, 0, 0])];
    if (p.stack) at[1] += top - b.min[1] * (p.scale || 1);
    const mats = part.getRoot().listMeshes();
    for (const mesh of mats) transformMesh(mesh, TRS(at, p.rot || 0, p.scale || 1));
    top = Math.max(top, at[1] + b.max[1] * (p.scale || 1));
    const map = mergeDocuments(doc, part);
    for (const n of part.getRoot().listScenes()[0].listChildren()) scene.addChild(map.get(n));
  }
  for (const s of doc.getRoot().listScenes()) if (s !== scene) s.dispose();
  doc.getRoot().setDefaultScene(scene);
  // dedup first: each merged part brought its own copy of the material, and join merges only what shares one
  await doc.transform(unpartition(), dedup(), flatten(), joinMeshes(), prune({ keepAttributes: true }));
  if (kitScale !== 1) for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, TRS([0, 0, 0], 0, kitScale));
  if (ground) {
    // stand on y = 0 (City's withoutBase models float 0.07 above it); tiles keep their own top at 0. A
    // plot ('top') lies on the tile instead: its top just above y = 0, the rest sunk into the tile
    const b = getBounds(scene),
      y = ground === 'top' ? b.max[1] - 0.02 : b.min[1];
    for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, TRS([0, -y, 0]));
  }
  const bounds = getBounds(scene);
  // the hex reach: the farthest vertex in hexes (1 = on the hex's own edge, flat-to-flat 2, pointy along z)
  let reach = 0;
  const v = [];
  for (const mesh of doc.getRoot().listMeshes())
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION');
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        const x = Math.abs(v[0]),
          z = Math.abs(v[2]);
        reach = Math.max(reach, x, x / 2 + (z * Math.sqrt(3)) / 2);
      }
    }
  const meshes = doc.getRoot().listMeshes(),
    prims = meshes.flatMap(m => m.listPrimitives()).length;
  await doc.transform(quantize({ quantizePosition: 16, quantizeNormal: 16, quantizeTexcoord: 16 }));
  const tris = doc
    .getRoot()
    .listMeshes()
    .flatMap(m => m.listPrimitives())
    .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);
  return { doc, tris, bounds, reach, meshes: meshes.length, prims };
}
