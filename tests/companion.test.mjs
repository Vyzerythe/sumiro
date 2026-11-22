import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCompanion } from '../src/domain/companion.mts';
import { createCollisionWorld } from '../src/physics/world.mts';

function ground(world, near, far, y = 8.316) {
  world.addTriangles([0,y,near, 20,y,near, 20,y,far, 0,y,near, 20,y,far, 0,y,far]);
}

test('the cat uses the authored pickup position and obeys grounded carry and set-down controls', () => {
  const world = createCollisionWorld();
  ground(world, -50, -62);
  const events = [];
  const cat = createCompanion(world, false, event => events.push(event));
  const player = { x: 6.3, y: 8.316, z: -58.1, heading: 0, grounded: true, state: 'IDLE', onCarrier: false, speed: 0 };
  assert.deepEqual([cat.state.x, cat.state.y, cat.state.z], [6.14, 8.316, -58.07]);
  cat.update(1 / 60, { ...player, grounded: false }, true);
  assert.equal(cat.state.phase, 'STRAY');
  cat.update(1 / 60, player, true);
  assert.equal(cat.state.phase, 'CARRIED');
  assert.deepEqual(events, [{ type: 'found' }]);
  cat.update(1 / 60, { ...player, onCarrier: true }, true);
  assert.equal(cat.state.phase, 'CARRIED');
  cat.update(1 / 60, player, true);
  assert.equal(cat.state.phase, 'IDLE');
  assert.ok(Math.abs(cat.state.z - (player.z + 0.65)) < 1e-10);
  cat.update(1 / 60, player, true);
  assert.equal(cat.state.phase, 'CARRIED');
  assert.equal(events.length, 1);
});

test('the cat follows recorded ground and waits at a real gap', () => {
  const world = createCollisionWorld();
  ground(world, -50, -62);
  ground(world, -65, -74);
  const events = [];
  const cat = createCompanion(world, true, event => events.push(event));
  const player = { x: 6, y: 8.316, z: -56, heading: 0, grounded: true, state: 'IDLE', onCarrier: false, speed: 0 };
  cat.reset(player);
  cat.update(1 / 60, player, true);
  for (let index = 1; index < 121; index++) cat.update(1 / 60, { ...player, z: -56 - index * 0.04, state: 'RUN', speed: 2.4 }, false);
  assert.ok(cat.state.z < -58);
  cat.update(1 / 60, { ...player, z: -63, state: 'LEAP', grounded: false, speed: 5 }, false);
  for (let index = 0; index < 280; index++) cat.update(1 / 60, { ...player, z: -67 }, false);
  assert.equal(cat.state.phase, 'WAIT_GAP');
  assert.ok(cat.state.z > -62);
  assert.deepEqual(events, [{ type: 'gap' }]);
});
