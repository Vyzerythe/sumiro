import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chapterFiveSceneAssets, createChapterFiveWorld } from '../src/application/chapter-five-world.mts';
import { n as publishedExtrude, t as createPublishedWorld } from '../sumiro/bundle/collision-DtBQEpmQ.js';

const [chapterSource, indexSource, kitSource, bodyRoomSource] = await Promise.all([
  'ch5_sea-CpHUIhkX.js', 'index-DnHRwVtn.js', 'kit-B01EgPBo.js', 'body_room-V11x-0lP.js',
].map(file => readFile(new URL(`../sumiro/bundle/${file}`, import.meta.url), 'utf8')));

function span(source, first, next) {
  const start = source.indexOf(first);
  const end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start, `Published Chapter Five source boundary changed at ${first}`);
  return source.slice(start, end);
}

class ContourPoint {
  constructor(x, y) { this.x = x; this.y = y; }
  equals(point) { return this.x === point.x && this.y === point.y; }
}

const originalShapeUtils = Function(span(indexSource, 'function Ws(', 'var Dc=class') + 'return wc;')();
const kit = Function('h', 's', 'u', span(kitSource, 'function g(', 'var C={') +
  'return { surfaces: _, edges: v, stones: S };')(publishedExtrude, ContourPoint, originalShapeUtils);
const installDiscs = Function(span(bodyRoomSource, 'function P(e,t)', 'export{N') + 'return P;')();
const originalLoad = Function('c', 'u', 'f', 'l', 'h',
  span(chapterSource, 'var y={discs:', ',J={uTideHigh') + ';' + span(chapterSource, 'async function Ce(', 'function we(') + 'return Ce;',
)(createPublishedWorld, kit.surfaces, kit.edges, kit.stones, installDiscs);

test('the Chapter Five static load agrees with shipped metadata, ordered triangles, and discs', async () => {
  const original = await originalLoad();
  const chapter = createChapterFiveWorld();
  for (const key of ['id', 'spawn', 'killY', 'killDrop']) assert.deepEqual(chapter[key], original[key], key);
  assert.equal(Object.hasOwn(chapter, 'killDrop'), Object.hasOwn(original, 'killDrop'));
  assert.deepEqual(Object.values(chapterFiveSceneAssets), original.sightFiles);
  assert.equal(original.surfaces.length, 53);
  assert.equal(original.stones.length, 0);
  assert.deepEqual(chapter.world.stats(), original.world.stats());
  const actual = chapter.world.triangles();
  const expected = original.world.triangles();
  assert.equal(actual.length, expected.length);
  for (const [index, triangle] of actual.entries()) assert.deepEqual(triangle, expected[index], `triangle ${index}`);
  assert.equal(chapter.world.discs().length, 23);
  assert.deepEqual(chapter.world.discs(), original.world.discs());
  assert.deepEqual(new Set(actual.map(triangle => triangle.kind)), new Set([1, 2, 4]));
});

test('fresh Chapter Five worlds preserve spawn support, sloping stairs, and isolated court barriers', async () => {
  const { world, spawn } = createChapterFiveWorld();
  const fresh = createChapterFiveWorld().world;
  const { world: original } = await originalLoad();
  assert.notStrictEqual(world.triangles()[0], fresh.triangles()[0]);
  assert.notStrictEqual(world.discs()[0], fresh.discs()[0]);
  assert.notStrictEqual(world.groundAt(spawn.x, spawn.z), fresh.groundAt(spawn.x, spawn.z));
  const grounded = world.groundAt(spawn.x, spawn.z);
  assert.ok(Math.abs(grounded.y - 3.6) < 1e-9);
  assert.equal(grounded.surface, 'rock');
  const stair = world.groundAt(30, -88.5);
  assert.ok(Math.abs(stair.y - 2.3) < 1e-9);
  assert.equal(stair.surface, 'stair');
  assert.ok(stair.nz < 0);
  for (const [x, z] of [[spawn.x, spawn.z], [30, -88.5], [34, -110], [33.8, -148], [13, -168], [34, -242],
    [86, -358], [125, -438], [125, -499], [136, -530], [191.5, -554], [191.5, -590], [0, 0]]) {
    assert.deepEqual(world.groundAt(x, z), original.groundAt(x, z), `${x},${z}`);
    assert.deepEqual(world.groundAt(x, z, 5, 0), original.groundAt(x, z, 5, 0), `bounded ${x},${z}`);
  }

  const gate = [125, 5, -483, 0, 0, -1, 8, 2];
  const closed = world.raycast(...gate);
  assert.ok(closed < 8);
  assert.equal(closed, original.raycast(...gate));
  world.setGroup('court_in', false);
  original.setGroup('court_in', false);
  assert.equal(world.raycast(...gate), Infinity);
  assert.equal(world.raycast(...gate), original.raycast(...gate));
  assert.equal(fresh.raycast(...gate), closed);
  assert.equal(world.body('raft'), null);

  const disc = world.discs()[1];
  const sweep = [{ x: disc.x + disc.r + 0.5, y: 3.6, z: disc.z + 0.1 }, -0.65, 0];
  const hit = world.sweepCapsule(...sweep);
  assert.ok(hit.hit);
  assert.deepEqual(hit, original.sweepCapsule(...sweep));
});
