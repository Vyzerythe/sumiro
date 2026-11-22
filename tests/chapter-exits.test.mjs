import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChapterExit } from '../src/application/chapter-exits.mts';

test('the pass exit requires continuous grounded dwell and can be retried after a load failure', () => {
  const exit = createChapterExit('ch2_pass');
  const feet = { x: 47, z: -376, grounded: true };
  assert.equal(exit.update(1, feet, {}), false);
  assert.equal(exit.update(1, { ...feet, grounded: false }, {}), false);
  assert.equal(exit.update(1, feet, {}), false);
  assert.equal(exit.update(0.6, feet, {}), false);
  assert.equal(exit.update(0.01, feet, {}), true);
  assert.equal(exit.update(2, feet, {}), false);
  exit.retry();
  assert.equal(exit.update(1.61, feet, {}), true);
});

test('the Sea and Summit exit gates require their authored completion flags', () => {
  const sea = createChapterExit('ch5_sea');
  const road = { x: 190, z: -600, grounded: true };
  assert.equal(sea.update(2, road, {}), false);
  assert.equal(sea.update(1 / 60, road, { ch5_last_rock: true }), true);

  const summit = createChapterExit('ch6_summit');
  const end = { x: -290, z: -350, grounded: true };
  assert.equal(summit.update(12, end, {}), false);
  assert.equal(summit.finishing, false);
  assert.equal(summit.update(10, end, { ch6_duel: true }), false);
  assert.equal(summit.finishing, true);
  assert.equal(summit.update(1, end, { ch6_duel: true }), false);
  assert.equal(summit.update(1 / 60, end, { ch6_duel: true }), true);
});
