// The contact sheet (plan/13 §5): every civ's roles, one row per civ and age, each model on a hex tile painted in
// that civ's style for that age; then the construction states and the dressing. Served from the repo root
// (sheet/shoot.mjs), it reads dist/manifest.json. ?civ=<name> shows one civ; ?view=<preset> frames a row.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const q = new URLSearchParams(location.search);
const manifest = await (await fetch('../dist/manifest.json')).json();
const canvas = document.getElementById('c'), labels = document.getElementById('labels');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#1c1814');
scene.add(new THREE.HemisphereLight(0xfff2e0, 0x3a3129, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-12, 20, 10);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 100 });
sun.shadow.mapSize.set(4096, 4096);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
const controls = new OrbitControls(camera, canvas);

const loader = new GLTFLoader(), tex = new THREE.TextureLoader(), cache = new Map(), mats = new Map();
const glb = (file) => { if (!cache.has(file)) cache.set(file, loader.loadAsync(`../dist/${file}`)); return cache.get(file); };
const material = (style, kit) => {
  const key = `${style}/${kit}`;
  if (!mats.has(key)) {
    const t = tex.load(`../dist/${manifest.styles[style][kit]}`);
    t.flipY = false; t.colorSpace = THREE.SRGBColorSpace;
    mats.set(key, new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, metalness: 0 }));
  }
  return mats.get(key);
};
async function place(id, style, x, z) {
  const m = manifest.models[id], g = (await glb(m.file)).scene.clone(true);
  g.traverse((o) => { if (o.isMesh) { o.material = material(style, m.kit); o.castShadow = o.receiveShadow = true; } });
  g.position.set(x, 0, z);
  scene.add(g);
  return m.tris;
}
const label = [];
const text = (s, x, y, z, cls = 'l') => { const e = document.createElement('div'); e.className = cls; e.textContent = s; labels.append(e); label.push({ e, p: new THREE.Vector3(x, y, z) }); };

const ROLES = manifest.roles;
const DX = 2.6, DZ = 3.2;
// ?kit=<name> is the authoring view: every model of one kit, in the style of the civ that draws it (or ?style=)
const only = q.get('kit');
const civs = only ? [] : Object.keys(manifest.civs).filter((c) => !q.get('civ') || c === q.get('civ'));
let row = 0, tris = 0, models = 0;
const tile = 'hexagon/hex_grass';
if (only) {
  const ids = Object.keys(manifest.models).filter((id) => manifest.models[id].kit === only).sort();
  const owner = Object.values(manifest.civs).find((c) => c.kit === only);
  const style = q.get('style') || owner?.styles[Number(q.get('age') || 1) - 1] || 'pack';
  if (!manifest.styles[style]?.[only]) throw new Error(`style ${style} does not paint the ${only} kit`);
  const per = Math.ceil(Math.sqrt(ids.length * 1.6));
  for (let i = 0; i < ids.length; i++) {
    const x = (i % per) * DX, z = Math.floor(i / per) * DZ;
    tris += await place(tile, style, x, z);
    tris += await place(ids[i], style, x, z);
    text(`${ids[i].split('/').pop()} · ${manifest.models[ids[i]].tris}`, x, 0, z + 1.2);
    models++;
  }
  row = Math.ceil(ids.length / per);
}
for (const civ of civs) {
  const c = manifest.civs[civ];
  for (let age = 0; age < c.styles.length; age++, row++) {
    const style = q.get('style') || c.styles[age], z = row * DZ;
    text(`${civ} · age ${age + 1} · ${style}`, -DX * 1.2, 0, z, 'row');
    let col = 0;
    for (const role of ROLES) {
      const slot = c.roles[role];
      if (!slot) continue;
      for (const id of slot[age]) {
        const x = col * DX;
        tris += await place(tile, style, x, z);
        if (c.plot) tris += await place(c.plot, style, x, z);
        tris += await place(id, style, x, z);
        text(`${role} · ${id.split('/').pop().replace('_withoutBase', '').replace('_blue', '')}`, x, 0, z + 1.2 + (col % 2) * 0.45);
        col++; models++;
      }
    }
  }
}
// each civ's biome (its tiles, plot and dressing) and the construction states, in its first style
for (const civ of civs) {
  const c = manifest.civs[civ], style = q.get('style') || c.styles[0], z = row++ * DZ;
  text(`${civ} · land and construction · ${style}`, -DX * 1.2, 0, z, 'row');
  let col = 0;
  for (const id of [...(c.plot ? [c.plot] : []), ...c.dress, ...(civ === 'default' ? manifest.states.stages : []), ...manifest.states.scaffold.slice(0, 1)]) {
    const x = col++ * DX;
    tris += await place(tile, style, x, z);
    tris += await place(id, style, x, z);
    text(id.split('/').pop(), x, 0, z + 1.2 + (col % 2) * 0.45);
    models++;
  }
}
// fit the camera to what was placed, looking down from the front at about 50°
resize();
scene.updateMatrixWorld(true);
const box = new THREE.Box3();
scene.traverse((o) => { if (o.isMesh) box.expandByObject(o); });
const centre = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), dir = new THREE.Vector3(0, 1.25, 1.05).normalize();
const dist = Math.max(size.x / 2 / (half * camera.aspect), (size.z * dir.y + size.y * dir.z) / 2 / half) * 1.08;
controls.target.copy(centre);
camera.position.copy(centre).addScaledVector(dir, dist);
controls.update();

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
const v = new THREE.Vector3();
const status = document.getElementById('status');
function frame() {
  resize();
  renderer.render(scene, camera);
  status.textContent = `${models} models · ${tris} tris · ${renderer.info.render.calls} draws`;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  for (const l of label) {
    v.copy(l.p).project(camera);
    l.e.style.left = `${(v.x * 0.5 + 0.5) * w}px`; l.e.style.top = `${(-v.y * 0.5 + 0.5) * h}px`;
    l.e.hidden = v.z > 1;
  }
}
renderer.setAnimationLoop(frame);
globalThis.__sheet = { ready: true, models, tris, info: () => ({ ...renderer.info.render }) };
