# ukubi-kit

The game's public 3D kit (orientation only; the design is mountain `plan/13-game-town.md` §5, private).

## Rules
- **Public repo: it holds no names of real components**, only roles (functions) and civs (atlas realms). The mapping
  from a component to a model lives in atlas (mountain `realms/realms.yaml`), never here.
- **CC0 sources only, pinned and locked**, or made here (`kits/ukubi`, by `tools/gen-ukubi.mjs`). A new model or
  pack: add it to `kits/<kit>/source.yaml`, `npm run lock`, review the lock diff, and add its licence to
  `LICENSES.md`.
- **dist/ is built, never edited.** `npm run build` writes it; CI's `npm run check` fails if it is stale.
- **One kit per civ** (owner, 2026-10-26): a civ's buildings, plot and dressing come from its own kit; build.mjs
  refuses anything else. The hex tiles and construction props are shared world pieces, painted in the civ's style.
- **Styles change textures, never geometry.** A civ's look per age is a style; a model chain per role is the catalog.
- **Health looks belong to the world, not to styles** (grey, smoke, rubble, fire): never put them in a style or a
  recipe (plan/13, the binding rule).
- GitHub-hosted runners only (public repo). Conventional Commits, feature branch + PR.
- Commit trailers: `Co-Authored-By: ukubi-claude-cloud <noreply@bnei.dev>` (cloud) or `ukubi-claude-<host>`, plus
  `Agent-Session: <id>`. Never model names, URLs or a "Generated with" footer.
