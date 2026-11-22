import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createChapterThreeTraversal } from '../src/application/chapter-three-ledges.mts';
import { createChapterFourTraversal } from '../src/application/chapter-four-ledges.mts';
import { createChapterThreeWorld } from '../src/application/chapter-three-world.mts';
import { createChapterFourWorld } from '../src/application/chapter-four-world.mts';
import { createLedgePath } from '../src/player/ledge-path.mts';
import { findLeapLink, resolveLeapTarget } from '../src/player/leap.mts';

async function loadOriginal(file, first, next, level) {
  const source = await readFile(new URL(`../sumiro/bundle/${file}`, import.meta.url), 'utf8');
  const start = source.indexOf(first);
  const end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start, `Published traversal boundary changed in ${file}`);
  return Function(source.slice(start, end) + `;return { ledges: ${level}.ledges, leapLinks: ${level}.leapLinks };`)();
}

const [pines, temple] = await Promise.all([
  loadOriginal('ch3_pines-BCHma7IG.js', 'var ie=', 'function ke(', 'q'),
  loadOriginal('ch4_temple-XtSLeUue.js', 'var x={discs', 'var xe=', 'W'),
]);

for (const [chapter, create, original, ledgeCount, linkCount] of [
  ['Three', createChapterThreeTraversal, pines, 9, 3],
  ['Four', createChapterFourTraversal, temple, 5, 5],
]) {
  test(`Chapter ${chapter} matches published authored ledges and leap links in order`, () => {
    const definitions = create();
    const other = create();
    assert.equal(definitions.ledges.length, ledgeCount);
    assert.equal(definitions.leapLinks.length, linkCount);
    assert.deepEqual(definitions, original);
    assert.notStrictEqual(definitions.ledges[0].points, other.ledges[0].points);
    assert.notStrictEqual(definitions.leapLinks[0].to, other.leapLinks[0].to);
    assert.ok(original.ledges.every(ledge => !('attach' in ledge) && !('body' in ledge)));
    assert.ok(original.leapLinks.every(link => !link.from?.body && !link.to.body));

    const ledges = new Set(definitions.ledges.map(ledge => ledge.id));
    for (const { fromLedge, to } of definitions.leapLinks) {
      if (fromLedge) assert.ok(ledges.has(fromLedge));
      if ('ledge' in to) assert.ok(ledges.has(to.ledge));
    }
  });
}

test('recovered launch regions resolve the authored pines and temple ledge targets', () => {
  for (const [definitions, world, x, z, direction, route, target, min, max] of [
    [createChapterThreeTraversal(), createChapterThreeWorld().world, -183.4, -199, { x: -1, z: 0 },
      'far_wall', 'r8_face', 1, 9],
    [createChapterFourTraversal(), createChapterFourWorld().world, 10, -338, { x: 0, z: -1 },
      'r3_up', 'r3_eave', 2, 20],
  ]) {
    const ground = world.groundAt(x, z);
    assert.ok(ground);
    const state = { x, y: ground.y, z, state: 'RUN', recentSpeed: 6, stickMag: 1 };
    const ledges = new Map(definitions.ledges.map(ledge => [ledge.id, createLedgePath(ledge)]));
    const match = findLeapLink(state, definitions, ledges, world, direction, {},
      link => resolveLeapTarget(state, link, ledges, world, direction, {}));
    assert.equal(match.link.id, route);
    assert.strictEqual(match.t.ledge, ledges.get(target));
    assert.ok(match.t.s >= min && match.t.s <= max);
  }
});
