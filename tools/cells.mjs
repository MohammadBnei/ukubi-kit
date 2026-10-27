#!/usr/bin/env bun
// cells: which cells of a kit's atlas grid (COLS×ROWS, 8×4) its models' UVs land in ("col,row", row 0 at the top), with vertex
// counts, so a style knows which cell to recolour.   bun tools/cells.mjs <kit> [model …]
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { readGLTF } from './model.mjs';
import { COLS, ROWS } from './procgen/atlas.mjs';
import { kindOf, sources } from './sources.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const [kitName, ...names] = process.argv.slice(2);
if (!kitName) { console.error('usage: cells.mjs <kit> [model …]'); process.exit(2); }
const kit = parse(await readFile(`${ROOT}kits/${kitName}/source.yaml`, 'utf8'));
const source = sources[kindOf(kit)];
if (!source.file) { console.error(`cells: ${kitName} is a ${kindOf(kit)} kit, with no atlas grid`); process.exit(2); }
const fileOf = await source.file(ROOT, kit); // a pinned pack's from the cache; a kit of our own, made
for (const m of kit.models.filter((m) => !names.length || names.some((n) => m.endsWith(n)))) {
  const doc = await readGLTF(fileOf(m)), cells = {}, v = [];
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const uv = p.getAttribute('TEXCOORD_0');
    for (let i = 0; uv && i < uv.getCount(); i++) { uv.getElement(i, v); const k = `${Math.min(COLS - 1, Math.floor(v[0] * COLS))},${Math.min(ROWS - 1, Math.floor(v[1] * ROWS))}`; cells[k] = (cells[k] || 0) + 1; }
  }
  console.log(m, Object.entries(cells).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(' '));
}
