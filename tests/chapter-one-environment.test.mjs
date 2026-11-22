import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { Box3, ClampToEdgeWrapping, MathUtils, Mesh, MeshBasicMaterial, NoColorSpace, Raycaster, Vector3 } from 'three';
import { createAssetManager, disposeGLTF } from '../src/assets/asset-manager.mts';
import { chapterOneEnvironmentAssets, loadChapterOneEnvironment } from '../src/application/chapter-one-environment.mts';
import { n as originalGate, r as originalTempleKeys } from '../sumiro/bundle/layout-BFL31pIQ.js';
import { t as originalCliffStyles } from '../sumiro/bundle/materials-CGuChJ0C.js';

const assetBase = 'https://chapter-one.assets.test/';
const assetFolder = new URL('../sumiro/assets/', import.meta.url);

function span(source, first, next) {
  const start = source.indexOf(first);
  const end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start, `Published environment boundary changed at ${first}`);
  return source.slice(start, end);
}

// The original Draco worker script and wasm run natively in a Node worker.
class NativeWorker {
  constructor(url) {
    this.worker = resolveObjectURL(url).text().then(source => {
      const worker = new Worker(`
        const { parentPort } = require('node:worker_threads');
        globalThis.self = globalThis;
        globalThis.onmessage = null;
        self.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
        ${source}
        parentPort.on('message', data => self.onmessage({ data }));
      `, { eval: true });
      worker.on('message', data => this.onmessage?.({ data }));
      return worker;
    });
  }
  postMessage(message, transfer) { void this.worker.then(worker => worker.postMessage(message, transfer)); }
  terminate() { void this.worker.then(worker => worker.terminate()); }
}

function replaceGlobal(context, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  context.after(() => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete globalThis[name];
  });
}

