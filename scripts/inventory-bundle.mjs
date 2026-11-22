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
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const base = join(root, "sumiro");
const bundle = join(base, "bundle");
const names = (await readdir(bundle)).filter((name) => name.endsWith(".js")).sort();
const fileSet = new Set(names);
const chunks = [];

function imports(filename, source) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const matches = new Map();

  function record(kind, node) {
    if (!node || !ts.isStringLiteralLike(node) || !/^\.{1,2}\//.test(node.text)) return;
    matches.set(kind + ":" + node.text, { kind, specifier: node.text });
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      record("static", node.moduleSpecifier);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      record("dynamic", node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }

  ts.forEachChild(file, visit);
  return [...matches.values()]
    .sort((a, b) => a.specifier.localeCompare(b.specifier) || a.kind.localeCompare(b.kind));
}

for (const name of names) {
  const filename = join(bundle, name);
  const source = await readFile(filename, "utf8");
  const references = imports(filename, source).map(({ kind, specifier }) => {
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
  description: "Read-only inventory of literal ESM imports in generated chunks; computed imports and source boundaries are outside this report.",
  entry: "index.html",
  jsChunks: chunks.length,
  totalJsBytes: chunks.reduce((sum, x) => sum + x.bytes, 0),
  chunks,
};
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
