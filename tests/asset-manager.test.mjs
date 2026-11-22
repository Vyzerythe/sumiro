import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BufferGeometry, Material, NoColorSpace, SRGBColorSpace, Texture } from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { createAssetManager } from '../src/assets/asset-manager.mts';

const assetBaseURL = 'https://assets.example.test/game/assets/';

function controlledFetch() {
  const requests = new Map();
  return {
    requests,
    fetch(url, { signal }) {
      return new Promise(resolve => requests.set(url, { signal, resolve }));
    },
  };
}

function replaceGlobal(context, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  context.after(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  });
}

function captureImageRequests(context) {
  const images = [];
  replaceGlobal(context, 'self', globalThis);
  replaceGlobal(context, 'document', {
    createElementNS(namespace, name) {
      assert.equal(namespace, 'http://www.w3.org/1999/xhtml');
      assert.equal(name, 'img');
      const image = new EventTarget();
      images.push(image);
      return image;
    },
  });
  return images;
}

function triangleGLTF() {
  return {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'Triangle' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
  };
}

const trianglePositions = [0, 0, 0, 1, 0, 0, 0, 1, 0];

function texturedTriangleGLB() {
  const gltf = triangleGLTF();
  gltf.meshes[0].primitives[0].material = 0;
  gltf.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }];
  gltf.textures = [{ source: 0 }];
  gltf.images = [{ uri: 'albedo.png' }];
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const glb = new ArrayBuffer(12 + 8 + jsonLength + 8 + 36);
  const view = new DataView(glb);
  const bytes = new Uint8Array(glb);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, glb.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + jsonLength);
  bytes.set(json, 20);
  view.setUint32(20 + jsonLength, 36, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  for (const [index, value] of trianglePositions.entries()) view.setFloat32(28 + jsonLength + index * 4, value, true);
  return glb;
}

test('URLs use the caller asset directory, and real fetch reads JSON and binary data', async context => {
  const assets = createAssetManager({ assetBaseURL: './game/assets' });
  context.after(() => assets.dispose());
  assert.equal(assets.url('levels/start.json?rev=2'), './game/assets/levels/start.json?rev=2');
  for (const url of ['/game/shared.json', '//example.test/file', 'blob:https://game.example/id', 'custom+v2:asset']) {
    assert.equal(assets.url(url), url);
  }
  const json = assets.loadJSON('data:application/json,%7B%22stage%22%3A2%7D');
  const binary = assets.loadArrayBuffer('data:application/octet-stream;base64,AP9/');
  assert.equal(assets.pending, 2);
  assert.deepEqual(await json, { stage: 2 });
  assert.deepEqual(new Uint8Array(await binary), new Uint8Array([0, 255, 127]));
  await assets.whenIdle();
  assert.equal(assets.pending, 0);
});

test('idle waits for overlapping requests and loads queued by a completion', async context => {
  const { fetch, requests } = controlledFetch();
  const assets = createAssetManager({ assetBaseURL: new URL(assetBaseURL), fetch });
  context.after(() => assets.dispose());
  const first = assets.loadJSON('first.json');
  const followup = first.then(() => assets.loadArrayBuffer('next.bin'));
  const failed = assert.rejects(assets.loadJSON('missing.json'), {
    message: `Failed to load ${assetBaseURL}missing.json: HTTP 404`,
  });
  let settled = false;
  const idle = assets.whenIdle().then(() => { settled = true; });
  assert.equal(assets.pending, 2);
  await Promise.resolve();
  requests.get(assetBaseURL + 'first.json').resolve(Response.json({ next: true }));
  requests.get(assetBaseURL + 'missing.json').resolve(new Response(null, { status: 404 }));
  await Promise.all([first, failed]);
  assert.equal(assets.pending, 1);
  assert.equal(settled, false);
  requests.get(assetBaseURL + 'next.bin').resolve(new Response(new Uint8Array([1])));
  await followup;
  await idle;
  assert.equal(assets.pending, 0);
});

