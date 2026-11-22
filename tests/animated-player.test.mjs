import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { AnimationClip, AnimationMixer, Group, Mesh, Object3D, NumberKeyframeTrack, SkinnedMesh, Texture, TextureLoader } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createAnimatedPlayer, loadAnimatedPlayer } from '../src/player/animated-player.mts';
import { movementConfig } from '../src/player/movement-config.mts';
import { t as createPublishedAnimator } from '../sumiro/bundle/anim-DUsNrsnS.js';

const clipDurations = {
  stand_idle: 3, walk: 1, jog: 14 / 24, run: 14 / 24, sprint: 0.5,
  jump_up: 10 / 24, jump_fwd: 10 / 24, fall: 0.5, land: 10 / 24, land_heavy: 26 / 24,
};

const idle = {
  state: 'IDLE', stateT: 0, grounded: true, landHeavy: false, stickMag: 0,
  x: 0, y: 0, z: 0, heading: 0, vx: 0, vz: 0,
};

function modelFixture() {
  const scene = new Group();
  const motion = new Object3D();
  motion.name = 'motion';
  scene.add(motion);
  const animations = Object.entries(clipDurations).map(([name, duration], index) => new AnimationClip(
    name, duration, [new NumberKeyframeTrack('motion.position[x]', [0, duration], [index + 1, index + 2])],
  ));
  return { scene, scenes: [scene], animations };
}

function realAction(player, model, name) {
  const clip = model.animations.find(clip => clip.name === name);
  const action = player.mixer.existingAction(clip);
  assert.ok(action, name);
  return action;
}

