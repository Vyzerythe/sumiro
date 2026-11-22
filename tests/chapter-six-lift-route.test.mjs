import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Group } from 'three/webgpu';
import { resolveChapterSpawn } from '../src/application/chapter-checkpoints.mts';
import { createChapterSixIceHolds } from '../src/application/chapter-six-ice-holds.mts';
import { createChapterSixTraversal } from '../src/application/chapter-six-ledges.mts';
import { createChapterSixWorld } from '../src/application/chapter-six-world.mts';
import { mountLateChapterMechanisms } from '../src/application/late-chapter-mechanisms.mts';
import { createLaterChapterCamera } from '../src/application/later-chapter-camera.mts';
import { createRunProgress } from '../src/domain/run-progress.mts';
import { createDefaultRun } from '../src/domain/save.mts';
import { createInputManager } from '../src/input/input-manager.mts';
import { createTraversalController } from '../src/player/traversal-controller.mts';

const glb = await readFile(new URL('../sumiro/assets/player/player.glb', import.meta.url));
const model = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
const durations = new Map(model.animations.map(clip => [
  clip.name, Math.max(...clip.samplers.map(sampler => model.accessors[sampler.input].max[0])),
]));
const delta = 1 / 60;

test('Summit veil_rest crosses the veil, rings the bell from the low lift, and lands on the upper shelf', context => {
  const { id, world, spawn, killY, killDrop } = createChapterSixWorld();
  const save = {
    ...createDefaultRun(), chapter: id, unlocked: ['ch1_climb', id], shrine: 'veil_rest', flags: { ch6_cairn: true },
  };
  const progress = createRunProgress({ getItem: () => JSON.stringify(save) });
  assert.deepEqual(progress.current.flags, { ch6_cairn: true });
  assert.equal(progress.current.abilities.inkStep, true);
  const controller = new AbortController();
  const cleanups = [];
  const lifetime = { signal: controller.signal, defer: cleanup => cleanups.push(cleanup) };
  const cues = [];
  const mechanisms = mountLateChapterMechanisms(id, world, new Group(), lifetime, progress, {
    encounterState() {}, breakSwarm() {},
    onEvent(event) { if (event.type === 'cue') cues.push(event.name); },
  });
  assert.ok(mechanisms);
  const ice = createChapterSixIceHolds(world);
  const player = createTraversalController(world, resolveChapterSpawn(id, spawn, progress.current, world), {
    ...createChapterSixTraversal(world),
    canInkStep: () => progress.current.abilities.inkStep,
    onInkStep: mechanisms.inkStep,
    duration(name) {
      const duration = durations.get(name);
      assert.ok(duration > 0, `Missing actor clip ${name}`);
      return duration;
    },
  });
  const camera = createLaterChapterCamera(world, id);
  const pad = { axes: [0, 0], buttons: [{ pressed: false }, { pressed: false }, { pressed: false }] };
  const input = createInputManager({ getGamepads: () => [pad] });
  context.after(() => {
    input.dispose();
    ice.dispose();
    controller.abort();
    for (const cleanup of cleanups.reverse()) cleanup();
  });
  const state = player.state;
  let view = camera(state, 0, 1);
  let frame = 0;
  const feet = () => `[${state.x.toFixed(3)}, ${state.y.toFixed(3)}, ${state.z.toFixed(3)}]`;
  const veilHit = () => world.raycast(-76, 53.5, -320, 1, 0, 0, 7, 2);
  assert.deepEqual([state.x, state.y, state.z], [-77.4, 52.6, -320]);
  assert.equal(veilHit(), 4);

  function step(strafe = 0, forward = 0, { jump = false, ink = false, strike = false } = {}) {
    pad.axes[0] = strafe;
    pad.axes[1] = -forward;
    pad.buttons[0].pressed = jump;
    pad.buttons[1].pressed = ink;
    pad.buttons[2].pressed = strike;
    const seconds = frame * delta;
    input.beginStep(seconds, delta);
    ice.step(delta, { state: state.state, ledge: state.ledge, teleports: 1 });
    mechanisms.step({ delta, player, attack: input.attack, interact: input.interact, seconds, cameraZ: view.z });
    player.step(delta, input, view);
    input.endStep();
    view = camera(state, delta, 1);
    frame++;
    assert.ok(state.y >= killY && state.lastGroundY - state.y <= killDrop, `Fell at ${feet()}`);
  }
  function aim(x, z, options = {}) {
    const dx = x - state.x, dz = z - state.z;
    const scale = (options.magnitude ?? 1) / (Math.hypot(dx, dz) || 1);
    const yaw = state.holdActive ? state.holdYaw : view.railYaw * Math.PI / 180;
    step((Math.cos(yaw) * dx - Math.sin(yaw) * dz) * scale,
      (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) * scale, options);
  }
  function walkTo(x, z, radius, magnitude = 1) {
    for (let i = 0; i < 330 && Math.hypot(x - state.x, z - state.z) > radius; i++) aim(x, z, { magnitude });
    assert.ok(Math.hypot(x - state.x, z - state.z) <= radius, `Missed [${x}, ${z}] at ${feet()}`);
  }
  function holdToward(x, z, frames, options) {
    for (let i = 0; i < frames; i++) aim(x, z, options);
  }
  function wait(frames) { for (let i = 0; i < frames; i++) step(); }

  // The saved stand is west of the veil. Cross east first to replay the forward crossing afterward.
  holdToward(-68, -320, 91);
  assert.ok(state.x < -72 && state.x > -72.4);
  aim(-67, -320, { ink: true });
  assert.equal(state.state, 'DODGE');
  assert.equal(veilHit(), Infinity);
  wait(50);
  assert.ok(state.x > -70 && state.grounded);
  assert.equal(veilHit(), 4);
  walkTo(-70, -320, 0.3, 0.4);
  wait(85);
  holdToward(-77, -320, 37);
  assert.ok(state.x > -72 && state.x < -71.6);
  aim(-78, -320, { ink: true });
  assert.equal(state.state, 'DODGE');
  wait(40);
  assert.ok(state.x < -74 && state.grounded);
  assert.equal(veilHit(), 4);

  const lift = world.body('lift_a');
  const counterweight = world.body('lift_b');
  assert.deepEqual([lift.y, counterweight.y], [52.6, 70]);
  walkTo(-84.5, -330.5, 0.24);
  holdToward(-84.5, -333, 38, { jump: true });
  wait(9);
  assert.equal(state.carrier, lift);
  walkTo(-86.03, -332.67, 0.16, 0.36);
  wait(10);
  assert.equal(state.carrier, lift);
  step(0, 0, { strike: true });
  for (let frame = 0; frame < 384; frame++) {
    step();
    assert.ok(state.grounded && state.carrier === lift, feet());
  }
  assert.deepEqual(cues.filter(cue => ['bell', 'liftStart', 'liftStop'].includes(cue)), ['bell', 'liftStart', 'liftStop']);
  assert.deepEqual([state.y, lift.y, counterweight.y], [70, 70, 52.6]);

  walkTo(-84.7, -334.3, 0.13, 0.55);
  holdToward(-84.7, -337.4, 40, { jump: true });
  assert.ok(state.grounded && state.carrier === null && state.z < -335 && state.y === 70, feet());
  walkTo(-96, -347, 0.6);
  assert.ok(state.grounded && state.y === 70, feet());
  assert.equal(progress.current.flags.ch6_gauntlet, undefined);
  assert.equal(progress.current.flags.ch6_duel, undefined);
});
