// The world kit (ours): the player's rides (a bike, a spaceship) and the carriers under the disc (the great turtle,
// the elephants on its shell, the beams they hold up), made by the procgen library (docs/procedural.md). Every model
// is sealed (raised parts have their bottoms) and stands on y = 0 about its own origin (the shell's centre, the
// body's), its front +z.
import { palette as define } from '../../tools/procgen/atlas.mjs';
import { Mesh } from '../../tools/procgen/mesh.mjs';
import { rng } from '../../tools/procgen/random.mjs';

export const palette = define({
  shell: { cell: '0,0', top: '#34382a', bottom: '#1b1d16' }, // the carapace, seen in the grooves between its plates
  scute: { cell: '1,0', top: '#7e7c55', bottom: '#41452c' }, // its plates, olive bronze
  scute2: { cell: '2,2', top: '#8f8159', bottom: '#4c4430' }, // and the warmer ones among them
  skin: { cell: '2,0', top: '#9ba393', bottom: '#4a5249' }, // the turtle's old hide
  belly: { cell: '3,0', top: '#d6c493', bottom: '#8a774c' },
  horn: { cell: '4,0', top: '#5e5342', bottom: '#2b251c' }, // beak, claws
  eye: { cell: '5,0', top: '#f2c85c', bottom: '#b07e26' },
  stone: { cell: '6,0', top: '#a7a68e', bottom: '#5c5b4a' }, // the crust of ages on its oldest plates
  dark: { cell: '7,0', top: '#2c2c2e', bottom: '#141415' }, // pupils, tyres
  hide: { cell: '0,1', top: '#a39b91', bottom: '#5c554e' }, // the elephant
  ivory: { cell: '1,1', top: '#f4ead0', bottom: '#c3b48a' },
  gold: { cell: '2,1', top: '#f2cb63', bottom: '#a5781f' },
  timber: { cell: '3,1', top: '#b98a58', bottom: '#7a5432' },
  grain: { cell: '4,1', top: '#dcbb8a', bottom: '#a5804f' }, // end grain
  paint: { cell: '5,1', top: '#c8442f', bottom: '#80241a' }, // the bike's frame, the ship's trim
  metal: { cell: '6,1', top: '#c3c9cf', bottom: '#6f767d' },
  leather: { cell: '7,1', top: '#6a442c', bottom: '#3c2618' },
  plate: { cell: '0,2', top: '#eef1f3', bottom: '#9aa4ad' }, // the ship's plating
  glass: { cell: '1,2', top: '#a6e1ff', bottom: '#2c6c9c' }, // its canopy
  glow: { cell: '5,2', top: '#f2ffff', bottom: '#a8f6ff' }, // its engines' mouths: bright at any height, to read as lit
  nail: { cell: '4,2', top: '#c2b8a6', bottom: '#81786a' }, // toenails
  lamp: { cell: '3,2', top: '#fff2b8', bottom: '#e0b84e' }
});
const mesh = () => new Mesh(palette);
const PI = Math.PI;

