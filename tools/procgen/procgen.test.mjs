// The procgen library's tests (npm test): every primitive faces out, under any placement; cells and UVs stay in
// their cell; the palette refuses mistakes; a kit generates the same bytes twice; the ukubi kit's models are sound.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { NodeIO } from '@gltf-transform/core';
import { parse } from 'yaml';
import { atlas, palette, uv } from './atlas.mjs';
import { load, toDoc } from './kit.mjs';
import { Mesh, normal } from './mesh.mjs';
import { rng } from './random.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const pal = palette({ a: { cell: '0,0', top: '#ffffff', bottom: '#000000' }, b: { cell: '7,3', top: '#ff0000', bottom: '#00ff00' } });
const centroid = (pts) => pts.reduce((s, p) => s.map((v, i) => v + p[i] / pts.length), [0, 0, 0]);

// a convex primitive faces out when every triangle's normal points away from a point inside it: the mean of its
// distinct vertices (inside the hull of a convex shape, where the bounds' centre may not be: a wedge's isn't)
function facesOut(m, what) {
  const verts = [...new Map(m.tris.flatMap((t) => t.p).map((p) => [p.map((v) => v.toFixed(9)).join(), p])).values()], c = centroid(verts);
  assert.deepEqual(m.problems(), [], what);
  m.tris.forEach((t, i) => {
    const n = normal(t.p), g = centroid(t.p), d = g.map((v, k) => v - c[k]);
    assert.ok(n[0] * d[0] + n[1] * d[1] + n[2] * d[2] > 1e-9, `${what}: triangle ${i} faces in (normal ${n.map((v) => v.toFixed(2))})`);
  });
}

const PRIMITIVES = {
  box: (m, o) => m.box([0, 0, 0], [1, 0.6, 0.4], 'a', { top: 'b', ...o }),
  gable: (m, o) => m.gable([0, 0, 0], [1, 0.6], 0.4, 'a', { ends: 'b', o: 0, ...o }),
  'gable with eaves': (m, o) => m.gable([0, 0, 0], [1, 0.6], 0.4, 'a', o),
  hip: (m, o) => m.hip([0, 0, 0], [1.2, 0.6], 0.4, 'a', o),
  pyramid: (m, o) => m.hip([0, 0, 0], [0.6, 0.6], 0.4, 'a', o),
  shed: (m, o) => m.shed([0, 0, 0], [1, 0.6], 0.3, 0.5, 'a', o),
  'sawtooth tooth': (m, o) => m.sawtooth([0, 0, 0], [0.5, 0.6], 0.3, 1, 'a', 'b', o),
  prism: (m, o) => m.prism([0, 0, 0], 0.3, 0.8, 'a', { top: 'b', ...o }),
  'tapered prism': (m, o) => m.prism([0, 0, 0], 0.3, 0.8, 'a', { r1: 0.1, n: 5, ...o }),
  cone: (m, o) => m.prism([0, 0, 0], 0.3, 0.8, 'a', { r1: 0, n: 7, ...o }),
  slab: (m, o) => m.slab([0, 0, 0], 1, 0.05, 'a', o),
};

test('every primitive faces out, wherever it is placed and however it is turned', () => {
  for (const [name, make] of Object.entries(PRIMITIVES)) for (const rot of [0, 0.7, Math.PI / 2, 4]) {
    facesOut(make(new Mesh(pal), { rot }), `${name} at rot ${rot}`);
    // placed elsewhere: translate the check's centre with it
    const moved = make(new Mesh(pal), { rot }), at = [0.4, 0.2, -0.3], shifted = new Mesh(pal).add(moved, { at });
    facesOut(shifted, `${name} at rot ${rot}, moved`);
  }
});

test('a slab with a rim: its rim faces up, its sides out, its top up', () => {
  const m = new Mesh(pal).slab([0, 0, 0], 1, 0.05, 'a', { rim: 'b', w: 0.1 });
  for (const t of m.tris) {
    const n = normal(t.p), g = centroid(t.p);
    if (Math.abs(n[1]) < 0.5) assert.ok(n[0] * g[0] + n[2] * g[2] > 0, 'a side faces out');
    else assert.ok(n[1] > 0, 'a top faces up');
  }
  const [lo, hi] = m.bounds();
  assert.ok(Math.abs(hi[2] - 1) < 1e-9 && Math.abs(lo[2] + 1) < 1e-9, 'n = 6 is pointy along z, like the tiles');
});

test('rot turns the front (+z) toward +x, the way recipes do', () => {
  const door = new Mesh(pal).box([0, 0, 0.5], [0.1, 0.1, 0.1], 'a');
  const [lo] = new Mesh(pal).add(door, { rot: Math.PI / 2 }).bounds();
  assert.ok(lo[0] > 0.4, `a front door turned by π/2 is at +x (its x from ${lo[0]})`);
});

