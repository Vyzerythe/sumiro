import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  chapterOneEdges, chapterOneGateBarrier, chapterOneStones, installChapterOneObstacles,
} from '../src/application/chapter-one-obstacles.mts';
import { chapterOneGroundRegions } from '../src/application/chapter-one-terrain.mts';
import { installGroundAsset } from '../src/physics/ground-asset.mts';
import { createCollisionWorld } from '../src/physics/world.mts';
import { n as extrude, r as contains, t as createPublishedWorld } from '../sumiro/bundle/collision-DtBQEpmQ.js';
import { n as poolRadius, t as poolCenter } from '../sumiro/bundle/layout-BxJUyHwJ.js';
import { i as transformGatePoint } from '../sumiro/bundle/layout-BFL31pIQ.js';
import { b as stairs, c as bridge, g as path, m as pad } from '../sumiro/bundle/rail-V5OV_nvf.js';

const [asset, chapterSource, kitSource] = await Promise.all([
  readFile(new URL('../sumiro/assets/levels/ch1_climb/ground.bin', import.meta.url)),
  readFile(new URL('../sumiro/bundle/ch1_climb-D1obDXnH.js', import.meta.url), 'utf8'),
  readFile(new URL('../sumiro/bundle/kit-B01EgPBo.js', import.meta.url), 'utf8'),
]);

function publishedSpan(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Published obstacle source boundary changed at ${start}`);
  return source.slice(from, to);
}

const kit = Function('h', publishedSpan(kitSource, 'function g(', 'var C={') +
  '; return { installStones: S, installEdges: v };')(extrude);

const reference = Function('y', 'b', 'x', 'S', 'w', 'ee', 'C', 'f', 'd', 'p', 'h', 'm',
  publishedSpan(chapterSource, 'function ne(', 'var Oe=') +
  publishedSpan(chapterSource, 'var ze=.9;', 'async function We(') +
  '; return { level: Z, load: Ue, decode: Be, edgeHeight: He };',
)(stairs, bridge, path, pad, transformGatePoint, poolRadius, poolCenter, contains, extrude, createPublishedWorld,
  kit.installEdges, kit.installStones);

async function makeWorlds() {
  const originalBytes = asset.buffer.slice(asset.byteOffset, asset.byteOffset + asset.byteLength);
  const original = await reference.load({ assets: { loadArrayBuffer(name) {
    assert.equal(name, 'levels/ch1_climb/ground.bin');
    return originalBytes;
  } } });
  const candidate = createCollisionWorld();
  const ground = installGroundAsset(candidate, asset, chapterOneGroundRegions);
  const terrainTriangles = candidate.stats().triangles;
  installChapterOneObstacles(candidate, ground);
  return { original: original.world, candidate, terrainTriangles, originalGround: reference.decode(originalBytes) };
}

test('Chapter One static obstacle data and installation match the shipped level', async () => {
  assert.equal(reference.level.edges.length, 27);
  assert.deepEqual(chapterOneEdges, reference.level.edges);
  assert.deepEqual(chapterOneStones, reference.level.stones);

  const { original, candidate, terrainTriangles } = await makeWorlds();
  assert.ok(candidate.stats().triangles > terrainTriangles);
  assert.deepEqual(candidate.stats(), original.stats());
  const obstacles = candidate.triangles().slice(terrainTriangles);
  assert.deepEqual(obstacles, original.triangles().slice(terrainTriangles));
  assert.deepEqual(new Set(obstacles.map(triangle => triangle.kind)), new Set([1, 2, 4, 10, 16]));
  assert.ok(obstacles.some(triangle => triangle.round));
  assert.ok(obstacles.some(triangle => triangle.group === chapterOneGateBarrier));
  assert.deepEqual(candidate.discs(), original.discs());

  for (const { x, z, top } of reference.level.stones) {
    assert.equal(candidate.groundAt(x, z).y, top);
    assert.deepEqual(candidate.groundAt(x, z), original.groundAt(x, z));
  }
  assert.equal(candidate.groundAt(9.85, -41).y, 9.72);
  assert.deepEqual(candidate.groundAt(9.85, -41), original.groundAt(9.85, -41));
});

function edgeRay(edge, ground, kinds) {
  const [[x0, z0], [x1, z1]] = edge.pts;
  const x = (x0 + x1) / 2;
  const z = (z0 + z1) / 2;
  const length = Math.hypot(x1 - x0, z1 - z0);
  const dx = -(z1 - z0) / length;
  const dz = (x1 - x0) / length;
  const y = Math.max(reference.edgeHeight(ground, x0, z0), reference.edgeHeight(ground, x1, z1)) + 2;
  return [x - dx * 0.2, y, z - dz * 0.2, dx, 0, dz, 0.3, kinds];
}

test('gate toggling and sight casts follow the published collision groups and masks', async () => {
  const { original, candidate, originalGround } = await makeWorlds();
  const gate = reference.level.edges.find(edge => edge.id === 'gate');
  const guard = reference.level.edges.find(edge => edge.id === 'path_left');
  const column = reference.level.edges.find(edge => edge.id === 'column_west');
  const gateRay = edgeRay(gate, originalGround, 2);
  const guardRay = edgeRay(guard, originalGround, 4);
  const sightRay = edgeRay(column, originalGround, 16);

  for (const world of [original, candidate]) {
    assert.ok(world.raycast(...gateRay) < Infinity);
    world.setGroup(chapterOneGateBarrier, false);
    assert.equal(world.raycast(...gateRay), Infinity);
    world.setGroup(chapterOneGateBarrier, true);
    assert.ok(world.raycast(...gateRay) < Infinity);
    assert.ok(world.raycast(...guardRay) < Infinity);
    assert.ok(world.raycast(...sightRay) < Infinity);
    assert.equal(world.rayFades, 'gate_columns');
  }
  for (const ray of [gateRay, guardRay, sightRay]) {
    assert.equal(candidate.raycast(...ray), original.raycast(...ray));
    assert.equal(candidate.rayFades, original.rayFades);
  }
});
