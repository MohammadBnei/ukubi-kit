# ukubi-kit

The game's 3D kit: free CC0 models (KayKit's free tiers), repainted into each civ's style, a catalog that says which
model a civ draws for a role in an age, and a Go package that embeds the result. The design is the private game's
(mountain `plan/13-game-town.md` §5); this repo holds no names of what the game draws, only roles and civs.

## How it works
- **Kits** (`kits/<kit>/source.yaml`): a KayKit pack pinned by commit (Medieval Hexagon, City Builder, Space Base,
  Halloween, Dungeon Remastered, Prototype), the models taken from it, a normalising scale so every building fits a
  hex 2 flat-to-flat, and the turns its models take (6 on a hex, 4 on a square). `lock.json` holds each fetched
  file's sha256. One kit is ours: `ukubi`, low-poly workshops and factories made on every build, deterministically,
  with its own atlas, by the **procgen** library (`tools/procgen/`): a kit's generator is a module of primitives and
  a palette. To make another kit, read [`docs/procedural.md`](docs/procedural.md).
- **Styles** (`catalog/styles.yaml`): every kit paints its models through one 8×4 atlas of gradient swatches.
  A style repaints a kit's atlas: an OKLab treatment of every pixel plus cells given a colour, each keeping its own
  gradient and detail. Clay, mountain's town, is the treatment fitted to its `clay.png`. A model never changes with
  the style; the game swaps the texture. A style is painted for its civ's kit and for the world kit (hexagon:
  the tiles and the construction props every civ shares; `catalog/civs.yaml` `world` declares it, its tiles and its
  ground and team cells, so the build names no kit).
- **Recipes** (`catalog/recipes.yaml`): kitbashing, several parts of one kit as one model. Most of Halloween's,
  Dungeon's and Prototype's buildings are recipes: those packs have few buildings that stand alone.
