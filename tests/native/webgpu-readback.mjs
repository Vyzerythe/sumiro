import assert from 'node:assert/strict';
import { create, globals } from 'webgpu';
import { Mesh, MeshBasicNodeMaterial, OrthographicCamera, PlaneGeometry, Scene } from 'three/webgpu';
import { uniform, vec3, vec4 } from 'three/tsl';
import { createWebGpuSurface } from '../../src/rendering/webgpu-renderer.mts';

const gpu = create(process.argv.slice(2));
Object.assign(globalThis, globals, { self: globalThis, requestAnimationFrame: () => 1, cancelAnimationFrame() {} });
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
material.colorNode = vec3(0.25, 0.5, 0.75);
scene.add(new Mesh(geometry, material));
const strength = uniform(0.5);

async function sample() {
  const { format } = configuration;
  assert.match(format, /^(rgba|bgra)8unorm(?:-srgb)?$/, 'readback requires a four-byte normalized format');
  const bytesPerRow = 256;
  const readback = device.createBuffer({ size: bytesPerRow, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: attachment, origin: { x: Math.floor(canvas.width / 2), y: Math.floor(canvas.height / 2) } },
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
      const color = scenePass.getTextureNode();
      return vec4(color.rgb.mul(strength), color.a);
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
  const first = await sample();
  surface.resize(64, 48, 1.25);
  surface.setResolutionScale(0.75);
  strength.value = 0.25;
  surface.render();
  const resized = await sample();
  const error = await device.popErrorScope();
  assert.equal(error, null, error?.message);
  assert.deepEqual([canvas.width, canvas.height], [80, 60]);

  // Expected standard sRGB encoding of the linear scene color at each strength.
  const expected = [[99, 137, 165, 255], [71, 99, 120, 255]];
  const tolerance = 2;
  for (const [index, pixel] of [first, resized].entries()) {
    assert.ok(pixel.every((value, channel) => Math.abs(value - expected[index][channel]) <= tolerance),
      `frame ${index + 1}: expected ${expected[index]} ± ${tolerance}, got ${pixel}`);
  }
  console.log('Native WebGPU readback', JSON.stringify({ first, resized, expected, tolerance }));
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