// plate: a raised plate on a facet (corners counter-clockwise seen from outside): a frustum standing proud of the
// facet by `lift`, its foot sunk `sink` into it, shrunk to `k` of the facet so the groove around it shows the facet.
// Returns its top's centre and its normal, for what grows on it.
function plate(m, corners, name, { k = 0.84, lift = 0.025, sink = 0.03 } = {}) {
  const n = corners.length,
    c = corners.reduce((s, p) => s.map((v, i) => v + p[i] / n), [0, 0, 0]);
  const d1 = corners[0].map((v, i) => corners[Math.floor(n / 2)][i] - v),
    d2 = corners[Math.floor(n / 4) || 1].map((v, i) => corners[(Math.floor((3 * n) / 4) || n - 1) % n][i] - v);
  let nn = [d1[1] * d2[2] - d1[2] * d2[1], d1[2] * d2[0] - d1[0] * d2[2], d1[0] * d2[1] - d1[1] * d2[0]];
  const l = Math.sqrt(nn[0] ** 2 + nn[1] ** 2 + nn[2] ** 2);
  nn = nn.map(v => v / l);
  // the normal by the corners' own winding (counter-clockwise from outside): flip it if the diagonals gave it inward
  const w = corners.reduce(
    (s, p, i) => {
      const q = corners[(i + 1) % n];
      return s.map((v, j) => v + [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]][j]);
    },
    [0, 0, 0]
  );
  if (w[0] * nn[0] + w[1] * nn[1] + w[2] * nn[2] < 0) nn = nn.map(v => -v);
  const at = (p, s, h) => p.map((v, i) => c[i] + (v - c[i]) * s + nn[i] * h);
  const top = corners.map(p => at(p, k, lift)),
    foot = corners.map(p => at(p, Math.min(1, k + 0.12), -sink));
  m.poly(top, name).poly([...foot].reverse(), name);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    m.quad(foot[i], foot[j], top[j], top[i], name);
  }
  return { at: at(c, 1, lift), normal: nn };
}

// barnacle: a little volcano of stone standing on a surface at `at`, along its normal (a loft along the normal: no
// angles to work out), its foot sunk `sink` (barnacles of one plate sink to different depths: their feet never share
// a plane)
const barnacle = (m, at, n, r, sink) =>
  m.loft(
    [0, 0, 0],
    [
      { at: at.map((v, i) => v - n[i] * sink), r },
      { at: at.map((v, i) => v + n[i] * r * 0.9), r: r * 0.45 }
    ],
    'stone',
    { n: 5, up: n[1] > 0.9 ? [0, 0, 1] : [0, 1, 0], ends: 'shell' }
  );

// ring: n points of an ellipse (half-sizes a across x, b along z) at height y, counter-clockwise seen from above
// starting at -z, the order the shell's plates take
const ring = (y, a, b, n, spin = 0) =>
  Array.from({ length: n }, (_, i) => {
    const t = ((i + spin) / n) * PI * 2;
    return [-a * Math.sin(t), y, -b * Math.cos(t)];
  });

/** the great turtle: a domed carapace of raised plates (its oldest crusted with stone), a pale plastron, a heavy old
 *  head with a horn beak and hooded eyes, long swept front flippers and paddle hind ones. Shell radius 1 across, 1.18 from
 *  its centre to its front rim (E). */
