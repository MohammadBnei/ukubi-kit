// procgen/parts: sub-assemblies any kit can use (docs/procedural.md). A part takes the kit's mesh factory (so it is
// built in that kit's palette) and the palette names to paint it with; it is built at the origin, front +z, for the
// caller to add() where it goes.

/** frontage: a door and a row of windows for a wall of width sx whose face is at z = 0. Each sits half in the wall,
 *  half proud of it (depth d), so no face shares the wall's plane. door: a palette name, or false. */
export function frontage(
  mesh,
  sx,
  { door = 'door', windows = 2, wy = 0.32, pane = 'glass', d = 0.03, size = [0.14, 0.12] } = {}
) {
  const m = mesh();
  if (door) m.box([0, 0, 0], [0.18, 0.3, d], door);
  for (let i = 0; i < windows; i++) {
    const wx = (i - (windows - 1) / 2) * (sx / (windows + (door ? 1 : 0.5)));
    if (!(door && Math.abs(wx) < 0.12)) m.box([wx, wy, 0], [size[0], size[1], d], pane);
  }
  return m;
}

/** house: walls [sx, sy, sz] under a gable roof of height h, with its frontage. names: walls, roof, ends (the gable
 *  ends, the walls' by default), and the frontage's door and pane; front: the frontage's other options. */
export function house(mesh, [sx, sy, sz], h, { walls, roof, ends = walls, o, ...front }) {
  return mesh()
    .box([0, 0, 0], [sx, sy, sz], walls)
    .gable([0, sy, 0], [sx, sz], h, roof, { ends, ...(o !== undefined && { o }) })
    .add(frontage(mesh, sx, front), { at: [0, 0, sz / 2] });
}