- **Civs** (`catalog/civs.yaml`): **one kit per civ.** Per role (a building's function: houses, utility, barracks,
  product …), the model for each age, with variants picked by a hash of the building's id. A role a civ doesn't
  list draws its own product, never another civ's. Its biome comes from the same kit: the hex tiles in its ground
  colour, a plot under every building (a floor piece, for a kit whose buildings have no base of their own) and
  seeded dressing on the free land. `default` is the town centre's and an unknown civ's. Construction states are
  shared by every civ: the scaffold, the four stages a new building or a wonder rises through, and `wonder`, the
  monument a finished wonder stands as (the town's own, no civ draws it).
- **Characters** (`kits/adventurers/source.yaml`): the town's people, KayKit's Adventurers pinned by commit. Each
  character is built apart from the models (`tools/character.mjs`): the meshes it keeps, its hat and cape baked into
  the skin, nothing held, so it is one skinned draw; its own texture as a file (no style paints people); and one clip
  file for all of them (`dist/characters/clips.glb`: the 41-joint rig and the named clips, played by bone name).
  Which character plays which unit is the game's, never this repo's.
- **Props** (`kits/world/`): the world's own models, made by procgen, that no civ draws: the player's rides (a bike,
  a spaceship) and the carriers under the disc (the great turtle, the elephants on its shell, the beams they hold).
  Each is built apart from the models (`dist/props/<name>.glb`), painted by its kit's own atlas (`dist/props/world.png`),
  never by a style. See [`docs/procedural.md`](docs/procedural.md#a-props-kit).
- **Shapes** (`catalog/shapes.yaml`): what a model looks like (tower, gate, yard, vault, mill, bay, rig, pit, wide),
  never what it stands for. A civ tags some variants with one shape each; the game's `PickFor` draws a building among
  the variants with a shape it asks for, else the untagged ones, else all (it is always drawn). Which shapes fit
  which building is the private side's, never this repo's.

| Civ | Kit | Age 1 → age 2 |
|---|---|---|
| platform | hexagon | timber homes, wells, mills → towers with flags |
| data | dungeon | walled vaults → pillared treasuries, a vault tower |
| operations | prototype | block sheds, stock yards → two-storey depots |
| guard | halloween | shrines, gates, watch posts → crypts, a gatehouse |
| fleet | space | modules → hubs, solar, drills |
| apps | city | low blocks → towers |
| code | ukubi (ours) | gabled workshops → factories |

## Build
```sh
bun install --frozen-lockfile   # Bun 1.4.2 (package.json's packageManager)
bun run build          # kits + catalog -> dist/ (models/, styles/, characters/, props/, manifest.json), then validates
bun run check          # rebuild into a temp dir; fail unless dist/ is current (CI runs this)
bun run lock           # after changing a pin or a model list: refetch and rewrite kits/*/lock.json, then review it
bun run test           # the procgen library's tests and the skin weights'
bun run lint           # biome ci: lint + format check of tools/, kits/*.mjs and sheet/ (CI runs this)
bun run format         # biome format --write
bun tools/cells.mjs city building_A_withoutBase   # which atlas cells a model's UVs use
```
The build is Bun's, and dist must not depend on the engine or the platform: CI checks it under Bun on Linux and on
macOS (Bun's Math functions come from the platform's libm), and under Node 22. One step depended on the engine:
gltf-transform's quantize sorts tied skin weights in the order the engine's sort leaves them, so `tools/weights.mjs`
does that sort and its normalisation with the order written down. A PNG is compared by its pixels, so a platform's
zlib may still write other bytes for the same image.
Validation fails on: a catalog reference that isn't a model, a civ drawing another kit's model, a civ without a
product, a civ missing an age, a building that overhangs its hex by more than 10% (the town centre may take more; a
building on a plot stays inside the plot, and the plot inside its hex), a model over 8000 triangles or a building
over 4500, a style cell outside the 8×4 grid or off a kit's swatches, a civ style without the tiles' ground and team
cells, or a `world` that is not a model kit with its tiles and two cells. The checks are ordered lists in `build.mjs`
(each civ's, then the town's), and a kit's source is chosen by its kind (`tools/sources.mjs`: fetched, made, or the
town's people). Characters fail on a rig that is not the clip file's (by joint name and order), on more than one draw, or on
more than 5500 triangles. A prop fails on more than one mesh or primitive, or more than 4000 triangles.

### Using a model
`manifest.models[id]` gives its `kit` and `file` (a GLB: one mesh, one primitive, KHR_mesh_quantization, no texture,
and never an embedded image: the game's pages allow `img-src 'self'` only, and `TestNoEmbeddedImages` holds every GLB to it);
`manifest.styles[style][kit]` gives the texture that paints it. Load the texture with `flipY = false` (glTF's UV
convention) in sRGB. One material per (style, kit) draws every model of that kit in that style, so a scene batches by
it. A quantized GLB keeps its dequantization on its node: apply the node's matrix (or keep the node).

### Using a character
`manifest.characters[name]` gives its `file` (a GLB: one skinned mesh, one primitive, quantized) and its `texture`
(`flipY = false`, sRGB); `manifest.clips` gives the clip file and its clip names. Clone a character with three's
`SkeletonUtils.clone` and play the clip file's clips on it with an `AnimationMixer` (the tracks bind by bone name).
There is no root motion: the game moves a walking character itself. `height` is its standing height, unscaled.

### Using a prop
`manifest.props[name]` gives its `file` (a GLB: one mesh, one primitive, quantized, standing on y = 0 about its own
origin, front +z), its `texture` (`flipY = false`, sRGB; one per props kit, so one material draws them all) and its
`size` (x, y, z).
The knight (`manifest.characters.knight`) is the player's avatar: it plays the same clip file (`Running_A` on foot,
`Sit_Chair_Idle` on the bike).

### Not yet as designed
- Styles are cell maps per kit, not shared named slots (wall, roof, …) mapped once per kit. With one kit per civ a
  style colours its own kit and the tiles, so little repeats.
- The manifest lists each model's kit, not its parts' provenance; every part is from that one kit.
- Every kit's models are built, used or not (the sheet shows the parts too).

## Contact sheet
`sheet/` shows every civ, age, role, construction state and dressing, painted. `node sheet/shoot.mjs [outdir]` (Node: Playwright)
serves it and screenshots it with Playwright (a dev tool, not a dependency). `?civ=apps&view=close`,
`?style=pack` (the packs' own colours) work in the URL; so do `?props=world` (the props; `&only=<name>`),
`?carrier=4` (the turtle with four elephants on its shell, all facing its heading, under a disc), `?character=knight`,
`&cam=low` (from near the ground) and `&cam=chase` (from behind and above).

## Go
```go
import ukubikit "github.com/MohammadBnei/ukubi-kit"
m, _ := ukubikit.Load()
model, style, ok := m.Pick("apps", "product", 2, "app:x") // stable per seed
turns := m.Turns(model)                                     // the ways it may face
plot, dress := m.Civ("apps").Plot, m.Civ("apps").Dress     // its biome
f := ukubikit.FS()                                         // dist/ as an fs.FS: serve models/ and styles/
```

## Commits
Conventional Commits. Feature branch and PR. Agent commits carry `Co-Authored-By: <agent> <noreply@bnei.dev>` and
`Agent-Session: <id>`; never a model name, a URL or a "Generated with" footer.
