import assert from 'node:assert/strict';
import { create, globals } from 'webgpu';
import { Mesh, MeshBasicNodeMaterial, OrthographicCamera, PlaneGeometry, Scene } from 'three/webgpu';
import { mix, uniform, vec3, vec4 } from 'three/tsl';
import { createInkGrade } from '../../src/rendering/ink-grade.mts';
import { createInkDepthKey } from '../../src/rendering/ink-depth-key.mts';
import { createInkEdgeAnalysis } from '../../src/rendering/ink-edge.mts';
import { configureInkSurfacePass, createInkSurfaceOutput } from '../../src/rendering/ink-surface-pass.mts';
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
const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
assert.ok(adapter, 'Dawn must expose a WebGPU adapter');
console.log('WebGPU adapter', adapter.info.description);

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
material.mrtNode = createInkSurfaceOutput({ lineWeight: 0.25 });
const background = new Mesh(geometry, material);
const foregroundGeometry = new PlaneGeometry(0.12, 0.24);
const foregroundMaterial = new MeshBasicNodeMaterial();
foregroundMaterial.mrtNode = createInkSurfaceOutput({ lineWeight: 1, movingSurfaceId: 3 });
const foreground = new Mesh(foregroundGeometry, foregroundMaterial);
foreground.position.set(0.2, 0, 1);

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
let systemCleanups = 0;
let renderCallbacks = 0;
let updateCallbacks = 0;
try {
  runtime = await createSourceRuntime({
    graphics: {
      canvas, scene, camera,
      buildOutput(scenePass) {
        const { color, depth, normalWeight, surfaceData } = configureInkSurfacePass(scenePass);
        depthKey = createInkDepthKey({ depth, surfaceData }, camera, { radiusPixels: 8, referenceHeight: 60 });
        depthKey.resize(32, 32);
        const normalPreview = vec4(normalWeight.r, normalWeight.b, normalWeight.a, 1);
        const depthPreview = vec4(vec3(depth.r), 1);
        const keyPreview = vec4(depthKey.texture.r.div(4), depthKey.texture.g.div(4), 0, 1);
        const edge = createInkEdgeAnalysis({ depth, normalWeight }, camera, { referenceHeight: 60 });
        const edgePreview = vec4(vec3(edge.r), 1);
        const inspection = mix(mix(mix(createInkGrade(color), normalPreview, inspectNormalWeight), depthPreview,
          inspectDepth), keyPreview, inspectKey);
        return mix(inspection, edgePreview, inspectEdge);
      },
    },
    systems: {
      './fixture.mts': async () => ({
        whilePaused: true,
        async init(context, lifetime) {
          const rgb = await context.assets.loadJSON('data:application/json,%5B0.25%2C0.5%2C1.5%5D');
          material.colorNode = vec3(...rgb).mul(strength);
          lifetime.ownRoot(background);
          lifetime.defer(() => systemCleanups++);
        },
        update(delta, context) {
          updateCallbacks++;
          context.registry.set('fixture.step', [context.time.step, delta]);
        },
        beforeRender() { renderCallbacks++; },
      }),
    },
    viewport: { width: 32, height: 32, pixelRatio: 1 },
    assets: { assetBaseURL: 'https://reference.invalid/' },
    gpu: {
      requestAdapter: async () => ({
        async requestDevice(descriptor) {
          device = await adapter.requestDevice(descriptor);
          return device;
        },
      }),
    },
  });
  assert.equal(runtime.backend, 'webgpu');
  assert.equal(runtime.context.assets.pending, 0);
  assert.equal(runtime.report()[0].failed, null);
  assert.ok(scene.children.includes(background));
  runtime.step();
  assert.deepEqual(runtime.context.registry.get('fixture.step'), [1, 1 / 60]);
  assert.equal(runtime.context.clock.elapsedTime, 1 / 60);
  runtime.context.paused = true;
  runtime.step();
  assert.equal(runtime.context.time.step, 1);
  assert.equal(updateCallbacks, 2);
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
  for (let x = 43; x <= 53; x++) {
    const [level] = await sample(x, 30);
    contourPeak = Math.max(contourPeak, level);
  }
  const error = await device.popErrorScope();
  assert.equal(error, null, error?.message);
  assert.deepEqual([canvas.width, canvas.height], [80, 60]);
  assert.deepEqual([runtime.context.view.drawWidth, runtime.context.view.drawHeight], [80, 60]);
  assert.equal(renderCallbacks, 6);

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
  console.log('Native WebGPU readback', JSON.stringify({
    first, resized, expected, normalWeight, depth, key, flatEdge, contourPeak, tolerance,
  }));
} finally {
  depthKey?.dispose();
  geometry.dispose();
  material.dispose();
  foregroundGeometry.dispose();
  foregroundMaterial.dispose();
  if (runtime) {
    const disposing = runtime.dispose();
    assert.equal(runtime.dispose(), disposing);
    await disposing;
    assert.equal(systemCleanups, 1);
    assert.equal(scene.children.includes(background), false);
    await assert.rejects(runtime.context.assets.loadJSON('data:application/json,null'), { name: 'AbortError' });
    assert.ok(unconfigured > 0);
    assert.throws(() => runtime.render(), /disposed/);
  }
}
