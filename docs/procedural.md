# Making a kit: the procgen library

When no CC0 pack has what a civ needs, we make the kit ourselves. The Code civ's `ukubi` kit is the first one
(`kits/ukubi/`). This guide covers making the next one, and growing the library when a kit needs a shape it lacks.

A made kit behaves exactly like a fetched KayKit pack, for four reasons:
- its models are flat-shaded low-poly meshes painted through an **8×4 atlas of gradient swatches**;
- styles repaint it with the same cell recolours (`catalog/styles.yaml`);
- recipes, plots and dressing use it the same way;
- the same validation holds it to the hex: reach, triangles, one kit per civ.

The difference is that its source is code, versioned in this repo and rebuilt on every build. It has no pin and no
lock.

## The pieces

| File | What |
|---|---|
| `tools/procgen/mesh.mjs` | `Mesh`: faces and primitives, composition, bounds, `problems()` |
| `tools/procgen/atlas.mjs` | `palette()` (named cells, checked), `atlas()` (the PNG), `uv()` |
| `tools/procgen/random.mjs` | `rng(seed)`, `hash32()`: seeded randomness, never `Math.random()` |
| `tools/procgen/kit.mjs` | `generateKit()`: runs a kit's module into `cache/`, versioned; `toDoc()` |
| `tools/procgen/procgen.test.mjs` | the library's tests (`npm test`): winding, cells, palette, determinism |
| `kits/<name>/source.yaml` | `generator: models.mjs`, the scale, the turns, and the models the build takes |
| `kits/<name>/models.mjs` | the kit itself: its `palette` and its `models` |

## Conventions (the library and the rest of the kit agree on these)

- **Units are a hex's.** A tile is 2 flat-to-flat and pointy along z, so a made kit's `scale` is 1. A model stands on
  y = 0 and is centred on x = z = 0.
- **Front is +z.** A building's door and windows face +z, and the town turns it in steps of 2π/`turns`.
- **`rot` is radians about +y, turning +z toward +x.** This is the same as `catalog/recipes.yaml`, so
  `rot: Math.PI / 2` faces a part's front toward +x.
- **Faces are wound counter-clockwise seen from outside.** Each primitive does this already, and the tests check it.
  A face you write by hand with `poly`/`quad` must too: list its corners counter-clockwise as seen from where its
  normal should point. Polygons must be planar and convex, because they are fanned from their first corner.
- **Primitives are open at the bottom**, since they always stand on something: the ground, a wall top, the plot. Never
  rely on seeing under one.
- **Two faces never share a plane.** A door or a window stands 0.01 proud of its wall, and a slab's rim sits just
  above its top, or the two will z-fight.
- **A primitive's `at` is its centre-bottom.** It turns about that point. To place a sub-assembly, build it as its own
  `Mesh` at the origin and `add()` it with `{ at, rot, scale }`.

