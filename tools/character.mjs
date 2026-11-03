// character: a KayKit character .glb as the kit's people (plan/13 §5 Characters), never through model.build (it
// would drop the skin's JOINTS_0/WEIGHTS_0 and scale skinned vertices without their inverse bind matrices):
//   - the meshes it keeps (keep: node names), every other one (held items) dropped;
//   - a rigid part on a bone (a hat on head, a cape on chest) baked into the skin: its vertices moved into the bind
//     space of that bone, weighted 1 to it, so the whole character is one skinned primitive: one draw;
//   - no clips (the kit's one clip file holds them: clips()), no image (its texture is written apart, served as a
//     file, so the page never decodes a blob: the town's CSP);
//   - quantized (KHR_mesh_quantization, which corrects the inverse bind matrices), its skin weights put in order by
//     weights.mjs, not by quantize (whose order depends on the engine).
import { getBounds, Logger } from '@gltf-transform/core';
import { cloneDocument, joinPrimitives, prune, quantize, transformMesh } from '@gltf-transform/functions';
import { io } from './model.mjs';
import { canonicalWeights } from './weights.mjs';

const quiet = new Logger(Logger.Verbosity.WARN);

// a 4x4 column-major matrix: multiply, invert, apply
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
function inv(m) {
  // general 4x4 inverse (Cramer)
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10,
    b01 = a00 * a12 - a02 * a10,
    b02 = a00 * a13 - a03 * a10,
    b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11,
    b05 = a02 * a13 - a03 * a12,
    b06 = a20 * a31 - a21 * a30,
    b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30,
    b09 = a21 * a32 - a22 * a31,
    b10 = a21 * a33 - a23 * a31,
    b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06,
    d = 1 / det;
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * d,
    (a02 * b10 - a01 * b11 - a03 * b09) * d,
    (a31 * b05 - a32 * b04 + a33 * b03) * d,
    (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d,
    (a00 * b11 - a02 * b08 + a03 * b07) * d,
    (a32 * b02 - a30 * b05 - a33 * b01) * d,
    (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d,
    (a01 * b08 - a00 * b10 - a03 * b06) * d,
    (a30 * b04 - a31 * b02 + a33 * b00) * d,
    (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d,
    (a00 * b09 - a01 * b07 + a02 * b06) * d,
    (a31 * b01 - a30 * b03 - a32 * b00) * d,
    (a20 * b03 - a21 * b01 + a22 * b00) * d
  ];
}
const apply = (m, v, w) => [0, 1, 2].map(r => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * w);

// strip: every animation but the kept ones (keep: the animations themselves, never matched by name; its channels and
// samplers first: disposing an animation alone leaves its samplers holding their accessors, which may be a kept clip's
// too, shared key times: prune drops the rest), and every texture (no image is ever embedded: the town's CSP)
function strip(root, keep = new Set()) {
  for (const a of root.listAnimations()) {
    if (keep.has(a)) continue;
    for (const c of a.listChannels()) c.dispose();
    for (const s of a.listSamplers()) s.dispose();
    a.dispose();
  }
  for (const t of root.listTextures()) t.dispose();
}

// pickClips: the named clips, rebuilt in the order named (each a new animation holding the first source clip of that
// name's channels and samplers; the root's list keeps the order they are made in), every other animation dropped,
// a duplicate-named one too. → the Set of the animations made, and each one's length in seconds.
function pickClips(doc, file, names) {
  const root = doc.getRoot();
  if (new Set(names).size !== names.length) throw new Error(`${file}: a clip named twice in ${names.join(', ')}`);
  const missing = names.filter(n => !root.listAnimations().some(a => a.getName() === n));
  if (missing.length) throw new Error(`${file}: no clip ${missing.join(', ')}`);
  const made = new Set(),
    moved = new Set(),
    durations = [];
  for (const name of names) {
    const from = root.listAnimations().find(a => a.getName() === name && !made.has(a)),
      a = doc.createAnimation(name);
    let end = 0;
    for (const s of from.listSamplers()) {
      a.addSampler(s);
      end = Math.max(end, s.getInput().getMax([])[0]);
    }
    for (const c of from.listChannels()) a.addChannel(c);
    moved.add(from);
    made.add(a);
    durations.push(+end.toFixed(3));
  }
  // a moved clip's channels and samplers are the made one's now: only the animation itself goes
  for (const a of moved) a.dispose();
  strip(root, made);
  return { made, durations };
}

/** a pack character file, parsed once: each call gets its own copy (every step below edits the document it gets) */
export function reader() {
  const parsed = {};
  return async file => {
    parsed[file] ||= io.read(file);
    const doc = cloneDocument(await parsed[file]);
    doc.setLogger(quiet);
    return doc;
  };
}

/** the joint names of a document's one skin, in order */
export const jointsOf = doc =>
  doc
    .getRoot()
    .listSkins()[0]
    ?.listJoints()
    .map(j => j.getName()) || [];

/**
 * character: doc (a character file's, named file in errors), keep (node names) → {doc, png (its texture's bytes), tris,
 * height, joints}.
 */
export async function character(doc, file, keep) {
  const root = doc.getRoot(),
    [skin] = root.listSkins(),
    joints = skin.listJoints();
  if (root.listSkins().length !== 1) throw new Error(`${file}: ${root.listSkins().length} skins, not one`);
  const ibm = skin.getInverseBindMatrices(),
    bind = j => {
      const m = [];
      ibm.getElement(j, m);
      return m;
    };
  const mat = root.listMaterials()[0];
  const png = mat.getBaseColorTexture()?.getImage();
  if (!png) throw new Error(`${file}: no base colour texture`);

  const prims = [],
    seen = new Set();
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    seen.add(node.getName());
    if (!keep.includes(node.getName())) continue;
    for (const p of mesh.listPrimitives()) {
      p.setMaterial(mat);
      for (const sem of p.listSemantics())
        if (!['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'].includes(sem)) p.setAttribute(sem, null);
      if (!node.getSkin()) {
        // a rigid part on a bone: into that bone's bind space, weighted 1 to it
        let bone = node.getParentNode();
        while (bone && !joints.includes(bone)) bone = bone.getParentNode();
        if (!bone) throw new Error(`${file}: ${node.getName()} is on no bone`);
        const j = joints.indexOf(bone),
          to = mul(inv(mul(bone.getWorldMatrix(), bind(j))), node.getWorldMatrix());
        const nm = inv(to),
          pos = p.getAttribute('POSITION'),
          nrm = p.getAttribute('NORMAL'),
          n = pos.getCount(),
          v = [];
        const P = new Float32Array(n * 3),
          N = new Float32Array(n * 3),
          J = new Uint16Array(n * 4),
          W = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
          P.set(apply(to, pos.getElement(i, v), 1), i * 3);
          const nv = nrm.getElement(i, v),
            t = [0, 1, 2].map(r => nm[r * 4] * nv[0] + nm[r * 4 + 1] * nv[1] + nm[r * 4 + 2] * nv[2]); // the inverse transpose
          const l = Math.hypot(...t) || 1;
          N.set(
            t.map(x => x / l),
            i * 3
          );
          J[i * 4] = j;
          W[i * 4] = 1;
        }
        const acc = (arr, type) => doc.createAccessor().setArray(arr).setType(type).setBuffer(root.listBuffers()[0]);
        p.setAttribute('POSITION', acc(P, 'VEC3'))
          .setAttribute('NORMAL', acc(N, 'VEC3'))
          .setAttribute('JOINTS_0', acc(J, 'VEC4'))
          .setAttribute('WEIGHTS_0', acc(W, 'VEC4'));
      } else {
        const J = p.getAttribute('JOINTS_0'),
          W = p.getAttribute('WEIGHTS_0'),
          n = J.getCount(),
          v = [];
        const J16 = new Uint16Array(n * 4),
          WF = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
          J16.set(J.getElement(i, v), i * 4);
          WF.set(W.getElement(i, v), i * 4);
        }
        p.setAttribute(
          'JOINTS_0',
          doc.createAccessor().setArray(J16).setType('VEC4').setBuffer(root.listBuffers()[0])
        ).setAttribute('WEIGHTS_0', doc.createAccessor().setArray(WF).setType('VEC4').setBuffer(root.listBuffers()[0]));
      }
      prims.push(p);
    }
  }
  const missing = keep.filter(k => !seen.has(k));
  if (missing.length) throw new Error(`${file}: no mesh ${missing.join(', ')}`);
  // one primitive, one mesh, one node carrying the skin: one draw
  const joined = joinPrimitives(prims);
  const mesh = doc.createMesh('character').addPrimitive(joined);
  const scene = root.getDefaultScene() || root.listScenes()[0];
  for (const node of root.listNodes())
    if (node.getMesh()) {
      node.getMesh().dispose();
      node.setSkin(null);
    }
  scene.addChild(doc.createNode('character').setMesh(mesh).setSkin(skin));
  strip(root); // no clips: the clip files hold them
  // its height standing, in bind space, before quantizing (which normalises positions) (KayKit's bind pose is its rest pose, standing)
  let top = 0;
  const pos = joined.getAttribute('POSITION'),
    v = [];
  for (let i = 0; i < pos.getCount(); i++) top = Math.max(top, pos.getElement(i, v)[1]);
  // quantize gives the mesh a skin of its own (its inverse bind matrices corrected), so prune again after it
  await doc.transform(
    prune({ keepAttributes: true, keepLeaves: true }),
    quantize({ quantizePosition: 16, quantizeNormal: 16, quantizeTexcoord: 16, normalizeWeights: false }),
    prune({ keepAttributes: true, keepLeaves: true })
  );
  const out = root.listMeshes().flatMap(m => m.listPrimitives());
  if (root.listMeshes().length !== 1 || out.length !== 1 || root.listSkins().length !== 1)
    throw new Error(
      `${file}: ${root.listMeshes().length} meshes, ${out.length} primitives, ${root.listSkins().length} skins, not one each`
    );
  canonicalWeights(out[0]);
  const tris = out[0].getIndices().getCount() / 3;
  // the rig's inverse bind matrices, flat: the clips (one rig's tracks) fit only a character with the same rig
  const ibms = [],
    m = [];
  for (let j = 0; j < joints.length; j++) {
    ibm.getElement(j, m);
    ibms.push(...m);
  }
  return { doc, png: Buffer.from(png), tris, height: +top.toFixed(3), joints: jointsOf(doc), ibms };
}

