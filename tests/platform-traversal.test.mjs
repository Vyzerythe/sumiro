import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCollisionWorld } from '../src/physics/world.mts';
import { createTraversalController } from '../src/player/traversal-controller.mts';

test('fixed-step traversal rides a moving body and inherits its velocity on takeoff', () => {
  const world = createCollisionWorld();
  const motion = world.addBody('platform', [{ positions: [
    -1, 0, -1, 1, 0, 1, 1, 0, -1,
    -1, 0, -1, -1, 0, 1, 1, 0, 1,
  ] }]);
  const player = createTraversalController(world, { x: 0, z: 0, heading: 0 });
  const input = { forward: 0, strafe: 0, walk: false, sprint: false, jump: false, jumpHeld: false, inkStep: false };
  const delta = 1 / 60;
  motion.setPose(0.1, 0.08, -0.2, 0.05, 0, 0, delta);
  player.step(delta, input, null);
  assert.equal(player.state.grounded, true);
  assert.strictEqual(player.state.carrier, motion);
  for (const [actual, expect] of [[player.state.x, 0.1], [player.state.y, 0.08], [player.state.z, -0.2], [player.state.heading, 0.05]]) {
    assert.ok(Math.abs(actual - expect) < 1e-10);
  }
  motion.setPose(0.2, 0.08, -0.2, 0.05, 0, 0, delta);
  player.step(delta, { ...input, jump: true, jumpHeld: true }, null);
  assert.equal(player.state.state, 'JUMP');
  assert.equal(player.state.carrier, null);
  assert.ok(player.state.x > 0.25 && player.state.vx > 5);
});
