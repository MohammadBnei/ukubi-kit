// procgen/random: seeded randomness, so a varied model or scatter is the same on every build and machine. Never
// Math.random() or the clock in a generator: build.mjs --check would see different bytes on the next build.

/** hash32: FNV-1a of a string, a seed for rng(). */
export function hash32(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

/** rng: mulberry32, a function returning the seed's sequence of numbers in [0, 1). */
export function rng(seed) {
  let a = typeof seed === 'string' ? hash32(seed) : seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
