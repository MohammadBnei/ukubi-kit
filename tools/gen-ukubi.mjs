// gen-ukubi: the kit of our own (Code's), made here rather than fetched: low-poly workshops and factories, a plot
// and props, flat-shaded, painted like a KayKit model through an 8×4 atlas of vertical gradient swatches that this
// file draws too, so a style repaints it the same way. Deterministic: the same source writes the same bytes, into
// cache/ukubi/<this file's hash>/, which build.mjs then reads like a fetched kit. CC0 (ours).
//
// Sizes are in hexes' units (a hex is 2 flat-to-flat): the kit's scale is 1, and every building keeps its corners
// inside the hex (build.mjs checks the reach).
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { PNG } from 'pngjs';

// the atlas: cell "col,row" -> [top, bottom] colours (a swatch darkens downwards, as KayKit's do)
const CELLS = {
  '0,0': ['#f1ebe0', '#c9bfae'], // plaster
  '1,0': ['#c99a66', '#8a623c'], // timber
  '2,0': ['#b8624a', '#7e3a2a'], // brick
  '3,0': ['#5d6772', '#353c45'], // slate (roofs)
  '4,0': ['#c3c3bd', '#8d8d87'], // concrete
  '5,0': ['#8fa3b3', '#55697a'], // steel
  '6,0': ['#e0874a', '#a4532a'], // team (signs, cranes' cabs, banners)
  '7,0': ['#9fd0ea', '#4d88ad'], // glass
  '0,1': ['#7a5536', '#4b3220'], // dark timber (doors, logs)
  '1,1': ['#8b8f93', '#5d6165'], // roof metal
  '2,1': ['#4a4a4a', '#232323'], // soot (chimney tops)
  '3,1': ['#f2c94c', '#c9961e'], // hazard yellow (crane)
  '4,1': ['#8fae6a', '#5d7d40'], // moss (foliage)
  '5,1': ['#d8c79d', '#a8956a'], // sand (plot)
  '6,1': ['#b06a3b', '#6f3e1f'], // rust
  '7,1': ['#ffe9a8', '#f2c14e'], // lit window
};
const NEUTRAL = ['#e6e6e6', '#3a3a3a'];
const SIDE = 256;

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function atlas() {
  const img = new PNG({ width: SIDE, height: SIDE }), cw = SIDE / 8, ch = SIDE / 4;
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
    const c = Math.floor(x / cw), r = Math.floor(y / ch), [a, b] = (CELLS[`${c},${r}`] || NEUTRAL).map(rgb);
    const t = (y - r * ch) / (ch - 1), o = (y * SIDE + x) * 4;
    for (let i = 0; i < 3; i++) img.data[o + i] = Math.round(a[i] + (b[i] - a[i]) * t);
    img.data[o + 3] = 255;
  }
  return PNG.sync.write(img, { deflateLevel: 9 });
}

