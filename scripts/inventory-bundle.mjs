#!/usr/bin/env node
/**
 * Read-only inventory of the published JavaScript chunks.
 *
 * Output is a deterministic JSON report on stdout. This intentionally does not
 * decompile, rewrite, format or claim to recover the original source structure.
 *
 * Run: node scripts/inventory-bundle.mjs > bundle-inventory.json
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const base = join(root, "sumiro");
const bundle = join(base, "bundle");
const names = (await readdir(bundle)).filter((name) => name.endsWith(".js")).sort();
const fileSet = new Set(names);
const chunks = [];

function imports(source) {
  const matches = [];
  for (const [kind, pattern] of [
    ["static", /\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?["'](\.{1,2}\/[^"']+)["']/g],
    ["dynamic", /\bimport\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g],
  ]) {
    for (const match of source.matchAll(pattern)) matches.push({ kind, specifier: match[1] });
  }
  return [...new Map(matches.map((x) => [x.kind + ":" + x.specifier, x])).values()]
    .sort((a, b) => a.specifier.localeCompare(b.specifier) || a.kind.localeCompare(b.kind));
}

for (const name of names) {
  const filename = join(bundle, name);
  const source = await readFile(filename, "utf8");
  const references = imports(source).map(({ kind, specifier }) => {
    const path = resolve(dirname(filename), specifier.split(/[?#]/, 1)[0]);
    return {
      kind,
      specifier,
      target: relative(base, path).replaceAll("\\", "/"),
      existsInBundle: dirname(path) === bundle && fileSet.has(basename(path)),
    };
  });
  chunks.push({
    file: "bundle/" + name,
    bytes: (await stat(filename)).size,
    generatedChunkLabel: name.replace(/-[A-Za-z0-9_-]{8}\.js$/, ""),
    imports: references,
  });
}

const report = {
  schemaVersion: 1,
  description: "Read-only inventory of generated distribution chunks; source boundaries are unverified.",
  entry: "index.html",
  jsChunks: chunks.length,
  totalJsBytes: chunks.reduce((sum, x) => sum + x.bytes, 0),
  chunks,
};
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