test('a face names a palette cell, never a missing one; add() keeps to one palette', () => {
  assert.throws(() => new Mesh(pal).box([0, 0, 0], [1, 1, 1], 'nope'), /no cell named nope/);
  assert.throws(() => new Mesh(), /palette/);
  const other = palette({ a: { cell: '0,0', top: '#ffffff', bottom: '#000000' } });
  assert.throws(() => new Mesh(pal).add(new Mesh(other).box([0, 0, 0], [1, 1, 1], 'a')), /one palette/);
});

test('the palette refuses a cell off the grid, a shared cell and a colour that is not #rrggbb', () => {
  assert.throws(() => palette({ x: { cell: '8,0', top: '#000000', bottom: '#000000' } }), /outside/);
  assert.throws(() => palette({ x: { cell: '1,1', top: '#000000', bottom: '#000000' }, y: { cell: '1,1', top: '#000000', bottom: '#000000' } }), /share/);
  assert.throws(() => palette({ x: { cell: '1,1', top: 'red', bottom: '#000000' } }), /#rrggbb/);
});

test('every vertex samples inside its face\'s cell', async () => {
  const m = PRIMITIVES.box(new Mesh(pal), {});
  const doc = toDoc(m), prim = doc.getRoot().listMeshes()[0].listPrimitives()[0], t = prim.getAttribute('TEXCOORD_0'), v = [];
  for (let i = 0; i < t.getCount(); i++) {
    t.getElement(i, v);
    const cell = m.tris[Math.floor(i / 3)].cell, [c, r] = cell.split(',').map(Number);
    assert.ok(v[0] > c / 8 && v[0] < (c + 1) / 8 && v[1] > r / 4 && v[1] < (r + 1) / 4, `vertex ${i} (${v}) is outside cell ${cell}`);
  }
  assert.deepEqual(uv('7,3', 0), [7.5 / 8, 3.1 / 4]);
});

test('the atlas is drawn from the palette: each cell its gradient, light at the top', async () => {
  const { PNG } = await import('pngjs');
  const img = PNG.sync.read(atlas(pal)), px = (x, y) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)];
  assert.deepEqual(px(16, 0), [255, 255, 255]);
  assert.deepEqual(px(16, 63), [0, 0, 0]);
  assert.deepEqual(px(7 * 32 + 16, 3 * 64), [255, 0, 0]);
});

test('the ukubi kit: every listed model is made, is sound, and is the same bytes made twice', async () => {
  const kit = parse(await readFile(`${ROOT}kits/ukubi/source.yaml`, 'utf8'));
  const { mod } = await load(ROOT, kit), io = new NodeIO();
  for (const name of kit.models) {
    assert.ok(mod.models[name], `${name} is listed but not made`);
    const m = mod.models[name]();
    assert.deepEqual(m.problems(), [], name);
    assert.ok(m.bounds()[0][1] >= -1e-9, `${name} goes below the ground`);
    const bytes = async () => { const { json, resources } = await io.writeJSON(toDoc(mod.models[name](), name)); return JSON.stringify(json) + Buffer.from(Object.values(resources)[0]).toString('hex'); };
    assert.equal(await bytes(), await bytes(), `${name} is not deterministic`);
  }
  assert.ok(atlas(mod.palette).equals(atlas(mod.palette)), 'the atlas is not deterministic');
});

test('rng is the seed\'s sequence: the same for the same seed, another for another', () => {
  const a = rng('x'), b = rng('x'), c = rng('y'), xs = [a(), a(), a()];
  assert.deepEqual(xs, [b(), b(), b()]);
  assert.notDeepEqual(xs, [c(), c(), c()]);
  assert.ok(xs.every((v) => v >= 0 && v < 1));
});

test('the guide\'s example kit (docs/procedural.md) is code that works', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const md = await readFile(`${ROOT}docs/procedural.md`, 'utf8');
  const block = md.match(/```js\n([\s\S]*?)```/)?.[1];
  assert.ok(block, 'the guide has a js example');
  const lib = new URL('./', import.meta.url).href;
  const dir = await mkdtemp(join(tmpdir(), 'procgen-doc-')), file = join(dir, 'models.mjs');
  await writeFile(file, block.replace(/\.\.\/\.\.\/tools\/procgen\//g, lib));
  try {
    const { palette: p, models } = await import(file);
    assert.ok(Object.keys(models).length > 0);
    for (const [name, make] of Object.entries(models)) {
      const m = make();
      assert.equal(m.palette, p);
      assert.deepEqual(m.problems(), [], name);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
