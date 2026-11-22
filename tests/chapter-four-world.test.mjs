import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chapterFourSceneAssets, createChapterFourWorld } from '../src/application/chapter-four-world.mts';
import { n as publishedExtrude, t as createPublishedWorld } from '../sumiro/bundle/collision-DtBQEpmQ.js';

const [chapterSource, indexSource, kitSource, bodyRoomSource] = await Promise.all([
  'ch4_temple-XtSLeUue.js', 'index-DnHRwVtn.js', 'kit-B01EgPBo.js', 'body_room-V11x-0lP.js',
].map(file => readFile(new URL(`../sumiro/bundle/${file}`, import.meta.url), 'utf8')));

function span(source, first, next) {
  const start = source.indexOf(first);
  const end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start, `Published Chapter Four source boundary changed at ${first}`);
  return source.slice(start, end);
}

// The shipped triangulator uses only x, y, and equals on contour points.
class ContourPoint {
  constructor(x, y) { this.x = x; this.y = y; }
  equals(point) { return this.x === point.x && this.y === point.y; }
}

const originalShapeUtils = Function(span(indexSource, 'function Ws(', 'var Dc=class') + 'return wc;')();
const kit = Function('h', 's', 'u', span(kitSource, 'function g(', 'var C={') +
  'return { floors: _, edges: v, stones: S };')(publishedExtrude, ContourPoint, originalShapeUtils);
const discs = Function(span(bodyRoomSource, 'function P(e,t)', 'export{N') + 'return P;')();
const originalLoad = Function('_', 'te', 're', 'ee', 'oe',
  span(chapterSource, 'var x={discs', 'var xe=') +
  span(chapterSource, 'async function Re()', 'async function ze(') + 'return Re;',
)(createPublishedWorld, kit.floors, kit.edges, kit.stones, discs);

test('Chapter Four matches published metadata and every static triangle and disc in order', async () => {
  const original = await originalLoad();
  const chapter = createChapterFourWorld();
  for (const key of ['id', 'spawn', 'killY', 'killDrop']) assert.deepEqual(chapter[key], original[key]);
  assert.deepEqual(Object.values(chapterFourSceneAssets), original.sightFiles);
  assert.equal(original.surfaces.length, 46);
  assert.equal(original.edges.length, 264);
  assert.equal(chapter.world.discs().length, 289);
  assert.deepEqual(chapter.world.stats(), original.world.stats());
  assert.deepEqual(chapter.world.triangles(), original.world.triangles());
  assert.deepEqual(chapter.world.discs(), original.world.discs());
  assert.deepEqual(new Set(chapter.world.triangles().map(triangle => triangle.kind)), new Set([1, 2, 4, 10]));
});

test('fresh Chapter Four worlds preserve ground, slope, camera mask and gate queries', async () => {
  const { world, spawn } = createChapterFourWorld();
  const fresh = createChapterFourWorld().world;
  const { world: original } = await originalLoad();
  assert.notStrictEqual(world.triangles()[0], fresh.triangles()[0]);
  assert.notStrictEqual(world.discs()[0], fresh.discs()[0]);
  assert.notStrictEqual(world.groundAt(spawn.x, spawn.z), fresh.groundAt(spawn.x, spawn.z));
  assert.equal(world.groundAt(spawn.x, spawn.z).y, 8);
  assert.equal(world.groundAt(30, -56).surface, 'stair');
  assert.equal(world.groundAt(30, -56).y, 10);
  for (const [x, z] of [[spawn.x, spawn.z], [30, -56], [30, -151], [30, -238], [75, -279], [81, -309],
    [39, -327], [30, -449], [30, -510], [28, -538], [0, 0]]) {
    assert.deepEqual(world.groundAt(x, z), original.groundAt(x, z));
    assert.deepEqual(world.groundAt(x, z, 63, 39), original.groundAt(x, z, 63, 39));
  }

  const cameraWall = [15, 65, -451, 0, 0, -1, 2, 8];
  assert.equal(world.raycast(...cameraWall), 1);
  assert.equal(world.raycast(...cameraWall), original.raycast(...cameraWall));
  const gate = [30, 26, -142.5, 0, 0, -1, 3, 2];
  assert.equal(world.raycast(...gate), 1.5);
  assert.equal(world.raycast(...gate), original.raycast(...gate));
  world.setGroup('fore_in', false);
  original.setGroup('fore_in', false);
  assert.equal(world.raycast(...gate), Infinity);
  assert.equal(world.raycast(...gate), original.raycast(...gate));
  assert.equal(fresh.raycast(...gate), 1.5);
});