/** clips: the rig (no mesh, no skin) and the named animations of one character file's doc. */
export async function clips(doc, file, names) {
  const root = doc.getRoot(),
    joints = jointsOf(doc);
  for (const n of root.listNodes())
    if (n.getMesh()) {
      n.getMesh().dispose();
      n.setSkin(null);
    }
  for (const s of root.listSkins()) s.dispose();
  pickClips(doc, file, names);
  for (const m of root.listMaterials()) m.dispose();
  await doc.transform(prune({ keepLeaves: true }));
  return { doc, joints };
}

// the bones a weapon may hang on
const SLOTS = ['handslot.r', 'handslot.l'];

/**
 * weapon: a held node of a character file's doc (a rigid mesh on a hand slot bone) → {doc, png, tris, size, slot}: its
 * offset on the slot baked into its vertices, then quantized, which puts the dequantization on the one node: added
 * whole (its node's transform kept) as a child of the bone named slot, it sits as the pack's character holds it. One
 * primitive, no image (png: its texture's bytes, the character's).
 */
export async function weapon(doc, file, name) {
  const root = doc.getRoot(),
    node = root.listNodes().find(n => n.getName() === name),
    slot = node?.getParentNode();
  if (!node?.getMesh()) throw new Error(`${file}: no mesh ${name}`);
  if (!slot || !root.listSkins()[0]?.listJoints().includes(slot) || !SLOTS.includes(slot.getName()))
    throw new Error(`${file}: ${name} is on ${slot?.getName() ?? 'nothing'}, not a hand slot (${SLOTS.join(', ')})`);
  const mesh = node.getMesh(),
    prims = mesh.listPrimitives(),
    mat = prims[0].getMaterial(),
    png = mat?.getBaseColorTexture()?.getImage();
  if (!png) throw new Error(`${file}: ${name} has no base colour texture`);
  for (const p of prims) {
    p.setMaterial(mat);
    for (const sem of p.listSemantics())
      if (!['POSITION', 'NORMAL', 'TEXCOORD_0'].includes(sem)) p.setAttribute(sem, null);
  }
  transformMesh(mesh, node.getMatrix());
  const one = doc.createMesh(name).addPrimitive(prims.length > 1 ? joinPrimitives(prims) : prims[0]),
    held = doc.createNode(name).setMesh(one),
    scene = doc.createScene().addChild(held);
  strip(root);
  for (const n of root.listNodes()) if (n !== held) n.dispose();
  for (const s of root.listSkins()) s.dispose();
  for (const s of root.listScenes()) if (s !== scene) s.dispose();
  root.setDefaultScene(scene);
  await doc.transform(prune({ keepAttributes: true }));
  const b = getBounds(scene),
    size = [0, 1, 2].map(i => +(b.max[i] - b.min[i]).toFixed(3));
  await doc.transform(quantize({ quantizePosition: 16, quantizeNormal: 16, quantizeTexcoord: 16 }));
  const out = root.listMeshes().flatMap(m => m.listPrimitives());
  if (root.listMeshes().length !== 1 || out.length !== 1)
    throw new Error(`${file}: ${name}: ${root.listMeshes().length} meshes, ${out.length} primitives, not one each`);
  return { doc, png: Buffer.from(png), tris: out[0].getIndices().getCount() / 3, size, slot: slot.getName() };
}

