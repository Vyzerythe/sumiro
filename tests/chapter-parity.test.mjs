import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chapters, firstChapterId, findChapter, abilitiesAtChapter, transitionToChapter,
} from "../src/domain/chapters.mjs";
import {
  t as originalChapters,
  n as originalFirst,
  a as originalFind,
  r as originalAbilities,
  i as originalTransition,
} from "../sumiro/bundle/chapters-B8aGs4KP.js";

// The unchanged published module is the executable parity reference.
test("chapter metadata and lookup exactly match the published module", () => {
  assert.equal(firstChapterId, originalFirst);
  assert.deepEqual(chapters, originalChapters);
  assert.equal(chapters.length, 6);
  for (const chapter of chapters) {
    assert.strictEqual(findChapter(chapter.id), chapter);
    assert.deepEqual(findChapter(chapter.id), originalFind(chapter.id));
  }
  for (const unknown of [undefined, null, "", "ch2_stub", "future_chapter"]) {
    assert.equal(findChapter(unknown), originalFind(unknown));
  }
});

test("ability unlock rules agree with the published implementation", () => {
  for (const id of [...chapters.map((chapter) => chapter.id), "future_chapter", "", null, undefined]) {
    assert.deepEqual(abilitiesAtChapter(id), originalAbilities(id));
  }
  assert.deepEqual(abilitiesAtChapter("ch1_climb"), {});
  assert.deepEqual(abilitiesAtChapter("ch2_pass"), { inkStep: true, sword: true });
});

test("transition behavior, flags, abilities, and run identity match the published module", () => {
  for (const id of [...chapters.map((chapter) => chapter.id), "future_chapter", "", undefined, null]) {
    const makeRun = () => ({
      chapter: "ch1_climb",
      shrine: "shrine-7",
      abilities: { legacy: true },
      flags: {
        inkStep: 1, cat_found: 2, ch2_complete: 3, ch3_complete: 4,
        ch4_complete: 5, ch5_complete: 6, ch6_complete: 7, unrelated: 8,
      },
      scrolls: ["first_mist"],
    });
    const actual = makeRun();
    const expected = makeRun();
    assert.strictEqual(transitionToChapter(actual, id), actual);
    assert.strictEqual(originalTransition(expected, id), expected);
    assert.deepEqual(actual, expected, "Mismatch for chapter ID: " + String(id));
  }
});
