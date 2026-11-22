import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRunVitals } from '../src/domain/run-vitals.mts';

test('capacity grows every third scroll and the shrine refills both resources', () => {
  const vitals = createRunVitals();
  vitals.hurt(2);
  vitals.updateCapacity(2, false);
  assert.deepEqual(vitals.snapshot(), { strokes: 3, maxStrokes: 5, drinks: 3, maxDrinks: 3 });
  vitals.updateCapacity(3, false);
  assert.deepEqual(vitals.snapshot(), { strokes: 4, maxStrokes: 6, drinks: 3, maxDrinks: 3 });
  assert.equal(vitals.beginDrink(1.8), true);
  vitals.refill(3, true);
  assert.deepEqual(vitals.snapshot(), { strokes: 8, maxStrokes: 8, drinks: 3, maxDrinks: 3 });
  assert.equal(vitals.drinking, null);
});

test('a drink heals once at the authored cue, and damage cancels without refunding the gourd', () => {
  const vitals = createRunVitals();
  assert.equal(vitals.beginDrink(1.8), false);
  vitals.hurt(3);
  assert.equal(vitals.beginDrink(1.8), true);
  assert.equal(vitals.beginDrink(1.8), false);
  vitals.step(1);
  assert.equal(vitals.strokes, 2);
  vitals.step(0.125);
  assert.equal(vitals.strokes, 4);
  vitals.step(1);
  assert.equal(vitals.drinking, null);
  assert.equal(vitals.strokes, 4);
  assert.equal(vitals.beginDrink(1.8), true);
  vitals.hurt(1);
  vitals.step(2);
  assert.equal(vitals.strokes, 3);
  assert.equal(vitals.snapshot().drinks, 1);
});
