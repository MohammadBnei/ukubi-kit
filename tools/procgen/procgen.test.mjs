// The procgen library's tests (bun run test): every primitive faces out, under any placement; cells and UVs stay in
// their cell; the palette refuses mistakes; a kit generates the same bytes twice; the ukubi kit's models are sound.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { NodeIO } from '@gltf-transform/core';
import { parse } from 'yaml';
import { atlas, palette, uv } from './atlas.mjs';
import { load, toDoc } from './kit.mjs';
import { Mesh, normal } from './mesh.mjs';
import { frontage, house } from './parts.mjs';
import { rng } from './random.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const pal = palette({
  a: { cell: '0,0', top: '#ffffff', bottom: '#000000' },
  b: { cell: '7,3', top: '#ff0000', bottom: '#00ff00' }
});
const centroid = pts => pts.reduce((s, p) => s.map((v, i) => v + p[i] / pts.length), [0, 0, 0]);

// a convex primitive faces out when every triangle's normal points away from a point inside it: the mean of its
// distinct vertices (inside the hull of a convex shape, where the bounds' centre may not be: a wedge's isn't)
function facesOut(m, what) {
  const verts = [...new Map(m.tris.flatMap(t => t.p).map(p => [p.map(v => v.toFixed(9)).join(), p])).values()],
    c = centroid(verts);
  assert.deepEqual(m.problems(), [], what);
  m.tris.forEach((t, i) => {
    const n = normal(t.p),
      g = centroid(t.p),
      d = g.map((v, k) => v - c[k]);
    assert.ok(
      n[0] * d[0] + n[1] * d[1] + n[2] * d[2] > 1e-9,
      `${what}: triangle ${i} faces in (normal ${n.map(v => v.toFixed(2))})`
    );
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
  slab: (m, o) => m.slab([0, 0, 0], 1, 0.05, 'a', o)
};

// closed: every edge is shared by exactly two faces, but for the open bottom's (on y = foot) when it has one. Finds
// a missing face (a gap under a roof) that facing out cannot. Edges are compared by their rounded ends.
function closed(m, what, { openBottom = true } = {}) {
  const key = p => p.map(v => v.toFixed(6)).join(),
    edges = new Map(),
    foot = m.bounds()[0][1];
  for (const t of m.tris)
    for (let i = 0; i < 3; i++) {
      const a = t.p[i],
        b = t.p[(i + 1) % 3],
        k = [key(a), key(b)].sort().join('|');
      edges.set(k, {
        n: (edges.get(k)?.n || 0) + 1,
        bottom: Math.abs(a[1] - foot) < 1e-6 && Math.abs(b[1] - foot) < 1e-6
      });
    }
  for (const [k, e] of edges)
    if (e.n !== 2 && !(openBottom && e.bottom && e.n === 1)) assert.fail(`${what}: edge ${k} has ${e.n} faces`);
}

test('every primitive is closed but for its open bottom; with a bottom, closed', () => {
  closed(new Mesh(pal).box([0, 0, 0], [1, 0.6, 0.4], 'a'), 'box');
  closed(new Mesh(pal).box([0, 0, 0], [1, 0.6, 0.4], 'a', { bottom: true }), 'box with a bottom', {
    openBottom: false
  });
  closed(new Mesh(pal).prism([0, 0, 0], 0.3, 0.8, 'a', { bottom: true }), 'prism with a bottom', { openBottom: false });
  closed(new Mesh(pal).prism([0, 0, 0], 0.3, 0.8, 'a', { r1: 0, bottom: true }), 'cone with a bottom', {
    openBottom: false
  });
  closed(new Mesh(pal).gable([0, 0, 0], [1, 0.6], 0.4, 'a', { o: 0 }), 'gable');
  closed(new Mesh(pal).hip([0, 0, 0], [1.2, 0.6], 0.4, 'a'), 'hip');
  closed(new Mesh(pal).shed([0, 0, 0], [1, 0.6], 0.3, 0.5, 'a'), 'shed');
  closed(new Mesh(pal).sawtooth([0, 0, 0], [0.5, 0.6], 0.3, 1, 'a', 'b'), 'a sawtooth tooth');
  closed(new Mesh(pal).slab([0, 0, 0], 1, 0.05, 'a'), 'slab');
});

test("a gable with eaves closes the wall up to the roof's underside", () => {
  // its end is a pentagon whose top edges lie in the roof's planes: the wall never shows through under the roof
  const m = new Mesh(pal).gable([0, 0, 0], [1, 0.6], 0.4, 'a', { ends: 'b', o: 0.1 }),
    ends = m.tris.filter(t => t.cell === '7,3');
  const top = Math.max(...ends.flatMap(t => t.p.map(p => p[1]))),
    corner = Math.max(...ends.flatMap(t => t.p.filter(p => Math.abs(Math.abs(p[2]) - 0.3) < 1e-9).map(p => p[1])));
  assert.ok(Math.abs(top - 0.4) < 1e-9, `the ends reach the ridge (${top})`);
  assert.ok(Math.abs(corner - (0.4 * 0.1) / 0.4) < 1e-9, `the ends reach the roof over the wall's edge (${corner})`);
});

test('a primitive refuses a size that would turn its faces in, and a shape it cannot make', () => {
  const m = new Mesh(pal);
  assert.throws(() => m.box([0, 0, 0], [-1, 1, 1], 'a'), /positive/);
  assert.throws(() => m.prism([0, 0, 0], 0.3, 1, 'a', { n: 2 }), /sides/);
  assert.throws(() => m.slab([0, 0, 0], 1, 0.1, 'a', { w: 1 }), /rim/);
  assert.throws(() => m.shed([0, 0, 0], [1, 1], 0, 0.5, 'a'), /positive/);
  assert.throws(() => m.hip([0, 0, 0], [0.5, 1], 0.3, 'a'), /deeper than wide/);
  assert.throws(() => m.add(new Mesh(pal).box([0, 0, 0], [1, 1, 1], 'a'), { scale: -1 }), /positive/);
});

test('add() mirrors, tilts and scales without turning a face in', () => {
  for (const [name, make] of Object.entries(PRIMITIVES)) {
    for (const o of [
      { mirror: true },
      { tilt: Math.PI / 2 },
      { tilt: 0.6, rot: 1, mirror: true },
      { scale: [2, 0.5, 1] }
    ]) {
      facesOut(new Mesh(pal).add(make(new Mesh(pal), {}), o), `${name} added with ${JSON.stringify(o)}`);
    }
  }
  // tilt π/2 lays an upright prism along +z, and mirror puts +x at -x
  const [lo, hi] = new Mesh(pal).add(new Mesh(pal).prism([0, 0, 0], 0.1, 1, 'a'), { tilt: Math.PI / 2 }).bounds();
  assert.ok(hi[2] > 0.99 && lo[2] > -1e-9 && hi[1] < 0.11, 'tilted: along +z');
  const [mlo] = new Mesh(pal).add(new Mesh(pal).box([0.5, 0, 0], [0.2, 0.2, 0.2], 'a'), { mirror: true }).bounds();
  assert.ok(mlo[0] < -0.59, 'mirrored: at -x');
});

test('repeat() places n copies a step apart; panel() is seen from both sides', () => {
  const one = new Mesh(pal).box([0, 0, 0], [0.1, 0.1, 0.1], 'a'),
    row = new Mesh(pal).repeat(one, 4, [0.2, 0, 0]);
  assert.equal(row.tris.length, 4 * one.tris.length);
  assert.ok(Math.abs(row.bounds()[1][0] - 0.65) < 1e-9);
  const p = new Mesh(pal).panel(
    [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0]
    ],
    'a'
  );
  assert.deepEqual(
    p.tris.map(t => Math.sign(normal(t.p)[2])),
    [1, -1]
  );
});

test('every primitive faces out, wherever it is placed and however it is turned', () => {
  for (const [name, make] of Object.entries(PRIMITIVES))
    for (const rot of [0, 0.7, Math.PI / 2, 4]) {
      facesOut(make(new Mesh(pal), { rot }), `${name} at rot ${rot}`);
      // placed elsewhere: translate the check's centre with it
      const moved = make(new Mesh(pal), { rot }),
        at = [0.4, 0.2, -0.3],
        shifted = new Mesh(pal).add(moved, { at });
      facesOut(shifted, `${name} at rot ${rot}, moved`);
    }
});

test('a slab with a rim: its rim faces up, its sides out, its top up', () => {
  const m = new Mesh(pal).slab([0, 0, 0], 1, 0.05, 'a', { rim: 'b', w: 0.1 });
  for (const t of m.tris) {
    const n = normal(t.p),
      g = centroid(t.p);
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
  assert.throws(
    () =>
      palette({
        x: { cell: '1,1', top: '#000000', bottom: '#000000' },
        y: { cell: '1,1', top: '#000000', bottom: '#000000' }
      }),
    /share/
  );
  assert.throws(() => palette({ x: { cell: '1,1', top: 'red', bottom: '#000000' } }), /#rrggbb/);
});

test("every vertex samples inside its face's cell", async () => {
  const m = new Mesh(pal);
  for (const make of Object.values(PRIMITIVES)) make(m, {});
  const doc = toDoc(m),
    prim = doc.getRoot().listMeshes()[0].listPrimitives()[0],
    t = prim.getAttribute('TEXCOORD_0'),
    v = [];
  for (let i = 0; i < t.getCount(); i++) {
    t.getElement(i, v);
    const cell = m.tris[Math.floor(i / 3)].cell,
      [c, r] = cell.split(',').map(Number);
    assert.ok(
      v[0] > c / 8 && v[0] < (c + 1) / 8 && v[1] > r / 4 && v[1] < (r + 1) / 4,
      `vertex ${i} (${v}) is outside cell ${cell}`
    );
  }
  assert.deepEqual(uv('7,3', 0), [7.5 / 8, 3.1 / 4]);
});

test('the atlas is drawn from the palette: each cell its gradient, light at the top', async () => {
  const { PNG } = await import('pngjs');
  const img = PNG.sync.read(atlas(pal)),
    px = (x, y) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)];
  assert.deepEqual(px(16, 0), [255, 255, 255]);
  assert.deepEqual(px(16, 63), [0, 0, 0]);
  assert.deepEqual(px(7 * 32 + 16, 3 * 64), [255, 0, 0]);
});

test('the ukubi kit: every listed model is made, is sound, and is the same bytes made twice', async () => {
  const kit = parse(await readFile(`${ROOT}kits/ukubi/source.yaml`, 'utf8'));
  const { mod } = await load(ROOT, kit),
    io = new NodeIO();
  for (const name of kit.models) {
    assert.ok(mod.models[name], `${name} is listed but not made`);
    const m = mod.models[name]();
    assert.deepEqual(m.problems(), [], name);
    assert.ok(m.bounds()[0][1] >= -1e-9, `${name} goes below the ground`);
    const bytes = async () => {
      const { json, resources } = await io.writeJSON(toDoc(mod.models[name](), name));
      return JSON.stringify(json) + Buffer.from(Object.values(resources)[0]).toString('hex');
    };
    assert.equal(await bytes(), await bytes(), `${name} is not deterministic`);
  }
  assert.ok(atlas(mod.palette).equals(atlas(mod.palette)), 'the atlas is not deterministic');
});

test("rng is the seed's sequence: the same for the same seed, another for another", () => {
  const a = rng('x'),
    b = rng('x'),
    c = rng('y'),
    xs = [a(), a(), a()];
  assert.deepEqual(xs, [b(), b(), b()]);
  assert.notDeepEqual(xs, [c(), c(), c()]);
  assert.ok(xs.every(v => v >= 0 && v < 1));
});

test("the guide's example kit (docs/procedural.md) is code that works", async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const md = await readFile(`${ROOT}docs/procedural.md`, 'utf8');
  const block = md.match(/```js\n([\s\S]*?)```/)?.[1];
  assert.ok(block, 'the guide has a js example');
  const lib = new URL('./', import.meta.url).href;
  const dir = await mkdtemp(join(tmpdir(), 'procgen-doc-')),
    file = join(dir, 'models.mjs');
  await writeFile(file, block.replace(/\.\.\/\.\.\/tools\/procgen\//g, lib));
  try {
    const { palette: p, models } = await import(file);
    assert.ok(Object.keys(models).length > 0);
    for (const [name, make] of Object.entries(models)) {
      const m = make();
      assert.equal(m.palette, p);
      assert.deepEqual(m.problems(), [], name);
      assert.deepEqual(coplanarOverlaps(m), [], `${name}: faces overlap in one plane`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// two faces in one plane that overlap z-fight (flicker) on screen. Coplanar: their normals agree and each one's
// corners lie in the other's plane; overlapping: their projections onto that plane share area (separating axes).
function coplanarOverlaps(m) {
  const out = [],
    eps = 1e-6;
  const n = m.tris.map(t => normal(t.p)),
    d = m.tris.map((t, i) => n[i][0] * t.p[0][0] + n[i][1] * t.p[0][1] + n[i][2] * t.p[0][2]);
  const axes2 = nn => {
    const k =
      Math.abs(nn[0]) > Math.abs(nn[1])
        ? Math.abs(nn[0]) > Math.abs(nn[2])
          ? 0
          : 2
        : Math.abs(nn[1]) > Math.abs(nn[2])
          ? 1
          : 2;
    return [0, 1, 2].filter(i => i !== k);
  };
  const overlap = (A, B) => {
    // 2-D triangles share area: no edge of either separates them (with a margin)
    for (const T of [A, B])
      for (let i = 0; i < 3; i++) {
        const [p, q] = [T[i], T[(i + 1) % 3]],
          ax = [q[1] - p[1], p[0] - q[0]],
          l = Math.hypot(...ax);
        const proj = P => P.map(v => (v[0] * ax[0] + v[1] * ax[1]) / l);
        const a = proj(A),
          b = proj(B);
        if (Math.max(...a) <= Math.min(...b) + 1e-5 || Math.max(...b) <= Math.min(...a) + 1e-5) return false;
      }
    return true;
  };
  for (let i = 0; i < m.tris.length; i++)
    for (let j = i + 1; j < m.tris.length; j++) {
      if (n[i][0] * n[j][0] + n[i][1] * n[j][1] + n[i][2] * n[j][2] < 1 - eps || Math.abs(d[i] - d[j]) > eps) continue;
      const [u, v] = axes2(n[i]),
        A = m.tris[i].p.map(p => [p[u], p[v]]),
        B = m.tris[j].p.map(p => [p[u], p[v]]);
      if (overlap(A, B)) out.push([i, j]);
    }
  return out;
}

test('no two faces of a ukubi model share a plane and overlap (they would flicker)', async () => {
  const kit = parse(await readFile(`${ROOT}kits/ukubi/source.yaml`, 'utf8'));
  const { mod } = await load(ROOT, kit);
  for (const name of kit.models) {
    const m = mod.models[name](),
      bad = coplanarOverlaps(m);
    assert.deepEqual(
      bad.slice(0, 3).map(([i, j]) => [m.tris[i], m.tris[j]].map(t => t.p.map(p => p.map(v => +v.toFixed(3))))),
      [],
      `${name}: faces overlap in one plane`
    );
  }
  // and the check sees one: a box on the ground with a slab in its bottom's plane, a window in its front's
  const flicker = new Mesh(pal).box([0, 0, 0], [1, 1, 1], 'a').box([0, 0.3, 0.45], [0.2, 0.2, 0.1], 'b');
  assert.ok(coplanarOverlaps(flicker).length > 0, 'a window flush with its wall is found');
});

test('the shared parts: a house is closed under its roof, its frontage stands proud of the wall', () => {
  const p = palette({
    walls: { cell: '0,0', top: '#ffffff', bottom: '#000000' },
    roof: { cell: '1,0', top: '#ffffff', bottom: '#000000' },
    door: { cell: '2,0', top: '#ffffff', bottom: '#000000' },
    glass: { cell: '3,0', top: '#ffffff', bottom: '#000000' }
  });
  const mesh = () => new Mesh(p),
    h = house(mesh, [1, 0.5, 0.8], 0.3, { walls: 'walls', roof: 'roof' });
  assert.deepEqual(coplanarOverlaps(h), [], 'no face of a house flickers');
  const f = frontage(mesh, 1),
    [lo, hi] = f.bounds();
  assert.ok(lo[2] < 0 && hi[2] > 0, "the frontage straddles the wall's face");
});

test("a style names a made kit's cells by its palette, and every name it uses is there", async () => {
  const styles = parse(await readFile(`${ROOT}catalog/styles.yaml`, 'utf8'));
  const kit = parse(await readFile(`${ROOT}kits/ukubi/source.yaml`, 'utf8')),
    { mod } = await load(ROOT, kit);
  for (const [id, st] of Object.entries(styles))
    for (const key of Object.keys(st.cells?.ukubi || {})) {
      assert.ok(mod.palette[key], `style ${id} names ukubi cell ${key}, not in its palette (name it, not "col,row")`);
    }
});

// sealed: a shape of any form (not only convex) is wound and closed. Every edge is walked once each way by the faces
// beside it (so none is missing and none faces in against its neighbour), but for an open bottom's edges on the foot
// plane; and each connected piece encloses a positive volume, measured from a point on the foot plane (where the
// open bottom adds none), so its faces point out, not in.
function sealed(m, what, { openBottom = false } = {}) {
  assert.deepEqual(m.problems(), [], what);
  const key = p => p.map(v => v.toFixed(6)).join(),
    foot = m.bounds()[0][1],
    walks = new Map(),
    parent = new Map();
  const find = k => {
    while (parent.get(k) !== k) k = parent.get(k);
    return k;
  };
  for (const t of m.tris) {
    const ks = t.p.map(key);
    for (const k of ks) if (!parent.has(k)) parent.set(k, k);
    parent.set(find(ks[1]), find(ks[0]));
    parent.set(find(ks[2]), find(ks[0]));
    for (let i = 0; i < 3; i++) {
      const e = `${ks[i]}|${ks[(i + 1) % 3]}`;
      walks.set(e, (walks.get(e) || 0) + 1);
    }
  }
  for (const [e, n] of walks) {
    const [a, b] = e.split('|'),
      back = walks.get(`${b}|${a}`) || 0,
      onFoot = [a, b].every(k => Math.abs(Number(k.split(',')[1]) - foot) < 1e-5);
    if (n !== back && !(openBottom && onFoot && back === 0 && n === 1))
      assert.fail(`${what}: edge ${e} is walked ${n} times one way and ${back} the other`);
  }
  const vol = new Map();
  for (const t of m.tris) {
    const [a, b, c] = t.p.map(p => [p[0], p[1] - foot, p[2]]),
      v =
        (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) /
        6,
      k = find(key(t.p[0]));
    vol.set(k, (vol.get(k) || 0) + v);
  }
  for (const [k, v] of vol) assert.ok(v > 0, `${what}: the piece at ${k} faces in (volume ${v})`);
}

test('a loft is sealed and faces out: straight, tapered to a point, curved, with a profile and its cells', () => {
  const straight = new Mesh(pal).loft(
    [0, 0, 0],
    [
      { at: [0, 0, 0], r: 0.3 },
      { at: [0, 0, 1], r: [0.2, 0.1] }
    ],
    'a'
  );
  facesOut(straight, 'a straight loft');
  sealed(straight, 'a straight loft');
  const egg = new Mesh(pal).loft(
    [0, 0.5, 0],
    [0, 0.4, 0.7, 0.4, 0].map((r, i) => ({ at: [0, 0, i * 0.25], r })),
    'a',
    { n: 6 }
  );
  facesOut(egg, 'a loft pointed at both ends');
  sealed(egg, 'a loft pointed at both ends');
  // a trunk: forward, then down, then curling forward again; along y too (its up falls back to z)
  const trunk = new Mesh(pal).loft(
    [0, 0, 0],
    [
      [0, 1, 0],
      [0, 1, 0.3],
      [0, 0.7, 0.45],
      [0, 0.3, 0.4],
      [0, 0.1, 0.55]
    ].map((at, i) => ({ at, r: 0.12 - i * 0.02, name: i % 2 ? 'b' : 'a' })),
    'a',
    { n: 5 }
  );
  sealed(trunk, 'a curved loft');
  sealed(
    new Mesh(pal).loft(
      [0, 0, 0],
      [
        { at: [0, 0, 0], r: 0.4 },
        { at: [0, 1, 0], r: 0.2 }
      ],
      'a'
    ),
    'an upright loft'
  );
  const hull = [
    [0, -1],
    [1, -0.4],
    [0.9, 0.3],
    [-0.9, 0.3],
    [-1, -0.4]
  ];
  const boat = new Mesh(pal).loft(
    [0, 0, 0],
    [
      { at: [0, 0, 0], r: 0.3 },
      { at: [0, 0, 1], r: 0.2 }
    ],
    'a',
    {
      profile: hull,
      cells: ['a', 'a', 'b', 'a', 'a']
    }
  );
  facesOut(boat, 'a loft with a profile');
  assert.equal(boat.tris.filter(t => t.cell === '7,3').length, 2, 'its deck side takes its own cell');
  for (const o of [{ mirror: true }, { tilt: 1, rot: 2 }, { scale: [1, 2, 0.5] }])
    sealed(new Mesh(pal).add(trunk, o), `a curved loft added with ${JSON.stringify(o)}`);
  assert.throws(() => new Mesh(pal).loft([0, 0, 0], [{ at: [0, 0, 0], r: 1 }], 'a'), /two rings/);
  assert.throws(
    () =>
      new Mesh(pal).loft(
        [0, 0, 0],
        [0.3, 0, 0.3].map((r, i) => ({ at: [0, 0, i], r })),
        'a'
      ),
    /ring 1/
  );
});

test('sealed() finds a missing face, a face turned in and a shape turned inside out', () => {
  const box = () => new Mesh(pal).box([0, 0.2, 0], [1, 1, 1], 'a', { bottom: true });
  sealed(box(), 'a closed box');
  sealed(new Mesh(pal).box([0, 0, 0], [1, 1, 1], 'a'), 'a box open at its foot', { openBottom: true });
  const missing = box();
  missing.tris.pop();
  assert.throws(() => sealed(missing, 'a missing face'), /walked/);
  const turned = box();
  turned.tris[0].p.reverse();
  assert.throws(() => sealed(turned, 'a face turned in'), /walked/);
  const inside = box();
  for (const t of inside.tris) t.p.reverse();
  assert.throws(() => sealed(inside, 'inside out'), /faces in/);
  assert.throws(() => sealed(new Mesh(pal).box([0, 0.2, 0], [1, 1, 1], 'a'), 'raised, open'), /walked/);
});

test("the world's props: each is made, sealed, under its cap, its size, and the same bytes made twice", async () => {
  const kit = parse(await readFile(`${ROOT}kits/world/source.yaml`, 'utf8'));
  const { mod } = await load(ROOT, kit),
    io = new NodeIO();
  assert.ok(kit.props, 'world is a props kit');
  assert.deepEqual(Object.keys(kit.caps).sort(), [...kit.models].sort(), 'every prop has a triangle cap');
  const size = {};
  for (const name of kit.models) {
    const m = mod.models[name]();
    sealed(m, name);
    assert.ok(m.tris.length <= kit.caps[name], `${name}: ${m.tris.length} triangles, over its cap ${kit.caps[name]}`);
    assert.deepEqual(coplanarOverlaps(m).slice(0, 3), [], `${name}: faces overlap in one plane`);
    const [lo, hi] = m.bounds();
    size[name] = hi.map((v, i) => v - lo[i]);
    const bytes = async () => {
      const { json, resources } = await io.writeJSON(toDoc(mod.models[name](), name));
      return JSON.stringify(json) + Buffer.from(Object.values(resources)[0]).toString('hex');
    };
    assert.equal(await bytes(), await bytes(), `${name} is not deterministic`);
  }
  const near = (v, want, tol, what) => assert.ok(Math.abs(v - want) <= tol, `${what}: ${v}, want ${want} ± ${tol}`);
  near(size.bike[2], 1.2, 0.1, 'the bike is about 1.2 long');
  near(size.ship_hull[2], 1, 1e-9, 'the hull is 1 long');
  near(size.elephant[1], 1, 1e-9, 'the elephant is 1 tall');
  assert.ok(mod.models.elephant().bounds()[0][1] >= -1e-9, "the elephant's feet are at 0");
  assert.deepEqual(size.beam, [1, 1, 1], 'the beam is a unit box');
  assert.ok(size.turtle[0] > 2 && size.turtle[2] > 2, 'the turtle: a shell of radius 1, flippers past it');
});
