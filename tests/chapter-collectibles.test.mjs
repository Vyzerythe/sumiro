import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Group } from 'three';
import { createAssetManager } from '../src/assets/asset-manager.mts';
import { chapterScrollPlacements, loadChapterCollectibles } from '../src/application/chapter-collectibles.mts';
import { getChapterCheckpoints } from '../src/application/chapter-checkpoints.mts';
import { createRunProgress } from '../src/domain/run-progress.mts';
import { scrollCount, scrollTexts } from '../src/domain/scrolls.mts';

const shippedChapters = [
  'ch1_climb-D1obDXnH.js', 'ch2_pass-9Opjv4P2.js', 'ch3_pines-BCHma7IG.js',
  'ch4_temple-XtSLeUue.js', 'ch5_sea-CpHUIhkX.js', 'ch6_summit-BczK7QHX.js',
];
const bundle = new URL('../sumiro/bundle/', import.meta.url);
const files = new URL('../sumiro/assets/', import.meta.url);
const litParts = ['lantern_glow', 'lantern_cloth', 'lantern_cord', 'lantern_bowl'];
const groundHeight = (x, z) => x * 0.12 - z * 0.2;
const world = { groundAt(x, z) { return { y: groundHeight(x, z) }; } };

function match(source, pattern) {
  const capture = source.match(pattern)?.[1];
  assert.ok(capture, 'Published chapter or kit boundary changed: ' + pattern);
  return capture;
}

async function publishedChapter(filename) {
  const text = await readFile(new URL(filename, bundle), 'utf8');
  const shrines = match(text, /\bshrines:(\[\{.*?\}\])/);
  const entities = match(text, /\bentities:(\[\{.*?\}\])/);
  const court = filename.startsWith('ch2_') ? match(text, /\blantern:(\[[^\]]+\])/) : '[]';
  return Function('G', 'return { shrines: ' + shrines + ', entities: ' + entities + ' };')({ lantern: JSON.parse(court) });
}

function assetFixture(context) {
  const loaded = [];
  const assets = createAssetManager({ assetBaseURL: 'https://collectibles.assets.test/', fetch: async resource => {
    const path = new URL(resource).pathname.slice(1);
    loaded.push(path);
    return new Response(await readFile(new URL(path, files)));
  } });
  context.after(() => assets.dispose());
  return { assets, loaded };
}

function lifetimeFixture() {
  const controller = new AbortController();
  const cleanup = [];
  return {
    signal: controller.signal,
    defer(callback) { cleanup.push(callback); },
    async release() {
      controller.abort();
      for (const callback of cleanup.splice(0).reverse()) await callback();
    },
  };
}

