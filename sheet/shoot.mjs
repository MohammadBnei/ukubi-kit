#!/usr/bin/env node
// shoot: serve the repo, open the contact sheet in headless Chromium (Playwright, a dev tool: not a dependency) and
// write a screenshot per view to the directory given (default: /tmp/ukubi-kit-sheet). Page errors fail it.
//   node sheet/shoot.mjs [outdir] [query …]   every civ, or only the views asked for: `kit=ukubi`, `kit=ukubi&age=2`,
//                                             `civ=guard&view=close` (PLAYWRIGHT_CHROMIUM: a chromium binary, if
//                                             Playwright's own isn't installed)
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = new URL('..', import.meta.url).pathname, OUT = process.argv[2] || '/tmp/ukubi-kit-sheet';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary' };
const srv = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const f = join(ROOT, p);
  if (!f.startsWith(ROOT) || !(p.startsWith('/sheet/') || p.startsWith('/dist/'))) { res.writeHead(404).end(); return; }
  try { res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }).end(await readFile(f)); } catch { res.writeHead(404).end(); }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/sheet/index.html`;
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(process.env.NODE_PATH || '', 'playwright')); }
const browser = await pw.chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const errors = [];
await mkdir(OUT, { recursive: true });
const civs = ['default', 'platform', 'data', 'operations', 'guard', 'fleet', 'apps', 'code'];
const asked = process.argv.slice(3).map((qs) => [qs.replace(/[^a-z0-9]+/gi, '-'), `?${qs}`, 1600, 900]);
for (const [name, qs, w, h] of asked.length ? asked : [['sheet', '', 1800, 1400], ...civs.map((c) => [c, `?civ=${c}&view=close`, 1600, 900])]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  await page.goto(base + qs);
  await page.waitForFunction(() => globalThis.__sheet?.ready, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => ({ models: __sheet.models, tris: __sheet.tris, ...__sheet.info() }));
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(name, JSON.stringify(info));
  await page.close();
}
await browser.close();
srv.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
