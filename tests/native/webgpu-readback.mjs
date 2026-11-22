import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { create, globals } from 'webgpu';
import { Mesh, MeshBasicNodeMaterial, OrthographicCamera, PlaneGeometry, Scene } from 'three/webgpu';
import { mix, uniform, vec3, vec4 } from 'three/tsl';
import { createChapterPreview } from '../../src/application/chapter-preview.mts';
import { createTraversalPreview } from '../../src/application/traversal-preview.mts';
import { createRunProgress } from '../../src/domain/run-progress.mts';
import { createDefaultRun } from '../../src/domain/save.mts';
import { createInkDepthKey } from '../../src/rendering/ink-depth-key.mts';
import { createInkRenderGraph } from '../../src/rendering/ink-render-graph.mts';
import { createInkSurfaceOutput } from '../../src/rendering/ink-surface-pass.mts';
import { createSourceRuntime } from '../../src/runtime/source-runtime.mts';

const gpu = create(process.argv.slice(2));
let pendingFrame;
Object.assign(globalThis, globals, {
  self: globalThis,
  requestAnimationFrame(callback) {
    pendingFrame = callback;
    return 1;
  },
  cancelAnimationFrame() {
    pendingFrame = undefined;
  },
});
Object.defineProperty(navigator, 'gpu', { value: gpu, configurable: true });

// Dawn supplies a real device and queue. This harness substitutes an offscreen
// texture for the browser canvas's presentation texture.
let configuration;
let device;
let attachment;
let unconfigured = 0;
const canvas = {
  width: 32,
  height: 32,
  getContext(kind) {
    assert.equal(kind, 'webgpu');
    return context;
  },
};
const context = {
  configure(options) {
    configuration = options;
  },
  getCurrentTexture() {
    if (attachment?.width === canvas.width && attachment.height === canvas.height) return attachment;
    attachment?.destroy();
    attachment = configuration.device.createTexture({
      size: [canvas.width, canvas.height],
      format: configuration.format,
      usage: configuration.usage,
    });
    return attachment;
  },
  unconfigure() {
    unconfigured++;
    attachment?.destroy();
    attachment = undefined;
  },
};
const nativeGpu = {
  async requestAdapter(options) {
    const adapter = await gpu.requestAdapter(options);
    assert.ok(adapter, 'Dawn must expose a WebGPU adapter');
    console.log('WebGPU adapter', adapter.info.description);
    return {
      async requestDevice(descriptor) {
        device = await adapter.requestDevice(descriptor);
        return device;
      },
    };
  },
};

const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.z = 2;
const scene = new Scene();
const geometry = new PlaneGeometry(2, 2);
const material = new MeshBasicNodeMaterial();
const strength = uniform(1);
const inspectNormalWeight = uniform(0);
const inspectDepth = uniform(0);
const inspectKey = uniform(0);
const inspectEdge = uniform(0);
const inspectComposite = uniform(0);
const applyInk = uniform(0);
material.mrtNode = createInkSurfaceOutput({ lineWeight: 0.25 });
const background = new Mesh(geometry, material);
const foregroundGeometry = new PlaneGeometry(0.12, 0.24);
const foregroundMaterial = new MeshBasicNodeMaterial();
foregroundMaterial.mrtNode = createInkSurfaceOutput({ lineWeight: 1, movingSurfaceId: 3 });
const foreground = new Mesh(foregroundGeometry, foregroundMaterial);
foreground.position.set(0.2, 0, 1);
const keyboardTarget = new EventTarget();

function pressSpace() {
  const event = Object.assign(new Event('keydown', { cancelable: true }), {
    code: 'Space', repeat: false, ctrlKey: false, altKey: false,
  });
  keyboardTarget.dispatchEvent(event);
  return event.defaultPrevented;
}

async function sample(x, y) {
  const { format } = configuration;
  assert.match(format, /^(rgba|bgra)8unorm(?:-srgb)?$/, 'readback requires a four-byte normalized format');
  const bytesPerRow = 256;
  const readback = device.createBuffer({ size: bytesPerRow, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: attachment, origin: { x, y } },
      { buffer: readback, bytesPerRow },
      { width: 1, height: 1 },
    );
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const pixel = [...new Uint8Array(readback.getMappedRange()).subarray(0, 4)];
    if (format.startsWith('bgra')) [pixel[0], pixel[2]] = [pixel[2], pixel[0]];
    return pixel;
  } finally {
    readback.destroy();
  }
}

