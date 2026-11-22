import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createCredits } from '../src/application/credits.mts';
import { t as chapters } from '../sumiro/bundle/chapters-B8aGs4KP.js';

async function parse(name) {
  const path = new URL(`../sumiro/bundle/${name}`, import.meta.url);
  return ts.createSourceFile(path.pathname, await readFile(path, 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

function initializer(source, name) {
  const declaration = source.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations])
    .find(node => node.name.getText(source) === name);
  assert.ok(declaration?.initializer, name);
  return declaration.initializer.getText(source);
}

test('the native run summary matches the shipped credits across all chapters', async () => {
  const [source, kit] = await Promise.all([parse('game-B5zfa1fm.js'), parse('kit-B01EgPBo.js')]);
  const credits = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'Te');
  assert.ok(credits);
  const [catalogue, total] = runInNewContext(
    `const C = ${initializer(kit, 'C')}; [${initializer(kit, 'T')}, ${initializer(kit, 'w')}]`);
  const data = { E: { run: null }, a: chapters, o: catalogue, c: total };
  const summarize = runInNewContext(`const D = ${initializer(source, 'D')}; ${credits.getText(source)}; Te`, data);
  for (const run of [
    { scrolls: [], playS: 0 },
    { scrolls: ['first_mist', 'low_pine', 'black_tide'], playS: 115 },
    { scrolls: Object.values(catalogue).flat(), playS: 812 },
  ]) {
    data.E.run = run;
    assert.deepEqual(createCredits(run), JSON.parse(JSON.stringify(summarize())));
  }
});
