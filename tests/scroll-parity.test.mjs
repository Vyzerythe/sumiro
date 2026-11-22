import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { chapters } from "../src/domain/chapters.mts";
import { scrollTexts, scrollCount, scrollsByChapter } from "../src/domain/scrolls.mts";

const source = await readFile(new URL("../sumiro/bundle/kit-B01EgPBo.js", import.meta.url), "utf8");
const matched = source.match(/var C=(\{[\s\S]*?\}),w=Object\.keys\(C\)\.length,T=(\{[\s\S]*?\}),E=\{preset:/);
assert.ok(matched, "published scroll metadata block changed; manually re-audit");
const original = runInNewContext(
  "var C=" + matched[1] + ",w=Object.keys(C).length,T=" + matched[2] + ";({C,w,T})",
);
const ordinary = value => JSON.parse(JSON.stringify(value));

test("scroll texts and ordering exactly reproduce the published catalogue", () => {
  assert.deepEqual(scrollTexts, ordinary(original.C));
  assert.equal(scrollCount, original.w);
  assert.equal(scrollCount, 12);
  for (const [name, poem] of Object.entries(scrollTexts)) {
    assert.equal(poem.length, 3, name + " must have three lines");
    assert.ok(poem.every(line => typeof line === "string" && line.length > 0));
  }
});

test("chapter scroll assignments exactly match published behavior and are coherent", () => {
  assert.deepEqual(scrollsByChapter, ordinary(original.T));
  assert.deepEqual(Object.keys(scrollsByChapter), chapters.map(c => c.id));
  const assigned = Object.values(scrollsByChapter).flat();
  assert.equal(assigned.length, scrollCount);
  assert.equal(new Set(assigned).size, scrollCount, "no scroll is assigned twice");
  assert.deepEqual(new Set(assigned), new Set(Object.keys(scrollTexts)));
});
