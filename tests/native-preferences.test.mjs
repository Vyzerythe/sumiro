import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createNativePreferencesStorage, nativePreferencesKey, normalizeNativePreferences,
} from '../src/domain/native-preferences.mts';
import { createRunProgress } from '../src/domain/run-progress.mts';
import { createDefaultRun, saveKey } from '../src/domain/save.mts';

test('native options inherit legacy choices, normalize overrides and use dedicated storage', () => {
  const settings = normalizeNativePreferences({ music: 3, sensitivity: -1, effects: NaN, invertY: true },
    { music: .2, effects: .4, ambience: .6, voice: -1, assist: true });
  assert.deepEqual(settings, { master: 1, music: 1, ambience: .6, effects: .4, voice: 0, sensitivity: .2,
    shake: 1, invertY: true, assist: true });
  const values = new Map([[saveKey, 'original']]);
  const access = () => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });
  createNativePreferencesStorage(access).write(settings);
  assert.deepEqual(createNativePreferencesStorage(access).read(), settings);
  assert.deepEqual([...values.keys()], [saveKey, nativePreferencesKey]);
  assert.equal(values.get(saveKey), 'original');
  const volatile = createNativePreferencesStorage(() => { throw Error('Denied'); });
  assert.equal(volatile.read().music, .8);
  volatile.write(settings);
  assert.deepEqual(volatile.read(), settings);
});

test('unlocked chapter replay changes memory and saves only after the caller confirms activation', () => {
  const writes = [];
  const loaded = { ...createDefaultRun(), chapter: 'ch3_pines', shrine: 'pines_2',
    unlocked: ['ch1_climb', 'ch2_pass', 'ch3_pines'], flags: { ch2_sword_wraith: true, ch3_pines_first: true, cat_found: true },
    scrolls: ['first_mist'] };
  const run = createRunProgress({ getItem: () => JSON.stringify(loaded), setItem: (_key, value) => writes.push(JSON.parse(value)) });
  assert.equal(run.selectUnlockedChapter('ch4_temple'), false);
  assert.equal(run.current.chapter, 'ch3_pines');
  assert.equal(run.selectUnlockedChapter('ch2_pass'), true);
  assert.equal(run.current.shrine, null);
  assert.deepEqual(run.current.flags, { ch3_pines_first: true, cat_found: true });
  assert.deepEqual(run.current.scrolls, ['first_mist']);
  run.setOptions({ master: .5 }, false);
  assert.deepEqual(writes, []);
  assert.equal(run.save(), true);
  assert.equal(writes[0].chapter, 'ch2_pass');
  assert.equal(writes[0].options.master, .5);
});
