import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BufferAttribute, BufferGeometry, Group, InterleavedBuffer, InterleavedBufferAttribute, Mesh,
} from 'three';
import {
  createMeshRaycaster, filterTrianglesByMaxEdge, hasLineOfSight,
  raycastVisibleSurface, relaxLongEdgesInPlace,
} from '../src/physics/sight.mts';
import {
  a as publishedMeshRaycaster, i as publishedLineOfSight, n as publishedRelaxLongEdges,
  r as publishedVisibleSurface, t as publishedFilterTriangles,
} from '../sumiro/bundle/sight-DXR0ElmN.js';

const hitState = ({ back, nx, ny, nz }) => [back, nx, ny, nz];

function createMesh(name, position, index) {
  const geometry = new BufferGeometry();
  if (position) geometry.setAttribute('position', position);
  if (index) geometry.setIndex(index);
  const mesh = new Mesh(geometry);
  mesh.name = name;
  return mesh;
}

function makeWallScene(walls) {
  const root = new Group();
  for (const [x, reverse] of walls) {
    const first = [0, -1, -1];
    const second = [0, -1, 1];
    const third = [0, 1, -1];
    const coordinates = reverse ? [...first, ...third, ...second] : [...first, ...second, ...third];
    const wall = createMesh('Wall', new BufferAttribute(new Float32Array(coordinates), 3));
    wall.position.x = x;
    root.add(wall);
  }
  root.updateMatrixWorld(true);
  return root;
}

test('mesh raycaster extracts indexed, mirrored, interleaved, and normalized geometry', () => {
  const root = new Group();
  const parent = new Group();
  parent.position.set(3, 1, -4);
  root.add(parent);
  const mirrored = createMesh('SightIndexed', new BufferAttribute(new Float32Array([
    -1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0,
  ]), 3), [0, 1, 2, 2, 1, 3]);
  mirrored.position.y = 1;
  mirrored.scale.set(-2, 1.5, 1);
  parent.add(mirrored);

  const interleaved = new InterleavedBuffer(new Float32Array([
    99, -1, -1, 0, 99, 1, -1, 0, 99, -1, 1, 0,
  ]), 4);
  const interleavedMesh = createMesh('SightInterleaved', new InterleavedBufferAttribute(interleaved, 3, 1));
  interleavedMesh.position.x = -5;
  root.add(interleavedMesh);

  const normalized = createMesh('SightNormalized', new BufferAttribute(new Int16Array([
    -32767, -32767, 0, 32767, -32767, 0, -32767, 32767, 0,
  ]), 3, true));
  normalized.position.set(10, -2, -3);
  normalized.rotation.y = Math.PI / 2;
  root.add(normalized);

  const ignored = createMesh('Decorative', mirrored.geometry.attributes.position, [0, 1, 2]);
  ignored.position.z = -2;
  root.add(ignored, createMesh('SightWithoutPositions'));
  root.updateMatrixWorld(true);

  const rays = [
    { args: [4, 1, -1, 0, 0, -1, 5], distance: 3, state: [false, 0, 0, 12] },
    { args: [4, 1, -10, 0, 0, 1, 10], distance: 6, state: [true, 0, 0, 12] },
    { args: [-5.25, -0.25, 2, 0, 0, -1, 5], distance: 2, state: [false, 0, 0, 4] },
    { args: [14, -2.25, -2.75, -1, 0, 0, 8], distance: 4, state: [false, 4, -0, 0] },
    { args: [-0.25, -0.25, 2, 0, 0, -1, 5], distance: Infinity },
    { args: [4, 1, -1, 0, 0, -1, 3], distance: Infinity },
  ];

  for (const twoSided of [false, true]) {
    const original = publishedMeshRaycaster(root, '^Sight', { twoSided });
    const candidate = createMeshRaycaster(root, /^Sight/, { twoSided });
    assert.equal(original.count(), 4);
    assert.equal(candidate.count(), original.count());
    for (const { args, distance, state } of rays) {
      assert.equal(original.raycast(...args), distance);
      assert.equal(candidate.raycast(...args), distance);
      assert.deepEqual(hitState(candidate), hitState(original));
      if (state) assert.deepEqual(hitState(original), twoSided ? [false, ...state.slice(1)] : state);
    }
  }
});

