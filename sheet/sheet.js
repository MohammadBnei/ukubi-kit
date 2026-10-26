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
const civs = Object.keys(manifest.civs).filter((c) => !q.get('civ') || c === q.get('civ'));
let row = 0, tris = 0, models = 0;
const tile = 'hexagon/hex_grass';
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
        tris += await place(id, style, x, z);
        text(`${role} · ${id.split('/').pop().replace('_withoutBase', '').replace('_blue', '')}`, x, 0, z + 1.2 + (col % 2) * 0.45);
        col++; models++;
      }
    }
  }
}
// construction and dressing, in clay and in each dressed civ's first style
for (const style of ['clay', ...civs.filter((c) => c !== 'default').map((c) => manifest.civs[c].styles[0])]) {
  const z = row++ * DZ;
  text(`states · ${style}`, -DX * 1.2, 0, z, 'row');
  let col = 0;
  for (const id of [...manifest.states.stages, ...manifest.states.scaffold, ...manifest.dress.grove]) {
    const x = col++ * DX;
    tris += await place(tile, style, x, z);
    tris += await place(id, style, x, z);
    text(id.split('/').pop(), x, 0, z + 1.2 + (col % 2) * 0.45);
    models++;
  }
}
const W = 10 * DX, H = row * DZ;
controls.target.set(W / 2 - DX, 0, H / 2 - DZ / 2);
const view = q.get('view');
if (view === 'close') camera.position.set(W / 2, 9, H / 2 + 12); else camera.position.set(W / 2 - DX, H * 1.1 + 8, H / 2 + H * 0.55 + 6);
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