function turtle() {
  const m = mesh(),
    N = 12,
    E = 1.18; // the shell's length over its width
  // the carapace: rings from the rim up, a raised plate on every facet and one on the crown
  const rings = [
    [0, 1.0],
    [0.1, 0.99],
    [0.28, 0.88],
    [0.43, 0.66],
    [0.52, 0.38],
    [0.56, 0.17]
  ].map(([y, a]) => ring(y + 0.18, a, a * E, N, 0.5));
  const crust = rng('turtle/crust');
  for (let r = 0; r + 1 < rings.length; r++)
    for (let i = 0; i < N; i++) {
      const lo = rings[r],
        hi = rings[r + 1],
        q = [lo[i], lo[(i + 1) % N], hi[(i + 1) % N], hi[i]];
      m.quad(...q, 'shell');
      const x = crust();
      const p = plate(m, q, r > 1 && x < 0.12 ? 'stone' : x < 0.5 ? 'scute' : 'scute2', {
        lift: r === 0 ? 0.02 : 0.035
      });
      // the barnacles of an age adrift, on one plate in four (never on the rim, where the elephants' feet go)
      if (r > 0 && crust() < 0.3) {
        const [u, v] = [q[1].map((x, k) => x - q[0][k]), q[3].map((x, k) => x - q[0][k])];
        for (let b = 0, nb = 1 + Math.floor(crust() * 3); b < nb; b++) {
          const du = crust() * 0.6 - 0.3,
            dv = crust() * 0.5 - 0.25;
          barnacle(
            m,
            p.at.map((x, k) => x + u[k] * du + v[k] * dv),
            p.normal,
            0.045 + crust() * 0.045,
            0.03 + b * 0.01
          );
        }
      }
    }
  m.poly(rings.at(-1), 'shell');
  plate(m, rings.at(-1), 'scute2', { k: 0.75, lift: 0.04 });
  m.poly([...rings[0]].reverse(), 'shell');
  // the plastron, under the rim
  m.loft(
    [0, 0, 0],
    [
      { at: [0, 0.2, 0], r: [0.92, 1.02] },
      { at: [0, 0.08, 0], r: [0.82, 0.92] },
      { at: [0, 0, 0], r: [0.55, 0.64] }
    ],
    'belly',
    { n: N, up: [0, 0, 1] }
  );
  // the head: a wrinkled neck out of the shell, a broad flat old skull, a hooked horn beak over its jaw
  m.loft(
    [0, 0, 0],
    [
      { at: [0, 0.3, 0.9], r: [0.26, 0.2] },
      { at: [0, 0.31, 1.08], r: [0.24, 0.19] },
      { at: [0, 0.33, 1.14], r: [0.26, 0.21] }, // a fold
      { at: [0, 0.36, 1.26], r: [0.23, 0.2] },
      { at: [0, 0.4, 1.4], r: [0.28, 0.22] },
      { at: [0, 0.42, 1.58], r: [0.27, 0.21] },
      { at: [0, 0.38, 1.76], r: [0.18, 0.15] },
      { at: [0, 0.33, 1.84], r: [0.12, 0.1], name: 'horn' }
    ],
    'skin',
    { n: 8, ends: 'horn' }
  );
  m.loft(
    [0, 0, 0],
    [
      { at: [0, 0.44, 1.66], r: [0.15, 0.1] },
      { at: [0, 0.42, 1.82], r: [0.13, 0.09] },
      { at: [0, 0.34, 1.94], r: [0.06, 0.05] },
      { at: [0, 0.25, 1.95], r: 0 }
    ],
    'horn',
    { n: 6 }
  );
  // the big scales on its crown
  for (const [z0, z1, w] of [
    [1.34, 1.47, 0.1],
    [1.49, 1.63, 0.11]
  ])
    plate(
      m,
      [
        [w, 0.6, z0],
        [-w, 0.6, z0],
        [-w * 0.9, 0.605, z1],
        [w * 0.9, 0.605, z1]
      ],
      'scute',
      { k: 0.9, lift: 0.025, sink: 0.04 }
    );
  // its eyes, hooded under a heavy brow, half shut: the look of something that has swum for ever
  for (const s of [1, -1]) {
    const eye = mesh()
      .loft(
        [0, 0, 0],
        [
          { at: [0, 0, -0.035], r: 0.05 },
          { at: [0, 0, 0.035], r: 0.045 }
        ],
        'eye',
        { n: 6 }
      )
      .loft(
        [0, 0, 0],
        [
          { at: [0, 0, 0.03], r: 0.022 },
          { at: [0, 0, 0.05], r: 0.02 }
        ],
        'dark',
        { n: 5 }
      )
      // the lid, down over the top of the eye
      .loft(
        [0, 0, 0],
        [
          { at: [-0.08, 0.012, 0.02], r: [0.04, 0.034] },
          { at: [0.07, 0.016, 0.03], r: [0.044, 0.038] }
        ],
        'skin',
        {
          n: 6
        }
      )
      .loft(
        [0, 0, 0],
        [
          { at: [-0.08, 0.05, 0.015], r: [0.03, 0.022] },
          { at: [0.08, 0.058, 0.02], r: [0.034, 0.026] }
        ],
        'horn',
        {
          n: 6
        }
      );
    m.add(eye, { scale: 1.1, at: [0.245 * s, 0.47, 1.56], rot: (PI / 2 - 0.35) * s, mirror: s < 0 });
  }
  // the flippers: long swept front ones like wings, short paddles behind; each with claws on its leading edge
  const flipper = (path, widths, claws) => {
    const f = mesh().loft(
      [0, 0, 0],
      path.map((at, i) => ({ at, r: widths[i] })),
      'skin',
      { n: 6 }
    );
    for (const [at, rot] of claws)
      f.add(mesh().prism([0, 0, 0], 0.025, 0.07, 'horn', { n: 4, r1: 0, bottom: true }), { at, rot, tilt: PI / 2 });
    return f;
  };
  const front = flipper(
    [
      [0.62, 0.24, 0.62],
      [1.05, 0.2, 0.62],
      [1.5, 0.14, 0.42],
      [1.9, 0.08, 0.06],
      [2.12, 0.04, -0.22]
    ],
    [[0.24, 0.1], [0.27, 0.075], [0.22, 0.055], [0.12, 0.035], 0],
    [
      [[1.12, 0.21, 0.86], 0.3],
      [[1.38, 0.17, 0.75], 0.6]
    ]
  );
  const hind = flipper(
    [
      [0.5, 0.22, -0.78],
      [0.78, 0.18, -1.02],
      [0.98, 0.14, -1.22],
      [1.08, 0.12, -1.38]
    ],
    [[0.18, 0.08], [0.21, 0.06], [0.15, 0.04], 0],
    []
  );
  for (const mirror of [false, true]) m.add(front, { mirror }).add(hind, { mirror });
  // a short tail
  return m.loft(
    [0, 0, 0],
    [
      { at: [0, 0.25, -0.95], r: 0.12 },
      { at: [0, 0.2, -1.25], r: 0.07 },
      { at: [0, 0.14, -1.42], r: 0 }
    ],
    'skin',
    { n: 6 }
  );
}