let runtime;
let depthKey;
let inkGraph;
let graphReleases = 0;
let contextRequests = 0;
let systemCleanups = 0;
let renderCallbacks = 0;
let updateCallbacks = 0;
try {
  runtime = await createSourceRuntime({
    graphics: {
      canvas, scene, camera,
      buildOutput(scenePass) {
        inkGraph = createInkRenderGraph(scenePass, camera, { referenceHeight: 60, fogStrength: 0 });
        const { color, depth, normalWeight, surfaceData } = inkGraph.attachments;
        depthKey = createInkDepthKey({ depth, surfaceData }, camera, { radiusPixels: 8, referenceHeight: 60 });
        depthKey.resize(32, 32);
        const normalPreview = vec4(normalWeight.r, normalWeight.b, normalWeight.a, 1);
        const depthPreview = vec4(vec3(depth.r), 1);
        const keyPreview = vec4(depthKey.texture.r.div(4), depthKey.texture.g.div(4), 0, 1);
        const edgePreview = vec4(vec3(inkGraph.edge.r), 1);
        const inspection = mix(mix(mix(inkGraph.outputNode, normalPreview, inspectNormalWeight), depthPreview,
          inspectDepth), keyPreview, inspectKey);
        return { ...inkGraph, outputNode: mix(mix(inspection, edgePreview, inspectEdge),
          mix(color, inkGraph.composite, applyInk), inspectComposite) };
      },
    },
    systems: {
      './fixture.mts': async () => ({
        whilePaused: true,
        async init(context, lifetime) {
          const rgb = await context.assets.loadJSON('data:application/json,%5B0.25%2C0.5%2C1.5%5D');
          material.colorNode = vec3(...rgb).mul(strength);
          lifetime.ownRoot(background);
          lifetime.defer(async () => {
            assert.equal(await context.assets.loadJSON('data:application/json,true'), true);
            assert.equal(unconfigured, 0, 'the GPU surface must survive asynchronous system cleanup');
            systemCleanups++;
          });
        },
        update(delta, context) {
          updateCallbacks++;
          context.registry.set('fixture.step', [context.time.step, delta, context.input.jump]);
        },
        beforeRender() { renderCallbacks++; },
      }),
    },
    viewport: { width: 32, height: 32, pixelRatio: 1 },
    assets: { assetBaseURL: 'https://reference.invalid/' },
    audio: { createContext() { contextRequests++; throw Error('Audio must wait for unlock'); } },
    input: { keyboardTarget },
    gpu: nativeGpu,
  });
  assert.equal(runtime.backend, 'webgpu');
  assert.equal(runtime.context.assets.pending, 0);
  const { audio, registry } = runtime.context;
  registry.set('game.options', { master: 1, music: 0.5, effects: 1 });
  const musicGain = audio.getEffectiveGain('music');
  const effectsGain = audio.getEffectiveGain('effects');
  assert.ok(Math.abs(musicGain - 0.09 * 10 ** (-5 / 20)) < 1e-12);
  registry.set('audio.duck', true);
  assert.equal(audio.getEffectiveGain('music'), musicGain);
  assert.ok(Math.abs(audio.getEffectiveGain('effects') - 0.1 * effectsGain) < 1e-12);
  assert.equal(contextRequests, 0);
  assert.equal(runtime.report()[0].failed, null);
  assert.ok(scene.children.includes(background));
  assert.deepEqual(runtime.context.registry.get('fixture.step'), [0, 0, false]);
  assert.equal(pressSpace(), true);
  runtime.step();
  assert.deepEqual(runtime.context.registry.get('fixture.step'), [1, 1 / 60, true]);
  assert.equal(runtime.context.input.jump, false);
  assert.equal(runtime.context.clock.elapsedTime, 1 / 60);
  runtime.context.paused = true;
  runtime.step();
  assert.equal(runtime.context.time.step, 1);
  assert.equal(updateCallbacks, 3);
  assert.deepEqual(runtime.context.registry.get('fixture.step'), [1, 1 / 60, false]);
  runtime.context.paused = false;
  device.pushErrorScope('validation');
  runtime.render();
  const first = { center: await sample(16, 16), corner: await sample(1, 1) };
  runtime.resize(64, 48, 1.25);
  runtime.setResolutionScale(0.75);
  depthKey.resize(60, 45);
  strength.value = 0.25;
  assert.equal(typeof pendingFrame, 'function', 'Three.js must schedule a new render frame');
  pendingFrame(performance.now());
  runtime.render();
  const resized = { center: await sample(40, 30), corner: await sample(1, 1) };
  inspectNormalWeight.value = 1;
  pendingFrame(performance.now());
  runtime.render();
  const normalWeight = await sample(40, 30);
  inspectDepth.value = 1;
  pendingFrame(performance.now());
  runtime.render();
  const depth = await sample(40, 30);
  scene.add(foreground);
  inspectKey.value = 1;
  pendingFrame(performance.now());
  runtime.render();
  const key = await sample(40, 30);
  inspectEdge.value = 1;
  pendingFrame(performance.now());
  runtime.render();
  const flatEdge = await sample(10, 30);
  let contourPeak = 0;
  let contourX = 43;
  for (let x = 43; x <= 53; x++) {
    const [level] = await sample(x, 30);
    if (level > contourPeak) {
      contourPeak = level;
      contourX = x;
    }
  }
  inspectComposite.value = 1;
  pendingFrame(performance.now());
  runtime.render();
  const baseColor = { flat: await sample(10, 30), contour: await sample(contourX, 30) };
  applyInk.value = 1;
  pendingFrame(performance.now());
  runtime.render();
  const inkColor = { flat: await sample(10, 30), contour: await sample(contourX, 30) };
  const error = await device.popErrorScope();
  assert.equal(error, null, error?.message);
  assert.deepEqual([canvas.width, canvas.height], [80, 60]);
  assert.deepEqual([runtime.context.view.drawWidth, runtime.context.view.drawHeight], [80, 60]);
  for (const texture of [inkGraph.edge, inkGraph.composite]) {
    assert.deepEqual([texture.renderTarget.width, texture.renderTarget.height], [60, 45]);
  }
  assert.equal(renderCallbacks, 8);

  // Independent CPU evaluation of the shoulder and corner curves, then sRGB.
  // A two-code-value band accommodates the bounded per-pixel dither and f16 sampling.
  const expected = [
    { center: [137, 188, 237, 255], corner: [115, 152, 186, 255] },
    { center: [71, 99, 165, 255], corner: [56, 76, 121, 255] },
  ];
  const tolerance = 2;
  for (const [index, frame] of [first, resized].entries()) {
    for (const [position, pixel] of Object.entries(frame)) {
      const target = expected[index][position];
      assert.ok(pixel.every((value, channel) => Math.abs(value - target[channel]) <= tolerance),
        `frame ${index + 1} ${position}: expected ${target} ± ${tolerance}, got ${pixel}`);
    }
  }
  const expectedNormalWeight = [188, 255, 137, 255];
  const expectedDepth = [121, 121, 121, 255];
  const expectedKey = [137, 225, 0, 255];
  assert.ok(normalWeight.every((value, channel) => Math.abs(value - expectedNormalWeight[channel]) <= tolerance),
    'encoded world normal and line weight ' + normalWeight);
  assert.ok(depth.every((value, channel) => Math.abs(value - expectedDepth[channel]) <= tolerance),
    'orthographic depth ' + depth);
  assert.ok(key.every((value, channel) => Math.abs(value - expectedKey[channel]) <= tolerance),
    'neighboring foreground depth and surface ID ' + key);
  assert.deepEqual(flatEdge, [0, 0, 0, 255], 'a flat, constant-depth surface should have zero contour');
  assert.ok(contourPeak >= 64, 'the near-to-far discontinuity should produce a visible contour');
  assert.deepEqual(inkColor.flat, baseColor.flat, 'a flat surface must retain its scene color');
  assert.ok(inkColor.contour.every((level, channel) => channel === 3
    ? level === baseColor.contour[channel]
    : level < baseColor.contour[channel] - 2), 'a contour must visibly darken the scene color');
  console.log('Native WebGPU readback', JSON.stringify({
    first, resized, expected, normalWeight, depth, key, flatEdge, contourPeak, baseColor, inkColor, tolerance,
  }));
} finally {
  depthKey?.dispose();
  geometry.dispose();
  material.dispose();
  foregroundGeometry.dispose();
  foregroundMaterial.dispose();
  if (runtime) {
    for (const texture of [inkGraph.edge, inkGraph.composite]) {
      texture.renderTarget.addEventListener('dispose', () => graphReleases++);
    }
    const disposing = runtime.dispose();
    assert.equal(runtime.dispose(), disposing);
    await disposing;
    assert.equal(systemCleanups, 1);
    assert.equal(graphReleases, 2);
    assert.equal(scene.children.includes(background), false);
    assert.equal(pressSpace(), false);
    await assert.rejects(runtime.context.assets.loadJSON('data:application/json,null'), { name: 'AbortError' });
    assert.ok(unconfigured > 0);
    assert.throws(() => runtime.render(), /disposed/);
  }
}