test('caller cancellation, timeout, and disposal settle even an uncooperative fetch', async context => {
  const { fetch, requests } = controlledFetch();
  const decoderPath = context.mock.method(DRACOLoader.prototype, 'setDecoderPath');
  const releaseDecoder = context.mock.method(DRACOLoader.prototype, 'dispose');
  const assets = createAssetManager({ assetBaseURL, dracoDecoderBaseURL: '/game/decoders/draco', timeoutMs: 100, fetch });
  context.after(() => assets.dispose());
  assert.deepEqual(decoderPath.mock.calls[0].arguments, ['/game/decoders/draco/']);
  const external = new AbortController();
  const reason = new Error('Chapter changed');
  const cancelled = assert.rejects(assets.loadJSON('cancel.json', { signal: external.signal }), error => error === reason);
  const other = assets.loadJSON('other.json');
  await Promise.resolve();
  external.abort(reason);
  assert.equal(requests.get(assetBaseURL + 'cancel.json').signal.reason, reason);
  assert.equal(requests.get(assetBaseURL + 'other.json').signal.aborted, false);
  requests.get(assetBaseURL + 'other.json').resolve(Response.json({ okay: true }));
  assert.deepEqual(await other, { okay: true });
  await cancelled;
  await assert.rejects(assets.loadJSON('cancelled-before-start.json', { signal: external.signal }), error => error === reason);
  assert.equal(requests.has(assetBaseURL + 'cancelled-before-start.json'), false);

  const timeout = assert.rejects(assets.loadArrayBuffer('timeout.bin'), { name: 'TimeoutError' });
  await timeout;
  assert.equal(requests.get(assetBaseURL + 'timeout.bin').signal.aborted, true);
  assert.equal(assets.pending, 0);

  const disposed = assert.rejects(assets.loadGLTF('dispose.glb'), { name: 'AbortError' });
  const idle = assets.whenIdle();
  await Promise.resolve();
  assets.dispose();
  assets.dispose();
  await disposed;
  await idle;
  assert.equal(requests.get(assetBaseURL + 'dispose.glb').signal.aborted, true);
  assert.equal(assets.pending, 0);
  assert.equal(releaseDecoder.mock.callCount(), 1);
  await assert.rejects(assets.loadTexture('after.png'), { name: 'AbortError' });
});

test('Three TextureLoader uses the resolved path and discards a cancelled late result', async context => {
  const images = captureImageRequests(context);
  const releaseTexture = context.mock.method(Texture.prototype, 'dispose');
  const assets = createAssetManager({ assetBaseURL });
  context.after(() => assets.dispose());
  const loaded = assets.loadTexture('albedo.png', { colorSpace: SRGBColorSpace });
  const failed = assert.rejects(assets.loadTexture('missing.png'), error => error.cause instanceof Event);
  const external = new AbortController();
  const cancelled = assert.rejects(assets.loadTexture('late.png', { signal: external.signal }), { name: 'AbortError' });
  await Promise.resolve();
  assert.deepEqual(images.map(image => image.src), ['albedo.png', 'missing.png', 'late.png'].map(path => assetBaseURL + path));
  images[0].dispatchEvent(new Event('load'));
  images[1].dispatchEvent(new Event('error'));
  external.abort();
  const texture = await loaded;
  assert.equal(texture.image, images[0]);
  assert.equal(texture.colorSpace, SRGBColorSpace);
  await Promise.all([failed, cancelled, assets.whenIdle()]);
  assert.equal(assets.pending, 0);
  images[2].dispatchEvent(new Event('load'));
  await Promise.resolve();
  assert.equal(releaseTexture.mock.callCount(), 1);
});

