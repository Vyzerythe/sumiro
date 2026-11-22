import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { chapterCheckpoints, createCheckpointInteraction, resolveChapterSpawn } from '../src/application/chapter-checkpoints.mts';
import { chapterOneGroundRegions, chapterOneSpawn } from '../src/application/chapter-one-terrain.mts';
import { installChapterOneObstacles } from '../src/application/chapter-one-obstacles.mts';
import { getStaticChapter } from '../src/application/static-chapter-catalog.mts';
import { createRunProgress } from '../src/domain/run-progress.mts';
import { createDefaultRun } from '../src/domain/save.mts';
import { installGroundAsset } from '../src/physics/ground-asset.mts';
import { createCollisionWorld } from '../src/physics/world.mts';
import { createTraversalController } from '../src/player/traversal-controller.mts';

const archives = {
  ch1_climb: 'ch1_climb-D1obDXnH.js', ch2_pass: 'ch2_pass-9Opjv4P2.js', ch3_pines: 'ch3_pines-BCHma7IG.js',
  ch4_temple: 'ch4_temple-XtSLeUue.js', ch5_sea: 'ch5_sea-CpHUIhkX.js', ch6_summit: 'ch6_summit-BczK7QHX.js',
};

async function referenceShrines(id, archive) {
  const url = new URL(`../sumiro/bundle/${archive}`, import.meta.url);
  const file = ts.createSourceFile(archive, await readFile(url, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declarations = file.statements.flatMap(statement => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : []);
  const levels = declarations.map(node => node.initializer).filter(node => node && ts.isObjectLiteralExpression(node));
  const field = (object, name) => object.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(file) === name)?.initializer;
  const definition = levels.find(candidate => field(candidate, 'id')?.getText(file) === '`' + id + '`' && field(candidate, 'shrines'));
  assert.ok(definition, `Chapter definition for ${id}`);
  const data = field(definition, 'shrines').getText(file);
  if (id !== 'ch2_pass') return Function('return (' + data + ')')();
  const layout = declarations.find(node => node.name.getText(file) === 'G').initializer;
  const lantern = Function('return ' + field(layout, 'lantern').getText(file))();
  return Function('G', 'return (' + data + ')')({ lantern });
}

test('all native shrine definitions and stand poses match the published entries and have ground support', async () => {
  const original = await Promise.all(Object.entries(archives).map(async ([id, archive]) => [id, await referenceShrines(id, archive)]));
  assert.deepEqual(chapterCheckpoints, Object.fromEntries(original));
  const terrain = await readFile(new URL('../sumiro/assets/levels/ch1_climb/ground.bin', import.meta.url));
  for (const [id, checkpoints] of original) {
    const { world, spawn } = id === 'ch1_climb' ? { world: createCollisionWorld(), spawn: chapterOneSpawn } : getStaticChapter(id).createWorld();
    if (id === 'ch1_climb') installChapterOneObstacles(world, installGroundAsset(world, terrain, chapterOneGroundRegions));
    for (const shrine of checkpoints) {
      assert.ok(world.groundAt(shrine.stand.x, shrine.stand.z), `${id} ${shrine.id} must have ground support`);
      assert.deepEqual(resolveChapterSpawn(id, spawn, { chapter: id, shrine: shrine.id }, world), shrine.stand);
    }
  }
});

test('later chapter checkpoints save only on eligible input and reset onto an authored stand', () => {
  const id = 'ch4_temple';
  const original = JSON.stringify({ ...createDefaultRun(), chapter: id });
  let saved = original;
  const store = { getItem: () => saved, setItem(_key, value) { saved = value; } };
  const progress = createRunProgress(store);
  const { world, spawn } = getStaticChapter(id).createWorld();
  const shrine = chapterCheckpoints[id][0];
  const interaction = createCheckpointInteraction(id, world, progress);
  const player = createTraversalController(world, shrine);
  assert.equal(interaction.update(player.state, true, true), null);
  assert.equal(saved, original);
  assert.equal(interaction.update(player.state, true, false), shrine.id);
  assert.equal(JSON.parse(saved).shrine, shrine.id);
  assert.equal(JSON.parse(saved).chapter, id);
  assert.equal(interaction.update(player.state, true, false), null);
  player.reset(spawn);
  interaction.update(player.state, false, false);
  player.reset(shrine);
  assert.equal(interaction.update(player.state, true, false), shrine.id);
  player.reset(resolveChapterSpawn(id, spawn, { chapter: id, shrine: shrine.id }, world));
  assert.deepEqual([player.state.x, player.state.z, player.state.heading, player.state.grounded],
    [shrine.stand.x, shrine.stand.z, shrine.stand.heading, true]);
});
