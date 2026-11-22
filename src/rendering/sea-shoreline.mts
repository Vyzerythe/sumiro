/** Sea lacquer from ve/fe in the published Chapter Five bundle. */
import type { Node, OrthographicCamera, PerspectiveCamera, Texture3DNode, TextureNode } from 'three/webgpu';
import {
  Fn, If, clamp, dot, max, mix, orthographicDepthToViewZ, perspectiveDepthToViewZ,
  reference, screenUV, smoothstep, uvec2, vec2, vec3, vec4,
} from 'three/tsl';
import { sampleInkNoise } from './ink-paper-wash.mts';
import { textureSize2D } from './texture-size.mts';

interface SeaLacquerInputs {
  noise: Texture3DNode;
  seconds: Node<'float'>;
  stir: Node<'float'>;
  /** Both positions use world coordinates. */
  position: Node<'vec3'>;
  cameraPosition: Node<'vec3'>;
  /** The distances are positive camera-forward Z values, in world units. */
  sceneDistance: Node<'float'>;
  waterDistance: Node<'float'>;
  mist?: Node<'vec3'>;
}

/** Evaluate the published lacquer in working RGB after the visibility test. */
export function createSeaLacquerColor({
  noise, seconds, stir, position, cameraPosition, sceneDistance, waterDistance,
  mist = vec3(0.62, 0.61, 0.6),
}: SeaLacquerInputs): Node<'vec3'> {
  return Fn(() => {
    const difference = position.sub(cameraPosition).toVar();
    const distance = difference.length().toVar();
    const view = difference.div(max(distance, 0.0001)).toVar();
    const q = position.xz.toVar();
    const flatness = clamp(view.y.negate(), 0, 1).oneMinus().toVar();
    const horizontal = view.xz.div(max(view.xz.length(), 0.0001));
    const azimuth = dot(horizontal, vec2(0.1, -1).normalize());
    const slow = sampleInkNoise(noise, vec3(q.mul(vec2(0.05, 0.19)), seconds.mul(0.05)));
    const smear = clamp(azimuth, 0, 1).pow(26).mul(slow.mul(0.8).add(0.45));
    const reflected = flatness.pow(5).mul(0.065).add(smear.mul(flatness.pow(2.2)).mul(0.2));

    const firstRing = sampleInkNoise(noise, vec3(q.mul(vec2(0.22, 0.6)).add(vec2(seconds.mul(0.06), 0)),
      seconds.mul(0.07)));
    const secondRing = sampleInkNoise(noise, vec3(q.mul(vec2(0.6, 0.2)).sub(vec2(0, seconds.mul(0.05))),
      seconds.mul(0.06).add(4)));
    const patches = smoothstep(0.56, 0.72, sampleInkNoise(noise, vec3(q.mul(0.035), seconds.mul(0.01).add(9))));
    // Reversed smoothstep edges in the original express a decreasing mask.
    const lines = smoothstep(0, 0.022, firstRing.sub(0.5).abs()).oneMinus().mul(0.5)
      .add(smoothstep(0, 0.016, secondRing.sub(0.52).abs()).oneMinus().mul(0.3));
    const ripple = stir.mul(0.1).add(0.05).mul(lines).mul(mix(patches, 1, stir))
      .mul(smoothstep(stir.mul(25).add(25), stir.mul(70).add(110), distance).oneMinus());

    const depth = sceneDistance.sub(waterDistance).mul(clamp(view.y.negate(), 0.05, 1)).toVar();
    const wobble = sampleInkNoise(noise, vec3(q.mul(1.3), seconds.mul(0.2))).sub(0.5).mul(0.05);
    const lip = depth.add(wobble).toVar();
    const gleam = smoothstep(0.02, 0.05, lip).mul(smoothstep(0.08, 0.17, lip).oneMinus())
      .mul(smoothstep(25, 90, distance).oneMinus());
    const color = vec3(0.07, 0.07, 0.066).add(reflected).add(ripple)
      .add(vec3(0.32, 0.31, 0.29).mul(gleam)).toVar();
    const shadedLip = mix(color.mul(0.72), color, smoothstep(0.1, 0.5, depth));

    const drift = sampleInkNoise(noise, vec3(q.mul(vec2(0.006, 0.014)), 21)).sub(0.5)
      .add(sampleInkNoise(noise, vec3(q.mul(vec2(0.02, 0.05)), 25)).sub(0.5).mul(0.4));
    const horizon = smoothstep(170, 620, distance.add(drift.mul(420)));
    return mix(shadedLip, mist, horizon.mul(0.96));
  })();
}

