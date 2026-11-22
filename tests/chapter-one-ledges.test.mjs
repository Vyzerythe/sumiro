import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chapterOneLedges, chapterOneLeapLinks } from '../src/application/chapter-one-ledges.mts';
import { installChapterOneObstacles } from '../src/application/chapter-one-obstacles.mts';
import { chapterOneGroundRegions } from '../src/application/chapter-one-terrain.mts';
import { installGroundAsset } from '../src/physics/ground-asset.mts';
import { createCollisionWorld } from '../src/physics/world.mts';
import { detectLedgeGrab } from '../src/player/ledge-grab.mts';
import { createLedgePath } from '../src/player/ledge-path.mts';
import { findLeapLink, resolveLeapRim, resolveLeapTarget } from '../src/player/leap.mts';
import { createTraversalController } from '../src/player/traversal-controller.mts';
import { r as publishedPointInPolygon } from '../sumiro/bundle/collision-DtBQEpmQ.js';
import { n as poolRadius, t as poolCenter } from '../sumiro/bundle/layout-BxJUyHwJ.js';
import { i as transformGatePoint } from '../sumiro/bundle/layout-BFL31pIQ.js';
import { b as stairs, c as bridge, g as path, m as pad } from '../sumiro/bundle/rail-V5OV_nvf.js';

const chapterSource = await readFile(new URL('../sumiro/bundle/ch1_climb-D1obDXnH.js', import.meta.url), 'utf8');
const from = chapterSource.indexOf('function ne(');
const to = chapterSource.indexOf('var Oe=', from);
assert.ok(from >= 0 && to > from, 'Published Chapter One authored data boundary changed');
const original = Function('y', 'b', 'x', 'S', 'w', 'ee', 'C', 'f',
  chapterSource.slice(from, to) + '; return { ledges: Z.ledges, leapLinks: Z.leapLinks };',
)(stairs, bridge, path, pad, transformGatePoint, poolRadius, poolCenter, publishedPointInPolygon);

test('Chapter One ledges match the published authored order, points, and flags exactly', () => {
  assert.deepEqual(chapterOneLedges, original.ledges);
  assert.deepEqual(chapterOneLedges.map(ledge => [ledge.id, ledge.points.length]), [
    ['rim_front', 18], ['crack', 8], ['table_low', 3], ['table_lip', 2],
  ]);
  assert.deepEqual(chapterOneLedges.filter(ledge => ledge.snap).map(ledge => ledge.id), ['table_lip']);
  assert.equal(chapterOneLedges[1].hopTo, 'rim_front');
});

test('Chapter One links match the published authored order, ranges, and shared landing', () => {
  assert.deepEqual(chapterOneLeapLinks, original.leapLinks);
  assert.deepEqual(chapterOneLeapLinks.map(link => link.id), ['gap_forward', 'gap_back', 'wall_back', 'shelf_crack']);
  assert.strictEqual(chapterOneLeapLinks[1].to, chapterOneLeapLinks[2].to);
});

test('authored definitions feed the existing ledge path, leap discovery, and grab routines', () => {
  const ledges = new Map(chapterOneLedges.map(ledge => [ledge.id, createLedgePath(ledge)]));
  const rim = ledges.get('rim_front');
  assert.equal(resolveLeapRim(rim, 6.5), rim.s[2]);
  assert.equal(resolveLeapRim(rim, 10.9), rim.s[11]);
  assert.equal(resolveLeapRim(ledges.get('crack'), 7.4), 0);
  assert.equal(resolveLeapRim(ledges.get('table_lip'), 10), ledges.get('table_lip').length);

  const state = { x: 2.8, y: 5.55, z: -44.4, recentSpeed: 5, state: 'RUN' };
  const aim = rim.at(resolveLeapRim(rim, 6.5));
  const length = Math.hypot(aim.x - state.x, aim.z - state.z);
  const direction = { x: (aim.x - state.x) / length, z: (aim.z - state.z) / length };
  const world = { groundAt: () => ({ y: 5.55 }) };
  const match = findLeapLink(state, { leapLinks: chapterOneLeapLinks }, ledges, world, direction, {},
    link => resolveLeapTarget(state, link, ledges, world, direction, {}));
  assert.strictEqual(match.link, chapterOneLeapLinks[0]);
  assert.strictEqual(match.t.ledge, rim);

  const target = { x: match.t.x, y: match.t.y, z: match.t.z, vx: 0, vz: 0, heading: 0 };
  let grabbed;
  assert.equal(detectLedgeGrab(target, ledges.values(), {}, 0.26, 2.1, 1,
    ledge => { grabbed = ledge; }), true);
  assert.strictEqual(grabbed, rim);
});

test('fixed-step input reaches the plateau through the authored gap, grab, and climb', async () => {
  const root = new URL('../sumiro/assets/', import.meta.url);
  const [terrain, glb] = await Promise.all([
    readFile(new URL('levels/ch1_climb/ground.bin', root)), readFile(new URL('player/player.glb', root)),
  ]);
  const rig = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
  const duration = clip => Math.max(...rig.animations.find(item => item.name === clip).samplers
    .map(sampler => rig.accessors[sampler.input].max[0]));
  const world = createCollisionWorld();
  installChapterOneObstacles(world, installGroundAsset(world, terrain, chapterOneGroundRegions));
  const view = { railYaw: -60 };
  const player = createTraversalController(world, { x: 0, z: -43, heading: -Math.PI / 3 }, {
    ledges: chapterOneLedges, leapLinks: chapterOneLeapLinks, duration,
  });
  const forward = { forward: 1, strafe: 0, jump: false, jumpHeld: false, walk: false, sprint: false };
  for (let step = 0; step < 22; step++) player.step(1 / 60, forward, view);
  player.step(1 / 60, { ...forward, jump: true, jumpHeld: true }, view);
  assert.equal(player.state.state, 'LEAP');
  assert.equal(player.state.leap.t.ledge.id, 'rim_front');
  const observed = new Set([player.state.state]);
  for (let step = 0; step < 180; step++) {
    player.step(1 / 60, forward, view);
    observed.add(player.state.state);
    if (observed.has('CLIMB') && player.state.grounded) break;
  }
  assert.deepEqual([...observed], ['LEAP', 'GRAB', 'HANG', 'CLIMB', 'IDLE']);
  assert.equal(player.state.grounded, true);
  assert.ok(player.state.y > 8);
});
