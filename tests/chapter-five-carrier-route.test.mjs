import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { getChapterCheckpoints } from '../src/application/chapter-checkpoints.mts';
import { createChapterFiveTraversal } from '../src/application/chapter-five-ledges.mts';
import { createChapterFiveMechanisms } from '../src/application/chapter-five-mechanisms.mts';
import { createChapterFiveWorld } from '../src/application/chapter-five-world.mts';
import { createLaterChapterCamera } from '../src/application/later-chapter-camera.mts';
import { createInputManager } from '../src/input/input-manager.mts';
import { createTraversalController } from '../src/player/traversal-controller.mts';

const DELTA = 1 / 60;
const HANG_STATES = new Set(['GRAB', 'HANG', 'CLIMB']);
const STONES = [
  // Takeoff Z, target X/Z, expected surface height.
  [-138.25, 32.6, -142.6, 2.5], [-143.85, 33.8, -148, 2.8], [-149, 33, -153.2, 3.1],
  [-154.45, 33.6, -160, 3.6],
  [-162.5, 35.6, -166, 2.3], [-167.15, 34.6, -170.6, 1.7], [-171.7, 35.8, -175.2, 1.3],
  [-176.42, 34.6, -179.8, 1.7], [-180.85, 35.4, -184.4, 2.6], [-185.5, 34.5, -189, 3.6],
];

async function playerClipDurations() {
  const glb = await readFile(new URL('../sumiro/assets/player/player.glb', import.meta.url));
  const rig = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
  const durations = new Map(rig.animations.map(({ name, samplers }) => [name,
    Math.max(...samplers.map(sampler => rig.accessors[sampler.input].max[0])),
  ]));
  return clip => {
    const seconds = durations.get(clip);
    assert.ok(seconds > 0, `Missing player clip duration for ${clip}`);
    return seconds;
  };
}

test('sampled Sea input reaches and dismounts the moving raft from the first_rock checkpoint', async () => {
  const duration = await playerClipDurations();
  const { world } = createChapterFiveWorld();
  const checkpoints = getChapterCheckpoints('ch5_sea');
  const firstRock = checkpoints.find(checkpoint => checkpoint.id === 'first_rock');
  const raftTop = checkpoints.find(checkpoint => checkpoint.id === 'raft_top');
  let fellInSea = false;
  const mechanisms = createChapterFiveMechanisms(world, { onFallOut() { fellInSea = true; } });
  const raft = world.body('raft');
  assert.ok(raft);
  const player = createTraversalController(world, firstRock.stand, { ...createChapterFiveTraversal(), duration });
  const { state } = player;
  const pad = { axes: [0, 0], buttons: [{ pressed: false }] };
  const input = createInputManager({ getGamepads: () => [pad] });
  const updateView = createLaterChapterCamera(world, 'ch5_sea');
  let view = updateView(state, 0, 0);
  let steps = 0;
  const snapshot = () => JSON.stringify({ step: steps, feet: [state.x, state.y, state.z], state: state.state,
    ledge: state.ledge?.id, carrier: state.carrier?.id, tide: mechanisms.tide.y, camera: view.zone });

  function step(strafe = 0, forward = 0, jump = false) {
    pad.axes[0] = strafe;
    pad.axes[1] = -forward;
    pad.buttons[0].pressed = jump;
    steps++;
    mechanisms.step(DELTA, { player: state, playing: true });
    assert.equal(fellInSea, false, snapshot());
    input.beginStep(steps * DELTA, DELTA);
    player.step(DELTA, input, view);
    input.endStep();
    view = updateView(state, DELTA, 0);
  }

  function aim(x, z, gain = 1, jump = false) {
    const dx = x - state.x, dz = z - state.z;
    const distance = Math.hypot(dx, dz) || 1;
    const yaw = view.railYaw * Math.PI / 180;
    step((Math.cos(yaw) * dx - Math.sin(yaw) * dz) * gain / distance,
      (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) * gain / distance, jump);
  }

  function approach(x, z, radius) {
    for (let frame = 0; frame < 400; frame++) {
      const distance = Math.hypot(x - state.x, z - state.z);
      if (distance <= radius) return;
      aim(x, z, distance > radius + 1 ? 1 : distance > radius + .3 ? .67 : .33);
    }
    assert.fail(`Could not approach (${x}, ${z}): ${snapshot()}`);
  }

  function jumpAcross(launchZ, x, z) {
    if (pad.buttons[0].pressed) aim(x, z);
    for (let frame = 0; frame < 220 && state.z > launchZ; frame++) aim(x, z);
    assert.ok(state.grounded && state.z <= launchZ + .01, snapshot());
    const takeoff = { y: state.y, carrier: state.carrier };
    aim(x, z, 1, true);
    assert.equal(state.state, 'JUMP', snapshot());
    assert.equal(state.carrier, null);
    const ledges = new Set();
    const states = new Set();
    for (let frame = 0; frame < 140 && !state.grounded; frame++) {
      states.add(state.state);
      if (state.ledge) ledges.add(state.ledge.id);
      if (HANG_STATES.has(state.state)) step(0, 1);
      else aim(x, z, 1, true);
    }
    assert.ok(state.grounded && Math.hypot(state.x - x, state.z - z) < 2.7, snapshot());
    return { takeoff, ledges, states };
  }

  try {
    assert.deepEqual([state.x, state.y, state.z], [27.4, 3.6, -130.1]);
    approach(32.6, -134.3, .4);
    for (const [index, [launchZ, x, z, y]] of STONES.entries()) {
      jumpAcross(launchZ, x, z);
      assert.ok(Math.abs(state.y - y) < 1e-10, snapshot());
      if (index === 3) for (let frame = 0; frame < 12; frame++) step();
    }

    approach(34, -205.8, .45);
    for (let frame = 0; frame < 22; frame++) step();
    assert.equal(mechanisms.tide.phase, 'high');
    jumpAcross(-206.4, 34.8, -212);
    assert.equal(state.carrier, raft);
    assert.equal(state.y, raft.y);
    assert.equal(view.zone, 'on_raft');
    for (let frame = 0; frame < 24; frame++) step();
    assert.ok(Math.hypot(state.vx, state.vz) < .003, snapshot());
    const passiveRideStart = { player: state.x, carrier: raft.x };
    for (let frame = 0; frame < 48; frame++) step();
    const travelledX = raft.x - passiveRideStart.carrier;
    assert.equal(state.carrier, raft);
    // Allow the small residual slide after release while requiring the full
    // carrier displacement at the millimeter scale.
    assert.ok(travelledX > .15 && Math.abs(state.x - passiveRideStart.player - travelledX) < .001, snapshot());
    assert.equal(state.y, raft.y);

    const crossing = jumpAcross(-214.3, 34.8, -219);
    assert.equal(crossing.takeoff.carrier, raft);
    assert.ok(crossing.takeoff.y < 3.2, 'the jumping player must descend with the falling tide before takeoff');
    assert.deepEqual([...crossing.ledges], ['l_r3_s']);
    for (const phase of ['GRAB', 'CLIMB']) assert.ok(crossing.states.has(phase), snapshot());
    assert.equal(state.carrier, null);
    assert.ok(Math.abs(state.y - 6.2) < 1e-10, snapshot());

    approach(raftTop.stand.x, raftTop.stand.z, .35);
    assert.equal(state.grounded, true);
    assert.equal(view.zone, 'r3');
    assert.ok(Math.abs(state.y - 6.2) < 1e-10 && steps < 1320, snapshot());
  } finally {
    input.dispose();
    mechanisms.dispose();
  }
});
