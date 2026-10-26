// procgen/mesh: low-poly geometry built from primitives, for a kit we make rather than fetch (docs/procedural.md).
//
// Conventions, the same as the rest of the kit:
// - units are a hex's (a hex tile is 2 flat-to-flat, pointy along z); y is up; a model stands on y = 0;
// - a model's front faces +z;
// - rot is radians about +y, turning +z toward +x (as catalog/recipes.yaml's rot: 1.5708 faces a part's front +x);
// - every face is wound counter-clockwise seen from outside (its normal points out), flat-shaded, in one palette cell.
//
// A primitive's `at` is its centre-bottom (x, y0, z) before rot, and rot turns it about its own centre-bottom.
// Composition: build a sub-assembly as its own Mesh and add() it where it goes; a Mesh never holds a transform.

export class Mesh {
  /** palette: {name: {cell: "c,r", …}} (procgen/atlas.mjs); faces name their cell by the palette's names. */
  constructor(palette) {
    if (!palette) throw new Error('procgen: a Mesh needs its kit\'s palette');
    this.palette = palette;
    this.tris = []; // {p: [[x,y,z] ×3], cell: "c,r"}
  }

  cell(name) {
    const c = this.palette[name]?.cell;
    if (!c) throw new Error(`procgen: no cell named ${name} in the palette (${Object.keys(this.palette).join(', ')})`);
    return c;
  }

  // ---- faces

  /** a planar convex polygon, counter-clockwise seen from outside, fanned from its first point. */
  poly(pts, name) {
    const cell = this.cell(name);
    for (let i = 1; i < pts.length - 1; i++) this.tris.push({ p: [pts[0], pts[i], pts[i + 1]].map((v) => [...v]), cell });
    return this;
  }
  quad(a, b, c, d, name) { return this.poly([a, b, c, d], name); }

  // ---- primitives (open at the bottom: they stand on something)

  /** a box: size [sx, sy, sz]; its top may take another cell. */
  box(at, [sx, sy, sz], name, { top = name, rot = 0 } = {}) {
    const P = place(at, rot), X = sx / 2, Z = sz / 2;
    const v = [P(-X, 0, -Z), P(X, 0, -Z), P(X, 0, Z), P(-X, 0, Z), P(-X, sy, -Z), P(X, sy, -Z), P(X, sy, Z), P(-X, sy, Z)];
    return this.quad(v[3], v[2], v[6], v[7], name).quad(v[1], v[0], v[4], v[5], name).quad(v[2], v[1], v[5], v[6], name)
      .quad(v[0], v[3], v[7], v[4], name).quad(v[7], v[6], v[5], v[4], top);
  }

  /** a gable roof over a footprint [sx, sz]: ridge along x at height h, eaves overhanging by o; its two gable ends
   *  (the wall's triangles under the roof, inside the overhang) may take another cell. */
  gable(at, [sx, sz], h, name, { ends = name, o = 0.06, rot = 0 } = {}) {
    const P = place(at, rot), X = sx / 2 + o, Z = sz / 2 + o, x = sx / 2, z = sz / 2, hz = h * (z / Z);
    const r0 = P(-X, h, 0), r1 = P(X, h, 0);
    this.quad(P(-X, 0, Z), P(X, 0, Z), r1, r0, name).quad(P(X, 0, -Z), P(-X, 0, -Z), r0, r1, name);
    return this.poly([P(-x, 0, -z), P(-x, 0, z), P(-x, hz, 0)], ends).poly([P(x, 0, z), P(x, 0, -z), P(x, hz, 0)], ends);
  }

  /** a hipped roof: four slopes up to a ridge along x (length sx - sz, a pyramid when that is ≤ 0). */
  hip(at, [sx, sz], h, name, { o = 0.06, rot = 0 } = {}) {
    const P = place(at, rot), X = sx / 2 + o, Z = sz / 2 + o, rx = Math.max(0, X - Z);
    const a = P(-X, 0, -Z), b = P(X, 0, -Z), c = P(X, 0, Z), d = P(-X, 0, Z), r0 = P(-rx, h, 0), r1 = P(rx, h, 0);
    if (rx === 0) return this.poly([d, c, r1], name).poly([c, b, r1], name).poly([b, a, r1], name).poly([a, d, r1], name);
    return this.quad(d, c, r1, r0, name).quad(b, a, r0, r1, name).poly([c, b, r1], name).poly([a, d, r0], name);
  }

