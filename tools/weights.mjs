// weights: a character's skin weights put in order and normalized the way gltf-transform's quantize does it, without the
// engine's sort. quantize's sortPrimitiveWeights (4.5.1) sorts each vertex's weights with a comparator that never calls
// two equal, so tied weights come out in whatever order the engine's sort leaves them (V8's: the later slot first;
// JavaScriptCore's: the earlier), and its normalizePrimitiveWeights then puts the rounding on the last weight in that
// order: the same character built under Node and Bun had different joints. Here both are transcribed for one set of four
// normalized uint8 weights, with V8's order written down: weight high to low, a tie by the later slot first. Node built
// dist that way, so nothing it built changes; the order only stops depending on the engine. normalizePrimitiveWeights
// is not exported, hence the transcription: its rescale, its correction and its Uint8Array wrap are kept as they are.
import { MathUtils } from '@gltf-transform/core';

const U8 = 5121; // UNSIGNED_BYTE
const dec = (i) => MathUtils.decodeNormalizedInt(i, U8), enc = (f) => MathUtils.encodeNormalizedInt(f, U8);
const sum = (w) => { let s = 0; for (let i = 0; i < w.length; i++) s += dec(w[i]); return s; };

// inOrder: one vertex's four weights (normalized uint8) and joints, sorted and normalized → [weights, joints]
export function inOrder(w, j) {
  const idx = [0, 1, 2, 3].sort((a, b) => w[b] - w[a] || b - a);
  const ws = Uint8Array.from(idx, (i) => w[i]), js = idx.map((i) => j[i]);
  let s = sum(ws);
  if (s !== 0 && s !== 1) {
    if (Math.abs(1 - s) > dec(1)) for (let k = 0; k < 4; k++) ws[k] = enc(dec(ws[k]) / s);
    s = sum(ws);
    if (s !== 1) for (let k = 3; k >= 0; k--) if (ws[k] > 0) { const d = 1 - s; ws[k] += Math.sign(d) * enc(Math.abs(d)); break; }
  }
  for (let k = 3; k >= 0; k--) if (ws[k] === 0) js[k] = 0;
  return [ws, js];
}

// canonicalWeights: every vertex of a quantized primitive (quantize run with normalizeWeights: false), in place
export function canonicalWeights(prim) {
  const extra = prim.listSemantics().filter((s) => /^(WEIGHTS|JOINTS)_[1-9]/.test(s));
  if (extra.length) throw new Error(`weights: one set of four only, not ${extra.join(', ')}`);
  const W = prim.getAttribute('WEIGHTS_0'), J = prim.getAttribute('JOINTS_0');
  if (W.getComponentType() !== U8 || !W.getNormalized()) throw new Error('weights: WEIGHTS_0 is not normalized uint8 (quantize first)');
  const w = W.getArray(), j = J.getArray();
  for (let o = 0; o < w.length; o += 4) {
    const [ws, js] = inOrder(w.subarray(o, o + 4), j.subarray(o, o + 4));
    w.set(ws, o); j.set(js, o);
  }
}