// a mesh under construction: flat-shaded triangles, each face's UVs in one cell (u at the cell's middle, v following
// the vertex's height through the swatch's gradient, from the model's top to its foot)
class Mesh {
  constructor() { this.tris = []; }
  // a planar polygon (counter-clockwise seen from outside), fanned
  poly(pts, cell) { for (let i = 1; i < pts.length - 1; i++) this.tris.push({ p: [pts[0], pts[i], pts[i + 1]], cell }); return this; }
  quad(a, b, c, d, cell) { return this.poly([a, b, c, d], cell); }
  // an axis-aligned box from its centre-bottom (x, y0, z) and size; rot turns it about +y through the origin
  box([x, y0, z], [sx, sy, sz], cell, { top = cell, rot = 0 } = {}) {
    const X = sx / 2, Z = sz / 2, y1 = y0 + sy, P = (px, py, pz) => turn([x + px, py, z + pz], rot);
    const v = [P(-X, y0, -Z), P(X, y0, -Z), P(X, y0, Z), P(-X, y0, Z), P(-X, y1, -Z), P(X, y1, -Z), P(X, y1, Z), P(-X, y1, Z)];
    this.quad(v[3], v[2], v[6], v[7], cell).quad(v[1], v[0], v[4], v[5], cell).quad(v[2], v[1], v[5], v[6], cell)
      .quad(v[0], v[3], v[7], v[4], cell).quad(v[7], v[6], v[5], v[4], top);
    return this;
  }
  // a gable roof over a box's top: ridge along x, eaves overhanging by o
  gable([x, y0, z], [sx, sz], h, cell, { gableCell, o = 0.06, rot = 0 } = {}) {
    const X = sx / 2 + o, Z = sz / 2 + o, P = (px, py, pz) => turn([x + px, py, z + pz], rot);
    const a = P(-X, y0, -Z), b = P(X, y0, -Z), c = P(X, y0, Z), d = P(-X, y0, Z), r0 = P(-X, y0 + h, 0), r1 = P(X, y0 + h, 0);
    this.quad(d, c, r1, r0, cell).quad(b, a, r0, r1, cell);
    const g = gableCell || cell, ga = P(-sx / 2, y0, -sz / 2), gb = P(sx / 2, y0, -sz / 2), gc = P(sx / 2, y0, sz / 2), gd = P(-sx / 2, y0, sz / 2);
    this.poly([ga, gd, P(-sx / 2, y0 + h * (sz / 2) / Z, 0)], g).poly([gc, gb, P(sx / 2, y0 + h * (sz / 2) / Z, 0)], g);
    return this;
  }
  // a sawtooth roof: n teeth along x over a box's top, each a slope (roof) and a vertical glass face
  sawtooth([x, y0, z], [sx, sz], h, n, roofCell, glassCell, { rot = 0 } = {}) {
    const w = sx / n, Z = sz / 2, P = (px, py, pz) => turn([x + px, py, z + pz], rot);
    for (let i = 0; i < n; i++) {
      const x0 = -sx / 2 + i * w, x1 = x0 + w;
      const a = P(x0, y0, -Z), b = P(x1, y0, -Z), c = P(x1, y0, Z), d = P(x0, y0, Z), e = P(x1, y0 + h, -Z), f = P(x1, y0 + h, Z);
      this.quad(a, d, f, e, roofCell);          // the slope, rising to x1
      this.quad(c, b, e, f, glassCell);         // the glazed face at x1
      this.poly([d, c, f], roofCell).poly([b, a, e], roofCell); // the ends
    }
    return this;
  }
  // an upright n-gon prism (a chimney, a silo, a tank), capped
  cyl([x, y0, z], r, h, cell, { n = 8, top = cell, r1 = r } = {}) {
    const ring = (y, rr) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [x + rr * Math.cos(a), y, z + rr * Math.sin(a)]; });
    const lo = ring(y0, r), hi = ring(y0 + h, r1);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.quad(lo[j], lo[i], hi[i], hi[j], cell); }
    this.poly([...hi].reverse(), top);
    return this;
  }
}
const turn = ([x, y, z], a) => (a ? [x * Math.cos(a) - z * Math.sin(a), y, x * Math.sin(a) + z * Math.cos(a)] : [x, y, z]);

// one Mesh as a glTF document: flat normals, UVs in the faces' cells
function toDoc(mesh) {
  const pos = [], nor = [], uv = [];
  let top = -Infinity, foot = Infinity;
  for (const t of mesh.tris) for (const p of t.p) { top = Math.max(top, p[1]); foot = Math.min(foot, p[1]); }
  for (const t of mesh.tris) {
    const [a, b, c] = t.p, u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(...n) || 1; n = n.map((v) => v / l);
    const [col, row] = t.cell.split(',').map(Number);
    for (const p of t.p) {
      pos.push(...p); nor.push(...n);
      const h = top > foot ? (top - p[1]) / (top - foot) : 0.5; // 0 at the top: the swatch's light end
      uv.push((col + 0.5) / 8, (row + 0.1 + 0.8 * h) / 4);
    }
  }
  const doc = new Document(), buf = doc.createBuffer();
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(new Float32Array(arr)).setBuffer(buf);
  const prim = doc.createPrimitive().setAttribute('POSITION', acc('VEC3', pos)).setAttribute('NORMAL', acc('VEC3', nor))
    .setAttribute('TEXCOORD_0', acc('VEC2', uv)).setMaterial(doc.createMaterial('ukubi').setRoughnessFactor(1).setMetallicFactor(0));
  doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)));
  return doc;
}

// the models. Cells by name, so a model reads as what it is.
const C = { plaster: '0,0', timber: '1,0', brick: '2,0', slate: '3,0', concrete: '4,0', steel: '5,0', team: '6,0', glass: '7,0',
  dark: '0,1', metal: '1,1', soot: '2,1', hazard: '3,1', moss: '4,1', sand: '5,1', rust: '6,1', lit: '7,1' };

