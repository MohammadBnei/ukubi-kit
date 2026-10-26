// procgen/atlas: a generated kit's palette and the atlas drawn from it (docs/procedural.md). The atlas has the
// KayKit layout every style expects: an 8×4 grid of vertical gradient swatches, light at the top, so a style
// (tools/style.mjs) repaints a made kit exactly as it repaints a fetched one.
import { PNG } from 'pngjs';

export const SIDE = 256, COLS = 8, ROWS = 4;
const NEUTRAL = ['#e6e6e6', '#3a3a3a']; // a cell no colour names: a grey ramp

/** palette: {name: {cell: "c,r", top: "#rrggbb", bottom: "#rrggbb"}}, checked: cells inside the grid, one name each. */
export function palette(cells) {
  const seen = {};
  for (const [name, c] of Object.entries(cells)) {
    const [col, row] = String(c.cell).split(',').map(Number);
    if (!(col >= 0 && col < COLS && row >= 0 && row < ROWS)) throw new Error(`palette: ${name}: cell ${c.cell} is outside ${COLS}×${ROWS}`);
    if (seen[c.cell]) throw new Error(`palette: ${name} and ${seen[c.cell]} share cell ${c.cell}`);
    for (const k of ['top', 'bottom']) if (!/^#[0-9a-f]{6}$/i.test(c[k] || '')) throw new Error(`palette: ${name}: ${k} ${c[k]} is not #rrggbb`);
    seen[c.cell] = name;
  }
  return Object.freeze({ ...cells });
}

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** atlas: the palette's swatches as a PNG, SIDE × SIDE. */
export function atlas(pal) {
  const byCell = Object.fromEntries(Object.values(pal).map((c) => [c.cell, [c.top, c.bottom]]));
  const img = new PNG({ width: SIDE, height: SIDE }), cw = SIDE / COLS, ch = SIDE / ROWS;
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
    const c = Math.floor(x / cw), r = Math.floor(y / ch), [a, b] = (byCell[`${c},${r}`] || NEUTRAL).map(rgb);
    const t = (y - r * ch) / (ch - 1), o = (y * SIDE + x) * 4;
    for (let i = 0; i < 3; i++) img.data[o + i] = Math.round(a[i] + (b[i] - a[i]) * t);
    img.data[o + 3] = 255;
  }
  return PNG.sync.write(img, { deflateLevel: 9 });
}

/** uv: where a vertex of a face in cell "c,r" samples: the cell's middle column, down its gradient by h (0 at the
 *  model's top, 1 at its foot), kept a tenth inside the cell so filtering never bleeds into a neighbour. */
export function uv(cell, h) {
  const [col, row] = cell.split(',').map(Number);
  return [(col + 0.5) / COLS, (row + 0.1 + 0.8 * h) / ROWS];
}