test('all 27 shrine and 12 scroll rigs use the supplied GLBs and authored placements', async context => {
  const { assets, loaded } = assetFixture(context);
  const originalKit = await readFile(new URL('kit-B01EgPBo.js', bundle), 'utf8');
  const originalSync = Function(match(originalKit, /(function z\(e,t\).*?)export\{/) + 'return B;')();
  const captured = new Set();
  let shrineCount = 0;
  for (const filename of shippedChapters) {
    const chapter = filename.split('-')[0];
    const authored = await publishedChapter(filename);
    assert.deepEqual(getChapterCheckpoints(chapter), authored.shrines);
    assert.deepEqual(chapterScrollPlacements[chapter], authored.entities.map(({ kind, ...site }) => {
      assert.equal(kind, 'scroll');
      return site;
    }));
    const lifetime = lifetimeFixture();
    context.after(() => lifetime.release());
    const presentation = await loadChapterCollectibles(chapter, assets, world, lifetime);
    const { root, shrines, scrolls } = presentation;
    assert.equal(root.parent, null);
    assert.deepEqual([...shrines.keys()], authored.shrines.map(site => site.id));
    assert.deepEqual([...scrolls.keys()], authored.entities.map(site => site.id));
    assert.equal(root.children.length, shrines.size + scrolls.size);

    let previousStone;
    for (const site of authored.shrines) {
      shrineCount++;
      const shrine = shrines.get(site.id);
      assert.deepEqual(shrine.position.toArray(), [site.x, groundHeight(site.x, site.z), site.z]);
      assert.equal(shrine.rotation.y, site.heading);
      assert.deepEqual(shrine.children.map(mesh => mesh.name), ['lantern_bowl', 'lantern_cloth', 'lantern_cord', 'lantern_glow', 'lantern_niche', 'lantern_stone']);
      const stone = shrine.getObjectByName('lantern_stone');
      assert.ok(stone.geometry.attributes.position.count > 100);
      if (previousStone) {
        assert.notStrictEqual(stone, previousStone);
        assert.strictEqual(stone.geometry, previousStone.geometry);
        assert.strictEqual(stone.material, previousStone.material);
      }
      previousStone = stone;
    }
    for (const site of authored.entities) {
      captured.add(site.id);
      const scroll = scrolls.get(site.id);
      assert.deepEqual(scroll.position.toArray(), [site.x, site.y ?? groundHeight(site.x, site.z), site.z]);
      assert.equal(scroll.rotation.y, site.heading);
      assert.deepEqual(scroll.children.map(node => node.name), ['scroll_cord', 'scroll_cradle', 'scroll_paper', 'scroll_rods', 'scroll_seal']);
      assert.ok(scroll.getObjectByName('scroll_paper').geometry.attributes.position.count > 0);
      const seal = scroll.getObjectByName('scroll_seal');
      assert.equal(seal.isSprite, true);
      assert.deepEqual(seal.position.toArray(), [0, 1, 0]);
      assert.deepEqual(seal.scale.toArray(), [0.85, 0.85, 0.85]);
      assert.equal(seal.renderOrder, 8);
      assert.equal(seal.material.opacity, 0.8);
      assert.equal(seal.material.depthWrite, false);
      const { data, width, height } = seal.material.map.image;
      assert.deepEqual([width, height], [256, 256]);
      assert.ok(data.some((channel, index) => index % 4 === 3 && channel !== 0));
    }

    const reference = {
      id: chapter, shrineNodes: new Map([...shrines].map(([id, rig]) => [id, rig.clone(true)])),
      scrollNodes: new Map([...scrolls].map(([id, rig]) => [id, rig.clone(true)])),
    };
    const expectedVisibility = (shrineMap, scrollMap) => [
      ...[...shrineMap.values()].flatMap(shrine => [shrine.visible, ...litParts.map(name => shrine.getObjectByName(name).visible)]),
      ...[...scrollMap.values()].map(scroll => scroll.visible),
    ];
    for (const state of [null, { chapter, shrine: authored.shrines[0].id, scrolls: [authored.entities[0].id] },
      { chapter: 'elsewhere', shrine: authored.shrines[0].id, scrolls: [] }]) {
      presentation.sync(state);
      originalSync(reference, state);
      assert.deepEqual(expectedVisibility(shrines, scrolls), expectedVisibility(reference.shrineNodes, reference.scrollNodes));
    }

    let disposals = 0;
    previousStone.geometry.addEventListener('dispose', () => disposals++);
    const stage = new Group();
    stage.add(root);
    await lifetime.release();
    assert.deepEqual(stage.children, []);
    assert.equal(disposals, 1);
  }
  assert.equal(shrineCount, 27);
  assert.equal(captured.size, 12);
  assert.deepEqual([...captured].sort(), Object.keys(scrollTexts).sort());
  assert.deepEqual(loaded.sort(), Array.from({ length: 6 }, () => ['kit/scroll.glb', 'kit/shrine.glb']).flat().sort());
});

test('later scroll actions respect ghost, proximity, stance and collection gates', async context => {
  const { assets } = assetFixture(context);
  const lifetime = lifetimeFixture();
  context.after(() => lifetime.release());
  const chapter = 'ch2_pass';
  const { scrolls, sync, nearestScroll, collectScroll } = await loadChapterCollectibles(chapter, assets, world, lifetime);
  let writes = 0;
  const progress = createRunProgress({ getItem: () => null, setItem() { writes++; } });
  await progress.completeChapter(async () => {});
  assert.equal(progress.current.chapter, chapter);
  const [x, y, z] = scrolls.get('dry_well').position.toArray();
  const player = { x, y, z, grounded: true, state: 'IDLE' };
  assert.equal(nearestScroll(player), null);
  assert.equal(collectScroll(player, progress), null);
  sync(progress.current);
  assert.equal(nearestScroll({ ...player, grounded: false }), null);
  assert.equal(nearestScroll({ ...player, state: 'DRINK' }), null);
  assert.equal(nearestScroll({ ...player, x: x + 1.5 }), null);
  assert.equal(nearestScroll({ ...player, y: y + 1.601 }), null);
  assert.equal(nearestScroll({ ...player, x: x + 1.499, y: y + 1.599 })?.id, 'dry_well');
  assert.equal(collectScroll({ ...player, state: 'HANG' }, progress), null);
  assert.equal(collectScroll(player, progress, () => false), null);
  const before = writes;
  const target = nearestScroll(player);
  const event = collectScroll(player, progress, accepted => accepted === target);
  assert.deepEqual(event, { type: 'scroll-captured', id: 'dry_well', lines: scrollTexts.dry_well, count: 1, total: scrollCount });
  assert.equal(writes, before + 1);
  assert.equal(scrolls.get('dry_well').visible, false);
  assert.equal(scrolls.get('snow_line').visible, true);
  assert.equal(collectScroll(player, progress), null);
  assert.equal(writes, before + 1);

  const chapterOne = await loadChapterCollectibles('ch1_climb', assets, world, lifetime);
  chapterOne.sync(progress.current);
  const firstMist = { x: 10.2, y: 9.72, z: -40.7, grounded: true, state: 'IDLE' };
  assert.equal(chapterOne.nearestScroll(firstMist), null);
  assert.equal(chapterOne.collectScroll(firstMist, progress), null);
  assert.equal(writes, before + 1);
});
