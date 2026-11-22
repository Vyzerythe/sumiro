import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createChapterSixIceHolds } from '../src/application/chapter-six-ice-holds.mts';
import { createChapterSixTraversal } from '../src/application/chapter-six-ledges.mts';
import { createChapterSixMechanisms } from '../src/application/chapter-six-mechanisms.mts';
import { createChapterSixWorld } from '../src/application/chapter-six-world.mts';
import { createLaterChapterCamera } from '../src/application/later-chapter-camera.mts';
import { createInputManager } from '../src/input/input-manager.mts';
import { createTraversalController } from '../src/player/traversal-controller.mts';

const glb = await readFile(new URL('../sumiro/assets/player/player.glb', import.meta.url));
const model = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
const durations = new Map(model.animations.map(clip => [
  clip.name, Math.max(...clip.samplers.map(sampler => model.accessors[sampler.input].max[0])),
]));
const delta = 1 / 60;

test('Summit normal spawn reaches the spine through the wind terrace, ice holds, and cornice', context => {
  const { id, world, spawn, killY, killDrop } = createChapterSixWorld();
  const mechanisms = createChapterSixMechanisms(world);
  const ice = createChapterSixIceHolds(world);
  const player = createTraversalController(world, spawn, {
    ...createChapterSixTraversal(world),
    canInkStep: () => true,
    onInkStep: mechanisms.inkStep,
    duration(name) {
      const duration = durations.get(name);
      assert.ok(duration > 0, `Missing actor clip ${name}`);
      return duration;
    },
  });
  const camera = createLaterChapterCamera(world, id);
  const pad = { axes: [0, 0], buttons: [{ pressed: false }] };
  const input = createInputManager({ getGamepads: () => [pad] });
  context.after(() => { input.dispose(); ice.dispose(); mechanisms.dispose(); });
  const state = player.state;
  let view = camera(state, 0, 1);
  let frame = 0;
  let gustPushedPlayer = false;
  const ledges = new Set();
  const carriers = new Set();
  const links = new Set();
  const feet = () => `[${state.x.toFixed(3)}, ${state.y.toFixed(3)}, ${state.z.toFixed(3)}]`;
  const nearHeight = height => assert.ok(Math.abs(state.y - height) < 1e-8, feet());
  assert.deepEqual([state.x, state.y, state.z], [29, 10, -50]);

  function step(strafe = 0, forward = 0, jump = false) {
    pad.axes[0] = strafe;
    pad.axes[1] = -forward;
    pad.buttons[0].pressed = jump;
    input.beginStep(frame * delta, delta);
    ice.step(delta, { state: state.state, ledge: state.ledge, teleports: 1 });
    player.setDrift(mechanisms.step(delta, state));
    gustPushedPlayer ||= mechanisms.get('w1').pushing && state.drift.x < 0;
    player.step(delta, input, view);
    input.endStep();
    view = camera(state, delta, 1);
    frame++;
    assert.ok(state.y >= killY && state.lastGroundY - state.y <= killDrop, `Fell at ${feet()}`);
    if (state.ledge) ledges.add(state.ledge.id);
    if (state.grounded && state.carrier) carriers.add(state.carrier.id);
    if (state.leap?.link.id) links.add(state.leap.link.id);
  }

  function aim(x, z, jump = false) {
    const dx = x - state.x, dz = z - state.z;
    const length = Math.hypot(dx, dz) || 1;
    // Convert the desired world direction into stick axes for the active authored camera.
    const yaw = state.holdActive ? state.holdYaw : view.railYaw * Math.PI / 180;
    step((Math.cos(yaw) * dx - Math.sin(yaw) * dz) / length,
      (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / length, jump);
  }
  function advanceTo(x, z, limit = 420) {
    for (let index = 0; index < limit && state.z > z; index++) aim(x, Math.min(z - 0.5, state.z - 1.4));
    assert.ok(state.z <= z, `Missed z=${z} at ${feet()}`);
  }
  function jumpToward(x, z, count) {
    for (let index = 0; index < count; index++) aim(x, z, true);
  }
  function hold(count, strafe = 0, forward = 0, jump = false) {
    for (let index = 0; index < count; index++) step(strafe, forward, jump);
  }

  advanceTo(30, -91.58);
  jumpToward(30, -96, 40);
  assert.ok(state.grounded && state.z < -92, feet());
  nearHeight(17.2);
  advanceTo(30, -103.45);
  jumpToward(30, -108.8, 39);
  assert.ok(state.grounded && state.z < -106.6, feet());
  advanceTo(29.5, -134.88);
  assert.ok(gustPushedPlayer);
  jumpToward(29.5, -137, 29);
  assert.equal(state.ledge?.id, 'ice_a1');
  assert.equal(state.carrier, world.body('body_ice_a1'));
  assert.equal(ice.holds.find(hold => hold.id === 'ice_a1').phase, 'holding');
  hold(90, 0, 1);
  assert.ok(state.grounded && state.z < -136, feet());
  nearHeight(20.6);

  advanceTo(30, -144.94);
  jumpToward(30, -147, 29);
  hold(5);
  assert.equal(state.ledge?.id, 'ice_a3');
  assert.equal(state.carrier, world.body('body_ice_a3'));
  hold(46, 1, 0, true);
  assert.equal(state.ledge?.id, 'rock_a4');
  hold(90, 0, 1);
  assert.ok(state.grounded && state.z < -146, feet());
  nearHeight(24);

  for (const [index, [approachX, approachZ, landingX, landingZ]] of [
    [30, -159.58, 30, -164],
    [30.7, -164.7, 31.2, -168.5],
    [30.7, -169.3, 30, -173.2],
    [30.4, -173.9, 31.2, -177.8],
  ].entries()) {
    advanceTo(approachX, approachZ, index === 0 ? 420 : 27);
    if (index > 0) assert.equal(state.carrier?.id, 'corn_' + (index - 1), feet());
    jumpToward(landingX, landingZ, 38);
  }
  advanceTo(30.8, -178.5, 27);
  assert.equal(state.carrier?.id, 'corn_3', feet());
  assert.deepEqual([...carriers], ['corn_0', 'corn_1', 'corn_2', 'corn_3']);
  jumpToward(31, -183, 38);
  advanceTo(31, -182.3, 5);
  assert.ok(state.grounded && state.z < -180.4 && !state.carrier, feet());
  advanceTo(31, -191.45);
  jumpToward(31, -201, 55);
  assert.deepEqual([...links], ['cornice_up']);
  assert.deepEqual([...ledges], ['ice_a1', 'ice_a3', 'rock_a4', 'a3_lip']);
  hold(100, 0, 1);
  assert.ok(state.grounded && state.z < -200, feet());
  nearHeight(28);
});
