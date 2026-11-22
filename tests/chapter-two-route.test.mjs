import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createChapterExit } from '../src/application/chapter-exits.mts';
import { createChapterTwoTraversal } from '../src/application/chapter-two-ledges.mts';
import { createChapterTwoMechanisms } from '../src/application/chapter-two-mechanisms.mts';
import { createChapterTwoWorld } from '../src/application/chapter-two-world.mts';
import { createLaterChapterCamera } from '../src/application/later-chapter-camera.mts';
import { createTraversalController } from '../src/player/traversal-controller.mts';

const glb = await readFile(new URL('../sumiro/assets/player/player.glb', import.meta.url));
const model = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
const durations = new Map(model.animations.map(clip => [
  clip.name, Math.max(...clip.samplers.map(sampler => model.accessors[sampler.input].max[0])),
]));
const dt = 1 / 60;
const noKeys = { forward: 0, strafe: 0, jump: false, jumpHeld: false, walk: false, sprint: false, inkStep: false };

function route(x, z, heading = 0) {
  const { id, world } = createChapterTwoWorld();
  const mechanisms = createChapterTwoMechanisms(world);
  const player = createTraversalController(world, { x, z, heading }, {
    ...createChapterTwoTraversal(),
    canInkStep: () => true,
    duration(name) {
      const duration = durations.get(name);
      assert.ok(duration > 0, name);
      return duration;
    },
  });
  const camera = createLaterChapterCamera(world, id);
  const exit = createChapterExit(id);
  const state = player.state;
  let view = camera(state, 0, 0);
  let exited = false;
  const observed = new Set();
  const visitedLedges = new Set();
  const usedLinks = new Set();
  const carriers = new Set();

  function step(input) {
    mechanisms.step(dt, state);
    player.step(dt, { ...noKeys, ...input }, view);
    view = camera(state, dt, 0);
    exited = exit.update(dt, state, {}) || exited;
    observed.add(state.state);
    if (state.ledge) visitedLedges.add(state.ledge.id);
    if (state.leap?.link.id) usedLinks.add(state.leap.link.id);
    if (state.carrier) carriers.add(state.carrier.id);
  }

  function toward(worldX, worldZ, action) {
    // Keep the intended world direction as the authored camera yaw changes.
    const yaw = state.holdActive ? state.holdYaw : view.railYaw * Math.PI / 180;
    const strafe = Math.cos(yaw) * worldX - Math.sin(yaw) * worldZ;
    const forward = -Math.sin(yaw) * worldX - Math.cos(yaw) * worldZ;
    step({ strafe, forward, ...action });
  }

  function until(limit, worldX, worldZ, condition) {
    for (let frame = 0; frame < limit && !condition(state); frame++) toward(worldX, worldZ);
    assert.ok(condition(state), `Missed waypoint at [${state.x}, ${state.y}, ${state.z}] in ${state.state}`);
  }

  function walk(frames, worldX, worldZ, action = {}) {
    for (let frame = 0; frame < frames; frame++) toward(worldX, worldZ, { ...action, jump: action.jump && frame === 0 });
  }
  function keys(frames, strafe, forward, action = {}) {
    for (let frame = 0; frame < frames; frame++) step({ strafe, forward, ...action, jump: action.jump && frame === 0 });
  }
  function shimmyTo(distance, strafe = 1) {
    for (let frame = 0; frame < 620 && Math.abs(state.ledgeS - distance) > 0.04; frame++) {
      assert.ok(state.ledge);
      step({ strafe });
    }
    assert.ok(Math.abs(state.ledgeS - distance) <= 0.04, state.state + ' at ' + state.ledgeS);
  }

  return { state, world, mechanisms, observed, visitedLedges, usedLinks, carriers, toward, walk, keys, until, shimmyTo,
    get exited() { return exited; } };
}

const jump = { jump: true, jumpHeld: true };

test('Chapter Two dock at [12.5, -47.4]: jump onto the called slab, ride it, and dismount to the gate road', () => {
  const run = route(12.5, -47.4);
  assert.equal(run.mechanisms.ringBell('court_slab_bell'), true);
  run.walk(120, 0, 0);
  run.walk(15, 0, -1);
  run.walk(29, 0, -1, jump);
  run.until(60, 0, 0, state => state.carrier?.id === 'court_slab');
  assert.equal(run.mechanisms.ringBell('court_far_bell'), true);
  run.walk(120, 0, 0);
  run.until(75, 0, -1, state => state.z < -60.55);
  run.walk(70, 0, -1, jump);
  assert.equal(run.state.carrier, null);
  assert.equal(run.state.grounded, true);
  assert.ok(run.state.z < -66);
  assert.equal(run.state.y, 6);
});

test('Chapter Two gate road at [14, -63]: mantle both rises, then grab, shimmy and climb the first crack', () => {
  const run = route(14, -63);
  run.until(240, 0, -1, state => state.z < -79.35);
  run.walk(40, 0, -1, jump);
  run.until(100, 0, -1, state => state.z < -85.35);
  assert.equal(run.state.y, 7.1);
  run.walk(40, 0, -1, jump);
  run.until(250, 0, -1, state => state.z < -98.8);
  assert.equal(run.state.y, 8.3);
  run.walk(32, 0, -1, jump);
  run.walk(30, 0, 0);
  assert.equal(run.state.ledge?.id, 'crack1');
  run.keys(390, 1, 0);
  assert.ok(run.state.ledgeS > 10.6);
  run.keys(100, 0, 1);
  assert.equal(run.state.grounded, true);
  assert.equal(run.state.y, 11.6);
  assert.ok(run.state.x > 22 && run.state.z < -100);
});

