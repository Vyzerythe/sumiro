/** Authored Sea silhouette reflections from me/he and Ee in ch5_sea-CpHUIhkX.js. */
import {
  Color, CustomBlending, DoubleSide, Group, LinearFilter, MaxEquation, Mesh, MeshBasicNodeMaterial,
  NoColorSpace, OneFactor, Scene,
  type Node, type Object3D, type OrthographicCamera, type PerspectiveCamera, type Texture3DNode, type TextureNode,
} from 'three/webgpu';
import {
  Fn, cameraPosition, clamp, max, mix, orthographicDepthToViewZ, pass, perspectiveDepthToViewZ,
  positionView, positionWorld, reference, screenUV, smoothstep, uniform, uvec2, vec2, vec3, vec4,
} from 'three/tsl';
import { sampleInkNoise } from './ink-paper-wash.mts';
import { textureSize2D } from './texture-size.mts';

export const seaReflectionMeshes = [
  'pads_side', 'shoulders', 'rim_boulders', 'monoliths', 'torii', 'arches',
  'broken_column', 'wreck', 'wreck3', 'wreck_sail', 'road_rock', 'marker_posts',
] as const;

interface SeaReflectionFragmentInputs {
  noise: Texture3DNode;
  level: Node<'float'>;
  seconds: Node<'float'>;
  position: Node<'vec3'>;
  eye: Node<'vec3'>;
  /** Positive camera-forward depths in world units. */
  reflectedDistance: Node<'float'>;
  opaqueDistance: Node<'float'>;
}

/** Mirrored fragments retain the source's discard test and working RGB. */
export function createSeaReflectionFragment({
  noise, level, seconds, position, eye, reflectedDistance, opaqueDistance,
}: SeaReflectionFragmentInputs): Node<'vec4'> {
  return Fn(() => {
    const immersion = level.sub(position.y).toVar();
    // A depth tie belongs to the real rock. The mirrored undersides also stop at the sea level.
    immersion.lessThan(0).or(reflectedDistance.greaterThan(opaqueDistance.sub(0.03))).discard();
    const distance = position.sub(eye).length();
    const streak = sampleInkNoise(noise, vec3(position.x.mul(0.22).add(position.z.mul(0.22)),
      position.y.mul(3.2).add(seconds.mul(0.25)), 5));
    const strength = immersion.div(-7).exp().mul(mix(0.3, 1, smoothstep(0.3, 0.7, streak)))
      .mul(smoothstep(70, 420, distance).oneMinus());
    return vec4(vec3(0.07, 0.07, 0.066).add(vec3(0.25, 0.245, 0.23).mul(strength)), 1);
  })();
}

interface SeaReflectionInputs {
  /** Raw forward depth from the opaque main scene pass. Exclude sea and mirror geometry. */
  depth: TextureNode;
  noise: Texture3DNode;
}

/**
 * Render borrowed GLB silhouettes into an independent, color-only pass. Place
 * the returned texture after the main opaque pass and Sea lacquer. Its shader
 * reads only the completed main depth and noise. The pass owns its target and
 * material. The caller owns input textures, source meshes, and their geometry.
 */
export function createSeaReflectionPass(
  camera: PerspectiveCamera | OrthographicCamera, { depth, noise }: SeaReflectionInputs,
) {
  const near = reference('near', 'float', camera);
  const far = reference('far', 'float', camera);
  const toViewZ = 'isPerspectiveCamera' in camera ? perspectiveDepthToViewZ : orthographicDepthToViewZ;
  const level = uniform(0).setName('seaReflectionLevel');
  const seconds = uniform(0).setName('seaReflectionSeconds');
  const material = new MeshBasicNodeMaterial({
    name: 'sea_mirror', side: DoubleSide, fog: false, toneMapped: false, transparent: true,
    depthTest: false, depthWrite: false, blending: CustomBlending, blendEquation: MaxEquation,
    blendSrc: OneFactor, blendDst: OneFactor,
  });
  const size = textureSize2D(depth);
  const texel = uvec2(clamp(screenUV.mul(size), vec2(0), size.sub(1)));
  material.fragmentNode = createSeaReflectionFragment({
    noise, level, seconds, position: positionWorld, eye: cameraPosition,
    reflectedDistance: positionView.z.negate(), opaqueDistance: toViewZ(depth.load(texel).r, near, far).negate(),
  });

  const scene = new Scene();
  // Black is the identity of the positive RGB maximum used for composition.
  scene.background = new Color(0, 0, 0);
  const mirrors = new Group();
  mirrors.name = 'mirror';
  mirrors.scale.y = -1;
  scene.add(mirrors);
  const mirrorPass = pass(scene, camera, { depthBuffer: false, colorSpace: NoColorSpace,
    minFilter: LinearFilter, magFilter: LinearFilter });
  const texture = mirrorPass.getTextureNode('output');
  let disposed = false;
  let release: (() => void) | undefined;
  const updateMirror = mirrorPass.updateBefore.bind(mirrorPass);
  mirrorPass.updateBefore = frame => { if (release) updateMirror(frame); };

  function assertActive() {
    if (disposed) throw Error('Sea reflection pass is disposed');
  }

  /**
   * Bind the rest-pose nodes from sea.glb. As in Ee, copy local position and
   * orientation only. The authored reflective nodes have identity scale.
   */
  function bind(root: Object3D, names: readonly string[] = seaReflectionMeshes) {
    assertActive();
    if (release) throw Error('Sea reflection meshes are already bound');
    const sources = names.map(name => {
      const source = root.getObjectByName(name);
      if (!(source instanceof Mesh)) throw Error('Sea reflection is missing mesh ' + name);
      return source;
    });
    const copies = sources.map(source => {
      const mesh = new Mesh(source.geometry, material);
      mesh.name = source.name;
      mesh.position.copy(source.position);
      mesh.quaternion.copy(source.quaternion);
      mesh.renderOrder = -5;
      mesh.frustumCulled = false;
      return mesh;
    });
    mirrors.add(...copies);
    const unbind = () => {
      if (release !== unbind) return;
      mirrors.remove(...copies);
      release = undefined;
    };
    release = unbind;
    return unbind;
  }

  return {
    texture, bind,
    update(height: number, time: number) {
      assertActive();
      if (!Number.isFinite(height) || !Number.isFinite(time)) throw RangeError('Sea reflection inputs must be finite');
      level.value = height;
      seconds.value = time;
      mirrors.position.y = height * 2;
    },
    setResolutionScale(scale: number) {
      assertActive();
      if (!Number.isFinite(scale) || scale <= 0) throw RangeError('Sea reflection requires positive resolution scale');
      mirrorPass.setResolutionScale(scale);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      release?.();
      try { mirrorPass.dispose(); } finally { material.dispose(); }
    },
  };
}

/** Compose the isolated reflection after lacquer, retaining the incoming alpha. */
export function blendSeaReflection(base: Node<'vec4'>, reflection: TextureNode, strength = 1): Node<'vec4'> {
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) throw RangeError('Sea reflection strength must be within zero and one');
  if (strength === 0) return base;
  const rgb = base.rgb;
  return vec4(mix(rgb, max(rgb, reflection.sample(screenUV).rgb), strength), base.a);
}