export interface SeaShorelineInputs {
  /** Completed raw forward projection depth of opaque land and objects. Exclude the water. */
  depth: TextureNode;
  /** An optional, separate completed coverage texture. Its R must equal value on water. */
  marker?: { texture: TextureNode; value: number };
  noise: Texture3DNode;
  level: Node<'float'>;
  seconds: Node<'float'>;
  stir: Node<'float'>;
  center?: readonly [x: number, z: number];
  size?: readonly [width: number, length: number];
  mist?: Node<'vec3'>;
  strength?: number;
}

function exactScreenTexel(texture: TextureNode) {
  const size = textureSize2D(texture);
  return texture.load(uvec2(clamp(screenUV.mul(size), vec2(0), size.sub(1)))).r;
}

/**
 * Composite a finite horizontal Sea plane before grade. The output retains the
 * incoming alpha. The returned node borrows the completed depth, optional
 * marker and noise textures. No input may be an attachment of the output pass.
 */
export function createSeaShoreline(base: Node<'vec4'>, camera: PerspectiveCamera | OrthographicCamera, {
  depth, marker, noise, level, seconds, stir, center = [100, -320], size = [3600, 3600],
  mist, strength = 1,
}: SeaShorelineInputs): Node<'vec4'> {
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) throw RangeError('Sea strength must be within zero and one');
  if (!center.every(Number.isFinite) || !size.every(extent => Number.isFinite(extent) && extent > 0) ||
      (marker !== undefined && !Number.isFinite(marker.value))) {
    throw RangeError('Sea bounds and coverage marker must be finite, with positive size');
  }
  if (strength === 0) return base;
  const perspective = 'isPerspectiveCamera' in camera;
  const inverseProjection = reference('projectionMatrixInverse', 'mat4', camera);
  const world = reference('matrixWorld', 'mat4', camera);
  const near = reference('near', 'float', camera);
  const far = reference('far', 'float', camera);
  const depthToViewZ = perspective ? perspectiveDepthToViewZ : orthographicDepthToViewZ;

  return Fn(() => {
    const result = base.toVar();
    const ndc = vec2(screenUV.x.mul(2).sub(1), screenUV.y.mul(-2).add(1));
    const projected = inverseProjection.mul(vec4(ndc, 0.5, 1)).toVar();
    const viewDirection = perspective ? projected.xyz.normalize().toVar() : vec3(0, 0, -1);
    const viewOrigin = perspective ? vec3(0) : vec3(projected.xy.div(projected.w), 0);
    const origin = world.mul(vec4(viewOrigin, 1)).xyz.toVar();
    const direction = world.mul(vec4(viewDirection, 0)).xyz.toVar();
    // The original upward-facing water mesh draws its front side only.
    If(direction.y.lessThan(-0.000001), () => {
      const travel = level.sub(origin.y).div(direction.y).toVar();
      const waterDistance = travel.mul(viewDirection.z.negate()).toVar();
      If(waterDistance.greaterThan(near).and(waterDistance.lessThan(far)), () => {
        const position = origin.add(direction.mul(travel)).toVar();
        const local = position.xz.sub(vec2(...center)).abs().toVar();
        const inBounds = local.x.lessThanEqual(size[0] / 2).and(local.y.lessThanEqual(size[1] / 2));
        const covered = marker ? inBounds.and(exactScreenTexel(marker.texture).equal(marker.value)) : inBounds;
        If(covered, () => {
          const sceneDistance = depthToViewZ(exactScreenTexel(depth), near, far).negate().toVar();
          If(sceneDistance.greaterThanEqual(waterDistance), () => {
            const cameraPosition = world.mul(vec4(0, 0, 0, 1)).xyz;
            const color = createSeaLacquerColor({
              noise, seconds, stir, position, cameraPosition, sceneDistance, waterDistance,
              ...(mist !== undefined ? { mist } : {}),
            });
            result.assign(vec4(mix(result.rgb, color, strength), result.a));
          });
        });
      });
    });
    return result;
  })();
}
