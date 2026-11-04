// sources: where a kit comes from, by kind (kits/<kit>/source.yaml). A kind loads its models and atlas, and says what
// the manifest records of its origin. build.mjs and cells.mjs go through it; build.mjs names the characters kind only to
// give the town's people their own path.
//   fetch       a CC0 pack pinned at a commit (repo, commit, root), sha256-locked (fetch.mjs)
//   generator   a kit of our own, made by the procgen library (generator: its module) (procgen/kit.mjs)
//   characters  the town's people (characters:) and their weapons (weapons:): their own path, characters() in
//               build.mjs; never a civ's kit
//   props       the world's props (props: true), made like a generator kit: their own path, props() in build.mjs;
//               never a civ's kit, never styled
//   creatures   the world's creatures (creatures:), each a file at a fixed address pinned by its sha256 (fetchUrls):
//               their own path, creatures() in build.mjs; never a civ's kit, never styled
import { join } from 'node:path';
import { fetchKit, fetchUrls } from './fetch.mjs';
import { generateKit } from './procgen/kit.mjs';

// kindOf: a kit's kind; a kit that is two kinds (characters made by a generator) is refused before anything loads
export function kindOf(kit) {
  if (kit.characters && kit.generator)
    throw new Error(`kit ${kit.name}: characters come from a pinned pack, not a generator`);
  if (kit.props && !kit.generator) throw new Error(`kit ${kit.name}: a props kit is made by a generator`);
  if (kit.creatures && (kit.generator || kit.characters || kit.repo))
    throw new Error(`kit ${kit.name}: creatures are a kit of their own, fetched by address`);
  if (kit.creatures) return 'creatures';
  return kit.characters ? 'characters' : kit.props ? 'props' : kit.generator ? 'generator' : 'fetch';
}

export const sources = Object.freeze({
  fetch: {
    load: (root, kit, opts) => fetchKit(root, kit, opts),
    origin: kit => ({ repo: kit.repo, commit: kit.commit }),
    // a model's file in the cache, before it is built (cells.mjs)
    file: async (root, kit) => m => join(root, 'cache', kit.name, kit.commit, m.endsWith('.glb') ? m : `${m}.gltf`)
  },
  generator: {
    load: (root, kit) => generateKit(root, kit),
    origin: kit => ({ generator: kit.generator }),
    file: async (root, kit) => {
      const { models } = await generateKit(root, kit);
      return m => models[m];
    }
  },
  props: {
    load: (root, kit) => generateKit(root, kit),
    origin: kit => ({ generator: kit.generator }),
    file: async (root, kit) => {
      const { models } = await generateKit(root, kit);
      return m => models[m];
    }
  },
  characters: {
    load: (root, kit, opts) =>
      fetchKit(
        root,
        {
          ...kit,
          // the characters' files and the files their weapons are held in (weapons:), each once
          models: [
            ...new Set([
              ...Object.values(kit.characters).map(c => c.model),
              ...Object.values(kit.weapons || {}).map(w => w.from)
            ])
          ]
        },
        opts
      ),
    origin: kit => ({ repo: kit.repo, commit: kit.commit })
  },
  creatures: {
    load: (root, kit, opts) =>
      fetchUrls(root, kit, Object.fromEntries(Object.entries(kit.creatures).map(([n, c]) => [n, c.url])), opts),
    origin: () => ({})
  }
});
