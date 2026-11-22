import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { FixedStepClock, SimulationTimeReader } from '../src/runtime/fixed-step-clock.mts';
import { RuntimeRegistry } from '../src/runtime/registry.mts';

const original = await readFile(new URL('../sumiro/bundle/index-DnHRwVtn.js', import.meta.url), 'utf8');
const start = original.indexOf('mg=class{constructor(e){this.hz');
const end = original.indexOf(',_g=', start);
assert.ok(start >= 0 && end > start);
const legacy = Function('pg', 'var ' + original.slice(start, end) + ';return {mg,hg,gg};')({ videoFps: 24 });

test('fixed-step timing follows the published clock without accumulated drift', () => {
  for (const rate of [30, 60, 120, 144]) {
    const reference = new legacy.mg(rate);
    const candidate = new FixedStepClock(rate, 24);
    const readers = [new legacy.hg(reference), new SimulationTimeReader(candidate)];
    for (let step = 1; step <= 12_000; step++) {
      reference._advance();
      candidate.advance();
      assert.equal(candidate.now(), reference.now());
      assert.equal(candidate.frame, reference.frame);
      assert.equal(candidate.dt, reference.dt);
      if (step % 7 === 0) assert.equal(readers[1].getDelta(), readers[0].getDelta());
    }
    assert.equal(candidate.t, 12_000 * candidate.fixedDt);
    assert.equal(readers[1].elapsedTime, readers[0].getElapsedTime());
  }
  for (const invalid of [0, -1, NaN, Infinity]) {
    assert.throws(() => new FixedStepClock(invalid, 24), /positive.*finite/);
  }
});

test('registry preserves optional defaults, replay, and listener snapshot semantics', () => {
  function exercise(registry) {
    const events = [];
    assert.equal(registry.get('missing', 'fallback'), 'fallback');
    registry.set('existing', undefined);
    assert.equal(registry.get('existing', 'fallback'), undefined);
    const later = value => events.push(['later', value]);
    let removeLater;
    registry.on('key', value => {
      events.push(['first', value]);
      removeLater();
    });
    removeLater = registry.on('key', later);
    registry.set('key', 1);
    registry.set('key', 2);
    const removeReplay = registry.on('key', value => events.push(['replay', value]));
    removeReplay();
    registry.delete('key');
    assert.equal(registry.has('key'), false);
    return { keys: registry.keys(), events };
  }
  assert.deepEqual(exercise(new RuntimeRegistry()), exercise(new legacy.gg()));
});

test('a throwing replay is rolled back and later listener failures stay isolated', () => {
  const errors = [];
  const registry = new RuntimeRegistry({ error: (...args) => errors.push(args) });
  registry.set('key', 1);
  const failing = () => { throw Error('failed replay'); };
  assert.throws(() => registry.on('key', failing), /failed replay/);
  assert.equal(registry.set('key', 2), 2);
  assert.equal(errors.length, 0);
  registry.on('future', failing);
  const seen = [];
  registry.on('future', value => seen.push(value));
  registry.set('future', 3);
  assert.deepEqual(seen, [3]);
  assert.equal(errors.length, 1);
});
