// The ukubi kit (Code's): low-poly workshops (age 1) and factories (age 2), a plot and props, made by the procgen
// library (docs/procedural.md). Units are a hex's; a building keeps inside 0.9 of its hex (it stands on the plot).
import { palette as define } from '../../tools/procgen/atlas.mjs';
import { Mesh } from '../../tools/procgen/mesh.mjs';

// the cells a style recolours (catalog/styles.yaml names them by "c,r"): keep a cell's place once a style uses it
export const palette = define({
  plaster: { cell: '0,0', top: '#f1ebe0', bottom: '#c9bfae' },
  timber: { cell: '1,0', top: '#c99a66', bottom: '#8a623c' },
  brick: { cell: '2,0', top: '#b8624a', bottom: '#7e3a2a' },
  slate: { cell: '3,0', top: '#5d6772', bottom: '#353c45' }, // roofs
  concrete: { cell: '4,0', top: '#c3c3bd', bottom: '#8d8d87' },
  steel: { cell: '5,0', top: '#8fa3b3', bottom: '#55697a' },
  team: { cell: '6,0', top: '#e0874a', bottom: '#a4532a' }, // signs, the civ's colour
  glass: { cell: '7,0', top: '#9fd0ea', bottom: '#4d88ad' },
  dark: { cell: '0,1', top: '#7a5536', bottom: '#4b3220' }, // doors, legs
  metal: { cell: '1,1', top: '#8b8f93', bottom: '#5d6165' }, // metal roofs
  soot: { cell: '2,1', top: '#4a4a4a', bottom: '#232323' },
  hazard: { cell: '3,1', top: '#f2c94c', bottom: '#c9961e' }, // cranes
  moss: { cell: '4,1', top: '#8fae6a', bottom: '#5d7d40' },
  sand: { cell: '5,1', top: '#d8c79d', bottom: '#a8956a' }, // the plot
  rust: { cell: '6,1', top: '#b06a3b', bottom: '#6f3e1f' },
  lit: { cell: '7,1', top: '#ffe9a8', bottom: '#f2c14e' }, // lit windows
});
const mesh = () => new Mesh(palette);

// a frontage: a door and a row of windows on the front (+z) of a wall [sx, sy] whose face is at z = 0
function frontage([sx], { door = true, windows = 2, wy = 0.32, pane = 'glass' } = {}) {
  const m = mesh(), f = 0.01;
  if (door) m.box([0, 0, f], [0.18, 0.3, 0.02], 'dark');
  for (let i = 0; i < windows; i++) {
    const wx = (i - (windows - 1) / 2) * (sx / (windows + (door ? 1 : 0.5)));
    if (!(door && Math.abs(wx) < 0.12)) m.box([wx, wy, f], [0.14, 0.12, 0.02], pane);
  }
  return m;
}
// a gabled house at the origin: walls [sx, sy, sz], a gable roof of height h, its frontage
function house([sx, sy, sz], h, walls, { roof = 'slate', ends = walls, ...front } = {}) {
  return mesh().box([0, 0, 0], [sx, sy, sz], walls).gable([0, sy, 0], [sx, sz], h, roof, { ends })
    .add(frontage([sx, sy], front), { at: [0, 0, sz / 2] });
}

