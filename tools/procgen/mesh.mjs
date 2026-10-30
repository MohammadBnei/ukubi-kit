// procgen/mesh: low-poly geometry built from primitives, for a kit we make rather than fetch (docs/procedural.md).
//
// Conventions, the same as the rest of the kit:
// - units are a hex's (a hex tile is 2 flat-to-flat, pointy along z); y is up; a model stands on y = 0;
// - a model's front faces +z;
// - rot is radians about +y, turning +z toward +x (as catalog/recipes.yaml's rot: 1.5708 faces a part's front +x);
// - every face is wound counter-clockwise seen from outside (its normal points out), flat-shaded, in one palette cell.
//
// A primitive's `at` is its centre-bottom (x, y0, z) before rot, and rot turns it about its own centre-bottom. Sizes
// are positive (a primitive refuses anything else). Composition: build a sub-assembly as its own Mesh (or take one
// from procgen/parts.mjs) and add() it where it goes, turned, tilted, scaled or mirrored; a Mesh holds no transform.

export class Mesh {
  /** palette: {name: {cell: "c,r", …}} (procgen/atlas.mjs); faces name their cell by the palette's names. */
  constructor(palette) {
    if (!palette) throw new Error("procgen: a Mesh needs its kit's palette");
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
    for (let i = 1; i < pts.length - 1; i++) this.tris.push({ p: [pts[0], pts[i], pts[i + 1]].map(v => [...v]), cell });
    return this;
  }
  quad(a, b, c, d, name) {
    return this.poly([a, b, c, d], name);
  }

  // ---- primitives (open at the bottom unless asked: most stand on something)

  /** a box: size [sx, sy, sz]; its top may take another cell; `bottom` closes it underneath (a raised part). */
  box(at, [sx, sy, sz], name, { top = name, bottom = false, rot = 0 } = {}) {
    sizes('box', sx, sy, sz);
    const P = place(at, rot),
      X = sx / 2,
      Z = sz / 2;
    const v = [
      P(-X, 0, -Z),
      P(X, 0, -Z),
      P(X, 0, Z),
      P(-X, 0, Z),
      P(-X, sy, -Z),
      P(X, sy, -Z),
      P(X, sy, Z),
      P(-X, sy, Z)
    ];
    this.quad(v[3], v[2], v[6], v[7], name)
      .quad(v[1], v[0], v[4], v[5], name)
      .quad(v[2], v[1], v[5], v[6], name)
      .quad(v[0], v[3], v[7], v[4], name)
      .quad(v[7], v[6], v[5], v[4], top);
    return bottom ? this.quad(v[0], v[1], v[2], v[3], bottom === true ? name : bottom) : this;
  }

  /** a gable roof over a footprint [sx, sz]: ridge along x at height h, eaves overhanging by o. Its two gable ends
   *  close the wall under the roof (a pentagon up to the roof's underside when it overhangs) and may take another
   *  cell. */
  gable(at, [sx, sz], h, name, { ends = name, o = 0.06, rot = 0 } = {}) {
    sizes('gable', sx, sz, h);
    need(o >= 0, 'gable: the overhang o is negative');
    const P = place(at, rot),
      X = sx / 2 + o,
      Z = sz / 2 + o,
      x = sx / 2,
      z = sz / 2;
    const r0 = P(-X, h, 0),
      r1 = P(X, h, 0),
      eave = (h * o) / Z; // the roof's height above the wall's edge
    this.quad(P(-X, 0, Z), P(X, 0, Z), r1, r0, name).quad(P(X, 0, -Z), P(-X, 0, -Z), r0, r1, name);
    const end = s => {
      // s = -1 (the -x end) or 1, wound to face s·x
      const pts =
        o > 0
          ? [P(s * x, 0, s * z), P(s * x, 0, -s * z), P(s * x, eave, -s * z), P(s * x, h, 0), P(s * x, eave, s * z)]
          : [P(s * x, 0, s * z), P(s * x, 0, -s * z), P(s * x, h, 0)];
      return this.poly(pts, ends);
    };
    end(-1);
    return end(1);
  }

