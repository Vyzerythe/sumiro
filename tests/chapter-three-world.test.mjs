import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chapterThreeSceneAssets, createChapterThreeWorld } from '../src/application/chapter-three-world.mts';
import { n as publishedExtrude, t as createPublishedWorld } from '../sumiro/bundle/collision-DtBQEpmQ.js';

const [chapterSource, indexSource, kitSource, bodyRoomSource] = await Promise.all([
  'ch3_pines-BCHma7IG.js', 'index-DnHRwVtn.js', 'kit-B01EgPBo.js', 'body_room-V11x-0lP.js',
].map(file => readFile(new URL(`../sumiro/bundle/${file}`, import.meta.url), 'utf8')));

function span(source, first, next) {
  const start = source.indexOf(first);
  const end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start, `Published Chapter Three source boundary changed at ${first}`);
  return source.slice(start, end);
}

// The published contour code only reads x, y and equals on these points.
class ContourPoint {
  constructor(x, y) { this.x = x; this.y = y; }
  equals(point) { return this.x === point.x && this.y === point.y; }
}

const originalShapeUtils = Function(span(indexSource, 'function Ws(', 'var Dc=class') + 'return wc;')();
const kit = Function('h', 's', 'u', span(kitSource, 'function g(', 'var C={') +
  'return { platforms: _, edges: v, stones: S };')(publishedExtrude, ContourPoint, originalShapeUtils);
const discs = Function(span(bodyRoomSource, 'function P(e,t)', 'export{N') + 'return P;')();
const originalLoad = Function('m', 'g', '_', 'h', 'b',
  span(chapterSource, 'var ie=', 'function ke(') + 'return Oe;',
)(createPublishedWorld, kit.platforms, kit.edges, kit.stones, discs);

test('Chapter Three matches published metadata and ordered static triangles and discs', async () => {
  const original = await originalLoad();
  const chapter = createChapterThreeWorld();
  for (const key of ['id', 'spawn', 'killY', 'killDrop']) assert.deepEqual(chapter[key], original[key]);
  assert.deepEqual(Object.values(chapterThreeSceneAssets), original.sightFiles);
  assert.equal(original.surfaces.length, 33);
  assert.equal(original.edges.length, 520);
  assert.equal(chapter.world.discs().length, 29);
  assert.deepEqual(chapter.world.stats(), original.world.stats());
  assert.deepEqual(chapter.world.triangles(), original.world.triangles());
  assert.deepEqual(chapter.world.discs(), original.world.discs());
  assert.deepEqual(new Set(chapter.world.triangles().map(triangle => triangle.kind)), new Set([1, 2, 4, 16]));
});

test('fresh Chapter Three worlds preserve ground, trunk, sweep and sight queries', async () => {
  const { world, spawn } = createChapterThreeWorld();
  const fresh = createChapterThreeWorld().world;
  const { world: original } = await originalLoad();
  assert.notStrictEqual(world.triangles()[0], fresh.triangles()[0]);
  assert.notStrictEqual(world.discs()[0], fresh.discs()[0]);
  assert.notStrictEqual(world.groundAt(spawn.x, spawn.z), fresh.groundAt(spawn.x, spawn.z));
  assert.equal(world.groundAt(spawn.x, spawn.z).y, 20);
  assert.equal(world.groundAt(36.4, -162).surface, 'wood');
  assert.equal(world.groundAt(-403, -212.4).surface, 'stair');
  for (const [x, z] of [[spawn.x, spawn.z], [32.5, -114], [36.4, -162], [-91, -202.3], [-196, -202],
    [-313.6, -172], [-403, -212.4], [-444.6, -299], [0, 0]]) {
    assert.deepEqual(world.groundAt(x, z), original.groundAt(x, z));
    assert.deepEqual(world.groundAt(x, z, 30, 19), original.groundAt(x, z, 30, 19));
  }

  const disc = world.discs()[0];
  const sweep = [{ x: disc.x + disc.r + 0.5, y: 20, z: disc.z }, -0.65, 0];
  const hit = world.sweepCapsule(...sweep);
  assert.ok(hit.hit && hit.round);
  assert.deepEqual(hit, original.sweepCapsule(...sweep));
  const sightRay = [-209, 33, -198, 0, 0, 1, 10, 16];
  assert.ok(world.raycast(...sightRay) < Infinity);
  assert.equal(world.raycast(...sightRay), original.raycast(...sightRay));
  assert.equal(world.rayFades, 'a07_pine');
  assert.equal(world.rayFades, original.rayFades);
});
