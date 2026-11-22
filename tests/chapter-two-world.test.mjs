import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chapterTwoSceneAssets, createChapterTwoWorld } from '../src/application/chapter-two-world.mts';
import { n as publishedExtrude, t as createPublishedWorld } from '../sumiro/bundle/collision-DtBQEpmQ.js';

const [chapterSource, indexSource, kitSource, bodyRoomSource] = await Promise.all([
  'ch2_pass-9Opjv4P2.js', 'index-DnHRwVtn.js', 'kit-B01EgPBo.js', 'body_room-V11x-0lP.js',
].map(file => readFile(new URL(`../sumiro/bundle/${file}`, import.meta.url), 'utf8')));

function span(source, first, next) {
  const start = source.indexOf(first);
  const end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start, `Published Chapter Two source boundary changed at ${first}`);
  return source.slice(start, end);
}

// The published triangulator uses only x, y and equals on contour points.
class ContourPoint {
  constructor(x, y) { this.x = x; this.y = y; }
  equals(point) { return this.x === point.x && this.y === point.y; }
}

const originalShapeUtils = Function(span(indexSource, 'function Ws(', 'var Dc=class') + 'return wc;')();
const originalInstallEdges = Function('h', span(kitSource, 'function v(e,t=[]', 'var y=2.5') + 'return v;')(publishedExtrude);
const originalInstallDiscs = Function(span(bodyRoomSource, 'function P(e,t)', 'export{N') + 'return P;')();
const originalLoad = Function('f', 'm', 'h', 'ee', 're', '_',
  span(chapterSource, 'var de=', 'function Le(') +
  span(chapterSource, 'var Q=`levels/ch2_pass`', 'async function $(') + 'return qe;',
)(ContourPoint, originalShapeUtils, publishedExtrude, originalInstallEdges, originalInstallDiscs, createPublishedWorld);

test('Chapter Two matches the published spawn and every static triangle and disc in order', async () => {
  const original = await originalLoad();
  const current = createChapterTwoWorld();
  for (const key of ['id', 'spawn', 'killY', 'killDrop']) assert.deepEqual(current[key], original[key]);
  assert.deepEqual(Object.values(chapterTwoSceneAssets), original.sightFiles);
  assert.equal(original.rocks.length, 53);
  assert.equal(current.world.discs().length, 31);
  assert.deepEqual(current.world.stats(), original.world.stats());
  assert.deepEqual(current.world.triangles(), original.world.triangles());
  assert.deepEqual(current.world.discs(), original.world.discs());
  assert.deepEqual(new Set(current.world.triangles().map(triangle => triangle.kind)), new Set([1, 2, 4]));
});

test('Chapter Two worlds support independent grounded traversal and collision queries', async () => {
  const { world, spawn } = createChapterTwoWorld();
  const other = createChapterTwoWorld().world;
  const { world: original } = await originalLoad();
  assert.notStrictEqual(world.triangles(), other.triangles());
  assert.notStrictEqual(world.triangles()[0], other.triangles()[0]);
  assert.notStrictEqual(world.discs(), other.discs());
  assert.notStrictEqual(world.groundAt(spawn.x, spawn.z), other.groundAt(spawn.x, spawn.z));
  assert.equal(world.groundAt(spawn.x, spawn.z).y, 6);
  assert.equal(world.groundAt(59, -149).surface, 'stair');
  for (const [x, z] of [[spawn.x, spawn.z], [14, -45], [59, -149], [59, -213], [47, -219], [49, -375], [0, 0]]) {
    assert.deepEqual(world.groundAt(x, z), original.groundAt(x, z));
    for (const [maxY, minY] of [[34, 25], [65.1, 45]]) {
      assert.deepEqual(world.groundAt(x, z, maxY, minY), original.groundAt(x, z, maxY, minY));
    }
  }

  const disc = world.discs()[0];
  const approaches = [
    [{ x: 7, y: 6, z: -36 }, 0, -3, { radius: 0.3, height: 1.7 }],
    [{ x: disc.x + disc.r + 0.5, y: 6, z: disc.z }, -0.6, 0, { radius: 0.3, height: 1.7 }],
  ];
  for (const args of approaches) {
    const candidateSweep = world.sweepCapsule(...args);
    assert.ok(candidateSweep.hit);
    assert.deepEqual(candidateSweep, original.sweepCapsule(...args));
  }
});
