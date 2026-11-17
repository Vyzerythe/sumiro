#!/usr/bin/env node
/**
 * Assemble a SOURCE-BACKED development distribution from the immutable
 * published build and the first recovered modules.
 *
 * This is a transitional integration build, not a fully reconstructed game.
 * The published directory under sumiro/ is never modified.
 */
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const outArg = process.argv.indexOf('--out');
const output = resolve(root, outArg >= 0 ? process.argv[outArg + 1] ?? '' : '.local-build');
if (outArg >= 0 && !process.argv[outArg + 1]) throw Error('--out requires a directory');
if (output === root || !output.startsWith(root + '/')) {
  throw Error('Output must be a dedicated directory inside the repository');
}
if ([resolve(root,'sumiro'), resolve(root,'src')].some(p => output === p || p.startsWith(output + '/'))) {
  throw Error('Output would overwrite tracked source or published assets');
}

const originalGame = join(root, 'sumiro/bundle/game-B5zfa1fm.js');
const originalChapters = join(root, 'sumiro/bundle/chapters-B8aGs4KP.js');
const EXPECTED_GIT_BLOBS = {
  game: '284349f2f8d0235e163f3c9b88b17ed222e3b269',
  chapters: '3da4e0f31fed783d0e548dd40fd0c1113cca16ec',
};
const sha = data => createHash('sha1')
  .update('blob ' + Buffer.byteLength(data) + '\0')
  .update(data).digest('hex');
const game = await readFile(originalGame);
const chapters = await readFile(originalChapters);
if (sha(game) !== EXPECTED_GIT_BLOBS.game || sha(chapters) !== EXPECTED_GIT_BLOBS.chapters) {
  throw Error('Published bundle has changed: audit integration boundaries before rebuilding');
}

const gameText = game.toString('utf8');
const start = gameText.indexOf('var u=');
const end = gameText.indexOf('var v=', start);
if (start < 0 || end < 0 || gameText.indexOf('sumiro.save.v1', start) > end) {
  throw Error('Save prelude could not be isolated');
}
const prior = gameText.slice(start, end);
for (const name of ['function p(', 'function m(', 'function te(', 'function h(', 'function g(', 'function _(']) {
  if (!prior.includes(name)) throw Error('Missing required original save function: ' + name);
}
const saveImports = [
  'saveKey as u', 'legacySaveKey as ee', 'legacyChapterAliases as d',
  'defaultOptions as f', 'migrateOptions as p', 'createDefaultRun as m',
  'isSupportedSave as te', 'normalizeSaveChapters as h',
  'loadSave as g', 'writeSave as _',
].join(',');
const rewritten = "import{" + saveImports + "}from'../../src/domain/save.mjs';\n"
  + gameText.slice(0, start) + gameText.slice(end);

const chapterAdapter = [
  "/* Transitional adapter: readable source module, original bundle export names. */",
  "export { findChapter as a, transitionToChapter as i,",
  "  firstChapterId as n, abilitiesAtChapter as r, chapters as t",
  "} from '../../src/domain/chapters.mjs';",
  '',
].join('\n');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(root, 'sumiro'), join(output, 'sumiro'), { recursive: true });
await cp(join(root, 'src'), join(output, 'src'), { recursive: true });
await writeFile(join(output, 'sumiro/bundle/game-B5zfa1fm.js'), rewritten);
await writeFile(join(output, 'sumiro/bundle/chapters-B8aGs4KP.js'), chapterAdapter);

const report = {
  kind: 'transitional-source-backed-development-build',
  originalGitBlob: EXPECTED_GIT_BLOBS,
  adaptedChunks: [
    'sumiro/bundle/game-B5zfa1fm.js',
    'sumiro/bundle/chapters-B8aGs4KP.js',
  ],
  sourceModules: ['src/domain/save.mjs', 'src/domain/chapters.mjs'],
  limitations: 'Other chunks still ship as compiled artifacts. Browser/playthrough parity is not yet verified.',
};
await writeFile(join(output, 'reconstruction-build.json'), JSON.stringify(report, null, 2) + '\n');
console.log('Built ' + output + '/sumiro/ with readable chapter and save modules');
