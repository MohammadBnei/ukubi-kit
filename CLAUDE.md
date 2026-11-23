# ukubi-kit

The game's public 3D kit (orientation only; the design is mountain `plan/13-game-town.md` §5).

## Rules
- **Public repo: it holds no names of real components**, only roles (functions) and civs (atlas realms). The mapping
  from a component to a model lives in atlas (mountain `realms/realms.yaml`), never here.
- **CC0 sources only, pinned and locked.** A new model or pack: add it to `kits/<kit>/source.yaml`, `bun run lock`,
  review the lock diff, and add its licence to `LICENSES.md`.
- **Or made here, with the procgen library** (`tools/procgen/`): read `docs/procedural.md` before making or editing
  a generated kit. A kit's own module holds its palette and models; anything two kits could use goes in the library,
  with a test.
- **dist/ is built, never edited.** `bun run build` writes it; CI's checks fail if it is stale: Bun's on Linux and on
  macOS, and Node's (dist must not depend on the engine or the platform).
- **One kit per civ** (owner, 2026-10-26): a civ's buildings, plot and dressing come from its own kit; build.mjs
  refuses anything else. The hex tiles and construction props are shared world pieces, painted in the civ's style.
- **Shapes say what a model looks like, never what it stands for** (`catalog/shapes.yaml`, one per variant): the
  mapping from what a building is to its shapes lives in atlas (mountain `realms.yaml`), never here.
- **Styles change textures, never geometry.** A civ's look per age is a style; a model chain per role is the catalog.
- **Health looks belong to the world, not to styles** (grey, smoke, rubble, fire): never put them in a style or a
  recipe (plan/13, the binding rule).
- CI runs on Forgejo Actions (`k8s-ubuntu-latest`, the Talos runner; the mirror uses GitHub's `ubuntu-latest`); the macOS check runs only on the GitHub mirror.

## Design and change rules
Code design: mountain `plan/15-architecture.md`. How a change is made: mountain `plan/16-dev-rules.md`. Not copied here.
Kit specifics: a refactor never changes dist (`check` proves it); an engine-dependent step (sort ties, V8 against
JavaScriptCore, Bun's libm Math) is done in the kit in one written-down order; the proof is `check` under Bun on Linux and
macOS and under Node (dist byte for byte), plus `bun tools/cells.mjs <kit>` diffed by hand for tools CI doesn't run.