  /** a hipped roof over [sx, sz] (sx ≥ sz: turn it for a ridge along z): four slopes up to a ridge along x of length
   *  sx - sz, a pyramid when square. */
  hip(at, [sx, sz], h, name, { o = 0.06, rot = 0 } = {}) {
    sizes('hip', sx, sz, h);
    need(sx >= sz, `hip: [${sx}, ${sz}] is deeper than wide; give it rot: Math.PI / 2 instead`);
    const P = place(at, rot),
      X = sx / 2 + o,
      Z = sz / 2 + o,
      rx = X - Z;
    const a = P(-X, 0, -Z),
      b = P(X, 0, -Z),
      c = P(X, 0, Z),
      d = P(-X, 0, Z),
      r0 = P(-rx, h, 0),
      r1 = P(rx, h, 0);
    if (rx < 1e-9)
      return this.poly([d, c, r1], name).poly([c, b, r1], name).poly([b, a, r1], name).poly([a, d, r1], name);
    return this.quad(d, c, r1, r0, name).quad(b, a, r0, r1, name).poly([c, b, r1], name).poly([a, d, r0], name);
  }

  /** a shed (mono-pitch) block over [sx, sz]: its roof rising from h0 at the front (+z) to h1 at the back, with its
   *  own walls (a lean-to). */
  shed(at, [sx, sz], h0, h1, name, { sides = name, rot = 0 } = {}) {
    sizes('shed', sx, sz, h0, h1);
    const P = place(at, rot),
      X = sx / 2,
      Z = sz / 2;
    const a = P(-X, h1, -Z),
      b = P(X, h1, -Z),
      c = P(X, h0, Z),
      d = P(-X, h0, Z);
    this.quad(d, c, b, a, name);
    this.quad(P(-X, 0, Z), P(X, 0, Z), c, d, sides).quad(P(X, 0, -Z), P(-X, 0, -Z), a, b, sides);
    this.quad(P(X, 0, Z), P(X, 0, -Z), b, c, sides).quad(P(-X, 0, -Z), P(-X, 0, Z), d, a, sides);
    return this;
  }

  /** a sawtooth roof over [sx, sz]: n teeth along x, each a slope rising toward +x and a vertical glazed face. */
  sawtooth(at, [sx, sz], h, n, name, glass, { rot = 0 } = {}) {
    sizes('sawtooth', sx, sz, h);
    need(Number.isInteger(n) && n >= 1, `sawtooth: ${n} teeth`);
    const P = place(at, rot),
      w = sx / n,
      Z = sz / 2;
    for (let i = 0; i < n; i++) {
      const x0 = -sx / 2 + i * w,
        x1 = x0 + w;
      const a = P(x0, 0, -Z),
        b = P(x1, 0, -Z),
        c = P(x1, 0, Z),
        d = P(x0, 0, Z),
        e = P(x1, h, -Z),
        f = P(x1, h, Z);
      this.quad(a, d, f, e, name).quad(c, b, e, f, glass).poly([d, c, f], name).poly([b, a, e], name);
    }
    return this;
  }

