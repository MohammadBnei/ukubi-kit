// style: a kit's atlas repainted into a style (plan/13 §5). A style is an OKLab treatment of every pixel,
// L' = l0 + lk·L, (a', b') = s·(a, b) + tint, plus recoloured cells: the atlases are 8×4 grids of vertical gradient
// swatches, and a cell given a colour keeps its own gradient and detail (its pixels' offsets from the cell's mean
// lightness, a third of their chroma offsets) around that colour. Clay, mountain's town, is the treatment
// {l0 .423, lk .461, s .269, tint [-.0056, .0149]} fitted to clay.png (mean error under 9/255 per channel).
import { PNG } from 'pngjs';

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => { c = Math.min(1, Math.max(0, c)); return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055; };

export function toLab(r, g, b) {
  r = lin(r / 255); g = lin(g / 255); b = lin(b / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

export function toRGB(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193679 * s, -0.0041960771 * l - 0.7034186135 * m + 1.707612726 * s]
    .map((c) => Math.round(gam(c) * 255));
}

export const hex = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

/** paint: atlas PNG bytes, a style, the cell overrides for this kit ({"c,r": "#rrggbb"}) → PNG bytes of side out. */
export function paint(atlasBytes, style, cells = {}, out = 256) {
  const src = PNG.sync.read(atlasBytes);
  if (src.width !== src.height || src.width % out) throw new Error(`style: the atlas is ${src.width}×${src.height}, not a square multiple of ${out}`);
  const k = src.width / out, img = new PNG({ width: out, height: out });
  const [ta, tb] = style.tint || [0, 0];
  const lab = new Float64Array(out * out * 3);
  for (let y = 0; y < out; y++) for (let x = 0; x < out; x++) { // a box filter down to out, then the treatment
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) { const p = ((y * k + j) * src.width + x * k + i) * 4; r += src.data[p]; g += src.data[p + 1]; b += src.data[p + 2]; }
    const [L, A, B] = toLab(r / k / k, g / k / k, b / k / k), o = (y * out + x) * 3;
    lab[o] = style.l0 + style.lk * L; lab[o + 1] = style.s * A + ta; lab[o + 2] = style.s * B + tb;
  }
  const cw = out / 8, ch = out / 4;
  for (const [key, colour] of Object.entries(cells)) {
    const [c, r] = key.split(',').map(Number), [tL, tA, tB] = toLab(...hex(colour));
    let mL = 0, mA = 0, mB = 0, n = 0;
    for (let y = r * ch; y < (r + 1) * ch; y++) for (let x = c * cw; x < (c + 1) * cw; x++) { const o = (y * out + x) * 3; mL += lab[o]; mA += lab[o + 1]; mB += lab[o + 2]; n++; }
    mL /= n; mA /= n; mB /= n;
    for (let y = r * ch; y < (r + 1) * ch; y++) for (let x = c * cw; x < (c + 1) * cw; x++) {
      const o = (y * out + x) * 3;
      lab[o] = tL + (lab[o] - mL); lab[o + 1] = tA + (lab[o + 1] - mA) / 3; lab[o + 2] = tB + (lab[o + 2] - mB) / 3;
    }
  }
  for (let i = 0; i < out * out; i++) {
    const [r, g, b] = toRGB(lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]);
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(img, { deflateLevel: 9 });
}