/** an elephant of the four: it stands on the turtle's shell and holds the disc up on its broad flat back. Pillar legs
 *  with pale nails, great ears, a trunk hanging and curling forward, long tusks bound in gold. 1 tall, feet at 0. */
function elephant() {
  const m = mesh(),
    Y = 0.6; // the body's axis
  // the body: a barrel along z, its back flat (an even section has a flat top) and the highest of it, under the disc
  m.loft(
    [0, 0, 0],
    [
      { at: [0, Y + 0.02, -0.46], r: [0.14, 0.15] },
      { at: [0, Y, -0.4], r: [0.27, 0.27] },
      { at: [0, Y, -0.22], r: [0.32, 0.31] },
      { at: [0, Y + 0.01, 0.06], r: [0.33, 0.32] },
      { at: [0, Y + 0.02, 0.26], r: [0.31, 0.31] },
      { at: [0, Y + 0.03, 0.38], r: [0.24, 0.26] }
    ],
    'hide',
    { n: 10 }
  );
  // the legs: tapered pillars on round feet, their nails a pale band
  for (const [x, z] of [
    [0.19, 0.24],
    [-0.19, 0.24],
    [0.19, -0.26],
    [-0.19, -0.26]
  ])
    m.prism([x, 0, z], 0.112, 0.045, 'nail', { n: 10, top: 'hide', bottom: true }).prism(
      [x, 0.04, z],
      0.1,
      0.56,
      'hide',
      {
        n: 10,
        r1: 0.11,
        bottom: true
      }
    );
  // the head, lowered and forward, under the line of its back
  m.loft(
    [0, 0, 0],
    [
      { at: [0, 0.63, 0.3], r: [0.2, 0.2] },
      { at: [0, 0.71, 0.44], r: [0.21, 0.21] },
      { at: [0, 0.69, 0.56], r: [0.18, 0.19] },
      { at: [0, 0.61, 0.64], r: [0.12, 0.13] }
    ],
    'hide',
    { n: 10 }
  );
  // the trunk: out of the face, hanging, its tip curled forward
  m.loft(
    [0, 0, 0],
    [
      [0, 0.59, 0.6, 0.1],
      [0, 0.49, 0.7, 0.085],
      [0, 0.35, 0.75, 0.07],
      [0, 0.21, 0.75, 0.058],
      [0, 0.09, 0.78, 0.05],
      [0, 0.06, 0.84, 0.045],
      [0, 0.09, 0.9, 0.04]
    ].map(([x, y, z, r]) => ({ at: [x, y, z], r })),
    'hide',
    { n: 7 }
  );
  for (const s of [1, -1]) {
    // a tusk, curving down and out, then up; a band of gold at its root
    m.loft(
      [0, 0, 0],
      [
        [0.09, 0.53, 0.56, 0.035],
        [0.12, 0.43, 0.68, 0.031],
        [0.14, 0.38, 0.82, 0.025],
        [0.12, 0.42, 0.95, 0.016],
        [0.09, 0.5, 1.02, 0]
      ].map(([x, y, z, r]) => ({ at: [x * s, y, z], r })),
      'ivory',
      { n: 6 }
    ).loft(
      [0, 0, 0],
      [
        { at: [0.1 * s, 0.495, 0.6], r: 0.043 },
        { at: [0.115 * s, 0.45, 0.66], r: 0.041 }
      ],
      'gold',
      { n: 6 }
    );
    // an ear: a great flat leaf, swept back from the head
    m.add(mesh().prism([0, 0, 0], 0.22, 0.03, 'hide', { n: 9, bottom: true }), {
      scale: [0.85, 1, 1.15],
      tilt: PI / 2,
      rot: s * (PI / 2 - 0.45),
      at: [0.2 * s, 0.61, 0.36]
    });
    // an eye
    m.add(mesh().box([0, 0, 0], [0.04, 0.035, 0.04], 'dark', { bottom: true }), { at: [0.165 * s, 0.69, 0.54] });
  }
  // the tail, with its tuft
  m.loft(
    [0, 0, 0],
    [
      { at: [0, 0.74, -0.42], r: 0.025 },
      { at: [0, 0.62, -0.5], r: 0.02 },
      { at: [0, 0.44, -0.52], r: 0.018 },
      { at: [0, 0.36, -0.52], r: 0.035, name: 'dark' },
      { at: [0, 0.3, -0.51], r: 0, name: 'dark' }
    ],
    'hide',
    { n: 5 }
  );
  // exactly 1 tall
  const h = m.bounds()[1][1];
  return mesh().add(m, { scale: 1 / h });
}

