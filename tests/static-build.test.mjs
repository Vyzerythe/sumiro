import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const distribution = resolve(root, "sumiro");

async function collectFiles(directory) {
  const paths = new Set();
  async function visit(current) {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const path = join(current, item.name);
      if (item.isDirectory()) await visit(path);
      else if (item.isFile()) paths.add(resolve(path));
    }
  }
  await visit(directory);
  return paths;
}

const files = await collectFiles(distribution);
const display = (path) => relative(root, path);
function assertReference(fromDirectory, reference, context) {
  const withoutQuery = reference.split(/[?#]/, 1)[0];
  const target = resolve(fromDirectory, withoutQuery);
  assert.ok(
    target.startsWith(distribution + sep),
    context + ": reference escapes the distribution: " + reference,
  );
  assert.ok(files.has(target), context + ": missing " + display(target));
}

test("published entry point and local HTML references are present", async () => {
  const entry = join(distribution, "index.html");
  assert.ok(files.has(entry), "sumiro/index.html is required");
  const html = await readFile(entry, "utf8");
  assert.match(html, /<script\b[^>]*type=["']module["']/);
  const refs = [...html.matchAll(/\b(?:src|href)=["'](\.[^"']+)["']/g)];
  assert.ok(refs.length > 0, "expected relative module or preload references");
  for (const match of refs) assertReference(distribution, match[1], "index.html");
});

test("every local static JavaScript import has a target", async () => {
  const moduleFiles = [...files].filter((path) => extname(path) === ".js");
  assert.ok(moduleFiles.length > 0, "no compiled JavaScript modules found");
  const patterns = [
    /\bfrom\s*["'](\.{1,2}\/[^"']+)["']/g,
    /\bimport\s*["'](\.{1,2}\/[^"']+)["']/g,
    /\bimport\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g,
  ];
  for (const path of moduleFiles) {
    const source = await readFile(path, "utf8");
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        assertReference(dirname(path), match[1], display(path));
      }
    }
  }
});

test("all checked-in JSON data is syntactically valid", async () => {
  const jsonFiles = [...files].filter((path) => extname(path) === ".json");
  assert.ok(jsonFiles.length > 0, "no asset metadata JSON found");
  for (const path of jsonFiles) {
    assert.doesNotThrow(
      () => JSON.parse(awaitableJson.get(path)),
      "invalid JSON: " + display(path),
    );
  }
});

// Load asynchronously before parsing to keep test callbacks synchronous.
const awaitableJson = new Map(
  await Promise.all(
    [...files].filter((path) => extname(path) === ".json").map(async (path) =>
      [path, await readFile(path, "utf8")],
    ),
  ),
);

test("indexed audio references resolve to shipped files", () => {
  const indexPath = join(distribution, "assets/audio/index.json");
  assert.ok(files.has(indexPath), "audio index is required");
  const audio = JSON.parse(awaitableJson.get(indexPath));
  for (const [id, track] of Object.entries(audio.music ?? {})) {
    assertReference(distribution, track.url, "music " + id);
  }
  for (const [id, path] of Object.entries(audio.voice ?? {})) {
    assertReference(distribution, path, "voice " + id);
  }
  for (const [id, paths] of Object.entries(audio.sfx ?? {})) {
    for (const path of paths) assertReference(distribution, path, "sfx " + id);
  }
  for (const [id, track] of Object.entries(audio.ambience ?? {})) {
    assertReference(distribution, track.url, "ambience " + id);
  }
});

test("audio manifests point to local media files", () => {
  const audioDir = join(distribution, "assets/audio");
  const music = JSON.parse(awaitableJson.get(join(audioDir, "music/manifest.json")));
  for (const [id, entry] of Object.entries(music.tracks ?? {})) {
    assertReference(join(audioDir, "music"), "./" + entry.file, "music manifest " + id);
  }
  const ambience = JSON.parse(awaitableJson.get(join(audioDir, "ambience/manifest.json")));
  if (ambience.wind?.file) {
    assertReference(join(audioDir, "ambience"), "./" + ambience.wind.file, "wind manifest");
  }
  const effects = JSON.parse(awaitableJson.get(join(audioDir, "sfx/manifest.json")));
  for (const [id, entry] of Object.entries(effects)) {
    for (const take of entry.takes ?? []) {
      assertReference(join(audioDir, "sfx"), "./" + take.file, "sfx manifest " + id);
    }
  }
});