const assetURL = new URL('../../sumiro/assets/', import.meta.url);
const chapterAssets = { assetBaseURL: assetURL, fetch: async path => new Response(await readFile(new URL(path))) };
const chapter = await createChapterPreview({
  canvas,
  viewport: { width: 96, height: 72, pixelRatio: 1 },
  assets: chapterAssets,
  gpu: nativeGpu,
});
try {
  let meshes = 0;
  chapter.context.scene.traverse(object => { if (object.isMesh) meshes++; });
  assert.ok(meshes > 0, 'the actual chapter asset must populate the scene');
  device.pushErrorScope('validation');
  chapter.render();
  const scan = [];
  for (const x of [24, 36, 48, 60, 72]) {
    for (const y of [18, 27, 36, 45, 54]) scan.push(await sample(x, y));
  }
  const backgroundPixel = await sample(1, 1);
  const error = await device.popErrorScope();
  assert.equal(error, null, error?.message);
  assert.ok(scan.some(pixel => pixel[3] === 255 && Math.max(...pixel.slice(0, 3)) - Math.min(...pixel.slice(0, 3)) > 20),
    'the chapter scan should include opaque, strongly colored model pixels');
  console.log('Chapter geometry WebGPU readback', JSON.stringify({ meshes, backgroundPixel, center: scan[12] }));
} finally {
  await chapter.dispose();
}

