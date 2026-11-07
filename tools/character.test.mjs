// character.mjs's uvCells: a triangle inside one cell of the atlas grid is that cell; one across two cells is a
// straddle (build.mjs refuses a body with any); a named mesh the file lacks is an error.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Document } from '@gltf-transform/core';
import { uvCells } from './character.mjs';
import { COLS, ROWS } from './procgen/atlas.mjs';

// docOf: one node per mesh, each one triangle with the given uvs (in cell units)
function docOf(meshes) {
  const doc = new Document(),
    buf = doc.createBuffer(),
    scene = doc.createScene();
  for (const [name, uvs] of Object.entries(meshes)) {
    const uv = doc
        .createAccessor()
        .setType('VEC2')
        .setArray(new Float32Array(uvs.flatMap(([c, r]) => [c / COLS, r / ROWS])))
        .setBuffer(buf),
      pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array(9)).setBuffer(buf),
      idx = doc
        .createAccessor()
        .setType('SCALAR')
        .setArray(new Uint16Array([0, 1, 2]))
        .setBuffer(buf),
      prim = doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('TEXCOORD_0', uv).setIndices(idx);
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  }
  return doc;
}

test('uvCells: a cell per triangle, a straddle across two', () => {
  const doc = docOf({
    inside: [
      [2.1, 1.1],
      [2.9, 1.1],
      [2.5, 1.9]
    ],
    across: [
      [4.2, 0.2],
      [5.8, 0.2],
      [5, 0.8]
    ]
  });
  assert.deepEqual(uvCells(doc, ['inside']), { cells: [[2, 1]], straddles: 0 });
  assert.equal(uvCells(doc, ['inside', 'across']).straddles, 1);
  assert.throws(() => uvCells(doc, ['head']), /no mesh head/);
});