### Fitting the hex (build.mjs checks these)
| What | Reach, in hexes (1 = the hex's edge) | Triangles |
|---|---|---|
| a building | ≤ 1.1, or ≤ 0.9 if its civ has a plot | ≤ 4500 |
| a town centre | ≤ 1.25 | ≤ 8000 |
| a plot | ≤ 1.0 (its neighbour's must not overlap it) | — |
| dressing | ≤ 1.1 | — |

Reach is the farthest vertex: `max(|x|, |x|/2 + |z|·√3/2)`. A box of half-sizes (X, Z) reaches `X/2 + Z·0.866`.
`ukubi`'s buildings come in around 0.7–0.8 and 80–130 triangles. The flat-shaded look needs very few.

## The palette is the kit's contract with the styles

`palette({ name: { cell: 'c,r', top: '#rrggbb', bottom: '#rrggbb' } })`: each name owns one cell of the 8×4 grid,
drawn as a vertical gradient (light at the top, as in KayKit's atlases). A face names its cell (`'brick'`), and its
vertices sample the cell's middle column, from the model's top (light) to its foot (dark). That gives the free
shading the packs have.

Styles recolour cells **by position**: `catalog/styles.yaml` says `ukubi: { "6,0": "#ff5cc8" }`. So:
- **Once a style uses a cell, never move its name to another cell.** Add new names in free cells instead.
- **Give every colour a style should change its own name**: the civ's team colour, the roof, the main walls.
  Colours that never change can share a name.
- **Note the cells at the top of `catalog/styles.yaml`** (`ukubi 0,0 plaster …`), as for every kit.

## Making a new kit, step by step

1. **`kits/<name>/source.yaml`:**
   ```yaml
   name: <name>
   generator: models.mjs
   licence: CC0-1.0
   scale: 1
   turns: 4          # 6 if its models are hex-shaped, 2 if they have one street face
   models: [hall_A, hall_B, plot_pad, barrels]
   ```
2. **`kits/<name>/models.mjs`:**
   ```js
   import { palette as define } from '../../tools/procgen/atlas.mjs';
   import { Mesh } from '../../tools/procgen/mesh.mjs';

   export const palette = define({
     walls: { cell: '0,0', top: '#d9d0c0', bottom: '#a89f8f' },
     roof:  { cell: '1,0', top: '#5d6772', bottom: '#353c45' },
     team:  { cell: '2,0', top: '#e0874a', bottom: '#a4532a' }, // the civ's colour, for its styles
     glass: { cell: '3,0', top: '#9fd0ea', bottom: '#4d88ad' },
   });
   const mesh = () => new Mesh(palette);

   // a sub-assembly: built at the origin, added where it goes
   const sign = () => mesh().box([0, 0, 0], [0.3, 0.08, 0.02], 'team');

   export const models = {
     hall_A: () => mesh()
       .box([0, 0, 0], [1.1, 0.6, 0.8], 'walls')
       .hip([0, 0.6, 0], [1.1, 0.8], 0.3, 'roof')
       .add(sign(), { at: [0, 0.35, 0.41] }),
     // …
   };
   ```
   A model is a function returning a `Mesh`. The build calls it once per build, so keep it pure: for variety, use
   `rng('<model>/<n>')`, never `Math.random()`.
3. **Look at it:** `npm run build && node sheet/shoot.mjs /tmp/out kit=<name>`. That is every model of the kit on a
   tile, with its triangle count. Add `&age=2`, or `&style=<style>`, to see it painted.
4. **Give it to a civ:**
   - `catalog/civs.yaml`: `kit: <name>`, its roles per age, its `product`, its `plot` and its `dress`;
   - `catalog/styles.yaml`: the civ's two styles, with their cells for the new kit, plus the hexagon tiles' `0,2`
     (ground) and `0,3` (team).
5. **Check it:**
   - `npm test`;
   - `npm run build`: it fails on reach, triangles, a foreign kit, or a missing product or cell;
   - `npm run check`;
   - `go test ./...`;
   - the game's `dev/town-gate.mjs` against the town, which is the budget for the whole town.
6. **Credit it:** add a `LICENSES.md` row (ours, CC0).

## Growing the library

A shape that two kits could use belongs in `mesh.mjs`, not in a kit's module. To add a primitive:
- give it an `(at, size…, name, { rot, … })` signature like the others, and build its points through
  `place(at, rot)`;
- wind its faces outward and leave it open at the bottom;
- add it to `PRIMITIVES` in `procgen.test.mjs`. The test then checks every face of it points out at four
  rotations, in place and moved. A shape that is not convex is tested piece by piece; `sawtooth` is tested one tooth
  at a time.

What it has today:

| Primitive | Shape |
|---|---|
| `box(at, [sx, sy, sz], name, { top, rot })` | walls, slabs, posts, windows |
| `gable(at, [sx, sz], h, name, { ends, o, rot })` | a pitched roof, ridge along x, eaves `o` |
| `hip(at, [sx, sz], h, name, { o, rot })` | four slopes; a pyramid when square |
| `shed(at, [sx, sz], h0, h1, name, { sides, rot })` | a lean-to: low at the front, high at the back, its own walls |
| `sawtooth(at, [sx, sz], h, n, name, glass, { rot })` | n glazed teeth, rising toward +x |
| `prism(at, r, h, name, { n, r1, top, rot })` | chimneys, silos, tanks; tapers to `r1`, a cone at 0 |
| `slab(at, r, t, name, { n, rim, w, rot })` | a plot or pad; n = 6 lies like the tiles |
| `poly(pts, name)` / `quad(a, b, c, d, name)` | anything else, wound by hand |
| `add(mesh, { at, rot, scale })` | composition |

## How a build makes it

- `build.mjs` sees `generator:` and calls `generateKit()` instead of fetching.
- `generateKit()` hashes this library's files and the kit's module into a version, then writes
  `cache/<kit>/<version>/<model>.gltf|.bin` and `atlas.png`. The models are validated by `problems()`: no faces, a
  coordinate that isn't a number, or a triangle with no area.
- From there it is the fetched path:
  - `model.mjs` joins each model into one mesh, quantizes it and grounds it;
  - `style.mjs` paints the atlas for every style that uses the kit;
  - the manifest lists the models like any other.
- `--check` rebuilds into a temporary directory and compares the pixels and bytes. A generator that varies between
  runs fails CI there.