const traversal = await createTraversalPreview({
  canvas,
  viewport: { width: 96, height: 72, pixelRatio: 1 },
  assets: chapterAssets,
  input: { keyboardTarget },
  gpu: nativeGpu,
});
try {
  const registry = traversal.context.registry;
  const spawn = registry.get('player.position');
  const initialRailFrame = registry.get('camera.railFrame');
  const initialCamera = traversal.context.camera.position.clone();
  assert.equal(spawn.state, 'IDLE');
  assert.equal(spawn.grounded, true);
  device.pushErrorScope('validation');
  traversal.render();
  const startingPixel = await sample(48, 58);
  const skyPixel = await sample(48, 8);
  assert.ok(Math.abs(startingPixel[0] - skyPixel[0]) > 10, 'the rendered path is distinct from the sky');
  keyboardTarget.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW', repeat: false }));
  for (let frame = 0; frame < 60; frame++) traversal.step();
  keyboardTarget.dispatchEvent(Object.assign(new Event('keyup'), { code: 'KeyW' }));
  const movement = registry.get('player.position');
  assert.ok(movement.z < spawn.z - 3);
  assert.equal(movement.state, 'RUN');
  assert.equal(movement.grounded, true);
  const walkingRailFrame = registry.get('camera.railFrame');
  assert.ok(walkingRailFrame > initialRailFrame);
  assert.ok(traversal.context.camera.position.distanceTo(initialCamera) > 1);
  for (let frame = 0; frame < 25; frame++) traversal.step();
  const takeoff = registry.get('player.position');
  assert.equal(pressSpace(), true);
  let peak = takeoff.y;
  let landed = false;
  for (let frame = 0; frame < 100; frame++) {
    if (frame === 12) keyboardTarget.dispatchEvent(Object.assign(new Event('keyup'), { code: 'Space' }));
    traversal.step();
    const current = registry.get('player.position');
    if (frame === 0) assert.equal(current.state, 'JUMP');
    peak = Math.max(peak, current.y);
    landed ||= current.state === 'LAND' && current.grounded;
  }
  assert.ok(peak > takeoff.y + 0.6, 'the jump must lift the player above the authored terrain');
  assert.equal(landed, true, 'airborne motion must return to the terrain');
  pendingFrame(performance.now());
  traversal.render();
  const error = await device.popErrorScope();
  assert.equal(error, null, error?.message);
  console.log('Chapter traversal WebGPU readback', JSON.stringify({
    spawn, movement, initialRailFrame, walkingRailFrame, jumpHeight: peak - takeoff.y, landed, startingPixel, skyPixel,
  }));
} finally {
  await traversal.dispose();
}

const resumedRun = createRunProgress({
  getItem: () => JSON.stringify({ ...createDefaultRun(), shrine: 'plateau' }),
  setItem() { throw Error('The preview must never save a resumed run'); },
});
const resumed = await createTraversalPreview({
  canvas,
  viewport: { width: 96, height: 72, pixelRatio: 1 },
  assets: chapterAssets,
  resume: resumedRun.current,
  gpu: nativeGpu,
});
try {
  const position = resumed.context.registry.get('player.position');
  assert.deepEqual([position.x, position.z], [14.6, -56.6]);
  assert.ok(position.grounded && position.y > 8);
  device.pushErrorScope('validation');
  resumed.render();
  const error = await device.popErrorScope();
  assert.equal(error, null, error?.message);
  console.log('Chapter checkpoint WebGPU resume', JSON.stringify(position));
} finally {
  await resumed.dispose();
}