export const models = {
  // age 1: workshops
  workshop_A: () => mesh() // a gabled shed: plaster on a timber sill, slate roof, a stove pipe
    .add(house([1.1, 0.55, 0.8], 0.42, 'plaster', { ends: 'timber' }))
    .box([0, 0, 0], [1.14, 0.06, 0.84], 'timber')
    .prism([0.35, 0.6, -0.15], 0.05, 0.5, 'soot'),
  workshop_B: () => { // a long shed with a lean-to and its logs
    const m = mesh().add(house([1.0, 0.5, 0.75], 0.38, 'timber', { windows: 3 }), { at: [-0.1, 0, 0] });
    m.shed([0.55, 0, 0], [0.62, 0.34], 0.3, 0.42, 'metal', { sides: 'dark', rot: Math.PI / 2 }); // sloping down, away from the shed
    for (let i = 0; i < 3; i++) m.box([0.55, i * 0.09, 0.42], [0.36, 0.08, 0.08], 'timber');
    return m;
  },
  workshop_C: () => { // a brick forge with a tall chimney and a water tank on legs
    const m = mesh().add(house([0.9, 0.6, 0.8], 0.35, 'brick', { pane: 'lit' }), { at: [-0.15, 0, 0] });
    m.box([0.12, 0.6, -0.2], [0.18, 0.75, 0.18], 'brick').box([0.12, 1.35, -0.2], [0.22, 0.06, 0.22], 'soot');
    for (const [dx, dz] of [[-0.12, -0.12], [0.12, -0.12], [0.12, 0.12], [-0.12, 0.12]]) m.box([0.58 + dx, 0, 0.25 + dz], [0.04, 0.5, 0.04], 'dark');
    return m.prism([0.58, 0.5, 0.25], 0.17, 0.28, 'rust', { top: 'metal' });
  },
  // age 2: factories
  factory_A: () => mesh() // a brick hall under a glazed sawtooth roof, a tall chimney, its sign
    .box([0, 0, 0], [1.25, 0.7, 0.9], 'brick').box([0, 0.7, 0], [1.29, 0.05, 0.94], 'concrete')
    .sawtooth([0, 0.75, 0], [1.25, 0.9], 0.3, 3, 'metal', 'glass')
    .add(frontage([1.25], { windows: 4, wy: 0.36, pane: 'lit' }), { at: [0, 0, 0.45] })
    .prism([-0.45, 0.75, -0.3], 0.09, 1.0, 'brick', { top: 'soot', r1: 0.07 })
    .box([0.45, 0.4, 0.46], [0.3, 0.08, 0.03], 'team'),
  factory_B: () => { // a two-storey block, glass and steel, a crane on its roof
    const m = mesh().box([0, 0, 0], [1.0, 1.1, 0.85], 'concrete').box([0, 1.1, 0], [1.04, 0.05, 0.89], 'steel');
    for (const y of [0.15, 0.6]) m.box([0, y, 0.43], [0.9, 0.3, 0.02], 'glass');
    return m.box([0, 0, 0.44], [0.2, 0.3, 0.02], 'dark')
      .box([0.3, 1.15, -0.15], [0.08, 0.6, 0.08], 'hazard').box([0.1, 1.72, -0.15], [0.8, 0.06, 0.06], 'hazard')
      .box([0.42, 1.6, -0.15], [0.14, 0.12, 0.12], 'team').box([-0.25, 1.4, -0.15], [0.01, 0.32, 0.01], 'dark');
  },
  factory_C: () => mesh() // a hall, a silo and the conveyor between them
    .add(house([0.9, 0.65, 0.85], 0.2, 'steel', { roof: 'metal', windows: 3, pane: 'lit' }), { at: [-0.2, 0, 0] })
    .prism([0.55, 0, -0.1], 0.24, 1.1, 'concrete', { n: 10, top: 'metal' }).prism([0.55, 1.1, -0.1], 0.24, 0.12, 'metal', { n: 10, r1: 0.04 })
    .box([0.2, 0.75, -0.1], [0.5, 0.06, 0.12], 'hazard')
    .box([0.25, 0, 0.35], [0.06, 0.75, 0.06], 'dark')
    .box([-0.2, 0.35, 0.44], [0.4, 0.07, 0.02], 'team'),
  // the plot under a Code building: a sand yard with a concrete curb, a hex 0.97 of the tile's
  plot_yard: () => mesh().slab([0, 0, 0], 1.12, 0.03, 'sand', { rim: 'concrete', w: 0.08 }),
  // dressing
  crates: () => mesh().box([0, 0, 0], [0.22, 0.2, 0.22], 'timber').box([0.2, 0, 0.05], [0.18, 0.16, 0.18], 'timber').box([0.08, 0.2, 0.02], [0.16, 0.14, 0.16], 'timber'),
  logs: () => { const m = mesh(); for (const [x, y] of [[-0.09, 0], [0.09, 0], [0, 0.09]]) m.box([x, y, 0], [0.09, 0.09, 0.45], 'timber', { top: 'dark' }); return m; },
  spool: () => mesh().prism([0, 0, 0], 0.13, 0.03, 'timber', { n: 10 }).prism([0, 0.03, 0], 0.07, 0.16, 'team', { n: 10 }).prism([0, 0.19, 0], 0.13, 0.03, 'timber', { n: 10 }),
  shrub: () => mesh().prism([0, 0, 0], 0.03, 0.12, 'dark', { n: 5 }).prism([0, 0.12, 0], 0.16, 0.3, 'moss', { n: 6, r1: 0 }),
  drum: () => mesh().prism([0, 0, 0], 0.08, 0.2, 'rust', { top: 'metal' }).prism([0.15, 0, 0.05], 0.08, 0.2, 'steel', { top: 'metal' }),
};
