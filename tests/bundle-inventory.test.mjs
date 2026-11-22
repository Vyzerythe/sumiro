import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('inventory resolves compact static imports and literal dynamic imports', () => {
  const script = fileURLToPath(new URL('../scripts/inventory-bundle.mjs', import.meta.url));
  const { chunks, coverage, missingAdapters } = JSON.parse(execFileSync(process.execPath, [script], { encoding: 'utf8' }));
  const byFile = new Map(chunks.map(chunk => [chunk.file, chunk]));

  assert.ok(byFile.get('bundle/cat-Kd4-3ZMc.js').imports.some(reference =>
    reference.kind === 'static' && reference.target === 'bundle/trail-BFIL-IHB.js' && reference.existsInBundle));
  assert.ok(byFile.get('bundle/stage-BwklfI8K.js').imports.some(reference =>
    reference.kind === 'dynamic' && reference.target === 'bundle/env_plateau-2JhtlrC-.js' && reference.existsInBundle));
  assert.equal(byFile.get('bundle/trail-BFIL-IHB.js').reconstruction.status, 'source');
  assert.equal(byFile.get('bundle/index-DnHRwVtn.js').reconstruction.status, 'hybrid');
  assert.equal(byFile.get('bundle/cat-Kd4-3ZMc.js').reconstruction.status, 'compiled');
  assert.ok(coverage.source > 0 && coverage.hybrid > 0 && coverage.compiled > 0);
  assert.equal(coverage.drifted, 0);
  assert.deepEqual(missingAdapters, []);
  assert.equal(Object.values(coverage).reduce((total, count) => total + count, 0), chunks.length);
});
