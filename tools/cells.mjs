#!/usr/bin/env node
// cells: which cells of a kit's 8×4 atlas grid its models' UVs land in ("col,row", row 0 at the top), with vertex
// counts, so a style knows which cell to recolour.   node tools/cells.mjs <kit> [model …]
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { readGLTF } from './model.mjs';
import { generateKit } from './procgen/kit.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const [kitName, ...names] = process.argv.slice(2);
if (!kitName) { console.error('usage: cells.mjs <kit> [model …]'); process.exit(2); }
const kit = parse(await readFile(`${ROOT}kits/${kitName}/source.yaml`, 'utf8'));
const made = kit.generator && (await generateKit(ROOT, kit)).models; // a kit of our own: made, not cached from a pin
for (const m of kit.models.filter((m) => !names.length || names.some((n) => m.endsWith(n)))) {
  const doc = await readGLTF(made ? made[m] : `${ROOT}cache/${kit.name}/${kit.commit}/${m.endsWith('.glb') ? m : `${m}.gltf`}`), cells = {}, v = [];
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const uv = p.getAttribute('TEXCOORD_0');
    for (let i = 0; uv && i < uv.getCount(); i++) { uv.getElement(i, v); const k = `${Math.min(7, Math.floor(v[0] * 8))},${Math.min(3, Math.floor(v[1] * 4))}`; cells[k] = (cells[k] || 0) + 1; }
  }
  console.log(m, Object.entries(cells).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(' '));
}
