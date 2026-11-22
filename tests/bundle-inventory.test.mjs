import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('inventory resolves compact static imports and literal dynamic imports', () => {
  const script = fileURLToPath(new URL('../scripts/inventory-bundle.mjs', import.meta.url));
  const { chunks } = JSON.parse(execFileSync(process.execPath, [script], { encoding: 'utf8' }));
  const byFile = new Map(chunks.map(chunk => [chunk.file, chunk.imports]));

  assert.ok(byFile.get('bundle/cat-Kd4-3ZMc.js').some(reference =>
    reference.kind === 'static' && reference.target === 'bundle/trail-BFIL-IHB.js' && reference.existsInBundle));
  assert.ok(byFile.get('bundle/stage-BwklfI8K.js').some(reference =>
    reference.kind === 'dynamic' && reference.target === 'bundle/env_plateau-2JhtlrC-.js' && reference.existsInBundle));
});
