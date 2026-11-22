import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';
import { compileReconstructedSource } from '../scripts/compile-reconstructed-source.mjs';

test('the emitted native browser entry resolves its complete literal module graph without published chunks', async () => {
  const project = new URL('../', import.meta.url);
  const output = new URL('.local-build-source/', project);
  const published = new URL('sumiro/bundle/', project);
  const emitted = new Map([...compileReconstructedSource(fileURLToPath(project), fileURLToPath(output))]
    .map(([path, content]) => [normalize(path), content]));
  const html = await readFile(new URL('src/application/index.html', project), 'utf8');
  const importMapText = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1];
  const entryPath = html.match(/<script type="module" src="([^"]+)"/)?.[1];
  assert.ok(importMapText && entryPath);
  const { imports } = JSON.parse(importMapText);
  const packagePrefixes = Object.keys(imports).filter(key => key.endsWith('/')).sort((a, b) => b.length - a.length);
  const visited = new Set();

  async function visit(url) {
    assert.ok(url.href.startsWith(project.href), `Module outside the project: ${url.href}`);
    assert.ok(!url.href.startsWith(published.href), `Published game dependency: ${url.href}`);
    if (visited.has(url.href)) return;
    visited.add(url.href);
    const content = url.href.startsWith(output.href) ? emitted.get(normalize(fileURLToPath(url))) : await readFile(url, 'utf8');
    assert.equal(typeof content, 'string', `Missing emitted module: ${url.href}`);
    const { importedFiles } = ts.preProcessFile(content, true, true);
    for (const { fileName } of importedFiles) {
      const prefix = packagePrefixes.find(key => fileName.startsWith(key));
      const mapped = imports[fileName] ?? (prefix ? imports[prefix] + fileName.slice(prefix.length) : undefined);
      await visit(mapped ? new URL(mapped, output) : new URL(fileName, url));
    }
  }

  await visit(new URL(entryPath, output));
  for (const module of ['application/traversal-preview.mjs', 'rendering/ink-render-graph.mjs', 'runtime/source-runtime.mjs']) {
    assert.ok(visited.has(new URL(module, output).href), `Missing native dependency ${module}`);
  }
});