test('Three GLTFLoader parses a real GLB and honors display-space texture handling', async context => {
  const images = captureImageRequests(context);
  const data = texturedTriangleGLB();
  const assets = createAssetManager({
    assetBaseURL,
    fetch: async url => new Response(url.endsWith('/broken.glb') ? 'not a GLB' : data),
  });
  context.after(() => assets.dispose());
  const display = assets.loadGLTF('models/triangle.glb');
  const original = assets.loadGLTF('models/triangle.glb', { displaySpace: false });
  const failed = assert.rejects(assets.loadGLTF('broken.glb'), error => error.cause instanceof SyntaxError);
  // Let the response body and the parser reach the controlled image transport.
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(images.length, 2);
  for (const image of images) {
    assert.equal(image.src, assetBaseURL + 'models/albedo.png');
    image.dispatchEvent(new Event('load'));
  }
  const [displayModel, originalModel] = await Promise.all([display, original]);
  const displayMesh = displayModel.scene.getObjectByName('Triangle');
  const originalMesh = originalModel.scene.getObjectByName('Triangle');
  assert.deepEqual([...displayMesh.geometry.attributes.position.array], trianglePositions);
  assert.equal(displayMesh.material.map.colorSpace, NoColorSpace);
  assert.equal(originalMesh.material.map.colorSpace, SRGBColorSpace);
  assert.equal(displayMesh.material.map.version, originalMesh.material.map.version + 1);
  await failed;
  await assets.whenIdle();
  assert.equal(assets.pending, 0);
});

test('a GLB completed after cancellation releases its unclaimed resources', async context => {
  const images = captureImageRequests(context);
  const geometry = context.mock.method(BufferGeometry.prototype, 'dispose');
  const material = context.mock.method(Material.prototype, 'dispose');
  const texture = context.mock.method(Texture.prototype, 'dispose');
  const assets = createAssetManager({ assetBaseURL, fetch: async () => new Response(texturedTriangleGLB()) });
  context.after(() => assets.dispose());
  const controller = new AbortController();
  const cancelled = assert.rejects(assets.loadGLTF('models/triangle.glb', { signal: controller.signal }),
    { name: 'AbortError' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(images.length, 1);
  controller.abort();
  await cancelled;
  images[0].dispatchEvent(new Event('load'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(geometry.mock.callCount(), 1);
  assert.equal(material.mock.callCount(), 1);
  assert.equal(texture.mock.callCount(), 1);
});

test('caller cancellation preserves shared glTF fetches and teardown aborts outstanding dependencies', async context => {
  const gltf = triangleGLTF();
  gltf.buffers[0].uri = 'triangle.bin';
  const dependencyRequests = [];
  if (typeof ProgressEvent === 'undefined') replaceGlobal(context, 'ProgressEvent', Event);
  replaceGlobal(context, 'fetch', request => new Promise((resolve, reject) => {
    const abort = () => reject(request.signal.reason);
    request.signal.addEventListener('abort', abort, { once: true });
    dependencyRequests.push({
      request,
      finish() {
        request.signal.removeEventListener('abort', abort);
        resolve(new Response(new Float32Array(trianglePositions)));
      },
    });
  }));
  const assets = createAssetManager({ assetBaseURL, fetch: async () => Response.json(gltf) });
  context.after(() => assets.dispose());
  const caller = new AbortController();
  const cancelled = assert.rejects(assets.loadGLTF('models/one.gltf', { signal: caller.signal }), { name: 'AbortError' });
  const concurrent = assets.loadGLTF('models/two.gltf');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(dependencyRequests.length, 1);
  const shared = dependencyRequests[0];
  assert.equal(shared.request.url, assetBaseURL + 'models/triangle.bin');
  caller.abort();
  await cancelled;
  assert.equal(shared.request.signal.aborted, false);
  shared.finish();
  const model = await concurrent;
  assert.deepEqual([...model.scene.getObjectByName('Triangle').geometry.attributes.position.array], trianglePositions);

  const stopped = assert.rejects(assets.loadGLTF('other/three.gltf'), { name: 'AbortError' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(dependencyRequests.length, 2);
  assets.dispose();
  assert.equal(dependencyRequests[1].request.signal.aborted, true);
  await stopped;
  await assets.whenIdle();
  assert.equal(assets.pending, 0);
});
