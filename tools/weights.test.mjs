// weights.mjs's tests: the tie order is written down (the later slot first), the normalisation is gltf-transform's (its
// rescale, its correction on the last weight, joint 0 under a zero weight), and on weights with no tie it gives what
// gltf-transform's own sortPrimitiveWeights gives, on any engine.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Document } from '@gltf-transform/core';
import { sortPrimitiveWeights } from '@gltf-transform/functions';
import { rng } from './procgen/random.mjs';
import { canonicalWeights, inOrder } from './weights.mjs';

const run = (w, j) => { const [ws, js] = inOrder(Uint8Array.from(w), j); return [[...ws], js]; };

test('ties: the later slot first, so the same weights give the same joints on any engine', () => {
  assert.deepEqual(run([32, 191, 32, 0], [1, 2, 3, 0]), [[191, 32, 32, 0], [2, 3, 1, 0]]);
  assert.deepEqual(run([125, 125, 5, 0], [10, 11, 12, 0]), [[125, 125, 5, 0], [11, 10, 12, 0]]);
  assert.deepEqual(run([0, 0, 0, 255], [4, 5, 6, 7]), [[255, 0, 0, 0], [7, 0, 0, 0]]);
});

test('normalisation: gltf-transform\'s, rescale first when the sum is off by more than one step', () => {
  // off by one step (254): its float sum misses 1 by more than 1/255, so every weight is rescaled, then the last corrected
  assert.deepEqual(run([251, 3, 0, 0], [1, 2, 0, 0]), [[252, 3, 0, 0], [1, 2, 0, 0]]);
  // off by two: rescaled
  assert.deepEqual(run([200, 53, 0, 0], [1, 2, 0, 0]), [[202, 53, 0, 0], [1, 2, 0, 0]]);
  // over: the rescale takes it down
  assert.deepEqual(run([200, 60, 0, 0], [1, 2, 0, 0]), [[196, 59, 0, 0], [1, 2, 0, 0]]);
  // already whole: sorted, nothing else
  assert.deepEqual(run([55, 200, 0, 0], [3, 4, 9, 9]), [[200, 55, 0, 0], [4, 3, 0, 0]]);
  // no weight at all: left as is (gltf-transform skips a zero sum), joints zeroed
  assert.deepEqual(run([0, 0, 0, 0], [1, 2, 3, 4]), [[0, 0, 0, 0], [0, 0, 0, 0]]);
});

// (not always high to low after: gltf-transform corrects after it sorts, so the corrected weight can pass its neighbour)
test('every result sums to 255, or is all zero', () => {
  const r = rng(7);
  for (let n = 0; n < 5000; n++) {
    const w = [0, 1, 2, 3].map(() => (r() < 0.3 ? 0 : Math.floor(r() * 256)));
    const [ws] = run(w, [0, 1, 2, 3]);
    const s = ws.reduce((a, b) => a + b, 0);
    assert.ok(s === 255 || (s === 0 && w.every((x) => x === 0)), `${w} -> ${ws} (sum ${s})`);
  }
});

test('with no tie, the same as gltf-transform\'s own sortPrimitiveWeights', () => {
  const r = rng(11), n = 2000, W = new Uint8Array(n * 4), J = new Uint8Array(n * 4);
  for (let v = 0; v < n; v++) {
    const ws = new Set();
    while (ws.size < 4) ws.add(r() < 0.25 && ![...ws].includes(0) ? 0 : 1 + Math.floor(r() * 254)); // distinct: no tie
    W.set([...ws], v * 4); J.set([0, 1, 2, 3].map(() => Math.floor(r() * 20)), v * 4);
  }
  const prim = () => {
    const doc = new Document(), buf = doc.createBuffer();
    return doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(n * 3)).setBuffer(buf))
      .setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(J.slice()).setBuffer(buf))
      .setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(W.slice()).setNormalized(true).setBuffer(buf));
  };
  const theirs = prim(), ours = prim();
  sortPrimitiveWeights(theirs, Infinity);
  canonicalWeights(ours);
  for (const s of ['WEIGHTS_0', 'JOINTS_0']) assert.deepEqual([...ours.getAttribute(s).getArray()], [...theirs.getAttribute(s).getArray()], s);
});

test('canonicalWeights refuses what it does not transcribe', () => {
  const doc = new Document(), buf = doc.createBuffer();
  const p = doc.createPrimitive()
    .setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(new Uint8Array(4)).setBuffer(buf))
    .setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(new Float32Array([1, 0, 0, 0])).setBuffer(buf));
  assert.throws(() => canonicalWeights(p), /not normalized uint8/);
  p.setAttribute('WEIGHTS_1', doc.createAccessor().setType('VEC4').setArray(new Uint8Array(4)).setNormalized(true).setBuffer(buf));
  assert.throws(() => canonicalWeights(p), /one set of four only/);
});

// under Node only: the tie order written down is V8's own, read off gltf-transform's sortPrimitiveWeights on weights
// full of ties (under Bun its order is JavaScriptCore's, which is why weights.mjs exists; CI runs this in its Node job)
test('with ties, under Node: the same as gltf-transform\'s own sortPrimitiveWeights', { skip: !!process.versions.bun }, () => {
  const r = rng(13), n = 4000, W = new Uint8Array(n * 4), J = new Uint8Array(n * 4), vals = [0, 0, 1, 2, 32, 63, 64, 85, 125, 127, 128, 170, 255];
  for (let o = 0; o < n * 4; o++) { W[o] = vals[Math.floor(r() * vals.length)]; J[o] = Math.floor(r() * 20); }
  const prim = () => {
    const doc = new Document(), buf = doc.createBuffer();
    return doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(n * 3)).setBuffer(buf))
      .setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(J.slice()).setBuffer(buf))
      .setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(W.slice()).setNormalized(true).setBuffer(buf));
  };
  const theirs = prim(), ours = prim();
  sortPrimitiveWeights(theirs, Infinity);
  canonicalWeights(ours);
  for (const s of ['WEIGHTS_0', 'JOINTS_0']) assert.deepEqual([...ours.getAttribute(s).getArray()], [...theirs.getAttribute(s).getArray()], s);
});