const archive = new URL('../sumiro/bundle/player-1_KrBWnI.js', import.meta.url);
const published = ts.createSourceFile(archive.pathname, await readFile(archive, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let gaitDeclaration;
let easingDeclaration;
function findGait(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'Gt') gaitDeclaration = node.getText(published);
  if (ts.isVariableDeclaration(node) && node.name.getText(published) === 'z' && node.parent.parent.parent === published) {
    easingDeclaration = node.getText(published);
  }
  ts.forEachChild(node, findGait);
}
findGait(published);
assert.ok(gaitDeclaration && easingDeclaration, 'published gait functions changed');

function createGaitOracle(model) {
  const original = createPublishedAnimator({ AnimationMixer }, model.scene, model.animations);
  const state = { vx: 0, vz: 0, mixSpeed: 0, stairK: 0, stairClimb: 0, swordK: 0, surface: 'stone', phase: 0, grounded: true };
  const sample = runInNewContext(`const ${easingDeclaration}; ${gaitDeclaration}; Gt`, {
    q: state, y: original, k: movementConfig, re: 0.02, ie: 0.52, qt() {},
  });
  original.playGait(0);
  return {
    original,
    update(frame, delta) {
      Object.assign(state, { vx: frame.vx, vz: frame.vz, grounded: frame.grounded });
      sample(delta);
      original.update(delta);
    },
  };
}

function comparePose(player, model, oracle) {
  for (const [name, expected] of oracle.original.actions) {
    const actual = realAction(player, model, name);
    assert.equal(actual.getEffectiveWeight(), expected.getEffectiveWeight(), `${name} weight`);
    // The bundled modulo adds a clip duration before wrapping a second time.
    if (expected.getEffectiveWeight() > 0) assert.ok(Math.abs(actual.time - expected.time) < 1e-12, `${name} time`);
  }
}

test('ground gait weights and shared stride phase agree with the shipped animator', () => {
  const model = modelFixture();
  const player = createAnimatedPlayer(model);
  const oracle = createGaitOracle(modelFixture());
  const dt = 1 / 60;
  for (const vx of [0, 0.2, 1.6, 2.4, 3.5, 4.4, 6.5, 7.5, 8, 0]) {
    for (let step = 0; step < 20; step++) {
      const state = { ...idle, vx, state: 'RUN', stateT: step * dt };
      player.update(state, dt);
      oracle.update(state, dt);
      comparePose(player, model, oracle);
    }
  }
  assert.ok(model.scene.getObjectByName('motion').position.x > 0);
  player.dispose();
});

test('jump, looping fall, and light landing retain the shipped clip envelopes', () => {
  const model = modelFixture();
  const player = createAnimatedPlayer(model);
  const oracle = createGaitOracle(modelFixture());
  oracle.update(idle, 0);
  const movingJump = { ...idle, state: 'JUMP', grounded: false, vx: 2.6, y: 1 };
  oracle.original.play('jump_fwd', { fade: 0.08 });
  for (const dt of [0.04, 0.12, 0.6]) {
    player.update(movingJump, dt);
    oracle.update(movingJump, dt);
    comparePose(player, model, oracle);
  }
  assert.equal(realAction(player, model, 'jump_fwd').time, clipDurations.jump_fwd);
  const falling = { ...movingJump, state: 'FALL', y: 0.7 };
  oracle.original.play('fall', { fade: 0.25 });
  for (const dt of [0.07, 0.5, 0.21]) {
    player.update(falling, dt);
    oracle.update(falling, dt);
    comparePose(player, model, oracle);
  }
  assert.ok(realAction(player, model, 'fall').time < clipDurations.fall);
  assert.equal(model.scene.position.y, 0.7);
  const landing = { ...idle, state: 'LAND', stickMag: 0.5, vx: 2.5 };
  oracle.original.play('land', { fade: 0.12, speed: 1.6 });
  player.update(landing, 0.1);
  oracle.update(landing, 0.1);
  comparePose(player, model, oracle);
  assert.equal(realAction(player, model, 'land').time, 0.16000000000000003);
  player.dispose();
});

test('a landing pose survives the controller returning to gait on its next tick', () => {
  const model = modelFixture();
  const player = createAnimatedPlayer(model);
  player.update({ ...idle, vx: 2.5, state: 'JUMP', grounded: false }, 0.1);
  assert.equal(realAction(player, model, 'jump_up').getEffectiveWeight(), 1);
  assert.equal(realAction(player, model, 'jump_fwd').getEffectiveWeight(), 0);
  player.update({ ...idle, state: 'LAND', landHeavy: true }, 0.12);
  const resumed = { ...idle, state: 'RUN', vx: 6.5, stickMag: 1 };
  player.update(resumed, 0.2);
  assert.equal(realAction(player, model, 'land_heavy').getEffectiveWeight(), 1);
  player.update(resumed, 1);
  assert.equal(realAction(player, model, 'land_heavy').time, clipDurations.land_heavy);
  player.update(resumed, 0.12);
  assert.equal(realAction(player, model, 'land_heavy').getEffectiveWeight(), 0);
  assert.ok(realAction(player, model, 'run').getEffectiveWeight() > 0);
  player.reset({ ...idle, x: 1, y: 2, z: 3, heading: 0.7 });
  assert.deepEqual(player.root.position.toArray(), [1, 2, 3]);
  assert.equal(player.root.rotation.order, 'YXZ');
  assert.equal(player.root.rotation.y, 0.7 + Math.PI);
  assert.equal(realAction(player, model, 'stand_idle').time, 0);
  assert.equal(realAction(player, model, 'stand_idle').getEffectiveWeight(), 1);
  player.dispose();
});

test('ground takeoff keeps the last grounded speed when air integration crosses the jump threshold', () => {
  const model = modelFixture();
  const player = createAnimatedPlayer(model);
  const airborne = { ...idle, state: 'JUMP', grounded: false };
  player.reset({ ...idle, vx: 2.4 });
  player.update({ ...airborne, vx: 2.6 }, 0.08);
  assert.equal(realAction(player, model, 'jump_up').getEffectiveWeight(), 1);
  player.reset({ ...idle, vx: 2.6 });
  player.update({ ...airborne, vx: 2.4 }, 0.08);
  assert.equal(realAction(player, model, 'jump_fwd').getEffectiveWeight(), 1);
  player.dispose();
});

test('the supplied GLB binds its real skeleton and disposes mixer and owned model resources', async context => {
  const glb = await readFile(new URL('../sumiro/assets/player/player.glb', import.meta.url));
  assert.equal(glb.toString('ascii', 0, 4), 'glTF');
  assert.equal(glb.toString('ascii', 16, 20), 'JSON');
  const metadata = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
  const clipNames = new Map(metadata.animations.map(clip => [clip.name, clip]));
  for (const [name, expected] of Object.entries(clipDurations)) {
    const clip = clipNames.get(name);
    assert.ok(clip, name);
    assert.equal(Math.max(...clip.samplers.map(sampler => metadata.accessors[sampler.input].max[0])), expected);
  }
  const armature = metadata.nodes[metadata.scenes[metadata.scene].nodes[0]];
  assert.equal(armature.name, 'Armature');
  assert.equal(armature.scale, undefined);

  // Keep parsing and animation native to Three. The embedded JPEG transport is controlled in Node.
  const originalSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
  Object.defineProperty(globalThis, 'self', { configurable: true, value: globalThis });
  context.after(() => {
    if (originalSelf) Object.defineProperty(globalThis, 'self', originalSelf);
    else delete globalThis.self;
  });
  context.mock.method(TextureLoader.prototype, 'load', (_url, loaded) => {
    const texture = new Texture();
    queueMicrotask(() => loaded(texture));
    return texture;
  });
  const buffer = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
  const model = await new GLTFLoader().parseAsync(buffer, '');
  const player = createAnimatedPlayer(model);
  const host = new Group();
  host.add(player.root);
  assert.equal(player.root.name, 'player');
  assert.deepEqual(player.root.scale.toArray(), [1, 1, 1]);
  const skinned = player.root.getObjectByName('Samurai');
  assert.ok(skinned instanceof SkinnedMesh);
  assert.equal(skinned.skeleton.bones.length, 96);
  assert.equal(skinned.frustumCulled, false);
  assert.ok(player.root.getObjectByName('SwordMesh') instanceof Mesh);
  const hips = player.root.getObjectByName('mixamorigHips');
  const idlePose = hips.position.clone();
  player.update({ ...idle, state: 'RUN', vx: 6.5, heading: Math.PI / 2 }, 0.2);
  assert.equal(player.root.rotation.y, 1.5 * Math.PI);
  assert.notDeepEqual(hips.position.toArray(), idlePose.toArray());

  skinned.skeleton.computeBoneTexture();
  let disposals = 0;
  for (const resource of [skinned.geometry, skinned.material, skinned.material.map, skinned.skeleton.boneTexture]) {
    resource.addEventListener('dispose', () => { disposals++; });
  }
  const firstClip = model.animations.find(clip => clip.name === 'stand_idle');
  assert.ok(player.mixer.existingAction(firstClip));
  player.dispose();
  player.dispose();
  assert.equal(disposals, 4);
  assert.equal(host.children.length, 0);
  assert.equal(player.mixer.existingAction(firstClip), null);
  assert.equal(player.mixer.stats.bindings.total, 0);
  assert.equal(player.mixer.stats.actions.inUse, 0);
});

test('the model service forwards cancellation and discards a model delivered after abort', async () => {
  const model = modelFixture();
  const host = new Group();
  host.add(model.scene);
  const ready = Promise.withResolvers();
  const controller = new AbortController();
  const assets = {
    loadGLTF(path, options) {
      assert.equal(path, 'player/player.glb');
      assert.equal(options.signal, controller.signal);
      return ready.promise;
    },
  };
  const result = assert.rejects(loadAnimatedPlayer(assets, { signal: controller.signal }), { name: 'AbortError' });
  controller.abort();
  ready.resolve(model);
  await result;
  assert.deepEqual(host.children, []);
  await assert.rejects(loadAnimatedPlayer({ loadGLTF: () => assert.fail('already cancelled') }, { signal: controller.signal }), { name: 'AbortError' });
  const missing = modelFixture();
  missing.animations = missing.animations.filter(clip => clip.name !== 'land_heavy');
  await assert.rejects(loadAnimatedPlayer({ loadGLTF: async () => missing }), /land_heavy/);
});
