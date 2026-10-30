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
| `tools/procgen/mesh.mjs` | `Mesh`: faces and primitives, composition (`add`, `repeat`), bounds, `problems()` |
| `tools/procgen/parts.mjs` | sub-assemblies any kit can use: `frontage()` (a door and windows), `house()` |
| `tools/procgen/atlas.mjs` | `palette()` (named cells, checked), `atlas()` (the PNG), `uv()` |
| `tools/procgen/random.mjs` | `rng(seed)`, `hash32()`: seeded randomness, never `Math.random()` |
| `tools/procgen/kit.mjs` | `generateKit()`: runs a kit's module into `cache/`, versioned; `toDoc()` |
| `tools/procgen/procgen.test.mjs` | the library's tests (`bun run test`): see "What the tests hold" below |
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
- **Primitives are open at the bottom**, since most stand on something: the ground, a wall top, the plot. Anything
  raised (a tank on legs, a crane's jib, a crate on a crate, a log) takes `bottom: true` (box and prism), or the camera
  sees into it from below.
- **Two faces never share a plane and overlap**, or they flicker. A door or a window straddles its wall's face (half
  in, half proud: `parts.frontage` does this); a slab's inner top sits a hair above its rim; a sign goes above the
  windows, not over them. The tests check every model of a kit for it.
- **Sizes are positive.** A primitive refuses a negative or zero size (it would turn its faces inward). To mirror, use
  `add(…, { mirror: true })`, which keeps the faces outward.
- **A primitive's `at` is its centre-bottom.** It turns about that point. To place a sub-assembly, build it as its own
  `Mesh` at the origin and `add()` it with `{ at, rot, tilt, scale, mirror }`. A model's gradient runs over its whole
  height, so a part shades a little differently in a tall model than in a short one.