// tube: a loft of two rings from a to b (a frame's tube, a strut), sealed at both ends
const tube = (m, a, b, r, name, n = 6) =>
  m.loft(
    [0, 0, 0],
    [
      { at: a, r },
      { at: b, r }
    ],
    name,
    { n, up: Math.abs(b[1] - a[1]) > 0.9 * Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) ? [0, 0, 1] : [0, 1, 0] }
  );

/** the bike: a chunky motorbike the knight rides seated, two fat wheels, a red tank and frame, a leather seat, a lamp.
 *  About 1.2 long, front +z. */
function bike() {
  const m = mesh(),
    R = 0.2, // the wheels' radius
    Z = 0.4; // the axles' distance from the middle
  // a wheel: a fat tyre, its rim and hub standing proud on both sides, lying along x
  const wheel = mesh()
    .prism([0, -0.05, 0], R, 0.1, 'dark', { n: 14, bottom: true })
    .prism([0, -0.056, 0], R * 0.6, 0.112, 'metal', { n: 10, bottom: true })
    .prism([0, -0.07, 0], 0.035, 0.14, 'dark', { n: 6, bottom: true });
  for (const z of [Z, -Z]) m.add(wheel, { tilt: PI / 2, rot: PI / 2, at: [0, R, z] });
  // mudguards over the wheels
  for (const z of [Z, -Z]) {
    const arc = [-0.95, -0.45, 0, 0.45, 0.95].map(a => [0, R + Math.cos(a) * (R + 0.04), z + Math.sin(a) * (R + 0.04)]);
    m.loft(
      [0, 0, 0],
      arc.map(at => ({ at, r: [0.07, 0.018] })),
      'paint',
      { n: 4 }
    );
  }
  // the fork, from the front axle up to the head of the frame, and the handlebar across it
  for (const x of [0.06, -0.06]) tube(m, [x, R, Z], [x, 0.66, Z - 0.12], 0.022, 'metal');
  tube(m, [0, 0.63, Z - 0.1], [0, 0.72, Z - 0.14], 0.04, 'metal');
  tube(m, [-0.24, 0.73, Z - 0.17], [0.24, 0.73, Z - 0.17], 0.018, 'metal');
  for (const x of [0.2, -0.2]) tube(m, [x, 0.73, Z - 0.17], [x * 1.25, 0.73, Z - 0.17], 0.03, 'leather');
  // the lamp, facing forward
  m.loft(
    [0, 0, 0],
    [
      { at: [0, 0.64, Z - 0.06], r: 0.07 },
      { at: [0, 0.64, Z + 0.02], r: 0.065, name: 'paint' }
    ],
    'paint',
    { n: 10, ends: 'lamp' }
  );
  // the frame: from the head down to the engine, and back to the rear axle
  tube(m, [0, 0.62, Z - 0.14], [0, 0.3, 0.05], 0.035, 'paint');
  tube(m, [0, 0.58, Z - 0.16], [0, 0.52, -0.25], 0.035, 'paint');
  for (const x of [0.07, -0.07]) {
    tube(m, [x, R, -Z], [x * 0.8, 0.3, -0.05], 0.025, 'paint');
    tube(m, [x, R, -Z], [x * 0.9, 0.5, -0.22], 0.022, 'paint');
  }
  // the engine, and its pipe out the back on the right
  m.box([0, 0.2, 0], [0.2, 0.2, 0.26], 'metal', { bottom: true, top: 'dark' });
  m.loft(
    [0, 0, 0],
    [
      [0.1, 0.25, 0.08],
      [0.14, 0.17, 0],
      [0.15, 0.17, -0.3],
      [0.15, 0.22, -0.52]
    ].map((at, i) => ({ at, r: i === 3 ? 0.04 : 0.028 })),
    'metal',
    { n: 6, ends: 'dark' }
  );
  // the tank: a red egg over the frame, and the seat behind it
  m.loft(
    [0, 0, 0],
    [
      { at: [0, 0.59, 0.24], r: [0.05, 0.04] },
      { at: [0, 0.6, 0.18], r: [0.11, 0.085] },
      { at: [0, 0.6, 0.02], r: [0.12, 0.09] },
      { at: [0, 0.58, -0.08], r: [0.09, 0.07] }
    ],
    'paint',
    { n: 8 }
  );
  m.loft(
    [0, 0, 0],
    [
      { at: [0, 0.57, -0.06], r: [0.08, 0.04] },
      { at: [0, 0.57, -0.14], r: [0.11, 0.05] },
      { at: [0, 0.59, -0.32], r: [0.1, 0.05] },
      { at: [0, 0.6, -0.38], r: [0.06, 0.04] }
    ],
    'leather',
    { n: 8 }
  );
  // the tail lamp
  return m.box([0, 0.57, -0.42], [0.06, 0.04, 0.03], 'paint', { bottom: true });
}

