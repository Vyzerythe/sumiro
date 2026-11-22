import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Mesh, NodeMaterial, PerspectiveCamera, PlaneGeometry, REVISION, Scene, WebGPURenderer, WGSLNodeBuilder,
} from 'three/webgpu';
import { uniform, vec4 } from 'three/tsl';
import { createWebGpuPipeline, createWebGpuSurface } from '../src/rendering/webgpu-renderer.mts';

test('the native pipeline composes a sampled scene pass into WGSL on Three.js r187', () => {
  assert.equal(REVISION, '187');
  const renderer = new WebGPURenderer({ canvas: { width: 32, height: 32 } });
  // The shader compiler expects these capabilities from an initialized renderer.
  // Use the baseline feature set and local bind groups without submitting commands.
  renderer.hasFeature = () => false;
  renderer._bindings = { getSharedBindGroup: group => group };
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  const material = new NodeMaterial();
  const geometry = new PlaneGeometry();
  const effectStrength = uniform(0.5).setName('effectStrength');
  const pipeline = createWebGpuPipeline(renderer, scene, camera, scenePass => {
    const color = scenePass.getTextureNode();
    return vec4(color.rgb.mul(effectStrength), color.a);
  });
  try {
    material.fragmentNode = pipeline.outputNode;
    const builder = new WGSLNodeBuilder(new Mesh(geometry, material), renderer);
    builder.scene = scene;
    builder.camera = camera;
    builder.build();
    assert.match(builder.fragmentShader, /textureSample/);
    assert.match(builder.fragmentShader, /effectStrength/);
    assert.match(builder.fragmentShader, /@fragment/);
  } finally {
    pipeline.dispose();
    material.dispose();
    geometry.dispose();
  }
});

test('the render pipeline releases a real pass target after setup failure and on disposal', () => {
  const renderer = new WebGPURenderer({ canvas: { width: 32, height: 32 } });
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  let releases = 0;
  const track = pass => pass.renderTarget.addEventListener('dispose', () => releases++);

  assert.throws(() => createWebGpuPipeline(renderer, scene, camera, pass => {
    track(pass);
    throw Error('invalid output graph');
  }), /invalid output graph/);
  assert.equal(releases, 1);

  const pipeline = createWebGpuPipeline(renderer, scene, camera, pass => {
    track(pass);
    return pass.getTextureNode();
  });
  pipeline.setResolutionScale(0.75);
  pipeline.dispose();
  pipeline.dispose();
  assert.equal(releases, 2);
  assert.throws(() => pipeline.render(), /disposed/);
});

test('a missing WebGPU API stops before touching the canvas', async () => {
  const sandboxedGpu = undefined;
  const canvas = { getContext() { throw Error('unexpected canvas access'); } };
  await assert.rejects(createWebGpuSurface({ canvas, scene: new Scene(), camera: new PerspectiveCamera() }, sandboxedGpu),
    /WebGPU is unavailable/);
});

test('a device acquired for an unusable canvas is destroyed on initialization failure', async () => {
  let destroys = 0;
  const device = {
    lost: new Promise(() => {}),
    destroy() { destroys++; },
  };
  const gpu = { requestAdapter: async () => ({ requestDevice: async () => device }) };
  const canvas = { getContext: () => null };
  await assert.rejects(createWebGpuSurface({ canvas, scene: new Scene(), camera: new PerspectiveCamera() }, gpu),
    /Could not get a WebGPU context/);
  assert.equal(destroys, 1);
});
