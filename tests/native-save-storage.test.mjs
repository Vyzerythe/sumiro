import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNativeSaveStorage, nativeSaveKey } from '../src/domain/native-save-storage.mts';
import { createRunProgress } from '../src/domain/run-progress.mts';
import { createDefaultRun, legacySaveKey, saveKey } from '../src/domain/save.mts';

test('native sessions can resume a shipped save and write only in their own slot', () => {
  const shipped = JSON.stringify({ ...createDefaultRun(), shrine: 'table' });
  const legacy = JSON.stringify({ ...createDefaultRun(), shrine: 'plateau' });
  const data = new Map([[saveKey, shipped], [legacySaveKey, legacy]]);
  const storage = createNativeSaveStorage(() => ({
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
  }));
  const progress = createRunProgress(storage);
  assert.equal(progress.current.shrine, 'table');
  assert.equal(data.has(nativeSaveKey), false);
  assert.equal(progress.checkpoint('plateau'), true);
  assert.equal(data.get(saveKey), shipped);
  assert.equal(data.get(legacySaveKey), legacy);
  assert.equal(JSON.parse(data.get(nativeSaveKey)).shrine, 'plateau');
  assert.equal(createRunProgress(storage).current.shrine, 'plateau');
});

test('storage unavailable during launch keeps native progress usable in memory', () => {
  const storage = createNativeSaveStorage(() => { throw Error('Storage unavailable'); });
  const progress = createRunProgress(storage);
  assert.equal(progress.hasSave, false);
  assert.equal(progress.save(), false);
  assert.equal(progress.checkpoint('table'), false);
  assert.equal(progress.current.shrine, 'table');
});
