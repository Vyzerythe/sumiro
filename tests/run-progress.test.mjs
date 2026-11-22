import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveChapterOneSpawn } from '../src/application/chapter-one-checkpoints.mts';
import { createRunProgress } from '../src/domain/run-progress.mts';
import { createDefaultRun, legacySaveKey, loadSave, saveKey } from '../src/domain/save.mts';

function storage(entries = []) {
  const values = new Map(entries);
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('resumes a legacy Chapter One checkpoint without writing on load', () => {
  const saved = { ...createDefaultRun(), shrine: 'table', playS: 15, custom: { value: true } };
  const store = storage([[legacySaveKey, JSON.stringify(saved)]]);
  const progress = createRunProgress(store);
  assert.equal(progress.hasSave, true);
  assert.deepEqual(resolveChapterOneSpawn(progress.current), { x: 9.6, z: -41.5, heading: 1 });
  assert.equal(store.getItem(saveKey), null);
  progress.tick(5);
  assert.equal(progress.checkpoint('plateau'), true);
  const resumed = loadSave(store);
  assert.equal(resumed.shrine, 'plateau');
  assert.equal(resumed.playS, 20);
  assert.deepEqual(resumed.custom, { value: true });
});

test('chapter progression waits for activation and preserves the checkpoint on failure', async () => {
  const store = storage();
  const progress = createRunProgress(store);
  assert.equal(progress.checkpoint('table'), true);
  const active = Promise.withResolvers();
  const transition = progress.completeChapter(id => {
    assert.equal(id, 'ch2_pass');
    return active.promise;
  });
  await assert.rejects(progress.completeChapter(async () => {}), /in progress/);
  assert.equal(loadSave(store).shrine, 'table');
  active.reject(Error('Missing chapter assets'));
  await assert.rejects(transition, /Missing chapter assets/);
  assert.equal(progress.current.chapter, 'ch1_climb');
  assert.equal(loadSave(store).shrine, 'table');

  assert.equal(await progress.completeChapter(async () => {}), true);
  const continued = createRunProgress(store).current;
  assert.equal(continued.chapter, 'ch2_pass');
  assert.equal(continued.shrine, null);
  assert.deepEqual(continued.unlocked, ['ch1_climb', 'ch2_pass']);
  assert.deepEqual(continued.abilities, { inkStep: true, sword: true });
  assert.throws(() => resolveChapterOneSpawn(continued), /Chapter One only/);
});

test('storage failure leaves completed in-memory progress available', async () => {
  const progress = createRunProgress({ getItem: () => null, setItem() { throw Error('Quota'); } });
  assert.equal(progress.checkpoint('table'), false);
  assert.equal(progress.current.shrine, 'table');
  assert.equal(progress.hasSave, false);
  assert.equal(await progress.completeChapter(async () => {}), false);
  assert.equal(progress.current.chapter, 'ch2_pass');
});
