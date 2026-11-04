// fetch: a kit's pinned files (each model's .gltf and the buffers it names, or its .glb, and the atlas) into cache/, checked
// against kits/<kit>/lock.json (sha256 per file). --lock writes the lock instead; a file the lock doesn't name is
// refused, so a changed pin or list is always a reviewed lock change.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';

const sha256 = b => createHash('sha256').update(b).digest('hex');

// download with a timeout and 3 retries, backing off (raw.githubusercontent.com rate-limits shared runner addresses)
async function download(url, kit) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      if (res.status !== 429 && res.status < 500)
        throw Object.assign(new Error(`${kit}: ${url}: ${res.status}`), { final: true });
      if (i >= 3) throw new Error(`${kit}: ${url}: ${res.status}`);
    } catch (e) {
      if (e.final || i >= 3) throw e;
    }
    await new Promise(r => setTimeout(r, 2000 * 2 ** i));
  }
}

// locked: a kit's file getter, each file checked against kits/<kit>/lock.json (sha256, keyed by key); --lock refetches
// every file and records it instead. A file's cache path may depend on its sha256 (fileOf(sha): the lock's, or under
// --lock the fetched one's). save() writes the lock (--lock only).
async function locked(root, kit, lock) {
  const lockPath = join(root, 'kits', kit.name, 'lock.json');
  const want = lock ? {} : JSON.parse(await readFile(lockPath, 'utf8').catch(() => '{}'));
  const got = {};
  const get = async (key, url, fileOf) => {
    let file = lock ? null : fileOf(want[key] || 'unlocked'),
      b = lock ? null : await readFile(file).catch(() => null); // --lock always refetches: never lock a cached copy
    const fetched = !b;
    if (fetched) b = await download(url, kit.name);
    const h = sha256(b);
    if (!lock && want[key] !== h)
      throw new Error(
        `${kit.name}: ${key}: sha256 ${h} is not the lock's ${want[key] || '(none: run bun run lock and review it)'}`
      );
    file = fileOf(h);
    if (fetched) {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(`${file}.part`, b); // then renamed: an interrupted run never leaves a short file in the cache
      await rename(`${file}.part`, file);
    }
    got[key] = h;
    return { file, bytes: b };
  };
  const save = async () => {
    if (lock) await writeFile(lockPath, `${JSON.stringify(Object.fromEntries(Object.entries(got).sort()), null, 2)}\n`);
  };
  return { get, save };
}

export async function fetchKit(root, kit, { lock = false } = {}) {
  const { get: getFile, save } = await locked(root, kit, lock);
  const get = rel =>
    getFile(rel, `https://raw.githubusercontent.com/${kit.repo}/${kit.commit}/${kit.root}/${rel}`, () =>
      join(root, 'cache', kit.name, kit.commit, rel)
    );
  const models = {};
  for (const m of kit.models) {
    // an entry naming a .glb is that one file (binary glTF holds its own buffer); any other is a .gltf and its buffers
    const glb = m.endsWith('.glb'),
      name = posix.basename(m).replace(/(\.gltf)?\.glb$/, '');
    const { file, bytes } = await get(glb ? m : `${m}.gltf`);
    if (!glb) {
      const gltf = JSON.parse(bytes.toString('utf8'));
      for (const buf of gltf.buffers || []) {
        if (!buf.uri || buf.uri.includes(':') || buf.uri.includes('..'))
          throw new Error(`${kit.name}: ${m}: a buffer uri atlas will not follow (${buf.uri})`);
        await get(posix.join(posix.dirname(m), buf.uri));
      }
    }
    if (models[name]) throw new Error(`${kit.name}: two models named ${name}`);
    models[name] = file;
  }
  const atlas = kit.atlas ? (await get(kit.atlas)).file : null; // a character kit has none: each character its own
  await save();
  return { models, atlas };
}

// fetchUrls: files a pack publishes at a fixed address but in no repo (urls: name -> https URL), pinned by their
// sha256 alone; the lock is keyed by the URL, so a changed address is always a reviewed lock change. Each is cached
// by its sha256, so two addresses never share a file and a re-lock to new bytes gets a path of its own. → {name: file}
export async function fetchUrls(root, kit, urls, { lock = false } = {}) {
  const { get, save } = await locked(root, kit, lock);
  const files = {};
  for (const [name, url] of Object.entries(urls)) {
    if (!/^https:\/\/[^/]+\/[\w./-]+$/.test(url) || url.includes('..'))
      throw new Error(`${kit.name}: ${name}: ${url} is not a plain https file address`);
    const ext = posix.extname(posix.basename(url));
    files[name] = (await get(url, url, h => join(root, 'cache', kit.name, 'sha256', `${h}${ext}`))).file;
  }
  await save();
  return files;
}