  /** an upright n-sided prism of radius r and height h, tapering to r1 (a chimney, a silo, a tank, a cone at r1 = 0),
   *  capped unless it comes to a point; `bottom` closes it underneath. Lying down: build it upright and add() it
   *  with tilt. */
  prism(at, r, h, name, { n = 8, r1 = r, top = name, bottom = false, rot = 0 } = {}) {
    sizes('prism', r, h);
    need(r1 >= 0, 'prism: r1 is negative');
    need(Number.isInteger(n) && n >= 3, `prism: ${n} sides`);
    const P = place(at, rot);
    const ring = (y, rr) =>
      Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        return P(rr * Math.sin(a), y, rr * Math.cos(a));
      });
    const lo = ring(0, r);
    if (bottom) this.poly([...lo].reverse(), bottom === true ? name : bottom);
    if (r1 === 0) {
      const apex = P(0, h, 0);
      for (let i = 0; i < n; i++) this.poly([lo[i], lo[(i + 1) % n], apex], name);
      return this;
    }
    const hi = ring(h, r1);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.quad(lo[i], lo[j], hi[j], hi[i], name);
    }
    return this.poly(hi, top);
  }

  /** a flat slab of n sides (a plot, a pad): radius r to its corners, thickness t; a rim of width w (< r) in another
   *  cell, the inner top a hair above it. n = 6 lies pointy along z, like the hex tiles. */
  slab(at, r, t, name, { n = 6, rim = name, w = 0, rot = 0 } = {}) {
    sizes('slab', r, t);
    need(w >= 0 && w < r, `slab: rim ${w} is not inside radius ${r}`);
    need(Number.isInteger(n) && n >= 3, `slab: ${n} sides`);
    const P = place(at, rot),
      a0 = n === 6 ? 0 : Math.PI / n;
    const ring = (rr, y) =>
      Array.from({ length: n }, (_, i) => {
        const a = a0 + (i / n) * Math.PI * 2;
        return P(rr * Math.sin(a), y, rr * Math.cos(a));
      });
    const lo = ring(r, 0),
      hi = ring(r, t);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.quad(lo[i], lo[j], hi[j], hi[i], rim);
    }
    if (w <= 0) return this.poly(hi, name);
    const inner = ring(r - w, t + 0.002);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.quad(hi[i], hi[j], inner[j], inner[i], rim);
    }
    return this.poly(inner, name);
  }

  /** a loft: a cross-section swept through rings [{at: [x, y, z] (from `at`), r: [a, b] or a number, name}], each
   *  ring square to the path there (its tangent from its neighbours, its frame carried along the path so it never
   *  twists). The section is `profile` (unit [s, u] points, convex, counter-clockwise from s toward u) or a regular
   *  n-gon with a flat bottom; a is its half-size across the path (s), b up (u, from `up` at the first ring). A ring
   *  of r 0 at either end is a point (a cone, a beak); any other end is capped with `ends`. A band takes its far
   *  ring's name, or `cells[i]` for the i-th side of the section (a stripe along the path). Hulls, shells, trunks,
   *  limbs: build it at the origin and add() it where it goes. */
  loft(at, rings, name, { n = 8, profile, cells, ends = name, up = [0, 1, 0], rot = 0 } = {}) {
    need(Array.isArray(rings) && rings.length >= 2, 'loft: fewer than two rings');
    const sec =
      profile ||
      Array.from({ length: n }, (_, i) => {
        const a = ((i + 0.5) / n) * Math.PI * 2 - Math.PI / 2; // a flat bottom: the first side lies under the path
        return [Math.cos(a), Math.sin(a)];
      });
    need(sec.length >= 3, `loft: a section of ${sec.length} points`);
    need(!cells || cells.length === sec.length, `loft: ${cells?.length} cells for ${sec.length} sides`);
    const r = rings.map(g => (typeof g.r === 'number' ? [g.r, g.r] : g.r));
    r.forEach(([a, b], i) => {
      const end = i === 0 || i === r.length - 1;
      need((a === 0 && b === 0 && end) || (a > 0 && b > 0), `loft: ring ${i} has size ${a}, ${b}`);
    });
    const P = place(at, rot),
      c = rings.map(g => g.at);
    const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]],
      dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2],
      cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]],
      unit = p => {
        const l = Math.sqrt(dot(p, p));
        need(l > 1e-9, 'loft: two rings at one place');
        return p.map(v => v / l);
      };
    let u = up;
    const pts = c.map((ci, i) => {
      const t = unit(sub(c[Math.min(i + 1, c.length - 1)], c[Math.max(i - 1, 0)]));
      // carry the frame: the last up, made square to this tangent (the first from `up`, or z if up runs along it)
      let v = sub(
        u,
        t.map(x => x * dot(u, t))
      );
      if (dot(v, v) < 1e-6)
        v = sub(
          [0, 0, 1],
          t.map(x => x * t[2])
        );
      u = unit(v);
      const s = cross(u, t); // s × u = t: the section runs counter-clockwise about the path
      return sec.map(([ps, pu]) => {
        const q = [0, 1, 2].map(k => ci[k] + r[i][0] * ps * s[k] + r[i][1] * pu * u[k]);
        return P(q[0], q[1], q[2]);
      });
    });
    const m = sec.length;
    for (let i = 0; i + 1 < pts.length; i++) {
      const lo = pts[i],
        hi = pts[i + 1],
        band = rings[i + 1].name || name;
      for (let k = 0; k < m; k++) {
        const j = (k + 1) % m,
          cell = cells?.[k] || band;
        if (i === 0 && r[0][0] === 0) this.poly([lo[k], hi[j], hi[k]], cell);
        else if (i + 2 === pts.length && r[i + 1][0] === 0) this.poly([lo[k], lo[j], hi[k]], cell);
        else this.quad(lo[k], lo[j], hi[j], hi[k], cell);
      }
    }
    if (r[0][0] > 0) this.poly([...pts[0]].reverse(), ends);
    if (r[r.length - 1][0] > 0) this.poly(pts[pts.length - 1], ends);
    return this;
  }

  /** a thin panel seen from both sides (a sail, a sign on a post, a flag): a planar convex polygon given once, drawn
   *  with both windings. */
  panel(pts, name) {
    return this.poly(pts, name).poly([...pts].reverse(), name);
  }

  // ---- composition

  /** add another Mesh (of the same palette), placed. In order: scale (a number, or [x, y, z]; positive), mirror
   *  (x → -x, the winding kept outward), tilt (radians about +x, turning +y toward +z: a prism lies down along z at
   *  π/2), rot (about +y), then at. */
  add(other, { at = [0, 0, 0], rot = 0, scale = 1, mirror = false, tilt = 0 } = {}) {
    if (other.palette !== this.palette) throw new Error('procgen: add() joins meshes of one palette only');
    const [kx, ky, kz] = typeof scale === 'number' ? [scale, scale, scale] : scale;
    need(
      [kx, ky, kz].every(k => k > 0),
      `add: scale ${scale} must be positive (mirror with mirror: true)`
    );
    const P = place(at, rot),
      ct = Math.cos(tilt),
      st = Math.sin(tilt);
    for (const t of other.tris) {
      const p = t.p.map(([x, y, z]) => {
        x *= kx * (mirror ? -1 : 1);
        y *= ky;
        z *= kz;
        return P(x, ct * y - st * z, st * y + ct * z);
      });
      this.tris.push({ p: mirror ? [p[0], p[2], p[1]] : p, cell: t.cell });
    }
    return this;
  }

  /** repeat: n copies of a Mesh, each `step` [dx, dy, dz] from the last, starting at `at` (a fence, a row of
   *  windows, stacked crates). */
  repeat(other, n, step, { at = [0, 0, 0], rot = 0 } = {}) {
    for (let i = 0; i < n; i++)
      this.add(other, { at: [at[0] + i * step[0], at[1] + i * step[1], at[2] + i * step[2]], rot });
    return this;
  }

  /** the axis-aligned bounds [[min], [max]]. */
  bounds() {
    const lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity];
    for (const t of this.tris)
      for (const p of t.p)
        for (let i = 0; i < 3; i++) {
          lo[i] = Math.min(lo[i], p[i]);
          hi[i] = Math.max(hi[i], p[i]);
        }
    return [lo, hi];
  }

  /** what is wrong with it: no faces, a coordinate that isn't a number, a triangle with no area. */
  problems() {
    const out = [];
    if (!this.tris.length) out.push('no faces');
    this.tris.forEach((t, i) => {
      if (t.p.flat().some(v => !Number.isFinite(v))) out.push(`triangle ${i}: a coordinate is not a number`);
      else if (area(t.p) < 1e-7) out.push(`triangle ${i}: no area (${JSON.stringify(t.p)})`);
    });
    return out;
  }
}

function need(ok, msg) {
  if (!ok) throw new Error(`procgen: ${msg}`);
}
// sizes: every size of a primitive is a positive number (a negative one would turn its faces inward)
function sizes(what, ...vs) {
  need(
    vs.every(v => Number.isFinite(v) && v > 0),
    `${what}: sizes ${vs.join(', ')} must all be positive`
  );
}

// place: a point's local (x, y, z) turned by rot about +y (+z toward +x) and moved to at
function place([ax, ay, az], rot) {
  const c = Math.cos(rot),
    s = Math.sin(rot);
  return (x, y, z) => [ax + c * x + s * z, ay + y, az - s * x + c * z];
}

/** normal: the unit normal of a triangle by its winding (counter-clockwise seen from where it points). */
export function normal([a, b, c]) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
    w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]],
    l = Math.hypot(...n) || 1;
  return n.map(v => v / l);
}
const area = ([a, b, c]) => {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
    w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
};
