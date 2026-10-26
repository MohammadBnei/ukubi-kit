# ukubi-kit

The game's 3D kit: free CC0 models (KayKit's free tiers), repainted into each civ's style, a catalog that says which
model a civ draws for a role in an age, and a Go package that embeds the result. The design is the private game's
(mountain `plan/13-game-town.md` §5); this repo holds no names of what the game draws, only roles and civs.

## How it works
- **Kits** (`kits/<kit>/source.yaml`): a KayKit pack pinned by commit, the models taken from it, and a normalising
  scale so every building fits a hex 2 flat-to-flat. `lock.json` holds each fetched file's sha256.
- **Styles** (`catalog/styles.yaml`): every KayKit pack paints its models through one 8×4 atlas of gradient swatches.
  A style repaints a kit's atlas: an OKLab treatment of every pixel plus cells given a colour, each keeping its own
  gradient and detail. Clay, mountain's town, is the treatment fitted to its `clay.png`. A model never changes with
  the style; the game swaps the texture.
- **Recipes** (`catalog/recipes.yaml`): kitbashing, several parts of one kit as one model.
- **Civs** (`catalog/civs.yaml`): per role (a building's function: houses, utility, barracks, product …), the model
  for each age, with variants picked by a hash of the building's id. A civ draws only its roles; the rest fall back
  to `default`. Construction states and seeded dressing (groves) are listed there too.

## Build
```sh
npm ci
npm run build          # kits + catalog -> dist/ (models/, styles/, manifest.json), then validates
npm run check          # rebuild into a temp dir; fail unless dist/ is current (CI runs this)
npm run lock           # after changing a pin or a model list: refetch and rewrite kits/*/lock.json, then review it
node tools/cells.mjs city building_A_withoutBase   # which atlas cells a model's UVs use
```
Validation fails on: a catalog reference that isn't a model, a civ missing an age, a building that overhangs its hex
by more than 10% (the town centre may take more), a model over 8000 triangles, a style cell outside the 8×4 grid.

### Using a model
`manifest.models[id]` gives its `kit` and `file` (a GLB: one mesh, one primitive, KHR_mesh_quantization, no texture);
`manifest.styles[style][kit]` gives the texture that paints it. Load the texture with `flipY = false` (glTF's UV
convention) in sRGB. One material per (style, kit) draws every model of that kit in that style, so a scene batches by
it. A quantized GLB keeps its dequantization on its node: apply the node's matrix (or keep the node).

### Not yet as designed
- Styles are cell maps per kit, not shared named slots (wall, roof, …) mapped once per kit: a colour meant for two
  kits is repeated in each. Slots come once a fourth kit makes the repetition hurt.
- The manifest lists each model's kit, not its parts' provenance; every part is from that one CC0 kit.

## Contact sheet
`sheet/` shows every civ, age, role, construction state and dressing, painted. `node sheet/shoot.mjs [outdir]`
serves it and screenshots it with Playwright (a dev tool, not a dependency). `?civ=apps&view=close`,
`?style=pack` (the packs' own colours) work in the URL.

## Go
```go
import ukubikit "github.com/MohammadBnei/ukubi-kit"
m, _ := ukubikit.Load()
model, style, ok := m.Pick("apps", "product", 2, "app:x") // stable per seed
f := ukubikit.FS()                                         // dist/ as an fs.FS: serve models/ and styles/
```

## Commits
Conventional Commits. Feature branch and PR. Agent commits carry `Co-Authored-By: <agent> <noreply@bnei.dev>` and
`Agent-Session: <id>`; never a model name, a URL or a "Generated with" footer.
