// sources.mjs's tests: every kit in kits/ is one kind, and its kind is the one its source.yaml says; a kit that is two
// kinds is refused before anything loads.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parse } from 'yaml';
import { kindOf, sources } from './sources.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

test('every kit is one kind, with a source', async () => {
  const kinds = {};
  for (const k of (await readdir(`${ROOT}kits`)).sort()) {
    const kit = parse(await readFile(`${ROOT}kits/${k}/source.yaml`, 'utf8'));
    kinds[k] = kindOf(kit);
    assert.ok(sources[kinds[k]], `${k}: kind ${kinds[k]} has no source`);
  }
  assert.equal(kinds.ukubi, 'generator');
  assert.equal(kinds.adventurers, 'characters');
  assert.equal(kinds.hexagon, 'fetch');
});

test('a kit that is two kinds is refused; the origin a kind records', () => {
  assert.throws(
    () => kindOf({ name: 'x', generator: 'models.mjs', characters: {} }),
    /characters come from a pinned pack/
  );
  assert.deepEqual(sources.fetch.origin({ repo: 'a/b', commit: 'c' }), { repo: 'a/b', commit: 'c' });
  assert.deepEqual(sources.generator.origin({ generator: 'models.mjs' }), { generator: 'models.mjs' });
});

test("a kind's files: a pinned pack's from the cache, by its commit; the people's origin is their pack's", async () => {
  const file = await sources.fetch.file('/r', { name: 'k', commit: 'c0' });
  assert.equal(file('a/b.glb'), '/r/cache/k/c0/a/b.glb');
  assert.equal(file('a/b'), '/r/cache/k/c0/a/b.gltf');
  assert.deepEqual(sources.characters.origin({ repo: 'a/b', commit: 'c', characters: {} }), {
    repo: 'a/b',
    commit: 'c'
  });
  assert.equal(sources.characters.file, undefined); // a people kit has no atlas grid: cells.mjs refuses it
});