  /** a shed (mono-pitch) roof over [sx, sz]: rising from h0 at the front (+z) to h1 at the back, with its sides. */
  shed(at, [sx, sz], h0, h1, name, { sides = name, rot = 0 } = {}) {
    const P = place(at, rot), X = sx / 2, Z = sz / 2;
    const a = P(-X, h1, -Z), b = P(X, h1, -Z), c = P(X, h0, Z), d = P(-X, h0, Z);
    this.quad(d, c, b, a, name);
    this.quad(P(-X, 0, Z), P(X, 0, Z), c, d, sides).quad(P(X, 0, -Z), P(-X, 0, -Z), a, b, sides);
    this.quad(P(X, 0, Z), P(X, 0, -Z), b, c, sides).quad(P(-X, 0, -Z), P(-X, 0, Z), d, a, sides);
    return this;
  }

  /** a sawtooth roof over [sx, sz]: n teeth along x, each a slope rising toward +x and a vertical glazed face. */
  sawtooth(at, [sx, sz], h, n, name, glass, { rot = 0 } = {}) {
    const P = place(at, rot), w = sx / n, Z = sz / 2;
    for (let i = 0; i < n; i++) {
      const x0 = -sx / 2 + i * w, x1 = x0 + w;
      const a = P(x0, 0, -Z), b = P(x1, 0, -Z), c = P(x1, 0, Z), d = P(x0, 0, Z), e = P(x1, h, -Z), f = P(x1, h, Z);
      this.quad(a, d, f, e, name).quad(c, b, e, f, glass).poly([d, c, f], name).poly([b, a, e], name);
    }
    return this;
  }

  /** an upright n-sided prism of radius r and height h, tapering to r1 (a chimney, a silo, a tank, a cone at r1 = 0),
   *  capped unless it comes to a point. */
  prism(at, r, h, name, { n = 8, r1 = r, top = name, rot = 0 } = {}) {
    const P = place(at, rot);
    const ring = (y, rr) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return P(rr * Math.sin(a), y, rr * Math.cos(a)); });
    const lo = ring(0, r);
    if (r1 === 0) { const apex = P(0, h, 0); for (let i = 0; i < n; i++) this.poly([lo[i], lo[(i + 1) % n], apex], name); return this; }
    const hi = ring(h, r1);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.quad(lo[i], lo[j], hi[j], hi[i], name); }
    return this.poly(hi, top);
  }

  /** a flat slab of n sides (a plot, a pad): radius r to its corners, thickness t, a rim of width w in another cell.
   *  n = 6 lies pointy along z, like the hex tiles. */
  slab(at, r, t, name, { n = 6, rim = name, w = 0, rot = 0 } = {}) {
    const P = place(at, rot), a0 = n === 6 ? 0 : Math.PI / n;
    const ring = (rr, y) => Array.from({ length: n }, (_, i) => { const a = a0 + (i / n) * Math.PI * 2; return P(rr * Math.sin(a), y, rr * Math.cos(a)); });
    const lo = ring(r, 0), hi = ring(r, t);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.quad(lo[i], lo[j], hi[j], hi[i], rim); }
    if (w <= 0) return this.poly(hi, name);
    const inner = ring(r - w, t + 0.002);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.quad(hi[i], hi[j], inner[j], inner[i], rim); }
    return this.poly(inner, name);
  }

  // ---- composition

  /** add another Mesh (of the same palette), placed: at, rot about +y, uniform scale. */
  add(other, { at = [0, 0, 0], rot = 0, scale = 1 } = {}) {
    if (other.palette !== this.palette) throw new Error('procgen: add() joins meshes of one palette only');
    const P = place(at, rot);
    for (const t of other.tris) this.tris.push({ p: t.p.map(([x, y, z]) => P(x * scale, y * scale, z * scale)), cell: t.cell });
    return this;
  }

  /** the axis-aligned bounds [[min], [max]]. */
  bounds() {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const t of this.tris) for (const p of t.p) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
    return [lo, hi];
  }

  /** what is wrong with it: no faces, a coordinate that isn't a number, a triangle with no area. */
  problems() {
    const out = [];
    if (!this.tris.length) out.push('no faces');
    this.tris.forEach((t, i) => {
      if (t.p.flat().some((v) => !Number.isFinite(v))) out.push(`triangle ${i}: a coordinate is not a number`);
      else if (area(t.p) < 1e-7) out.push(`triangle ${i}: no area (${JSON.stringify(t.p)})`);
    });
    return out;
  }
}

// place: a point's local (x, y, z) turned by rot about +y (+z toward +x) and moved to at
function place([ax, ay, az], rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return (x, y, z) => [ax + c * x + s * z, ay + y, az - s * x + c * z];
}

/** normal: the unit normal of a triangle by its winding (counter-clockwise seen from where it points). */
export function normal([a, b, c]) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...n) || 1;
  return n.map((v) => v / l);
}
const area = ([a, b, c]) => {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
};
