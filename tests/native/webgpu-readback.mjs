import assert from 'node:assert/strict';
import { create, globals } from 'webgpu';
import { Mesh, MeshBasicNodeMaterial, OrthographicCamera, PlaneGeometry, Scene } from 'three/webgpu';
import { mix, uniform, vec3, vec4 } from 'three/tsl';
import { createInkGrade } from '../../src/rendering/ink-grade.mts';
import { configureInkSurfacePass, createInkSurfaceOutput } from '../../src/rendering/ink-surface-pass.mts';
import { createWebGpuSurface } from '../../src/rendering/webgpu-renderer.mts';

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
material.colorNode = vec3(0.25, 0.5, 1.5).mul(strength);
material.mrtNode = createInkSurfaceOutput(0.25);
scene.add(new Mesh(geometry, material));

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

let surface;
try {
  surface = await createWebGpuSurface({
    canvas, scene, camera,
    buildOutput(scenePass) {
      const { color, depth, normalWeight } = configureInkSurfacePass(scenePass);
      const normalPreview = vec4(normalWeight.r, normalWeight.b, normalWeight.a, 1);
      const depthPreview = vec4(vec3(depth.r), 1);
      return mix(mix(createInkGrade(color), normalPreview, inspectNormalWeight), depthPreview, inspectDepth);
    },
  }, {
    requestAdapter: async () => ({
      async requestDevice(descriptor) {
        device = await adapter.requestDevice(descriptor);
        return device;
      },
    }),
  });
  assert.equal(surface.backend, 'webgpu');
  device.pushErrorScope('validation');
  surface.render();
  const first = { center: await sample(16, 16), corner: await sample(1, 1) };
  surface.resize(64, 48, 1.25);
  surface.setResolutionScale(0.75);
  strength.value = 0.25;
  assert.equal(typeof pendingFrame, 'function', 'Three.js must schedule a new render frame');
  pendingFrame(performance.now());
  surface.render();
  const resized = { center: await sample(40, 30), corner: await sample(1, 1) };
  inspectNormalWeight.value = 1;
  pendingFrame(performance.now());
  surface.render();
  const normalWeight = await sample(40, 30);
  inspectDepth.value = 1;
  pendingFrame(performance.now());
  surface.render();
  const depth = await sample(40, 30);
  const error = await device.popErrorScope();
  assert.equal(error, null, error?.message);
  assert.deepEqual([canvas.width, canvas.height], [80, 60]);

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
  assert.ok(normalWeight.every((value, channel) => Math.abs(value - expectedNormalWeight[channel]) <= tolerance),
    'encoded world normal and line weight ' + normalWeight);
  assert.ok(depth.every((value, channel) => Math.abs(value - expectedDepth[channel]) <= tolerance),
    'orthographic depth ' + depth);
  console.log('Native WebGPU readback', JSON.stringify({ first, resized, expected, normalWeight, depth, tolerance }));
} finally {
  geometry.dispose();
  material.dispose();
  if (surface) {
    const disposing = surface.dispose();
    assert.equal(surface.dispose(), disposing);
    await disposing;
    assert.ok(unconfigured > 0);
    assert.throws(() => surface.render(), /disposed/);
  }
}