test('raycaster add and finish expose the shipped grid and mutable hit contract', () => {
  const root = new Group();
  const original = publishedMeshRaycaster(root, 'Wall');
  const candidate = createMeshRaycaster(root, 'Wall');
  assert.equal(original.count(), 0);
  const positions = new Float32Array([0, -1, -1, 0, -1, 1, 0, 1, -1, 4, 4, 4]);
  for (const caster of [original, candidate]) {
    caster.add(positions);
    assert.equal(caster.count(), 1);
    assert.equal(caster.raycast(-6, -0.25, -6.25, 1, 0, 1, 10), Infinity);
    assert.equal(caster.finish(), caster);
  }
  const rays = [
    [[-6, -0.25, -6.25, 1, 0, 1, 10], 6, [false, -4, 0, 0]],
    [[6, -0.25, 5.75, -1, 0, -1, 10], 6, [true, -4, 0, 0]],
    [[-6, 3, -6.25, 1, 0, 1, 10], Infinity, [true, -4, 0, 0]],
  ];
  for (const [args, distance, state] of rays) {
    assert.equal(original.raycast(...args), distance);
    assert.equal(candidate.raycast(...args), distance);
    assert.deepEqual(hitState(original), state);
    assert.deepEqual(hitState(candidate), hitState(original));
  }
});

test('visible surface skips back faces and near pairs while retaining hit state', () => {
  const cases = [
    { walls: [[0.125, false]], limit: 2, distance: 0.125 },
    { walls: [[0.125, true], [1, false]], limit: 2, distance: 1 },
    { walls: [[0.125, false], [0.25, true], [1, false]], limit: 2, distance: 1 },
    { walls: [[0.125, false], [0.25, false], [1, false]], limit: 2, distance: 1 },
    { walls: [[0.125, false], [0.25, true]], limit: 2, distance: Infinity },
    { walls: [[0.625, false], [0.75, true]], limit: 2, distance: 0.625 },
    { walls: [[1, false]], limit: 1, distance: Infinity },
    { walls: Array.from({ length: 7 }, (_, index) => [index + 1, index < 6]), limit: 10, distance: Infinity },
  ];
  for (const { walls, limit, distance } of cases) {
    const root = makeWallScene(walls);
    const args = [0, -0.25, -0.25, 1, 0, 0, limit];
    const original = publishedMeshRaycaster(root, 'Wall');
    const candidate = createMeshRaycaster(root, 'Wall');
    assert.equal(publishedVisibleSurface(original, ...args), distance);
    assert.equal(raycastVisibleSurface(candidate, ...args), distance);
    assert.deepEqual(hitState(candidate), hitState(original));
  }
});

test('line of sight stops short of its target and treats nearer walls as occlusion', () => {
  const root = makeWallScene([[0, false]]);
  const original = publishedMeshRaycaster(root, 'Wall');
  const candidate = createMeshRaycaster(root, 'Wall');
  const cases = [
    [[-2, -0.25, -0.25, 0.5, -0.25, -0.25], false],
    [[-2, -0.25, -0.25, 0.1, -0.25, -0.25], true],
    [[-2, -0.25, -0.25, -1.8, -0.25, -0.25], true],
    [[-2, -0.25, -0.25, -2, -0.25, -0.25], true],
    [[-2, 3, -0.25, 0.5, 3, -0.25], true],
  ];
  for (const [args, visible] of cases) {
    assert.equal(publishedLineOfSight(original, ...args), visible);
    assert.equal(hasLineOfSight(candidate, ...args), visible);
    assert.deepEqual(hitState(candidate), hitState(original));
  }
});

test('triangle edge filter agrees at the exact edge threshold and drops incomplete faces', () => {
  const positions = new Float32Array([0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, 9]);
  const indices = new Uint16Array([0, 1, 2, 0, 1, 3, 2, 1]);
  for (const [limit, expected] of [[4.9, []], [5, [0, 1, 2]], [10, [0, 1, 2, 0, 1, 3]]]) {
    const original = publishedFilterTriangles(indices, positions, limit);
    assert.deepEqual(original, expected);
    assert.deepEqual(filterTrianglesByMaxEdge(indices, positions, limit), original);
  }
});

test('long-edge relaxation moves rounded duplicate vertices together in place', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 8, 8, 0, 8.0002, 8, 0]);
  const indices = new Uint32Array([3, 0, 1, 4, 1, 2]);
  for (const limit of [0, 2, 20]) {
    const original = positions.slice();
    const candidate = positions.slice();
    assert.equal(publishedRelaxLongEdges(indices, original, limit), undefined);
    assert.equal(relaxLongEdgesInPlace(indices, candidate, limit), undefined);
    assert.deepEqual(candidate, original);
    if (limit === 2) {
      assert.deepEqual(Array.from(original.slice(9)), [
        Math.fround(1 / 3), Math.fround(1 / 3), 0, Math.fround(1 / 3), Math.fround(1 / 3), 0,
      ]);
    }
    if (limit === 20) assert.deepEqual(original, positions);
  }
  const oneLongEdge = [0, 0, 0, 2, 0, 0, 1, 0, 0];
  const original = oneLongEdge.slice();
  const candidate = oneLongEdge.slice();
  publishedRelaxLongEdges([0, 1, 2], original, 1);
  relaxLongEdgesInPlace([0, 1, 2], candidate, 1);
  assert.deepEqual(original, oneLongEdge);
  assert.deepEqual(candidate, original);
});
