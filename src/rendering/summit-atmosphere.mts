/** Summit cloud sea (Oe/ke/Le) and mist banks (Ne) from ch6_summit-BczK7QHX.js. */
import {
  DataTexture, DoubleSide, Group, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshBasicNodeMaterial,
  NoColorSpace, PlaneGeometry, RedFormat, RepeatWrapping, Scene, Vector3,
  type Node, type OrthographicCamera, type PerspectiveCamera, type Texture3DNode, type TextureNode,
} from 'three/webgpu';
import {
  Fn, cameraPosition, clamp, max, mix, mrt, orthographicDepthToViewZ, output, pass, perspectiveDepthToViewZ,
  positionView, positionWorld, reference, screenUV, smoothstep, texture, texture3D, uniform, uvec2, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { createInkAnimatedWash, createInkNoiseTexture } from './ink-paper-wash.mts';
import { textureSize2D } from './texture-size.mts';

const TILE_SIZE = 1024;
const CLOUD_WIDTH = 3200;
const CLOUD_HEIGHT = -1;
const BANK_CENTERS = [
  [6,2,-70], [8,4,-130], [14,6,-190], [6,6,-250], [10,8,-300],
  [-10,10,-292], [-46,12,-296], [-90,16,-300], [-126,20,-318], [-176,26,-320],
  [-222,28,-318], [-270,30,-320], [-312,30,-350], [70,8,-100], [66,12,-210],
] as const;

function authoredRandom(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

/** Rasterize the authored gradients at texel centers with straight grayscale source-over. */
export function createSummitCloudTexture() {
  const pixels = new Uint8Array(TILE_SIZE ** 2).fill(140);
  function dab(x: number, y: number, radius: number, value: number, alpha: number, squash: number) {
    const height = radius * squash;
    for (let row = Math.floor(y - height); row < Math.ceil(y + height); row++) {
      const v = (row + .5 - y) / height;
      // The CanvasTexture source flips image rows on upload. Store them in
      // texture order here so DataTexture can upload without a GPU copy pass.
      const offset = (TILE_SIZE - 1 - ((row + TILE_SIZE) % TILE_SIZE)) * TILE_SIZE;
      for (let column = Math.floor(x - radius); column < Math.ceil(x + radius); column++) {
        const u = (column + .5 - x) / radius;
        const coverage = alpha * Math.max(1 - Math.sqrt(u * u + v * v), 0);
        const index = offset + (column + TILE_SIZE) % TILE_SIZE;
        const prior = pixels[index]!;
        pixels[index] = Math.round(prior + (value - prior) * coverage);
      }
    }
  }
  const random = authoredRandom;
  for (let i = 0; i < 90; i++) dab(random(i) * TILE_SIZE, random(i + 200) * TILE_SIZE,
    90 + random(i + 400) * 150, 240, .5, .6);
  for (let i = 0; i < 70; i++) dab(random(i + 600) * TILE_SIZE, random(i + 800) * TILE_SIZE,
    60 + random(i + 1000) * 120, 70, .45, .45);

  const map = new DataTexture(pixels, TILE_SIZE, TILE_SIZE, RedFormat);
  map.name = 'SummitCloudPaint';
  map.colorSpace = NoColorSpace;
  map.wrapS = map.wrapT = RepeatWrapping;
  map.minFilter = LinearMipmapLinearFilter;
  map.magFilter = LinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 8;
  map.needsUpdate = true;
  return map;
}

interface CloudInputs {
  map: TextureNode;
  position: Node<'vec3'>;
  eye: Node<'vec3'>;
  drift: Node<'float'>;
}

/** Straight-alpha working color from the authored horizontal cloud sheet. */
export function createSummitCloudColor({ map, position, eye, drift }: CloudInputs): Node<'vec4'> {
  return Fn(() => {
    const q = position.xz.div(420).toVar();
    const first = map.sample(q.add(vec2(drift, 0))).r;
    const second = map.sample(q.mul(.37).add(vec2(drift.mul(-.6), .31))).r;
    const value = mix(first, second, .5).toVar();
    const rgb = mix(vec3(.42, .44, .48), vec3(.72, .73, .76), smoothstep(.42, .74, value));
    const distance = position.xz.sub(eye.xz).length().toVar();
    const below = eye.y.sub(position.y).div(max(distance, 1));
    const alpha = smoothstep(.012, .11, below.add(value.sub(.5).mul(.09)))
      .mul(smoothstep(620, 1500, distance).oneMinus());
    return vec4(rgb, alpha);
  })();
}

/**
 * Mount the atmosphere in a dedicated color-only render pass. `depth` is the
 * completed forward opaque depth from this same camera, with a far clip that
 * covers the distant scenery. Do not include the atmosphere's group in the
 * main scene. The pass owns its optional noise volume, cloud tile and meshes.
 */
export function mountSummitAtmosphere(
  camera: PerspectiveCamera | OrthographicCamera, depth: TextureNode, sharedNoise?: Texture3DNode,
) {
  const seconds = uniform(0).setName('summitMistSeconds');
  const drift = uniform(0).setName('summitCloudDrift');
  const near = reference('near', 'float', camera);
  const far = reference('far', 'float', camera);
  const depthToViewZ = 'isPerspectiveCamera' in camera ? perspectiveDepthToViewZ : orthographicDepthToViewZ;
  const size = textureSize2D(depth);
  const texel = uvec2(clamp(screenUV.mul(size), vec2(0), size.sub(1)));
  const distance = depthToViewZ(depth.load(texel).r, near, far).negate();
  const fragmentDistance = positionView.z.negate();

  const cloudMap = createSummitCloudTexture();
  const cloudGeometry = new PlaneGeometry(CLOUD_WIDTH, CLOUD_WIDTH);
  cloudGeometry.rotateX(-Math.PI / 2);
  const cloudMaterial = new MeshBasicNodeMaterial({ name: 'summit_clouds', fog: false, toneMapped: false,
    transparent: true, depthTest: false, depthWrite: false });
  cloudMaterial.fragmentNode = Fn(() => {
    fragmentDistance.greaterThan(distance).discard();
    return createSummitCloudColor({ map: texture(cloudMap), position: positionWorld, eye: cameraPosition, drift });
  })();
  const cloud = new Mesh(cloudGeometry, cloudMaterial);
  cloud.name = 'cloud_sea';
  cloud.position.y = CLOUD_HEIGHT;
  cloud.renderOrder = 1;
  cloud.frustumCulled = false;

  const noiseVolume = sharedNoise === undefined ? createInkNoiseTexture() : undefined;
  const noise = sharedNoise ?? texture3D(noiseVolume!);
  const bankMaterial = new MeshBasicNodeMaterial({ name: 'summit_mist', side: DoubleSide, forceSinglePass: true,
    fog: false, toneMapped: false, transparent: true, depthTest: false, depthWrite: false });
  bankMaterial.fragmentNode = Fn(() => {
    const sceneDistance = distance.toVar();
    fragmentDistance.greaterThanEqual(sceneDistance).or(fragmentDistance.lessThanEqual(10)).discard();
    return createInkAnimatedWash({ noise, position: positionWorld, uv: uv(), seconds,
      sceneDistance, washDistance: fragmentDistance },
    { kind: 'bank', frequency: 1.4, strength: .62, rise: .015, softDepth: 1.2 });
  })();
  const bankGeometry = new PlaneGeometry(1, 1);
  const group = new Group();
  group.name = 'summit_atmosphere';
  group.add(cloud);
  for (const [x, y, z] of BANK_CENTERS) for (const index of [0, 1]) {
    const mesh = new Mesh(bankGeometry, bankMaterial);
    mesh.name = 'mist';
    mesh.position.set(x + (index - .5) * 40, y + index * 6, z + (index - .5) * 22);
    mesh.scale.set(120 + index * 50, 38 + index * 16, 1);
    mesh.rotation.y = .5 + x * .002;
    mesh.renderOrder = 3;
    group.add(mesh);
  }

  const scene = new Scene();
  scene.add(group);
  const layer = pass(scene, camera, { depthBuffer: false, colorSpace: NoColorSpace,
    minFilter: LinearFilter, magFilter: LinearFilter });
  // Force transparent black independently of the canvas renderer's clear alpha.
  layer.setMRT(mrt({ output }).setClearColor('output', 0, 0));
  const layerTexture = layer.getTextureNode('output');
  const render = layer.updateBefore.bind(layer);
  layer.updateBefore = frame => { if (group.visible) render(frame); };
  const eye = new Vector3();
  let disposed = false;
  function update(time: number) {
    if (disposed) return;
    if (!Number.isFinite(time)) throw RangeError('Summit atmosphere time must be finite');
    camera.getWorldPosition(eye);
    cloud.position.set(eye.x, CLOUD_HEIGHT, eye.z);
    seconds.value = time;
    drift.value = time * .0016;
  }
  update(0);
  return {
    texture: layerTexture, group, update,
    setEnabled(enabled: boolean) { if (!disposed) group.visible = enabled; },
    setResolutionScale(scale: number) {
      if (!Number.isFinite(scale) || scale <= 0) throw RangeError('Summit atmosphere resolution requires a positive scale');
      if (!disposed) layer.setResolutionScale(scale);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      group.clear();
      layer.dispose();
      cloudMaterial.dispose();
      bankMaterial.dispose();
      cloudGeometry.dispose();
      bankGeometry.dispose();
      cloudMap.dispose();
      noiseVolume?.dispose();
    },
  };
}

/** The isolated target stores premultiplied RGB. Composite it before ink grade. */
export function blendSummitAtmosphere(base: Node<'vec4'>, atmosphere: TextureNode): Node<'vec4'> {
  return Fn(() => {
    const layer = atmosphere.sample(screenUV).toVar();
    return vec4(layer.rgb.add(base.rgb.mul(layer.a.oneMinus())), base.a);
  })();
}
