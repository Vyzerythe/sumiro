import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LinearFilter, Mesh, NodeMaterial, NoColorSpace, OrthographicCamera, PerspectiveCamera,
  PlaneGeometry, REVISION, Scene, Vector3, WebGPURenderer, WGSLNodeBuilder,
} from 'three/webgpu';
import { pass, rtt, uniform } from 'three/tsl';
import { createInkComposite } from '../src/rendering/ink-composite.mts';
import { createInkEdgeAnalysis } from '../src/rendering/ink-edge.mts';
import { configureInkSurfacePass } from '../src/rendering/ink-surface-pass.mts';

function compileComposite(camera, options) {
  const renderer = new WebGPURenderer({ canvas: { width: 32, height: 32 } });
  renderer.hasFeature = () => false;
  renderer._bindings = { getSharedBindGroup: group => group };
  const scene = new Scene();
  const scenePass = pass(scene, camera);
  const inputs = configureInkSurfacePass(scenePass);
  const edge = rtt(createInkEdgeAnalysis(inputs, camera), 32, 32, {
    colorSpace: NoColorSpace, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter,
  });
  const geometry = new PlaneGeometry();
  const material = new NodeMaterial();
  try {
    material.fragmentNode = createInkComposite({ ...inputs, edge }, camera, options);
    const builder = new WGSLNodeBuilder(new Mesh(geometry, material), renderer);
    builder.scene = scene;
    builder.camera = camera;
    builder.build();
    return builder.fragmentShader;
  } finally {
    material.dispose();
    geometry.dispose();
    edge.dispose();
    scenePass.dispose();
  }
}

test('r187 filters weighted coverage with a normalized kernel and bleeds cavity downward', () => {
  assert.equal(REVISION, '187');
  const shader = compileComposite(new PerspectiveCamera(), { fogStrength: 0 });
  const edge = /textureDimensions\(\s*(\w+),\s*0\s*\)/.exec(shader)?.[1];
  const samples = [...shader.matchAll(/textureSample\(\s*(\w+),/g)].map(match => match[1]);
  assert.ok(edge);
  assert.equal(samples.filter(texture => texture === edge).length, 10);
  assert.equal(samples.filter(texture => texture !== edge).length, 1);

  const center = /(\w+) = \( \w+\.x \* (\d+\.\d+) \);/.exec(shader);
  assert.ok(center);
  const weights = /\+ \( \( \w+\.x \+ \w+\.x \) \* (\d+\.\d+) \) \);/g;
  const pairs = [...shader.matchAll(weights)].map(match => Number(match[1]));
  assert.equal(pairs.length, 4);
  assert.ok(pairs.every(weight => weight > 0));
  const sum = Number(center[2]) + 2 * pairs.reduce((total, weight) => total + weight, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12, 'a uniform contour should keep its coverage');
  assert.match(shader, new RegExp(`clamp\\( ${center[1]}, 0\\.0, 1\\.0 \\)`));
  assert.match(shader, /textureSample\(.* - vec2<f32>\( 0\.0,.* \* 3\.0 \)/);
  assert.match(shader, /smoothstep\( 0\.02, 0\.6,.* \* 0\.2 /);
  assert.match(shader, /smoothstep\( 0\.5, 0\.74,.* \* 0\.62 /);
  assert.doesNotMatch(shader, /\b(textureLoad|exp)\(/);
  assert.match(shader, /output\.color = vec4<f32>\( \w+, 1\.0 \)/);
});

test('fog gates on geometry and loads fog weight from the same pixel as projection depth', () => {
  const shader = compileComposite(new PerspectiveCamera());
  const depth = /var (\w+)\s*:\s*texture_depth_2d;/.exec(shader)?.[1];
  const loads = [...shader.matchAll(/textureLoad\(\s*(\w+), vec2<i32>\(\s*(\w+)\s*\), u32\( 0u/g)];
  assert.ok(depth);
  assert.equal(loads.length, 2);
  assert.equal(loads[0][1], depth);
  assert.notEqual(loads[1][1], depth);
  assert.equal(loads[0][2], loads[1][2]);
  assert.match(shader, /if \( \( \w+ < 1\.0 \) \) \{/);
  assert.match(shader, /asin\( clamp\( normalize\(/);
  assert.match(shader, / - 22\.0/);
  assert.match(shader, /1\.0 - exp\(.*clamp\( \w+\.y, 0\.0, 1\.0 \).* \/ -117\.0.* \* 0\.72/);
  assert.match(shader, /\/ max\( \( - \w+\.z \), 0\.0001 \)/);

  const orthographic = compileComposite(new OrthographicCamera());
  assert.match(orthographic, /vec3<f32>\( 0\.0, 0\.0, -1\.0 \)/);
  assert.doesNotMatch(orthographic, /\/ max\( \( - \w+\.z \), 0\.0001 \)/);
});

test('ink composite rejects camera-independent settings outside their numeric domains', () => {
  const camera = new OrthographicCamera();
  for (const referenceHeight of [0, -1, Infinity, NaN]) {
    assert.throws(() => createInkComposite({}, camera, { referenceHeight }), RangeError);
  }
  for (const fogStrength of [-0.1, 1.1, Infinity, NaN]) {
    assert.throws(() => createInkComposite({}, camera, { fogStrength }), RangeError);
  }
});

test('chapter fog tint and ink boldness are uniform inputs to the fog blend', () => {
  const fogTint = uniform(new Vector3(0.8, 0.9, 1)).setName('chapterFogTint');
  const inkBold = uniform(0.6).setName('chapterInkBold');
  const shader = compileComposite(new OrthographicCamera(), { fogTint, inkBold });
  const bold = /(\w+) = max\( object\.chapterInkBold, 0\.0 \);/.exec(shader);
  assert.ok(bold);
  const fogBlend = shader.split('\n').find(line => line.includes('1.0 - exp('));
  assert.ok(fogBlend);
  assert.ok(fogBlend.includes('object.chapterFogTint'));
  assert.ok(fogBlend.includes('( ' + bold[1] + ' * 22.0 )'));
  assert.ok(fogBlend.includes('( ' + bold[1] + ' * 0.3 )'));
});
