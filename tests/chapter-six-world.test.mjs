import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chapterSixSceneAssets, chapterSixSight, createChapterSixWorld } from '../src/application/chapter-six-world.mts';
import { n as publishedExtrude, t as createPublishedWorld } from '../sumiro/bundle/collision-DtBQEpmQ.js';

const [chapterSource, indexSource, kitSource, bodyRoomSource] = await Promise.all([
  'ch6_summit-BczK7QHX.js', 'index-DnHRwVtn.js', 'kit-B01EgPBo.js', 'body_room-V11x-0lP.js',
].map(file => readFile(new URL('../sumiro/bundle/' + file, import.meta.url), 'utf8')));

function span(source, first, next) {
  const start = source.indexOf(first);
  const end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start, 'Published source boundary changed at ' + first);
  return source.slice(start, end);
}

class ContourPoint {
  constructor(x, y) { this.x = x; this.y = y; }
  equals(point) { return this.x === point.x && this.y === point.y; }
}

const shapeUtils = Function(span(indexSource, 'function Ws(', 'var Dc=class') + 'return wc;')();
const kit = Function('h', 's', 'u', span(kitSource, 'function g(', 'var C={') +
  'return { surfaces: _, edges: v, stones: S };')(publishedExtrude, ContourPoint, shapeUtils);
const discs = Function(span(bodyRoomSource, 'function P(e,t)', 'export{N') + 'return P;')();
const originalLoad = Function('d', 'p', 'm', 'f', '_',
  span(chapterSource, 'var b={', 'var we=') + 'return Ce;',
)(createPublishedWorld, kit.surfaces, kit.edges, kit.stones, discs);

test('the native world matches the shipped initial static collision and scene paths', async () => {
  const original = await originalLoad();
  const chapter = createChapterSixWorld();
  for (const key of ['id', 'spawn', 'killY', 'killDrop']) assert.deepEqual(chapter[key], original[key]);
  assert.deepEqual([chapterSixSight.asset], original.sightFiles);
  assert.equal(chapterSixSight.meshNames.source, original.sightMeshes);
  assert.equal(chapterSixSight.twoSided, original.sightTwoSided);
  const setup = span(chapterSource, 'async function De(', 'function Oe()');
  const originalAssets = [...setup.matchAll(/loadGLTF\(\x60([^\x60]+)\x60\)/g)].map(match => match[1]);
  assert.deepEqual(Object.values(chapterSixSceneAssets), originalAssets);
  assert.deepEqual(chapter.world.stats(), original.world.stats());
  for (const [index, triangle] of chapter.world.triangles().entries()) {
    assert.deepEqual(triangle, original.world.triangles()[index], 'ordered triangle ' + index);
  }
  assert.deepEqual(chapter.world.discs(), original.world.discs());
  assert.deepEqual(new Set(chapter.world.triangles().map(triangle => triangle.kind)), new Set([1, 2, 4, 10]));
  assert.equal(chapter.world.discs().length, 14);
});

test('fresh worlds preserve spawn, cap, ramp, stair, arena and encounter door queries', async () => {
  const { world, spawn } = createChapterSixWorld();
  const independent = createChapterSixWorld().world;
  const { world: original } = await originalLoad();
  assert.notStrictEqual(world.triangles()[0], independent.triangles()[0]);
  assert.notStrictEqual(world.discs()[0], independent.discs()[0]);
  assert.equal(world.groundAt(spawn.x, spawn.z).y, 10);
  assert.equal(world.groundAt(spawn.x, spawn.z).surface, 'snow');
  assert.equal(world.groundAt(26.5, -75).y, 12.92);
  assert.equal(world.groundAt(-166, -350).surface, 'stair');
  assert.equal(world.groundAt(-243, -350).surface, 'stone');
  for (const [x, z] of [
    [29,-50], [30,-79], [26.5,-75], [24.4,-124.5], [31,-221], [31,-239],
    [18,-237], [31,-280], [-90,-321], [-166,-350], [-243,-350], [-293,-350], [0,0],
  ]) {
    assert.deepEqual(world.groundAt(x, z), original.groundAt(x, z));
    assert.deepEqual(world.groundAt(x, z, 69, 16), original.groundAt(x, z, 69, 16));
  }
  const doorRay = [31, 39, -274, 0, 0, -1, 8, 2];
  assert.equal(world.raycast(...doorRay), 4);
  assert.equal(world.raycast(...doorRay), original.raycast(...doorRay));
  world.setGroup('cairn_in', false);
  original.setGroup('cairn_in', false);
  assert.equal(world.raycast(...doorRay), Infinity);
  assert.equal(world.raycast(...doorRay), original.raycast(...doorRay));
  assert.equal(independent.raycast(...doorRay), 4);
  assert.equal(world.body('body_ice_a1'), null);
});
