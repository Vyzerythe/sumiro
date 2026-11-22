import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  BufferGeometry, CatmullRomCurve3, ClampToEdgeWrapping, Float32BufferAttribute, Group, LinearMipmapLinearFilter,
  Mesh, NoColorSpace, TubeGeometry, Vector3,
} from 'three';
import { createAssetManager } from '../src/assets/asset-manager.mts';
import { loadChapterOneLandmarks } from '../src/application/chapter-one-landmarks.mts';
import { i as gateToWorld, n as gateLayout } from '../sumiro/bundle/layout-BFL31pIQ.js';
import { t as poolTrigger } from '../sumiro/bundle/layout-BxJUyHwJ.js';
import { t as originalInkLift } from '../sumiro/bundle/layout-DibyQJX5.js';

const assetsDirectory = new URL('../sumiro/assets/', import.meta.url);
const bundleDirectory = new URL('../sumiro/bundle/', import.meta.url);

function span(source, first, next) {
  const start = source.indexOf(first);
  const end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start, 'Published landmark boundary at ' + first);
  return source.slice(start, end);
}

function webpSize(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 16), 'WEBPVP8 ');
  assert.deepEqual([...bytes.subarray(23, 26)], [0x9d, 0x01, 0x2a]);
  return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
}

function assetFixture(context) {
  const controller = new AbortController();
  const cleanups = [];
  const inputs = new Map();
  const textures = new Map();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElementNS(_space, kind) {
      assert.equal(kind, 'img');
      return new class extends EventTarget {
        set src(resource) {
          const path = new URL(resource).pathname.slice(1);
          readFile(new URL(path, assetsDirectory)).then(bytes => {
            inputs.set(path, bytes);
            [this.width, this.height] = webpSize(bytes);
            this.dispatchEvent(new Event('load'));
          }, () => this.dispatchEvent(new Event('error')));
        }
      }();
    },
  } });
  const service = createAssetManager({ assetBaseURL: 'https://landmarks.assets.test/', fetch: async resource => {
    const path = new URL(resource).pathname.slice(1);
    const bytes = await readFile(new URL(path, assetsDirectory));
    inputs.set(path, bytes);
    return new Response(bytes);
  } });
  async function release() {
    controller.abort();
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    service.dispose();
  }
  context.after(async () => {
    await release();
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  });
  return {
    assets: {
      loadGLTF: service.loadGLTF,
      async loadTexture(path, options) {
        const texture = await service.loadTexture(path, options);
        textures.set(path, texture);
        return texture;
      },
    },
    lifetime: { signal: controller.signal, defer(cleanup) { cleanups.push(cleanup); } },
    inputs, textures, release,
  };
}

function authoredPositions(glb, name) {
  assert.equal(glb.toString('ascii', 0, 4), 'glTF');
  const length = glb.readUInt32LE(12);
  const model = JSON.parse(glb.subarray(20, 20 + length).toString());
  const node = model.nodes.find(node => node.name === name);
  const primitive = model.meshes[node.mesh].primitives[0];
  const position = model.accessors[primitive.attributes.POSITION];
  assert.equal(position.componentType, 5126);
  assert.equal(position.type, 'VEC3');
  const base = 28 + length + model.bufferViews[position.bufferView].byteOffset + (position.byteOffset ?? 0);
  return Array.from({ length: position.count * 3 }, (_, index) => glb.readFloatLE(base + index * 4));
}

