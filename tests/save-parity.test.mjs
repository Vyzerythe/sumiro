import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { findChapter, firstChapterId } from "../src/domain/chapters.mts";
import {
  saveKey, legacySaveKey, legacyChapterAliases, defaultOptions,
  migrateOptions, createDefaultRun, isSupportedSave,
  normalizeSaveChapters, loadSave, writeSave,
} from "../src/domain/save.mts";

/**
 * Extract only the self-contained save-function prelude from the immutable
 * published module. Do not import the whole game: it initializes browser-heavy
 * modules. This dynamic reference tests the original shipped function bodies,
 * rather than a second manually transcribed implementation.
 *
 * If the published bundle changes shape, fail explicitly and re-audit.
 */
const published = await readFile(new URL("../sumiro/bundle/game-B5zfa1fm.js", import.meta.url), "utf8");
const match = published.match(/var u=`sumiro\.save\.v1`[\s\S]*?(?=var v=`game`)/);
assert.ok(match, "cannot identify original save prelude: review the published bundle");

function makeStorage(values = {}, options = {}) {
  const map = new Map(Object.entries(values));
  return {
    calls: [],
    getItem(key) {
      this.calls.push(["getItem", key]);
      if (options.failRead) throw Error("read denied");
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      this.calls.push(["setItem", key, value]);
      if (options.failWrite) throw Error("write denied");
      map.set(key, value);
    },
    snapshot: () => Object.fromEntries(map),
  };
}

function reference(storage) {
  return runInNewContext(match[0] + "\n({ u, ee, d, f, p, m, te, h, g, _ })", {
    localStorage: storage,
    t: findChapter,
    r: firstChapterId,
  });
}

const plain = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

test("save keys, aliases, and options match the shipped prelude", () => {
  const oracle = reference(makeStorage());
  assert.equal(saveKey, oracle.u);
  assert.equal(legacySaveKey, oracle.ee);
  assert.deepEqual(legacyChapterAliases, plain(oracle.d));
  assert.deepEqual(defaultOptions, plain(oracle.f));
});

test("defaults, permissive validation, and options migration match original", () => {
  const oracle = reference(makeStorage());
  const optionCases = [
    undefined, null, {}, { vol: 1 }, { vol: 2 },
    { vol: 0, music: 1 }, { vol: 0, music: 0.2 },
    { vol: -1, sensitivity: 3, assist: true },
  ];
  for (const options of optionCases) {
    assert.deepEqual(plain(migrateOptions(options)), plain(oracle.p(options)));
    assert.deepEqual(plain(createDefaultRun(options)), plain(oracle.m(options)));
  }
  const saves = [
    null, undefined, false, {}, { v: 2 }, { v: 1, chapter: 2 },
    { v: 1, chapter: "ch1_climb", unlocked: [], scrolls: [], abilities: {}, flags: {} },
    { v: 1, chapter: "ch1_climb", unlocked: [], scrolls: [], abilities: null, flags: {} },
  ];
  for (const save of saves) {
    assert.deepEqual(plain(isSupportedSave(save)), plain(oracle.te(save)));
  }
});

test("chapter aliases, unlock ordering, fallbacks, and shrine migration match", () => {
  const oracle = reference(makeStorage());
  const saves = [
    { chapter: "ch1_climb", unlocked: ["ch1_climb"], shrine: "a" },
    { chapter: "ch2_stub", unlocked: ["ch2_stub", "ch1_climb", "ch2_stub"], shrine: "b" },
    { chapter: "ch6_summit", unlocked: ["bogus", "ch2_pass"], shrine: "c" },
    { chapter: "unknown", unlocked: ["bogus"], shrine: null },
    { chapter: "ch3_pines", unlocked: [], shrine: "d", flags: { keep: true } },
  ];
  for (const input of saves) {
    assert.deepEqual(
      plain(normalizeSaveChapters(input)),
      plain(oracle.h(input)),
    );
  }
});

test("stored save loading matches current-key priority and legacy fallback", () => {
  const valid = {
    v: 1, started: true, chapter: "ch2_stub", shrine: "s",
    unlocked: ["ch2_stub"], abilities: {}, scrolls: [],
    flags: {}, options: { vol: 1, music: 1 }, playS: 60,
  };
  const current = JSON.stringify({ ...valid, chapter: "ch3_pines" });
  const legacy = JSON.stringify(valid);
  for (const values of [
    {},
    { [legacySaveKey]: legacy },
    { [saveKey]: current },
    { [saveKey]: current, [legacySaveKey]: legacy },
    { [saveKey]: "invalid-json", [legacySaveKey]: legacy },
    { [saveKey]: JSON.stringify({ v: 99 }), [legacySaveKey]: legacy },
    { [saveKey]: "null" },
  ]) {
    const actualStorage = makeStorage(values);
    const originalStorage = makeStorage(values);
    const actual = loadSave(actualStorage);
    const expected = reference(originalStorage).g();
    assert.deepEqual(plain(actual), plain(expected));
    assert.deepEqual(actualStorage.calls, originalStorage.calls);
  }
  for (const options of [{ failRead: true }, { failWrite: true }]) {
    const a = makeStorage({}, options);
    const b = makeStorage({}, options);
    assert.deepEqual(plain(loadSave(a)), plain(reference(b).g()));
  }
});

test("save writes preserve bytes, key, and failure handling", () => {
  for (const value of [
    { v: 1, chapter: "ch1_climb" },
    { flags: { a: true }, scrolls: ["x"] },
    { nested: [1, 2, 3] },
    { invalidNumber: Number.NaN },
  ]) {
    const a = makeStorage();
    const b = makeStorage();
    assert.equal(writeSave(value, a), reference(b)._(value));
    assert.deepEqual(a.snapshot(), b.snapshot());
    assert.deepEqual(a.calls, b.calls);
  }
  const a = makeStorage({}, { failWrite: true });
  const b = makeStorage({}, { failWrite: true });
  assert.equal(writeSave({ v: 1 }, a), reference(b)._({ v: 1 }));
});

test("permissive stored fields and inherited alias lookups retain round-trip bytes", () => {
  const serialized = JSON.stringify({
    v: 1, chapter: "unknown", shrine: "old", flags: "legacy", abilities: ["legacy"],
    unlocked: ["constructor", ["ch2_stub"], ["ch3_pines"]], scrolls: [9, null],
    options: { vol: "2", music: null, extra: 20 }, futureField: { keep: true },
  });
  const actualStorage = makeStorage({ [legacySaveKey]: serialized });
  const originalStorage = makeStorage({ [legacySaveKey]: serialized });
  const oracle = reference(originalStorage);
  const actual = loadSave(actualStorage);
  const expected = oracle.g();
  assert.ok(actual);
  assert.equal(actual.chapter, "ch2_pass");
  assert.deepEqual(actual.unlocked, ["ch1_climb", "ch2_pass"]);
  assert.equal(actual.shrine, null);
  assert.equal(writeSave(actual, actualStorage), oracle._(expected));
  assert.deepEqual(actualStorage.calls, originalStorage.calls);
  assert.deepEqual(actualStorage.snapshot(), originalStorage.snapshot());
});

test("blocked browser storage fails without throwing from the localStorage getter", context => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() { throw new DOMException("Storage denied", "SecurityError"); },
  });
  context.after(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  });
  assert.equal(loadSave(), null);
  assert.equal(writeSave({ v: 1 }), false);
});