// windows and a door on a box's +z face (its front), slightly proud of the wall
function front(m, [x, y0, z], [sx, , sz], { door = true, windows = 2, wy = 0.32, cell = C.glass } = {}) {
  const f = z + sz / 2 + 0.01;
  if (door) m.box([x, y0, f], [0.18, 0.3, 0.02], C.dark);
  for (let i = 0; i < windows; i++) {
    const wx = x + (i - (windows - 1) / 2) * (sx / (windows + (door ? 1 : 0.5)));
    if (door && Math.abs(wx - x) < 0.12) continue;
    m.box([wx, y0 + wy, f], [0.14, 0.12, 0.02], cell);
  }
  return m;
}

const MODELS = {
  // age 1: workshops
  workshop_A: () => { // a gabled shed: plaster on a timber frame, slate roof, a stove pipe
    const m = new Mesh();
    m.box([0, 0, 0], [1.1, 0.55, 0.8], C.plaster).box([0, 0, 0], [1.14, 0.06, 0.84], C.timber);
    m.gable([0, 0.55, 0], [1.1, 0.8], 0.42, C.slate, { gableCell: C.timber });
    front(m, [0, 0, 0], [1.1, 0.55, 0.8]);
    m.cyl([0.35, 0.6, -0.15], 0.05, 0.5, C.soot);
    return m;
  },
  workshop_B: () => { // a long shed with a lean-to of logs
    const m = new Mesh();
    m.box([-0.1, 0, 0], [1.0, 0.5, 0.75], C.timber).gable([-0.1, 0.5, 0], [1.0, 0.75], 0.38, C.slate, { gableCell: C.timber });
    front(m, [-0.1, 0, 0], [1.0, 0.5, 0.75], { windows: 3 });
    m.box([0.55, 0, 0], [0.32, 0.36, 0.6], C.dark).box([0.55, 0.36, 0], [0.4, 0.04, 0.68], C.metal);
    for (let i = 0; i < 3; i++) m.box([0.55, i * 0.09, 0.42], [0.36, 0.08, 0.08], C.timber);
    return m;
  },
  workshop_C: () => { // a brick forge with a tall chimney and a water tank on legs
    const m = new Mesh();
    m.box([-0.15, 0, 0], [0.9, 0.6, 0.8], C.brick).gable([-0.15, 0.6, 0], [0.9, 0.8], 0.35, C.slate, { gableCell: C.brick });
    front(m, [-0.15, 0, 0], [0.9, 0.6, 0.8], { windows: 2, cell: C.lit });
    m.box([0.12, 0.6, -0.2], [0.18, 0.75, 0.18], C.brick).box([0.12, 1.35, -0.2], [0.22, 0.06, 0.22], C.soot);
    for (const [dx, dz] of [[-0.12, -0.12], [0.12, -0.12], [0.12, 0.12], [-0.12, 0.12]]) m.box([0.58 + dx, 0, 0.25 + dz], [0.04, 0.5, 0.04], C.dark);
    m.cyl([0.58, 0.5, 0.25], 0.17, 0.28, C.rust, { top: C.metal });
    return m;
  },
  // age 2: factories
  factory_A: () => { // a brick hall under a glazed sawtooth roof, a tall chimney
    const m = new Mesh();
    m.box([0, 0, 0], [1.25, 0.7, 0.9], C.brick).box([0, 0.7, 0], [1.29, 0.05, 0.94], C.concrete);
    m.sawtooth([0, 0.75, 0], [1.25, 0.9], 0.3, 3, C.metal, C.glass);
    front(m, [0, 0, 0], [1.25, 0.7, 0.9], { windows: 4, wy: 0.36, cell: C.lit });
    m.cyl([-0.45, 0.75, -0.3], 0.09, 1.0, C.brick, { top: C.soot, r1: 0.07 });
    m.box([0.45, 0.4, 0.46], [0.3, 0.08, 0.03], C.team); // the sign
    return m;
  },
  factory_B: () => { // a two-storey block, glass and steel, a crane on its roof
    const m = new Mesh();
    m.box([0, 0, 0], [1.0, 1.1, 0.85], C.concrete).box([0, 1.1, 0], [1.04, 0.05, 0.89], C.steel);
    for (const y of [0.15, 0.6]) m.box([0, y, 0.43], [0.9, 0.3, 0.02], C.glass);
    m.box([0, 0, 0.44], [0.2, 0.3, 0.02], C.dark);
    m.box([0.3, 1.15, -0.15], [0.08, 0.6, 0.08], C.hazard).box([0.1, 1.72, -0.15], [0.8, 0.06, 0.06], C.hazard)
      .box([0.42, 1.6, -0.15], [0.14, 0.12, 0.12], C.team).box([-0.25, 1.4, -0.15], [0.01, 0.32, 0.01], C.dark);
    return m;
  },
  factory_C: () => { // a hall, a silo and the conveyor between them
    const m = new Mesh();
    m.box([-0.2, 0, 0], [0.9, 0.65, 0.85], C.steel).gable([-0.2, 0.65, 0], [0.9, 0.85], 0.2, C.metal, { gableCell: C.steel });
    front(m, [-0.2, 0, 0], [0.9, 0.65, 0.85], { windows: 3, cell: C.lit });
    m.cyl([0.55, 0, -0.1], 0.24, 1.1, C.concrete, { n: 10, top: C.metal }).cyl([0.55, 1.1, -0.1], 0.24, 0.12, C.metal, { n: 10, r1: 0.04 });
    m.box([0.2, 0.75, -0.1], [0.5, 0.06, 0.12], C.hazard, { rot: 0 });
    m.box([0.25, 0, 0.35], [0.06, 0.75, 0.06], C.dark);
    m.box([-0.2, 0.35, 0.44], [0.4, 0.07, 0.02], C.team);
    return m;
  },
  // the plot under a Code building: a sand yard with a concrete curb, a hex inside the tile's (0.97 of it)
  plot_yard: () => {
    const m = new Mesh(), r = 1.12;
    const ring = (rr, y) => Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; return [rr * Math.cos(a), y, rr * Math.sin(a)]; });
    const lo = ring(r, 0), hi = ring(r, 0.03), inner = ring(r - 0.08, 0.035);
    for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; m.quad(lo[j], lo[i], hi[i], hi[j], C.concrete); m.quad(hi[j], hi[i], inner[i], inner[j], C.concrete); }
    m.poly([...inner].reverse(), C.sand);
    return m;
  },
  // dressing
  crates: () => new Mesh().box([0, 0, 0], [0.22, 0.2, 0.22], C.timber).box([0.2, 0, 0.05], [0.18, 0.16, 0.18], C.timber).box([0.08, 0.2, 0.02], [0.16, 0.14, 0.16], C.timber),
  logs: () => { const m = new Mesh(); for (const [x, y] of [[-0.09, 0], [0.09, 0], [0, 0.09]]) m.box([x, y, 0], [0.09, 0.09, 0.45], C.timber, { top: C.dark }); return m; },
  spool: () => new Mesh().cyl([0, 0, 0], 0.13, 0.03, C.timber, { n: 10 }).cyl([0, 0.03, 0], 0.07, 0.16, C.team, { n: 10 }).cyl([0, 0.19, 0], 0.13, 0.03, C.timber, { n: 10 }),
  shrub: () => new Mesh().cyl([0, 0, 0], 0.03, 0.12, C.dark, { n: 5 }).cyl([0, 0.12, 0], 0.16, 0.3, C.moss, { n: 6, r1: 0.02 }),
  drum: () => new Mesh().cyl([0, 0, 0], 0.08, 0.2, C.rust, { n: 8, top: C.metal }).cyl([0.15, 0, 0.05], 0.08, 0.2, C.steel, { n: 8, top: C.metal }),
};

const io = new NodeIO();
/** generateKit: write the kit into cache/ (once per version of this file), → {models: {name: file}, atlas: file}. */
export async function generateKit(root, kit) {
  const version = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex').slice(0, 16);
  const dir = join(root, 'cache', kit.name, version);
  await mkdir(dir, { recursive: true });
  const put = async (name, bytes) => { const f = join(dir, name); await writeFile(`${f}.part`, bytes); await rename(`${f}.part`, f); return f; };
  const models = {};
  for (const name of kit.models) {
    if (!MODELS[name]) throw new Error(`${kit.name}: ${name} is not a model gen-ukubi.mjs makes (${Object.keys(MODELS).join(', ')})`);
    const { json, resources } = await io.writeJSON(toDoc(MODELS[name]()));
    const bin = Object.keys(resources)[0];
    json.buffers[0].uri = `${name}.bin`;
    await put(`${name}.bin`, resources[bin]);
    models[name] = await put(`${name}.gltf`, JSON.stringify(json));
  }
  return { models, atlas: await put('atlas.png', atlas()) };
}
