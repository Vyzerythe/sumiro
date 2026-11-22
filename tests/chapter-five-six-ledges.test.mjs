import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { createChapterFiveTraversal } from '../src/application/chapter-five-ledges.mts';
import { chapterSixLedgeAttachments, createChapterSixTraversal } from '../src/application/chapter-six-ledges.mts';
import { createChapterSixWorld } from '../src/application/chapter-six-world.mts';
import { createLedgePath } from '../src/player/ledge-path.mts';

async function originalMetadata(file, first, expression) {
  const url = new URL(`../sumiro/bundle/${file}`, import.meta.url);
  const source = await readFile(url, 'utf8');
  const ast = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declarations = ast.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []);
  const data = declarations.find(node => node.name.getText(ast) === 'q' && node.getText(ast).includes('leapLinks:'));
  const start = source.indexOf(first);
  assert.ok(start >= 0 && data && data.getEnd() > start, `Published traversal boundary changed in ${file}`);
  return Function(`${source.slice(start, data.getEnd())}; return ${expression};`)();
}

test('Chapter Five preserves the exact world-space ledges after the original clearance trimming', async () => {
  const original = await originalMetadata('ch5_sea-CpHUIhkX.js', 'var y={discs:', 'q');
  const traversal = createChapterFiveTraversal();
  assert.equal(traversal.ledges.length, 35);
  assert.equal(traversal.leapLinks.length, 5);
  assert.deepEqual(traversal.ledges.map(ledge => ledge.id), original.ledges.map(ledge => ledge.id));
  for (const [index, ledge] of traversal.ledges.entries()) assert.deepEqual(ledge, original.ledges[index], ledge.id);
  assert.deepEqual(traversal.leapLinks, original.leapLinks);
  assert.ok(traversal.ledges.every(ledge => !ledge.body));
  const closed = traversal.ledges.find(ledge => ledge.id === 'l_p1').points;
  assert.strictEqual(closed[0], closed.at(-1));
  assert.notStrictEqual(traversal.ledges[0].points[0], createChapterFiveTraversal().ledges[0].points[0]);
});

test('Chapter Six fails closed by default and documents exactly which bodies the static projection omitted', async () => {
  const { q: original, A: anchors } = await originalMetadata('ch6_summit-BczK7QHX.js', 'var b={discs:', '({q,A})');
  const { world } = createChapterSixWorld();
  assert.throws(() => createChapterSixTraversal(world), /ice_a1 requires body body_ice_a1/);
  const projection = createChapterSixTraversal(world, { skipUnresolvedBodies: true });
  assert.deepEqual(projection.ledges, original.ledges.filter(ledge => !ledge.attach));
  assert.deepEqual(projection.skippedBodyIds, original.ledges.filter(ledge => ledge.attach).map(ledge => ledge.attach));
  assert.deepEqual(projection.leapLinks, original.leapLinks);
  const bound = anchors.at(-1);
  const body = world.addBody(bound.body, []);
  body.setPose((bound.x0 + bound.x1) / 2, bound.y, bound.z);
  const partial = createChapterSixTraversal(world, { skipUnresolvedBodies: true });
  assert.equal(partial.ledges.find(ledge => ledge.id === bound.id).body, body);
  assert.deepEqual(partial.skippedBodyIds, projection.skippedBodyIds.slice(0, -1));
});

test('Chapter Six binds the original body IDs and samples local ice endpoints through the live body poses', async () => {
  const { q: original, A: anchors, de: mechanisms } = await originalMetadata(
    'ch6_summit-BczK7QHX.js', 'var b={discs:', '({q,A,de})',
  );
  const { world } = createChapterSixWorld();
  const mounted = new Map();
  for (const [index, mechanism] of mechanisms.entries()) {
    const [x, y, z] = mechanism.path[0];
    assert.deepEqual(chapterSixLedgeAttachments[index], { id: anchors[index].id, bodyId: mechanism.id, x, y, z });
    const body = world.addBody(mechanism.id, mechanism.parts);
    body.setPose(x, y, z);
    mounted.set(mechanism.id, body);
  }
  const traversal = createChapterSixTraversal(world);
  assert.equal(traversal.ledges.length, 10);
  assert.deepEqual(traversal.skippedBodyIds, []);
  assert.deepEqual(traversal.ledges.map(({ body, ...ledge }) => ledge), original.ledges);
  assert.deepEqual(traversal.leapLinks, original.leapLinks);
  for (const anchor of anchors) {
    const ledge = traversal.ledges.find(ledge => ledge.id === anchor.id);
    assert.strictEqual(ledge.body, mounted.get(anchor.body));
    const path = createLedgePath(ledge);
    const coordinates = ({ x, y, z, ox, oz }) => [x, y, z, ox, oz];
    assert.deepEqual(coordinates(path.at(0)), [anchor.x0, anchor.y, anchor.z, 0, 1]);
    assert.deepEqual(coordinates(path.at(path.length)), [anchor.x1, anchor.y, anchor.z, 0, 1]);
    ledge.body.setPose(ledge.body.x + 1, ledge.body.y + 0.5, ledge.body.z - 2);
    assert.deepEqual(coordinates(path.at(0)), [anchor.x0 + 1, anchor.y + 0.5, anchor.z - 2, 0, 1]);
  }
});