### Fitting the hex (build.mjs checks these)
| What | Reach, in hexes (1 = the hex's edge) | Triangles |
|---|---|---|
| a building | ≤ 1.1, or ≤ 0.9 if its civ has a plot | ≤ 4500 |
| a town centre | ≤ 1.25 | ≤ 8000 |
| a plot | ≤ 1.0 (its neighbour's must not overlap it) | — |
| dressing | ≤ 1.1 | — |

Reach is the farthest vertex: `max(|x|, |x|/2 + |z|·√3/2)`. A box of half-sizes (X, Z) reaches
`max(X, X/2 + Z·0.866)`.
`ukubi`'s buildings come in around 0.7–0.8 and 80–130 triangles. The flat-shaded look needs very few.

## The palette is the kit's contract with the styles

`palette({ name: { cell: 'c,r', top: '#rrggbb', bottom: '#rrggbb' } })`: each name owns one cell of the 8×4 grid,
drawn as a vertical gradient (light at the top, as in KayKit's atlases). A face names its cell (`'brick'`), and its
vertices sample the cell's middle column, from the model's top (light) to its foot (dark). That gives the free
shading the packs have.

A style recolours a made kit's cells **by name**: `catalog/styles.yaml` says `ukubi: { team: "#ff5cc8" }`, and the
build looks the name up in the palette. (A fetched pack's cells are named by position, `"6,0"`.) So:
- **A palette may move a name to another cell** without breaking a style, but keep each name's meaning: a style that
  paints `team` pink expects signs and banners there, not walls.
- **Give every colour a style should change its own name**: the civ's team colour, the roof, the main walls.
  Colours that never change can share a name.
- **A style can only name what the palette has**: the build and a test refuse an unknown name. The cells a style may
  touch are the palette's cells (the kit's swatches); the rest of the atlas is a grey ramp.
- **List the names at the top of `catalog/styles.yaml`**, as every kit's cells are listed there.

## Making a new kit, step by step

1. **`kits/<name>/source.yaml`:**
   ```yaml
   name: <name>
   generator: models.mjs
   licence: CC0-1.0
   scale: 1
   turns: 4          # 6 if its models are hex-shaped, 2 if they have one street face
   models: [hall_A, hall_B]
   ```
2. **`kits/<name>/models.mjs`:**
   ```js
   import { palette as define } from '../../tools/procgen/atlas.mjs';
   import { Mesh } from '../../tools/procgen/mesh.mjs';
   import * as parts from '../../tools/procgen/parts.mjs';

   export const palette = define({
     walls: { cell: '0,0', top: '#d9d0c0', bottom: '#a89f8f' },
     roof:  { cell: '1,0', top: '#5d6772', bottom: '#353c45' },
     team:  { cell: '2,0', top: '#e0874a', bottom: '#a4532a' }, // the civ's colour, for its styles
     glass: { cell: '3,0', top: '#9fd0ea', bottom: '#4d88ad' },
     door:  { cell: '4,0', top: '#7a5536', bottom: '#4b3220' },
   });
   const mesh = () => new Mesh(palette);

   // a sub-assembly: built at the origin, added where it goes; it straddles the wall's face
   const sign = () => mesh().box([0, 0, 0], [0.3, 0.08, 0.03], 'team');

   export const models = {
     hall_A: () => mesh()
       .box([0, 0, 0], [1.1, 0.6, 0.8], 'walls')
       .hip([0, 0.6, 0], [1.1, 0.8], 0.3, 'roof')
       .add(parts.frontage(mesh, 1.1, { windows: 2 }), { at: [0, 0, 0.4] })
       .add(sign(), { at: [0, 0.5, 0.4] }),
     hall_B: () => mesh() // the shared house, a tank on legs beside it
       .add(parts.house(mesh, [0.8, 0.5, 0.7], 0.3, { walls: 'walls', roof: 'roof' }), { at: [-0.2, 0, 0] })
       .repeat(mesh().box([0, 0, 0], [0.03, 0.4, 0.03], 'door'), 2, [0.2, 0, 0], { at: [0.35, 0, 0] })
       .prism([0.45, 0.4, 0], 0.14, 0.25, 'team', { bottom: true }),
   };
   ```
   A model is a function returning a `Mesh`. The build calls it once per build, so keep it pure: for variety, use
   `rng('<model>/<n>')`, never `Math.random()`.
3. **Look at it:** `bun run build && node sheet/shoot.mjs /tmp/out kit=<name>`. That is every model of the kit on a
   tile, with its triangle count. The shot needs Playwright with a Chromium (a dev tool, not a dependency: set
   `NODE_PATH` to where it is installed, or `PLAYWRIGHT_CHROMIUM` to a browser); or serve the repo and open
   `sheet/index.html?kit=<name>`. Once a civ draws the kit (step 4), `'kit=<name>&age=2'` shows it in that civ's age-2
   style, and `'kit=<name>&style=<style>'` in any style; quote the query, or the shell takes the `&`.
4. **Give it to a civ:**
   - `catalog/civs.yaml`: `kit: <name>`, its roles per age, its `product`, its `plot` and its `dress`;
   - `catalog/styles.yaml`: the civ's two styles, with their cells for the new kit, plus the world kit's ground and team
     cells (`catalog/civs.yaml` `world`: the hexagon tiles' `0,2` and `0,3`). Name the kit's cells by its palette.
5. **Check it:**
   - `bun run test`;
   - `bun run build`: it fails on reach, triangles, a foreign kit, or a missing product or cell;
   - `bun run check`;
   - `go test ./...`;
   - the game's town gate (`dev/town-gate.mjs` in the ukubi-game repo) against the town, which is the budget for the
     whole town.
6. **Credit it:** add a `LICENSES.md` row (ours, CC0).

## Growing the library

A shape that two kits could use belongs in the library, not in a kit's module: a primitive in `mesh.mjs`, an
assembly of primitives in `parts.mjs`. To add a primitive:
- give it an `(at, size…, name, { rot, … })` signature like the others, check its sizes with `sizes()` and its other
  inputs with `need()`, and build its points through `place(at, rot)`;
- wind its faces outward and leave it open at the bottom (offer `bottom` if it will be raised);
- add it to `PRIMITIVES` in `procgen.test.mjs`, and to the closed-shape test. A shape that is not convex is tested
  piece by piece; `sawtooth` is tested one tooth at a time.

What it has today:

| Primitive | Shape |
|---|---|
| `box(at, [sx, sy, sz], name, { top, bottom, rot })` | walls, slabs, posts, windows, crates |
| `gable(at, [sx, sz], h, name, { ends, o, rot })` | a pitched roof, ridge along x, eaves `o` (0.06); its ends close the wall up to the roof |
| `hip(at, [sx, sz], h, name, { o, rot })` | four slopes to a ridge along x (sx ≥ sz; turn it otherwise); a pyramid when square |
| `shed(at, [sx, sz], h0, h1, name, { sides, rot })` | a lean-to block: low at the front, high at the back, its own walls |
| `sawtooth(at, [sx, sz], h, n, name, glass, { rot })` | n glazed teeth, rising toward +x |
| `prism(at, r, h, name, { n, r1, top, bottom, rot })` | chimneys, silos, tanks, logs (tilted); tapers to `r1`, a cone at 0 |
| `slab(at, r, t, name, { n, rim, w, rot })` | a plot or pad; n = 6 lies like the tiles |
| `loft(at, rings, name, { n, profile, cells, ends, up, rot })` | a section swept through rings along a path: a hull, a shell, a trunk, a limb, a tube; a ring of r 0 at an end is a point |
| `panel(pts, name)` | a thin face seen from both sides: a sail, a flag |
| `poly(pts, name)` / `quad(a, b, c, d, name)` | anything else, wound by hand |
| `add(mesh, { at, rot, tilt, scale, mirror })` | composition: scale (a number or [x, y, z]), mirror x, tilt about x (+y toward +z), turn, place |
| `repeat(mesh, n, step, { at, rot })` | n copies a step apart: a fence, a row, a stack |

| Part (`parts.mjs`) | |
|---|---|
| `frontage(mesh, sx, { door, windows, wy, pane, d, size })` | a door and a row of windows, straddling a wall's face at z = 0 |
| `house(mesh, [sx, sy, sz], h, { walls, roof, ends, o, …frontage })` | walls under a gable roof, its frontage on the front |

Not yet in it (add them when a kit needs them, with their tests): a gambrel roof (a barn), arches, stairs.

### What the tests hold
- every primitive faces out, at four turns, moved, mirrored, tilted and scaled;
- every primitive is closed but for its open bottom (closed entirely with `bottom`), so a missing face shows;
- a loft, and every world prop, is sealed: each edge walked once each way, each piece enclosing a positive volume
  (so a shape that is not convex is checked whole, not piece by piece);
- a gable's ends reach the roof's underside;
- a primitive refuses a size or shape it cannot make;
- every vertex samples inside its face's cell, and the atlas is drawn from the palette;
- no two faces of a kit's model overlap in one plane;
- a style names only cells the palette has;
- a kit's models are made the same twice; and this guide's example runs and passes the same checks.

## A props kit

Some models are no civ's: the world's rides (`bike`, `ship_hull`) and the carriers under the disc (`turtle`,
`elephant`, `beam`), in `kits/world/`. A props kit is a made kit with `props: true` in its `source.yaml` and a
triangle cap per model (`caps:`, which the tests hold; the build holds every prop to `MAX_PROP_TRIS`, 4000). The
build gives it its own path, like the characters':
- each model is `dist/props/<name>.glb` (one mesh, one primitive, quantized, standing on y = 0), and the kit's atlas,
  as made, is `dist/props/<kit>.png`: no style paints a prop, and no civ or role draws one;
- the manifest lists it in `props[name] = {kit, file, texture, bytes, sha256, tris, size}`;
- every prop is sealed, wound out, under its cap and free of coplanar overlaps (`procgen.test.mjs`).

A prop is built at its true proportions and may then be scaled whole to its size (the elephant to 1 tall, the hull to
1 long). Look at one with `node sheet/shoot.mjs /tmp/out 'props=world'` (`&only=turtle`, `&cam=low` from near the
ground), `'carrier=4'` (the turtle with four elephants under a disc) or `'character=knight'`.

## How a build makes it

- `generator:` makes the kit a generator kind (`tools/sources.mjs`), whose source calls `generateKit()` instead of
  fetching.
- `generateKit()` hashes every `.mjs` file of the library and of the kit's directory into a version, removes older
  versions, and writes `cache/<kit>/<version>/<model>.gltf|.bin` and `atlas.png` (through temporary files of its own,
  so two runs at once never collide). It rewrites them on every run; the version only keeps old outputs apart. The
  models are validated by `problems()`: no faces, a coordinate that isn't a number, or a triangle with no area.
- From there it is the fetched path:
  - `model.mjs` joins each model into one mesh, quantizes it and grounds it;
  - `style.mjs` paints the atlas for every style that uses the kit;
  - the manifest lists the models like any other.
- `--check` rebuilds into a temporary directory and compares the pixels and bytes. A generator that varies between
  runs fails CI there.
