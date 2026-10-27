// sources.mjs's tests: every kit in kits/ is one kind, and its kind is the one its source.yaml says; a kit that is two
// kinds is refused before anything loads.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
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
  assert.throws(() => kindOf({ name: 'x', generator: 'models.mjs', characters: {} }), /characters come from a pinned pack/);
  assert.deepEqual(sources.fetch.origin({ repo: 'a/b', commit: 'c' }), { repo: 'a/b', commit: 'c' });
  assert.deepEqual(sources.generator.origin({ generator: 'models.mjs' }), { generator: 'models.mjs' });
});