/**
 * creature: an animated animal's .glb (one skin) as the world's creature, its own rig and its own clips in one file:
 *   - its primitives joined into one skinned primitive (one draw), each one's material colour baked into its vertices
 *     (COLOR_0: glTF's vertex colour and base colour factor are both linear, so the product is the pack's colour),
 *     drawn by one material that keeps the pack's (its base colour white); a textured creature is refused;
 *   - the clips named, in that order (the pack's duplicates and the rest dropped);
 *   - quantized as a character is, its skin weights put in order by weights.mjs.
 * → {doc, tris, size (x y z), height, durations (s, per clip)}: size and height are of its bind pose, skinned.
 */
export async function creature(file, names) {
  const doc = await io.read(file);
  doc.setLogger(quiet);
  const root = doc.getRoot(),
    skins = root.listSkins();
  if (skins.length !== 1) throw new Error(`${file}: ${skins.length} skins, not one`);
  const [skin] = skins,
    joints = skin.listJoints(),
    ibm = skin.getInverseBindMatrices(),
    buf = root.listBuffers()[0];
  const prims = [],
    blank = doc.createMaterial(), // a part with no material draws glTF's default one
    // what one material must keep for every part: all but the base colour, which goes into the vertices
    look = m =>
      JSON.stringify([
        m.getMetallicFactor(),
        m.getRoughnessFactor(),
        m.getEmissiveFactor(),
        m.getAlphaMode(),
        m.getDoubleSided()
      ]);
  let first;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    if (node.getSkin() !== skin) throw new Error(`${file}: ${node.getName()} is not on the skin`);
    for (const p of mesh.listPrimitives()) {
      const mat = p.getMaterial() || blank;
      if (mat.getBaseColorTexture() || p.getAttribute('COLOR_0'))
        throw new Error(`${file}: ${node.getName()} is textured or coloured already: not a creature this builds`);
      if (p.listTargets().length)
        throw new Error(`${file}: ${node.getName()} has morph targets: not a creature this builds`);
      if (mat.getBaseColorFactor()[3] !== 1)
        throw new Error(
          `${file}: ${node.getName()}: material ${mat.getName()} is not opaque (base colour alpha ${mat.getBaseColorFactor()[3]})`
        );
      first ??= mat;
      if (look(mat) !== look(first))
        throw new Error(
          `${file}: ${node.getName()}: material ${mat.getName()} differs from ${first.getName()} in more than its base colour`
        );
      for (const sem of p.listSemantics())
        if (!['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0'].includes(sem)) p.setAttribute(sem, null);
      const n = p.getAttribute('POSITION').getCount(),
        c = mat.getBaseColorFactor().slice(0, 3),
        J = p.getAttribute('JOINTS_0'),
        W = p.getAttribute('WEIGHTS_0'),
        v = [];
      const C = new Float32Array(n * 3),
        J16 = new Uint16Array(n * 4),
        WF = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        C.set(c, i * 3);
        J16.set(J.getElement(i, v), i * 4);
        WF.set(W.getElement(i, v), i * 4);
      }
      const acc = (arr, type) => doc.createAccessor().setArray(arr).setType(type).setBuffer(buf);
      p.setAttribute('COLOR_0', acc(C, 'VEC3'))
        .setAttribute('JOINTS_0', acc(J16, 'VEC4'))
        .setAttribute('WEIGHTS_0', acc(WF, 'VEC4'));
      prims.push(p);
    }
  }
  if (!prims.length) throw new Error(`${file}: no mesh`);
  const mat = (prims[0].getMaterial() || blank).setName('creature').setBaseColorFactor([1, 1, 1, 1]);
  for (const p of prims) p.setMaterial(mat);
  const joined = joinPrimitives(prims);
  for (const node of root.listNodes())
    if (node.getMesh()) {
      node.getMesh().dispose();
      node.setSkin(null);
      if (!node.listChildren().length) node.dispose();
    }
  (root.getDefaultScene() || root.listScenes()[0]).addChild(
    doc.createNode('creature').setMesh(doc.createMesh('creature').addPrimitive(joined)).setSkin(skin)
  );
  // its clips, in the order named; every other animation goes
  const { durations } = pickClips(doc, file, names);
  // its bind pose, skinned (each vertex through its joints' world × inverse bind matrices): what it stands as
  const mats = joints.map((j, k) => mul(j.getWorldMatrix(), ibm.getElement(k, [])));
  const pos = joined.getAttribute('POSITION'),
    J = joined.getAttribute('JOINTS_0'),
    W = joined.getAttribute('WEIGHTS_0'),
    lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.getCount(); i++) {
    const p = pos.getElement(i, []),
      j = J.getElement(i, []),
      w = W.getElement(i, []),
      out = [0, 0, 0];
    for (let k = 0; k < 4; k++) {
      if (!w[k]) continue;
      const q = apply(mats[j[k]], p, 1);
      for (let r = 0; r < 3; r++) out[r] += w[k] * q[r];
    }
    for (let r = 0; r < 3; r++) {
      lo[r] = Math.min(lo[r], out[r]);
      hi[r] = Math.max(hi[r], out[r]);
    }
  }
  await doc.transform(
    prune({ keepAttributes: true, keepLeaves: true }),
    quantize({
      quantizePosition: 16,
      quantizeNormal: 16,
      quantizeColor: 16,
      normalizeWeights: false
    }),
    prune({ keepAttributes: true, keepLeaves: true })
  );
  const out = root.listMeshes().flatMap(m => m.listPrimitives());
  if (root.listMeshes().length !== 1 || out.length !== 1 || root.listSkins().length !== 1)
    throw new Error(
      `${file}: ${root.listMeshes().length} meshes, ${out.length} primitives, ${root.listSkins().length} skins, not one each`
    );
  canonicalWeights(out[0]);
  return {
    doc,
    tris: out[0].getIndices().getCount() / 3,
    size: [0, 1, 2].map(r => +(hi[r] - lo[r]).toFixed(3)),
    bottom: +lo[1].toFixed(3),
    height: +hi[1].toFixed(3),
    durations
  };
}
