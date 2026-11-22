import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as reference from '../sumiro/bundle/trail-BFIL-IHB.js';
import {
  createMovementTrail, findWalkableSegment, trailCapsule, trailHeightTolerance, trailGroundAt,
} from '../src/player/movement-trail.mts';
import { createCollisionWorld } from '../src/physics/world.mjs';

function worldWithFloor() {
  const world = createCollisionWorld();
  world.addTriangles([-40, 0, -40, -40, 0, 40, 40, 0, -40, 40, 0, 40, 40, 0, -40, -40, 0, 40]);
  return world;
}

test('trail geometry preserves the published ground and segment contract', () => {
  const world = worldWithFloor();
  const from = { x: 0, y: 0, z: 0 };
  const to = { x: 3, y: 0, z: 4 };
  assert.equal(reference.a(world, from, to), 0, 'flat ground admits a five-unit segment');
  assert.deepEqual(trailCapsule, reference.t);
  assert.equal(trailHeightTolerance, reference.n);
  assert.deepEqual(trailGroundAt(world, 0, 0, 0.42, -0.42), reference.i(world, 0, 0, 0.42, -0.42));
  const carrierWorld = { groundAt: () => ({ y: 0, ny: 1, surface: 0, body: {} }) };
  assert.equal(trailGroundAt(carrierWorld, 0, 0, 1, -1), null);
  for (const [end, options] of [
    [to, {}], [to, { maxLen: 4.99 }], [to, { maxLen: 5 }],
    [from, {}], [{ ...to, y: 0.58 }, {}], [{ x: 50, y: 0, z: 50 }, {}],
  ]) {
    assert.equal(findWalkableSegment(world, from, end, options), reference.a(world, from, end, options));
  }
  world.addTriangles([1, -1, -2, 1, 2, -2, 1, -1, 3, 1, 2, -2, 1, 2, 3, 1, -1, 3], { kind: 2 });
  assert.equal(reference.a(world, from, to), null, 'a wall breaks the otherwise walkable segment');
  assert.equal(findWalkableSegment(world, from, to), null);
});

test('trail recording matches the published state machine and absolute indexes', () => {
  const world = worldWithFloor();
  const expected = reference.r();
  const actual = createMovementTrail();
  const point = (x, overrides = {}) => ({ x, y: 0, z: 0, state: 'WALK', grounded: true, onCarrier: false, ...overrides });

  const inputs = [null, point(0), point(0.2), point(0.8), point(0.9, { state: 'LEAP' }), point(0.9),
    point(1, { onCarrier: true }), point(1), point(2, { grounded: false }), point(2)];
  for (const input of inputs) assert.equal(actual.record(world, input), expected.record(world, input));
  assert.deepEqual(actual.points, expected.points);
  assert.equal(actual.nextBreak(0), expected.nextBreak(0));
  assert.ok(actual.at(actual.nextBreak(0)).broken);
  assert.equal(actual.lengthFrom(0), expected.lengthFrom(0));

  actual.restart(point(0));
  expected.restart(point(0));
  for (let index = 1; index <= 605; index++) {
    const input = point(index % 2 ? 1 : 0);
    assert.equal(actual.record(world, input), expected.record(world, input));
  }
  assert.equal(actual.points.length, 600);
  assert.equal(actual.first(), 6);
  assert.equal(actual.end(), expected.end());
  assert.equal(actual.at(5), null);
  assert.deepEqual(actual.last(), expected.last());
  assert.deepEqual(actual.points, expected.points);
  actual.clear();
  expected.clear();
  assert.equal(actual.first(), expected.first());
  assert.equal(actual.end(), expected.end());
  assert.equal(actual.last(), null);
});
