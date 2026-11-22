import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Group, MathUtils } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import ts from 'typescript';
import {
  chapterFiveMechanismSites, createChapterFiveMechanisms, sampleChapterFiveTide,
} from '../src/application/chapter-five-mechanisms.mts';
import { createCollisionWorld } from '../src/physics/world.mts';
import { n as originalExtrude, t as originalWorld } from '../sumiro/bundle/collision-DtBQEpmQ.js';

const [chapter, level] = await Promise.all(['ch5_sea-CpHUIhkX.js', 'level-O-RtwNJJ.js'].map(file =>
  readFile(new URL('../sumiro/bundle/' + file, import.meta.url), 'utf8')));

function span(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'Published mechanism source boundary changed at ' + start);
  return source.slice(from, to);
}

const parsed = ts.createSourceFile('chapter.mjs', chapter, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declarations = new Map(parsed.statements.filter(ts.isVariableStatement)
  .flatMap(statement => [...statement.declarationList.declarations].map(declaration => [declaration.name.getText(parsed), declaration])));
const definitions = Function(
  'const ' + ['b', 'S', 'G', 'K', 'F', 'B'].map(name => declarations.get(name).getText(parsed)).join(',') +
  ';return ' + span(chapter, 'mechs:[', ',combat:').slice('mechs:'.length) + ';',
)().filter(entry => entry.kind === 'tide' || entry.kind === 'platform');

const setup = Function('S', 'f', 'r', 'w', 'J', 'X', 'W', 'V', 'U', 'C',
  span(level, 'var T=Math.PI/180', 'j={preset:').replace(/,$/, ';') +
  span(level, 'function L(', 'function R(') + span(level, 'function ne(', 'function z(') +
  span(level, 'function re(', 'function ie(') + span(level, 'function ce(', 'function le(') +
  'return { platform: re, tide: ce };'
);
const presentation = Function('J', 't', 's', span(chapter, 'function Oe(', 'export{De') + 'return Oe;')(
  { uTideNow: {} }, MathUtils, () => false,
);

function oracle() {
  const world = originalWorld();
  const byId = new Map();
  const cues = [];
  let falls = 0;
  const levelState = { spawn: { x: 30, z: -64 } };
  const factory = setup(originalExtrude, world, levelState, byId,
    () => ({ node: null, placeholder: null }), () => {}, (name, options) => cues.push({ name, ...options }),
    () => null, () => false, () => true);
  for (const entry of definitions) byId.set(entry.id, factory[entry.kind](entry));
  for (const entry of byId.values()) entry.reset();
  const sea = byId.get('sea');
  const visual = {
    mech: byId, drift: { position: {} }, seaMat: { uniforms: { uTime: {}, uStir: {} } },
    mirror: { position: {} }, mirrorMat: { uniforms: { uSea: {}, uTime: {} } },
    seaStir: 0, mist: { position: { set() {} } }, mistMats: [], curtains: [],
  };
  return {
    sea, byId, levelState, cues, get falls() { return falls; }, visual,
    step(delta, seconds, player, playing) {
      sea.update(delta, player, null, { playing, body: { fallOut: () => falls++ } });
      for (const entry of byId.values()) if (entry !== sea) entry.update(delta, player);
      presentation(delta, { time: { t: seconds }, camera: { position: {} }, registry: { get() {} } }, visual);
    },
  };
}

test('the authored tide and all seven carrier paths, collision, and presentation match the published routines', () => {
  const reference = oracle();
  const cues = [];
  let falls = 0;
  const world = createCollisionWorld();
  const mechanisms = createChapterFiveMechanisms(world, { onCue: cue => cues.push(cue), onFallOut: () => falls++ });
  const { kind, ...tideSite } = definitions[0];
  assert.deepEqual(chapterFiveMechanismSites.tide, tideSite);
  assert.equal(mechanisms.platforms.length, 7);
  for (const { templates, ...site } of chapterFiveMechanismSites.platforms) {
    const { kind, mode, float, ...reference } = definitions.find(entry => entry.id === site.id);
    assert.deepEqual(site, reference);
  }

  const compare = () => {
    const { kind, x, z, ...tide } = reference.sea.read();
    assert.deepEqual(mechanisms.tide, tide);
    for (const platform of mechanisms.platforms) {
      const published = reference.byId.get(platform.id);
      const expected = published.read();
      for (const key of ['x', 'y', 'z', 'vx', 'vy', 'vz']) assert.equal(platform.body[key], expected[key], platform.id + ' ' + key);
      assert.equal(platform.body.yaw, published.body.yaw);
      assert.equal(platform.distance, expected.d);
      assert.equal(platform.length, expected.length);
      assert.deepEqual(platform.body.tris.map(tri => [Array.from(tri), tri.kind, tri.surface]),
        published.body.tris.map(tri => [Array.from(tri), tri.kind, tri.surface]));
      assert.equal(world.groundAt(platform.body.x, platform.body.z).body, platform.body);
    }
  };
  compare();
  for (const seconds of [-40.5, -0.01, 0, 8 - 1e-7, 8, 10, 12, 16, 18, 20, 28, 132.5]) {
    assert.equal(sampleChapterFiveTide(seconds).y, reference.sea.height(seconds));
  }

  let elapsed = 0;
  for (const delta of [5, 0.5, 1.5, 1, 2, 2, 4, 2, 2, 0.17, 2.6, 4.9, 4.33, 7.25]) {
    elapsed += delta;
    const seconds = 15 + elapsed;
    const player = { y: 1.5, state: elapsed < 16 ? 'LEAP' : 'IDLE' };
    reference.step(delta, seconds, player, true);
    mechanisms.step(delta, { player, playing: true, seconds });
    compare();
    assert.deepEqual(cues, reference.cues);
    assert.equal(falls, reference.falls);
    assert.deepEqual(mechanisms.presentation, { seconds, stir: reference.visual.seaStir,
      mirrorY: reference.visual.mirror.position.y, driftY: reference.visual.drift.position.y });
  }
  assert.ok(falls > 0);
  assert.deepEqual(cues.slice(0, 2), [{ name: 'tide', seconds: 4, hold: 4 }, { name: 'tideFall', seconds: 4 }]);
  for (const y of [0, 3, 3.05, 4]) assert.equal(mechanisms.unsafeAt(100, y, -245), reference.levelState.unsafeAt(100, y, -245));
  for (const entry of reference.byId.values()) entry.reset();
  mechanisms.reset();
  compare();
  assert.equal(mechanisms.presentation.seconds, 15 + elapsed);
});

test('the supplied GLB templates follow their bodies and return intact on disposal', async () => {
  const bytes = await readFile(new URL('../sumiro/assets/levels/ch5_sea/sea.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const root = gltf.scene;
  const water = new Group();
  water.position.set(1, 2, 3);
  root.add(water);
  const world = createCollisionWorld();
  const mechanisms = createChapterFiveMechanisms(world);
  const boat = root.getObjectByName('boat');
  const drift = root.getObjectByName('drift_wood');
  const baseline = [...root.children];
  let geometryDisposals = 0;
  boat.geometry.addEventListener('dispose', () => geometryDisposals++);
  mechanisms.bind(root, water);
  assert.equal(boat.visible, false);
  assert.equal(drift.visible, false);
  assert.equal(root.getObjectByName('boat1_node').children[0].geometry, boat.geometry);
  assert.equal(root.getObjectByName('grey_node').children[0].material, boat.material);
  assert.notEqual(root.getObjectByName('grey_node').children[0], root.getObjectByName('boat1_node').children[0]);
  const riderBody = world.body('boat1');
  const rider = riderBody.toWorld(0.2, 0, 0.2);
  mechanisms.step(10, { seconds: 100 });
  riderBody.carry(rider);
  for (const platform of mechanisms.platforms) {
    const node = root.getObjectByName(platform.node);
    const { body } = platform;
    assert.deepEqual(node.position.toArray(), [body.x, body.y, body.z]);
    assert.equal(node.rotation.y, body.yaw);
  }
  assert.equal(rider.y, riderBody.y);
  assert.deepEqual(water.position.toArray(), [100, 1.5, -320]);
  assert.equal(root.getObjectByName('drift').position.y, mechanisms.presentation.driftY);
  mechanisms.dispose();
  mechanisms.dispose();
  assert.deepEqual(root.children, baseline);
  assert.equal(boat.visible, true);
  assert.equal(drift.visible, true);
  assert.equal(geometryDisposals, 0);
  assert.deepEqual(water.position.toArray(), [1, 2, 3]);
  assert.ok(mechanisms.platforms.every(platform => !platform.body.enabled && !platform.body.moved));
  root.traverse(node => {
    if (node.isMesh) {
      node.geometry.dispose();
      node.material.dispose();
    }
  });
});