/** the ship: a sleek low-poly spaceship, white plating with red trim, a glass canopy, short swept wings with an engine
 *  nacelle on each, and glowing nozzles at the back (it is seen from behind and above). 1 long, front +z. */
function ship() {
  const m = mesh();
  // the fuselage: a flattened hexagon, wide and low, from a pointed nose back to a square tail; the trim along its
  // flanks
  const flat = [
    [0, -1],
    [1, -0.4],
    [1, 0.4],
    [0, 1],
    [-1, 0.4],
    [-1, -0.4]
  ];
  m.loft(
    [0, 0, 0],
    [
      { at: [0, 0.16, -0.42], r: [0.12, 0.08] },
      { at: [0, 0.16, -0.3], r: [0.15, 0.1] },
      { at: [0, 0.16, -0.05], r: [0.15, 0.1] },
      { at: [0, 0.15, 0.2], r: [0.11, 0.08] },
      { at: [0, 0.14, 0.38], r: [0.05, 0.045] },
      { at: [0, 0.13, 0.5], r: 0 }
    ],
    'plate',
    { profile: flat, cells: ['plate', 'paint', 'plate', 'plate', 'paint', 'plate'] }
  );
  // the canopy, a glass teardrop on its back
  m.loft(
    [0, 0, 0],
    [
      { at: [0, 0.22, -0.12], r: [0.05, 0.03] },
      { at: [0, 0.23, -0.04], r: [0.075, 0.055] },
      { at: [0, 0.22, 0.08], r: [0.06, 0.045] },
      { at: [0, 0.2, 0.2], r: 0 }
    ],
    'glass',
    { n: 8 }
  );
  // the main engine: a nozzle out of the tail, its mouth glowing
  m.loft(
    [0, 0, 0],
    [
      { at: [0, 0.16, -0.47], r: [0.085, 0.055] },
      { at: [0, 0.16, -0.4], r: [0.075, 0.05] }
    ],
    'metal',
    { n: 10, ends: 'glow' }
  );
  for (const s of [1, -1]) {
    // a wing, swept back, thin, from the flank out to the nacelle; its tip trimmed
    m.loft(
      [0, 0, 0],
      [
        { at: [0.1 * s, 0.13, -0.16], r: [0.2, 0.022] },
        { at: [0.22 * s, 0.12, -0.22], r: [0.14, 0.018] },
        { at: [0.3 * s, 0.115, -0.26], r: [0.1, 0.015], name: 'paint' }
      ],
      'plate',
      { n: 6, up: [0, 1, 0] }
    );
    // the nacelle at its tip, and its glowing nozzle
    const x = 0.32 * s;
    m.loft(
      [0, 0, 0],
      [
        { at: [x, 0.12, -0.4], r: 0.055 },
        { at: [x, 0.12, -0.3], r: 0.06 },
        { at: [x, 0.12, -0.1], r: 0.05 },
        { at: [x, 0.12, 0.0], r: 0.025, name: 'paint' }
      ],
      'plate',
      { n: 8 }
    ).loft(
      [0, 0, 0],
      [
        { at: [x, 0.12, -0.45], r: 0.05 },
        { at: [x, 0.12, -0.38], r: 0.045 }
      ],
      'metal',
      { n: 8, ends: 'glow' }
    );
  }
  // a fin on its back, behind the canopy
  m.loft(
    [0, 0, 0],
    [
      { at: [0, 0.24, -0.38], r: [0.012, 0.06] },
      { at: [0, 0.27, -0.28], r: [0.01, 0.04] },
      { at: [0, 0.29, -0.2], r: 0, name: 'paint' }
    ],
    'paint',
    { n: 4 }
  );
  // exactly 1 long, nozzles to nose
  const [lo, hi] = m.bounds();
  return mesh().add(m, { scale: 1 / (hi[2] - lo[2]) });
}

export const models = {
  turtle,
  bike,
  ship,
  elephant,
  // a beam: a unit box of timber, its end grain at top and bottom (the world scales it to the load it bears)
  beam: () => mesh().box([0, 0, 0], [1, 1, 1], 'timber', { top: 'grain', bottom: 'grain' })
};
