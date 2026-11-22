import type { Node, OrthographicCamera, PerspectiveCamera, Texture3DNode, TextureNode } from 'three/webgpu';
import {
  Fn, If, clamp, cross, dot, orthographicDepthToViewZ, perspectiveDepthToViewZ,
  reference, screenUV, uvec2, vec2, vec3, vec4,
} from 'three/tsl';
import { blendInkWash, createInkAnimatedWash, createInkPaperColor, type InkWashControls } from './ink-paper-wash.mts';
import { textureSize2D } from './texture-size.mts';

type SceneCamera = PerspectiveCamera | OrthographicCamera;

/** Shipped sky background in working-space RGB. */
export const INK_PAPER_BASE = [195.8 / 255, 183.2 / 255, 152 / 255] as const;

export interface InkSurfaceSkyOptions {
  noise: Texture3DNode;
  referenceHeight?: number;
  strength?: number;
}

function projectionPoint(inverseProjection: Node<'mat4'>) {
  const ndc = vec2(screenUV.x.mul(2).sub(1), screenUV.y.mul(-2).add(1));
  return inverseProjection.mul(vec4(ndc, 0.5, 1));
}

function projectionDepthAtPixel(depth: TextureNode) {
  const size = textureSize2D(depth);
  const texel = uvec2(clamp(screenUV.mul(size), vec2(0), size.sub(1)));
  return depth.load(texel).r;
}

/**
 * Texture the paper already in the input color at clear-depth pixels. Set the
 * scene background to INK_PAPER_BASE to use the authored palette. Modulating
 * the composited pixel keeps silhouette ink that extends beyond the geometry.
 * The depth attachment must be raw forward depth from the supplied camera.
 */
export function createInkSurfaceSky(
  base: Node<'vec4'>, depth: TextureNode, camera: SceneCamera,
  { noise, referenceHeight = 704, strength = 1 }: InkSurfaceSkyOptions,
): Node<'vec4'> {
  if (!Number.isFinite(referenceHeight) || referenceHeight <= 0) {
    throw RangeError('Paper sky requires a positive finite reference height');
  }
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) {
    throw RangeError('Paper sky strength must be between zero and one');
  }
  if (strength === 0) return base;
  const perspective = 'isPerspectiveCamera' in camera;
  const inverseProjection = reference('projectionMatrixInverse', 'mat4', camera);
  const cameraWorld = reference('matrixWorld', 'mat4', camera);

  return Fn(() => {
    const result = base.toVar();
    If(projectionDepthAtPixel(depth).equal(1), () => {
      const viewDirection = perspective ? projectionPoint(inverseProjection).xyz : vec3(0, 0, -1);
      const direction = cameraWorld.mul(vec4(viewDirection, 0)).xyz;
      // Inverse focal scale equals tan(fov / 2). Map a vertical NDC span of 2 to
      // the reference height, while using a parallel ray for orthographic views.
      const radiansPerPixel = perspective
        ? inverseProjection.mul(vec4(0, 1, 0, 0)).y.abs().mul(2 / referenceHeight)
        : undefined;
      result.assign(createInkPaperColor(result, {
        noise, direction, strength, ...(radiansPerPixel ? { radiansPerPixel } : {}),
      }));
    });
    return result;
  })();
}

export interface InkWashSheet {
  noise: Texture3DNode;
  seconds: Node<'float'>;
  center: Node<'vec3'>;
  /** World-space vector spanning the complete local U extent of the sheet. */
  rightSpan: Node<'vec3'>;
  /** World-space vector spanning the complete local V extent, from foot to top. */
  upSpan: Node<'vec3'>;
}

/**
 * Blend a finite, two-sided wash sheet into opaque working-space color before
 * grading. The axes and center use world units. Compare both depths along the
 * camera forward axis, as the published mist shader does after linearizing Z.
 */
export function createInkWashSheet(
  base: Node<'vec4'>, depth: TextureNode, camera: SceneCamera,
  { noise, seconds, center, rightSpan, upSpan }: InkWashSheet, controls: InkWashControls = {},
): Node<'vec4'> {
  if (controls.strength === 0) return base;
  const perspective = 'isPerspectiveCamera' in camera;
  const inverseProjection = reference('projectionMatrixInverse', 'mat4', camera);
  const cameraWorld = reference('matrixWorld', 'mat4', camera);
  const near = reference('near', 'float', camera);
  const far = reference('far', 'float', camera);
  const toViewZ = perspective ? perspectiveDepthToViewZ : orthographicDepthToViewZ;

  return Fn(() => {
    const result = base.toVar();
    const point = projectionPoint(inverseProjection).toVar();
    const viewOrigin = perspective ? vec3(0) : vec3(point.xy.div(point.w), 0);
    const viewDirection = perspective ? point.xyz.normalize().toVar() : vec3(0, 0, -1);
    const origin = cameraWorld.mul(vec4(viewOrigin, 1)).xyz.toVar();
    const direction = cameraWorld.mul(vec4(viewDirection, 0)).xyz.toVar();
    const normal = cross(rightSpan, upSpan).toVar();
    const areaSquared = dot(normal, normal).toVar();
    const facing = dot(direction, normal).toVar();

    // Compare the angle independently of the magnitude of the axes. A
    // degenerate sheet also fails this test and never reaches a division.
    If(facing.mul(facing).greaterThan(areaSquared.mul(dot(direction, direction)).mul(0.000000000001)), () => {
      const travel = dot(center.sub(origin), normal).div(facing).toVar();
      const washDistance = travel.mul(viewDirection.z.negate()).toVar();
      If(washDistance.greaterThan(near).and(washDistance.lessThan(far)), () => {
        const position = origin.add(direction.mul(travel)).toVar();
        const offset = position.sub(center).toVar();
        const u = dot(cross(offset, upSpan), normal).div(areaSquared);
        const v = dot(cross(rightSpan, offset), normal).div(areaSquared);
        const uv = vec2(u, v).add(0.5).toVar();
        If(uv.x.greaterThan(0).and(uv.x.lessThan(1)).and(uv.y.greaterThan(0)).and(uv.y.lessThan(1)), () => {
          const sceneDistance = toViewZ(projectionDepthAtPixel(depth), near, far).negate().toVar();
          If(sceneDistance.greaterThan(washDistance), () => {
            const wash = createInkAnimatedWash({ noise, position, uv, seconds, sceneDistance, washDistance }, controls);
            result.assign(blendInkWash(result, wash));
          });
        });
      });
    });
    return result;
  })();
}