test('Chapter Two first-holds shrine at [26.6, -106.4]: clear both cornice gaps and climb onto the shelf', () => {
  const run = route(26.6, -106.4);
  run.until(180, 1, 0, state => state.x > 38.8);
  run.until(180, 0, -1, state => state.z < -110.1);
  run.walk(70, 0, -1, jump);
  assert.equal(run.state.ledge?.id, 'cornice_a');
  run.shimmyTo(run.state.ledge.length);
  run.keys(38, 1, 0, jump);
  assert.equal(run.state.ledge?.id, 'cornice_b');
  run.shimmyTo(run.state.ledge.length);
  run.keys(38, 1, 0, jump);
  assert.equal(run.state.ledge?.id, 'cornice_c');
  run.shimmyTo(2);
  run.keys(100, 0, 1);
  assert.equal(run.state.grounded, true);
  assert.equal(run.state.y, 13.9);
});

test('Chapter Two upper stair at [57, -191] and cleft floor at [48, -220]: complete the authored leap links', () => {
  const stair = route(57, -191);
  stair.until(70, 0, -1, state => state.z < -193.2);
  stair.walk(53, 0, -1, jump);
  stair.keys(100, 0, 1);
  assert.deepEqual([...stair.usedLinks], ['stair_gap']);
  assert.deepEqual([...stair.visitedLedges], ['r6_s']);
  assert.equal(stair.state.grounded, true);
  assert.equal(stair.state.y, 33.5);

  const cleft = route(48, -220, -Math.PI / 2);
  cleft.until(70, 1, 0, state => state.x > 50.3);
  cleft.walk(45, 1, 0, jump);
  for (let link = 0; link < 3; link++) cleft.keys(50, 0, -1, jump);
  cleft.keys(100, 0, 1);
  assert.deepEqual([...cleft.usedLinks], ['e1_w1', 'w1_e2', 'e2_w2']);
  assert.deepEqual([...cleft.visitedLedges], ['e1', 'w1', 'e2', 'w2']);
  assert.equal(cleft.state.grounded, true);
  assert.equal(cleft.state.y, 39.9);
});

test('Chapter Two ink rock c at [-3.8, -220]: use a late jump and an airborne Ink Step to reach rock d', () => {
  const run = route(-3.8, -220, Math.PI / 2);
  run.until(90, -1, 0, state => state.x < -8.1);
  run.walk(10, -1, 0, jump);
  run.toward(-1, 0, { inkStep: true, jumpHeld: true });
  run.walk(60, -1, 0, { jumpHeld: true });
  assert.ok(run.observed.has('DASH'));
  assert.equal(run.state.grounded, true);
  assert.ok(run.state.x < -16 && run.state.x > -20);
  assert.ok(Math.abs(run.state.y - 39.9) < 1e-9);
});

test('Chapter Two Tooth approach at [3.3, -256]: switch between both walls and climb onto h_top', () => {
  const run = route(3.3, -256, -Math.PI / 2);
  run.until(70, 1, 0, state => state.x > 6);
  run.walk(67, 1, 0, jump);
  run.keys(9, 0, 0);
  assert.equal(run.state.ledge?.id, 'h1a');
  run.shimmyTo(run.state.ledge.length);
  run.keys(37, 1, 0, jump);
  assert.equal(run.state.ledge?.id, 'h1b');
  run.shimmyTo(run.state.ledge.length);
  run.keys(49, 0, -1, jump);
  run.keys(44, 0, 1, jump);
  run.keys(63, 0, -1, jump);
  run.keys(90, 0, 1);
  assert.deepEqual([...run.usedLinks], ['tooth_leap', 'h1b_h2', 'h3_h4']);
  assert.deepEqual([...run.visitedLedges], ['h1a', 'h1b', 'h2', 'h3', 'h4']);
  assert.equal(run.state.grounded, true);
  assert.equal(run.state.y, 49.6);
});

test('Chapter Two Knife approach at [47, -314] and top at [48, -342]: climb and use the crumbles to reach the exit', () => {
  const knife = route(47, -314);
  knife.until(70, 0, -1, state => state.z < -317.4);
  knife.walk(67, 0, -1, jump);
  assert.equal(knife.state.ledge?.id, 'k1');
  knife.shimmyTo(knife.state.ledge.length);
  knife.keys(42, 1, 0, jump);
  assert.equal(knife.state.ledge?.id, 'k2');
  knife.shimmyTo(3.98);
  knife.keys(42, 1, 0, jump);
  assert.equal(knife.state.ledge?.id, 'k3');
  knife.keys(100, 0, 1);
  assert.deepEqual([...knife.usedLinks], ['knife_leap']);
  assert.equal(knife.state.grounded, true);
  assert.equal(knife.state.y, 64.9);

  const spur = route(48, -342);
  spur.until(60, 0, -1, state => state.z < -344.6);
  spur.walk(45, 0, -1, jump);
  spur.until(20, 0, -1, state => state.z < -349.4);
  spur.walk(38, 0, -1, jump);
  spur.until(20, 0, -1, state => state.z < -354.14);
  spur.walk(9, 0, -1, jump);
  spur.toward(0, -1, { inkStep: true, jumpHeld: true });
  spur.walk(57, 0, -1, { jumpHeld: true });
  assert.deepEqual([...spur.carriers], ['last_0', 'last_1']);
  assert.ok(spur.observed.has('DASH'));
  assert.equal(spur.state.grounded, true);
  assert.equal(spur.state.y, 64.9);
  assert.ok(spur.state.z < -361);
  spur.keys(102, 0, 1);
  spur.until(200, 0, -1, state => state.z < -375);
  spur.walk(105, 0, 0);
  assert.equal(spur.exited, true);
});
