import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMovingTriangleBody } from '../src/physics/moving-body.mjs';
import { t as createPublishedWorld } from '../sumiro/bundle/collision-DtBQEpmQ.js';

const batches = [
  { positions: [0,0,0, 1,0,0, 0,0,1, 2,1,0, 2,3,0, 2,1,2], kind: 4, surface: 'stone' },
  { positions: [0,0,0, 1,1,1, 2,2,2, -1,0,-2, 0,2,-2, 1,0,-2], kind: 2, surface: null },
];

function bodySnapshot(body) {
  const fields = ['id', 'enabled', 'placed', 'x', 'y', 'z', 'yaw', 'pitch', 'roll',
    'vx','vy','vz','dyaw','moved','minX','maxX','minY','maxY','minZ','maxZ'];
  return {
    state: Object.fromEntries(fields.map(key => [key, body[key]])),
    tris: body.tris.map(tri => ({
      coordinates: [...tri],
      local: [...tri.local],
      kind: tri.kind, surface: tri.surface, group: tri.group, fades: tri.fades,
      bodyIdentity: tri.body === body,
    })),
  };
}

function pair() {
  const original = createPublishedWorld().addBody('platform', batches);
  const recovered = createMovingTriangleBody('platform', batches);
  return [recovered, original];
}

test('initial triangle layout, triangle filtering and body state match shipped engine', () => {
  const [candidate, original] = pair();
  assert.deepEqual(bodySnapshot(candidate), bodySnapshot(original));
  assert.equal(candidate.tris.length, 3, 'degenerate triangle must be skipped');
});

test('pose matrix, velocity, orientation and world/local projection remain equivalent', () => {
  const [candidate, original] = pair();
  const poses = [
    [0,0,0,0,0,0,0],
    [1,2,-3,0.4,-0.2,0.1,1/60],
    [2,-4,1,1.2,0.4,-0.7,0.25],
    [2,-4,1,1.2,0.4,-0.7,0.25],
    [2,-4,1,1.2,0.4,-0.7,0],
    [-3,5,3,-Math.PI,0.3,-0.2,1],
  ];
  const probes = [[0,0,0], [1,2,3], [-5,3,2], [0.25,-0.75,9]];
  for (const pose of poses) {
    candidate.setPose(...pose);
    original.setPose(...pose);
    assert.deepEqual(bodySnapshot(candidate), bodySnapshot(original));
    for (const [x,y,z] of probes) {
      assert.deepEqual(candidate.toWorld(x,y,z), original.toWorld(x,y,z));
      assert.deepEqual(candidate.toLocal(x,y,z), original.toLocal(x,y,z));
      assert.deepEqual(
        candidate.dirToWorld(x,z,{ox:0,oz:0}),
        original.dirToWorld(x,z,{ox:0,oz:0}),
      );
      const outA = { tagged: true }, outB = { tagged: true };
      assert.strictEqual(candidate.toWorld(x,y,z,outA), outA);
      assert.strictEqual(original.toWorld(x,y,z,outB), outB);
      assert.deepEqual(outA,outB);
    }
  }
});

test('carrying points through motion reproduces reference transforms', () => {
  const [candidate, original] = pair();
  let pointsA = [{x:1,y:0,z:2}, {x:-1.5,y:3,z:0.1}, {x:0,y:0,z:0}];
  let pointsB = pointsA.map(p => ({...p}));
  for (const pose of [
    [1,1,-2,0,0,0,0.5],
    [3,1,-2,0.7,0.1,0,0.5],
    [3,1,-2,0.7,0.1,0,0.5],
    [0,-1,4,1.5,-0.5,0.2,0],
    [4,0,3,-0.5,0.3,-0.2,0.25],
  ]) {
    candidate.setPose(...pose);
    original.setPose(...pose);
    for (let i = 0; i < pointsA.length; i++) {
      candidate.carry(pointsA[i]);
      original.carry(pointsB[i]);
      assert.deepEqual(pointsA[i],pointsB[i]);
    }
  }
});

test('zero-triangle and repeated-pose cases retain published semantics', () => {
  for (const inputs of [[], [{positions:[]}], [{positions:[0,0,0,1,1,1,2,2,2]}]]) {
    const a = createMovingTriangleBody('empty',inputs);
    const b = createPublishedWorld().addBody('empty',inputs);
    assert.deepEqual(bodySnapshot(a),bodySnapshot(b));
    a.setPose(1,2,3,Math.PI/3,0,0,1);
    b.setPose(1,2,3,Math.PI/3,0,0,1);
    assert.deepEqual(bodySnapshot(a),bodySnapshot(b));
  }
});
