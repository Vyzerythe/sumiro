import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = join(root, '.local-build-test');
const game = 'sumiro/bundle/game-B5zfa1fm.js';
const chapters = 'sumiro/bundle/chapters-B8aGs4KP.js';
const kit = 'sumiro/bundle/kit-B01EgPBo.js';

test('source-backed build preserves originals and binds live domain imports', async () => {
  const hash = data => createHash('sha256').update(data).digest('hex');
  const before = await Promise.all([game, chapters, kit].map(p => readFile(join(root,p))));
  try {
    const result = spawnSync(process.execPath, ['scripts/build-reconstructed-dev.mjs', '--out', out], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const after = await Promise.all([game, chapters].map(p => readFile(join(root,p))));
    assert.deepEqual(after.map(hash), before.map(hash), 'published files changed');
    const [outputGame, outputChapters, outputKit, report, index] = await Promise.all([
      readFile(join(out,game),'utf8'),
      readFile(join(out,chapters),'utf8'),
      readFile(join(out,kit),'utf8'),
      readFile(join(out,'reconstruction-build.json'),'utf8'),
      readFile(join(out,'sumiro/index.html'),'utf8'),
    ]);
    assert.match(outputGame, /from'\.\.\/\.\.\/src\/domain\/save\.mjs'/);
    assert.doesNotMatch(outputGame, /function te\(/);
    assert.match(outputChapters, /src\/domain\/chapters\.mjs/);
    assert.match(outputKit, /src\/domain\/scrolls\.mjs/);
    assert.doesNotMatch(outputKit, /w=Object\.keys\(C\)\.length/);
    assert.match(index, /bundle\/index-/);
    assert.equal(JSON.parse(report).kind, 'transitional-source-backed-development-build');

    const adapter = await import(pathToFileURL(join(out,chapters)).href);
    const readable = await import(pathToFileURL(join(out,'src/domain/chapters.mjs')).href);
    assert.deepEqual(adapter.t, readable.chapters);
    assert.deepEqual(adapter.r('ch2_pass'), { inkStep: true, sword: true });
    const scrolls = await import(pathToFileURL(join(out,'src/domain/scrolls.mjs')).href);
    assert.equal(scrolls.scrollCount, 12);
    const saves = await import(pathToFileURL(join(out,'src/domain/save.mjs')).href);
    assert.equal(saves.createDefaultRun().chapter, 'ch1_climb');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('build refuses unsafe destinations before altering any project files', async () => {
  const forbidden = ['.', 'sumiro', 'sumiro/assets', 'sumiro/.local-build', 'src', 'docs', 'tests', '.local-build/nested', '../outside'];
  for (const name of forbidden) {
    const result = spawnSync(process.execPath, ['scripts/build-reconstructed-dev.mjs', '--out', name], {
      cwd: root, encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, 'unsafe output unexpectedly accepted: ' + name);
    assert.match(result.stderr, /Output must be a root-level/);
  }
});
