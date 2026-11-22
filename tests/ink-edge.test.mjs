import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Mesh, NodeMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry, REVISION, Scene,
  WebGPURenderer, WGSLNodeBuilder,
} from 'three/webgpu';
import { pass } from 'three/tsl';
import { createInkEdgeAnalysis } from '../src/rendering/ink-edge.mts';
import { configureInkSurfacePass } from '../src/rendering/ink-surface-pass.mts';

function compileEdgeAnalysis(camera) {
  const renderer = new WebGPURenderer({ canvas: { width: 32, height: 32 } });
  // Give the compiler the baseline capabilities without submitting GPU commands.
  renderer.hasFeature = () => false;
  renderer._bindings = { getSharedBindGroup: group => group };
  const scene = new Scene();
  const scenePass = pass(scene, camera);
  const geometry = new PlaneGeometry();
  const material = new NodeMaterial();
  try {
    material.fragmentNode = createInkEdgeAnalysis(configureInkSurfacePass(scenePass), camera);
    const builder = new WGSLNodeBuilder(new Mesh(geometry, material), renderer);
    builder.scene = scene;
    builder.camera = camera;
    builder.build();
    return builder.fragmentShader;
  } finally {
    scenePass.dispose();
    material.dispose();
    geometry.dispose();
  }
}

test('r187 ink edge analysis loads the two data attachments with bounded, symmetric texel taps', () => {
  assert.equal(REVISION, '187');
  const shader = compileEdgeAnalysis(new PerspectiveCamera());
  const depth = /var (\w+)\s*:\s*texture_depth_2d;/.exec(shader)?.[1];
  const surface = /var (\w+)\s*:\s*texture_2d<f32>;/.exec(shader)?.[1];
  assert.ok(depth && surface);
  const loads = [...shader.matchAll(/textureLoad\(\s*(\w+)\s*,/g)].map(match => match[1]);
  assert.equal(loads.filter(texture => texture === depth).length, 33);
  assert.equal(loads.filter(texture => texture === surface).length, 17);
  assert.doesNotMatch(shader, /\btextureSample\w*\(/);
  assert.match(shader, new RegExp(`textureDimensions\\(\\s*${depth},\\s*0`));
  assert.match(shader, /inkCenterPixel = floor\(/);
  assert.match(shader, /floor\(.*abs\(.*sign\(/);
  assert.match(shader, /clamp\(.*inkSceneSize - vec2<f32>\(\s*1\.0\s*\)/);
});

test('the shader keeps depth contours, normal creases and nearest-surface weight separate', () => {
  const shader = compileEdgeAnalysis(new PerspectiveCamera());
  assert.match(shader, /inkDepthEdge = max\(\s*inkDepthEdge,.*abs\(/);
  assert.match(shader, /inkNormalEdge = max\(\s*inkNormalEdge,.*1\.0 - dot\(.*min\(.*\.w,.*\.w/);
  assert.equal([...shader.matchAll(/< inkNearestDistance\s*\)/g)].length, 16);
  assert.match(shader, /inkContour = .*smoothstep\(\s*0\.018, 0\.055, inkDepthEdge\s*\).*smoothstep\(\s*0\.32, 0\.72, inkNormalEdge\s*\)/);
  assert.match(shader, /output\.color = .*inkContour.*inkNearestSurface\.w.*inkCenterSurface\.w.*inkCrevice, inkContour\s*\)/);
});

test('orthographic ink analysis uses linear depth before measuring curvature', () => {
  const shader = compileEdgeAnalysis(new OrthographicCamera());
  assert.match(shader, /inkCenterDistance = .*\*.* - /);
  assert.doesNotMatch(shader, /inkCenterDistance = .*\//);
  assert.match(shader, /inkDepthEdge = max\(\s*inkDepthEdge, abs\(\s*\w+\s*\)\s*\)/);
});