function readPngDimensions(bytes) {
  const buffer = Buffer.from(bytes);
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function nativeAssetFixture(context) {
  const nativeFetch = globalThis.fetch;
  const models = new Map();
  const decoderHits = [];
  const imageSizes = [];
  replaceGlobal(context, 'self', globalThis);
  replaceGlobal(context, 'Worker', NativeWorker);
  if (typeof ProgressEvent === 'undefined') replaceGlobal(context, 'ProgressEvent', Event);
  // Image pixels are not rendered in Node. Verify their real PNG headers and
  // supply image dimensions while the actual GLTFLoader assembles the textures.
  replaceGlobal(context, 'createImageBitmap', async blob => {
    const size = readPngDimensions(await blob.slice(0, 24).arrayBuffer());
    imageSizes.push(size);
    return size;
  });
  replaceGlobal(context, 'document', {
    createElementNS(_namespace, kind) {
      assert.equal(kind, 'img');
      return new class extends EventTarget {
        set src(value) {
          const url = new URL(value);
          assert.equal(url.origin + '/', assetBase);
          readFile(new URL(url.pathname.slice(1), assetFolder)).then(bytes => {
            Object.assign(this, readPngDimensions(bytes));
            this.dispatchEvent(new Event('load'));
          }, () => this.dispatchEvent(new Event('error')));
        }
      }();
    },
  });
  replaceGlobal(context, 'fetch', async (request, options) => {
    const url = new URL(typeof request === 'string' ? request : request.url);
    if (url.protocol !== 'file:') return nativeFetch(request, options);
    assert.match(url.pathname, /\/three\/examples\/jsm\/libs\/draco\/gltf\/draco_(wasm_wrapper\.js|decoder\.wasm)$/);
    const data = await readFile(url);
    decoderHits.push(url.pathname.split('/').at(-1));
    return new Response(data);
  });
  const assets = createAssetManager({ assetBaseURL: assetBase, fetch: async value => {
    const url = new URL(value);
    assert.equal(url.origin + '/', assetBase);
    const path = url.pathname.slice(1);
    const data = await readFile(new URL(path, assetFolder));
    const jsonLength = data.readUInt32LE(12);
    assert.equal(data.readUInt32LE(16), 0x4e4f534a);
    models.set(path, JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8')));
    return new Response(data);
  } });
  context.after(() => assets.dispose());
  return { assets, models, decoderHits, imageSizes };
}

function lifetimeFixture(context) {
  const controller = new AbortController();
  const cleanups = [];
  context.after(async () => {
    controller.abort();
    for (const cleanup of cleanups.reverse()) await cleanup();
  });
  return { signal: controller.signal, defer(cleanup) { cleanups.push(cleanup); } };
}

test('Chapter One assembles the supplied GLBs, Draco geometry and look textures in Node', async context => {
  const { assets, models, decoderHits, imageSizes } = nativeAssetFixture(context);
  const lifetime = lifetimeFixture(context);
  const environment = await loadChapterOneEnvironment(assets, lifetime);
  const { cliff, crossing, plateau, gate, course } = chapterOneEnvironmentAssets;
  assert.deepEqual([...models.keys()].sort(), [...cliff, ...crossing, plateau, gate, course].sort());
  assert.deepEqual([...models].filter(([, json]) => json.extensionsRequired?.includes('KHR_draco_mesh_compression'))
    .map(([path]) => path).sort(), [...crossing, plateau].sort());
  assert.deepEqual(decoderHits.sort(), ['draco_decoder.wasm', 'draco_wasm_wrapper.js']);
  assert.ok(imageSizes.length > 10 && imageSizes.every(({ width, height }) => width > 0 && height > 0));

  const { root } = environment;
  assert.equal(root.children.length, 10);
  for (const name of ['set_path', 'set_wall', 'set_lobes', 'set_rocks', 'env_bridge', 'env_stairs', 'env_slab']) {
    const node = root.getObjectByName(name);
    assert.deepEqual(node.position.toArray(), [0, 0, 0], name);
    assert.equal(new Box3().setFromObject(node).isEmpty(), false, name);
  }
  for (const name of ['path', 'bridge_planks', 'stair_blocks', 'slab_top', 'wall_front', 'plateau_top']) {
    assert.ok(root.getObjectByName(name).geometry.attributes.position.count > 0, name);
  }
  assert.deepEqual({
    preset: originalCliffStyles.path.preset, look: originalCliffStyles.path.look, tint: originalCliffStyles.path.tint,
    cavityK: originalCliffStyles.path.cavityK, lineWeight: originalCliffStyles.path.lineWeight,
  }, { preset: 'stone', look: true, tint: [1.008, 1, 0.972], cavityK: 0.5, lineWeight: 0.9 });
  for (const path of cliff) {
    const model = models.get(path);
    for (const node of model.nodes.filter(node => node.mesh !== undefined)) {
      const primitive = model.meshes[node.mesh].primitives[0];
      const source = model.materials[primitive.material];
      const style = source.name.replace(/\.\d+$/, '').replace(/^mat_/, '');
      if (!originalCliffStyles[style]?.look) continue;
      const paint = model.accessors[primitive.attributes.COLOR_0];
      assert.equal(paint.type, 'VEC4', node.name);
      assert.equal(paint.normalized, true, node.name);
      const { material } = root.getObjectByName(node.name);
      assert.equal(material.vertexColors, false, node.name);
      assert.equal(material.map, null, node.name);
      const lookSamples = [];
      material.colorNode.traverse(node => {
        if (node.isSplitNode && node.node.isTextureNode) lookSamples.push(node);
      });
      assert.equal(lookSamples.length, 1, node.name);
      assert.equal(lookSamples[0].components, 'x', node.name);
      assert.equal(lookSamples[0].node.value.colorSpace, NoColorSpace, node.name);
    }
  }
  assert.equal(root.getObjectByName('plateau_collision').visible, false);
  assert.equal(root.getObjectByName('fade_face').material.transparent, true);
  assert.equal(root.getObjectByName('fade_face').renderOrder, -10);
  for (const name of ['wall_front', 'plateau_top']) {
    const look = root.getObjectByName(name).material.map;
    assert.ok(look.image.width > 0 && look.image.height > 0);
    assert.equal(look.flipY, false);
    assert.equal(look.wrapS, ClampToEdgeWrapping);
    assert.equal(look.wrapT, ClampToEdgeWrapping);
  }

  const gateRoot = root.getObjectByName('gate_root');
  assert.deepEqual(gateRoot.position.toArray(), [originalGate.x, originalGate.y, originalGate.z]);
  assert.equal(gateRoot.rotation.y, originalGate.yaw);
  const temple = root.getObjectByName('temple_root');
  const cards = root.getObjectByName('temple_cards_fixed');
  const gateSource = await readFile(new URL('../sumiro/bundle/env_gate-_uuAXCZF.js', import.meta.url), 'utf8');
  const originalSeatRidge = Function('i', 'r', 'e', 't', 'n', span(gateSource, 'var x=new i', 'async function E(') + 'return T;')(
    Vector3, Mesh, MeshBasicMaterial, Raycaster, MathUtils,
  );
  const sourceGate = await assets.loadGLTF(gate, { displaySpace: false });
  lifetime.defer(() => disposeGLTF(sourceGate));
  sourceGate.scene.updateMatrixWorld(true);
  const board = sourceGate.scene.getObjectByName('gate_ridge_board');
  const tiles = sourceGate.scene.getObjectByName('gate_tile');
  const unadjusted = board.geometry.attributes.position.array.slice();
  originalSeatRidge(board, tiles);
  assert.notDeepEqual(board.geometry.attributes.position.array, unadjusted);
  assert.deepEqual(root.getObjectByName('gate_ridge_board').geometry.attributes.position.array, board.geometry.attributes.position.array);
  const originalTemple = Function('l', 'n', span(gateSource, 'function b(', 'var x=new') + 'return b;')(
    originalTempleKeys, MathUtils,
  );
  for (const railFrame of [0, 186, 192, 198, 202, 208, 214, 300]) {
    environment.update({ railFrame, cameraY: 9.6 });
    assert.deepEqual(temple.position.toArray(), originalTemple(railFrame, new Vector3()).toArray());
    assert.equal(cards.material.opacity, MathUtils.smoothstep(railFrame, 186, 198));
    assert.equal(cards.visible, cards.material.opacity > 0);
  }
  const shoulder = root.getObjectByName('shoulder_left');
  assert.equal(shoulder.position.x, 0.9 * 2.6 * MathUtils.smoothstep(9.6, 9.2, 10));
  assert.equal(shoulder.position.z, -0.44 * 2.6 * MathUtils.smoothstep(9.6, 9.2, 10));

  const chapterSource = await readFile(new URL('../sumiro/bundle/ch1_climb-D1obDXnH.js', import.meta.url), 'utf8');
  const originalCourse = Function(span(chapterSource, 'var T=(e,t,n,r,i)', ',re=') + ';return E;')();
  const reshapeCourse = Function('D', 'ae', span(chapterSource, 'function oe(', 'function se(') + 'return oe;')(0.3, 0.12);
  const sourcePieces = await assets.loadGLTF(course);
  lifetime.defer(() => disposeGLTF(sourcePieces));
  assert.deepEqual(environment.course.children.map(node => node.name), originalCourse.map(site => site.id));
  for (const site of originalCourse) {
    const node = environment.course.getObjectByName(site.id);
    const template = sourcePieces.scene.getObjectByName(site.piece);
    assert.deepEqual(node.position.toArray(), [site.x, site.top, site.z]);
    const spread = site.noCollide ? 1 : 1.1;
    assert.deepEqual(node.scale.toArray(), [site.w * spread, site.h, site.d * spread]);
    const expected = site.noCollide ? template.geometry : reshapeCourse(template.geometry, site.h);
    assert.deepEqual(node.geometry.attributes.position.array, expected.attributes.position.array);
    if (!site.noCollide) expected.dispose();
  }
});