test('Chapter One pool and stain use the actual terrain-conformed meshes and WebP masks', async context => {
  const { assets, lifetime, inputs, textures, release } = assetFixture(context);
  const landmarks = await loadChapterOneLandmarks(assets, lifetime);
  assert.equal(landmarks.root.parent, null);
  assert.deepEqual([...inputs.keys()].sort(), ['fx_ink/fx_ink.glb', 'fx_ink/pool.webp', 'fx_ink/stain.webp']);
  const sizes = { 'fx_ink/pool.webp': [1536, 1536], 'fx_ink/stain.webp': [2600, 3200] };
  for (const [path, texture] of textures) {
    assert.deepEqual([texture.image.width, texture.image.height], sizes[path]);
    assert.equal(texture.colorSpace, NoColorSpace);
    assert.equal(texture.wrapS, ClampToEdgeWrapping);
    assert.equal(texture.wrapT, ClampToEdgeWrapping);
    assert.equal(texture.generateMipmaps, true);
    assert.equal(texture.minFilter, LinearMipmapLinearFilter);
  }
  const glb = inputs.get('fx_ink/fx_ink.glb');
  for (const [mesh, lift, order, depthOffset] of [
    [landmarks.stain, originalInkLift, 1, -4], [landmarks.pool, originalInkLift + 0.002, 2, -6],
  ]) {
    assert.deepEqual([...mesh.geometry.attributes.position.array], authoredPositions(glb, mesh.name));
    assert.deepEqual(mesh.position.toArray(), [0, lift, 0]);
    assert.equal(mesh.renderOrder, order);
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.receiveShadow, false);
    assert.equal(mesh.material.transparent, true);
    assert.equal(mesh.material.depthWrite, false);
    assert.equal(mesh.material.isNodeMaterial, true);
    assert.equal(mesh.material.polygonOffsetFactor, -1);
    assert.equal(mesh.material.polygonOffsetUnits, depthOffset);
  }
  assert.equal(landmarks.root.getObjectByName('review_slab'), undefined);
  const stage = new Group();
  stage.add(landmarks.root);
  let disposals = 0;
  for (const resource of [landmarks.pool.geometry, landmarks.stain.geometry, landmarks.pool.material, landmarks.stain.material, ...textures.values()]) {
    resource.addEventListener('dispose', () => disposals++);
  }
  await release();
  assert.equal(disposals, 6);
  assert.deepEqual(stage.children, []);
});

test('ropes and paper strips match the shipped builder and variable-step gate fall', async context => {
  const { assets, lifetime } = assetFixture(context);
  const actual = await loadChapterOneLandmarks(assets, lifetime);
  const original = await readFile(new URL('ch1_climb-D1obDXnH.js', bundleDirectory), 'utf8');
  const buildStory = Function('e', 'c', 's', 'i', 'u', 'a', 't', 'w', 'te', 'v', 'C', 'f',
    span(original, 'var Oe=', 'function Ie(') + span(original, 'function Re(', 'var ze=') + 'return Re;')(
    Group, CatmullRomCurve3, Vector3, Mesh, TubeGeometry, BufferGeometry, Float32BufferAttribute,
    gateToWorld, gateLayout, () => {}, poolTrigger, () => false,
  );
  const referenceStage = new Group();
  let phase = 'barred';
  const story = {
    story: true,
    setFlag() {},
    grantAbility() {},
    hint() {},
  };
  const body = { c: { ...poolTrigger, vx: 0, vz: 0, grounded: true }, act: () => true };
  const values = new Map([['game', story], ['game.state', 'PLAY'], ['player.body', body]]);
  const reference = buildStory({
    registry: {
      get: key => values.get(key),
      set(key) { if (key === 'audio.cue') phase = 'dropping'; },
    },
  }, {
    group: referenceStage, takeoffMarks: [], triggers: [{ id: 'gate_through', poly: [] }], interactables: [],
    courseGroup: new Group(), world: { setGroup() {} },
  });
  const rope = referenceStage.getObjectByName('gate_rope');
  for (const name of ['rope', 'shide']) {
    assert.deepEqual(actual.rope.getObjectByName(name).geometry.attributes.position.array,
      rope.getObjectByName(name).geometry.attributes.position.array);
  }
  assert.deepEqual(actual.rope.position.toArray(), rope.position.toArray());
  assert.equal(actual.rope.rotation.y, rope.rotation.y);
  reference.enter({ flags: {} });
  const states = new Set();
  for (const dt of [0, 0.42, 1, 1.1, 1.2, 0.13, 0.29, 0.42, 0.39, 0.27, 1]) {
    reference.update(dt);
    if (phase === 'dropping' && !rope.visible) phase = 'open';
    actual.update(dt, phase);
    states.add(phase);
    assert.equal(actual.rope.visible, rope.visible, phase);
    assert.equal(actual.rope.rotation.z, rope.rotation.z, phase);
    assert.deepEqual(actual.rope.position.toArray(), rope.position.toArray(), phase);
  }
  assert.deepEqual([...states], ['barred', 'dropping', 'open']);
  actual.update(0, 'barred');
  assert.equal(actual.rope.visible, true);
  actual.update(0, 'open');
  assert.equal(actual.rope.visible, false);
  assert.equal(actual.pool.visible, true);
  assert.equal(actual.stain.visible, true);
});
