import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { decodeGroundAsset, installGroundAsset, sampleGroundEdgeHeight } from '../src/physics/ground-asset.mts';
import { createCollisionWorld } from '../src/physics/world.mts';
import { createInputManager } from '../src/input/input-manager.mts';
import { createTraversalController } from '../src/player/traversal-controller.mts';
import { FixedStepClock } from '../src/runtime/fixed-step-clock.mts';
import { chapterOneGroundRegions, chapterOneSpawn } from '../src/application/chapter-one-terrain.mts';
import { r as publishedPointInPolygon, t as createPublishedWorld } from '../sumiro/bundle/collision-DtBQEpmQ.js';
import { n as poolRadius, t as poolCenter } from '../sumiro/bundle/layout-BxJUyHwJ.js';
import { i as transformGatePoint } from '../sumiro/bundle/layout-BFL31pIQ.js';
import { b as stairs, c as bridge, g as path, m as pad } from '../sumiro/bundle/rail-V5OV_nvf.js';

const [asset, chapterSource] = await Promise.all([
  readFile(new URL('../sumiro/assets/levels/ch1_climb/ground.bin', import.meta.url)),
  readFile(new URL('../sumiro/bundle/ch1_climb-D1obDXnH.js', import.meta.url), 'utf8'),
]);

function publishedSpan(start, end) {
  const from = chapterSource.indexOf(start);
  const to = chapterSource.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Published ground source boundary changed at ${start}`);
  return chapterSource.slice(from, to);
}

// Evaluate the published authored data and ground functions without booting the game.
const reference = Function('y', 'b', 'x', 'S', 'w', 'ee', 'C', 'f',
  publishedSpan('function ne(', 'var Oe=') +
  publishedSpan('var ze=.9;', 'async function Ue(') +
  '; return { level: Z, decode: Be, install: Ve, sampleEdgeHeight: He };',
)(stairs, bridge, path, pad, transformGatePoint, poolRadius, poolCenter, publishedPointInPolygon);

const publishedGround = reference.decode(asset.buffer.slice(asset.byteOffset, asset.byteOffset + asset.byteLength));

test('Chapter One ground planes match the shipped decoder, including an unaligned view', () => {
  assert.equal(asset.byteLength, 159_120);
  const input = Buffer.alloc(asset.byteLength + 2, 255);
  asset.copy(input, 1);
  const ground = decodeGroundAsset(input.subarray(1, -1));
  assert.equal(ground.heights.length, 53_040);
  assert.deepEqual(ground.heights, publishedGround.heights);
  assert.deepEqual(ground.surfaces, publishedGround.surfaces);

  const missingIndex = publishedGround.heights.indexOf(-32768);
  assert.ok(missingIndex >= 0);
  assert.equal(ground.at(missingIndex % 136, Math.floor(missingIndex / 136)), null);
  assert.equal(ground.at(-1, 0), null);
  assert.equal(ground.at(1, 0.5), null);
  for (const [x, z] of [[-0.51, 7.4], [-1.7, -34], [4, -44], [9.2, -40.5], [15.4, -55.6], [-50, 50]]) {
    assert.deepEqual(ground.node(x, z), publishedGround.node(x, z));
    assert.equal(ground.at(...ground.node(x, z)), publishedGround.at(...publishedGround.node(x, z)));
    assert.equal(sampleGroundEdgeHeight(ground, x, z), reference.sampleEdgeHeight(publishedGround, x, z));
  }
  input.fill(0);
  assert.deepEqual(ground.heights, publishedGround.heights);
  assert.deepEqual(ground.surfaces, publishedGround.surfaces);
});

test('actual asset and authored regions install the same terrain as the published level', () => {
  assert.deepEqual(reference.level.groundRegions.map(region => region.id), ['climb', 'shelf', 'plateau']);
  assert.deepEqual(chapterOneGroundRegions, reference.level.groundRegions);
  assert.deepEqual(chapterOneSpawn, reference.level.spawn);
  const original = createPublishedWorld();
  const candidate = createCollisionWorld();
  reference.install(original, publishedGround, reference.level.groundRegions);
  installGroundAsset(candidate, asset, chapterOneGroundRegions);
  assert.ok(original.stats().triangles > 0);
  assert.deepEqual(candidate.stats(), original.stats());
  assert.deepEqual(candidate.triangles(), original.triangles());
  assert.equal(candidate.discs().length, 0);

  const { x, z } = reference.level.spawn;
  assert.ok(candidate.groundAt(x, z), 'the published spawn has installed terrain');
  for (const [probeX, probeZ] of [[x, z], [2.7, -43], [9.2, -40.5], [15.4, -55.6], [30, -68]]) {
    assert.deepEqual(candidate.groundAt(probeX, probeZ), original.groundAt(probeX, probeZ));
  }
});

test('truncated and oversized assets leave existing collision state intact', () => {
  const world = createCollisionWorld();
  world.addTriangles([0, 1, 0, 3, 1, 0, 0, 1, 3], { surface: 'wood' });
  const existing = world.triangles()[0];
  const stats = world.stats();
  const hit = world.groundAt(1, 1);
  for (const malformed of [asset.subarray(0, -1), Buffer.concat([asset, Buffer.from([0])])]) {
    assert.throws(() => installGroundAsset(world, malformed, reference.level.groundRegions), /expected 159120/);
    assert.deepEqual(world.stats(), stats);
    assert.strictEqual(world.triangles()[0], existing);
    assert.strictEqual(world.groundAt(1, 1), hit);
  }
});

test('sampled keyboard input walks the recovered terrain from the published spawn', context => {
  const world = createCollisionWorld();
  installGroundAsset(world, asset, chapterOneGroundRegions);
  const body = createTraversalController(world, chapterOneSpawn);
  const keyboard = new EventTarget();
  const input = createInputManager({ keyboardTarget: keyboard });
  context.after(() => input.dispose());
  const clock = new FixedStepClock(60, 24);
  function tick() {
    clock.advance();
    input.beginStep(clock.t, clock.fixedDt);
    try {
      assert.equal(body.step(clock.fixedDt, input, null), true);
    } finally {
      input.endStep();
    }
  }
  const before = { ...body.state };
  keyboard.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW', repeat: false }));
  for (let index = 0; index < 60; index++) tick();
  assert.ok(body.state.z < before.z - 3);
  assert.equal(body.state.x, before.x);
  assert.equal(body.state.y, world.groundAt(body.state.x, body.state.z).y);
  assert.equal(body.state.state, 'RUN');
  keyboard.dispatchEvent(Object.assign(new Event('keyup'), { code: 'KeyW' }));
  for (let index = 0; index < 60; index++) tick();
  assert.equal(body.state.state, 'IDLE');
});
