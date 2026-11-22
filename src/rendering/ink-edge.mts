import type { Node, OrthographicCamera, PerspectiveCamera, TextureNode } from 'three/webgpu';
import {
  Fn, If, clamp, dot, float, max, min, mix, orthographicDepthToViewZ,
  perspectiveDepthToViewZ, reference, screenUV, select, smoothstep, uvec2, vec2, vec4,
} from 'three/tsl';
import { textureSize2D } from './texture-size.mts';

const DIRECTIONS = [
  [1, 0], [0.9239, 0.3827], [0.7071, 0.7071], [0.3827, 0.9239],
  [0, 1], [-0.3827, 0.9239], [-0.7071, 0.7071], [-0.9239, 0.3827],
] as const;

// Shipped INK.line and INK.occlusion settings used by the geometric analysis.
const LINE = {
  width: 1.9,
  referenceDistance: 6,
  widthExponent: 0.16,
  maxWidth: 3.6,
  minimumRadius: 1.5,
  depthLow: 0.018,
  depthHigh: 0.055,
  normalLow: 0.32,
  normalHigh: 0.72,
  creaseWeight: 0.75,
  convexKeep: 0.42,
  upLow: -0.55,
  upHigh: -0.05,
  lowerKeep: 0.3,
  fadeNear: 45,
  fadeFar: 220,
  midDark: 0.8,
};
const OCCLUSION_RADIUS = 8;
const OCCLUSION_CAP = 0.05;

interface InkEdgeInputs {
  depth: TextureNode;
  normalWeight: TextureNode;
}

interface InkEdgeOptions {
  referenceHeight?: number;
}

/**
 * Analyze two same-size textures in screen space, using mip-0 texels. Depth is
 * raw projection depth from `camera`. Normal RGB is world normal encoded as
 * `normal * 0.5 + 0.5`, with material line weight in alpha.
 *
 * Result RGBA holds weighted contour, weighted cavity, geometric crevice, and
 * unweighted contour coverage. Sample it as linear data. The radius follows
 * source texture height in reference pixels. Brush fields, wobble, and the
 * wash and stroke composite are separate from the geometric analysis.
 */
export function createInkEdgeAnalysis(
  { depth, normalWeight }: InkEdgeInputs,
  camera: PerspectiveCamera | OrthographicCamera,
  { referenceHeight = 704 }: InkEdgeOptions = {},
): Node<'vec4'> {
  if (!Number.isFinite(referenceHeight) || referenceHeight <= 0) {
    throw RangeError('Ink edge analysis requires a positive, finite reference height');
  }

  const perspective = 'isPerspectiveCamera' in camera;
  const toViewZ = perspective ? perspectiveDepthToViewZ : orthographicDepthToViewZ;
  const near = reference('near', 'float', camera);
  const far = reference('far', 'float', camera);
  return Fn(() => {
    const size = textureSize2D(depth).toVar('inkSceneSize');
    const pixel = screenUV.mul(size).floor().toVar('inkCenterPixel');
    const pixelScale = size.y.div(referenceHeight).toVar('inkPixelScale');
    const texelAt = (at: Node<'vec2'>) => uvec2(clamp(at, vec2(0), size.sub(1)));
    // Quantize the offset once so opposite taps stay centered on the same texel.
    const pairedOffset = (offset: Node<'vec2'>) => offset.abs().add(0.5).floor().mul(offset.sign());
    const distanceAt = (at: Node<'uvec2'>) => toViewZ(depth.load(at).r, near, far).negate();
    const centerTexel = texelAt(pixel).toVar();
    const centerDistance = distanceAt(centerTexel).toVar('inkCenterDistance');
    const centerSurface = normalWeight.load(centerTexel).toVar('inkCenterSurface');
    const centerRange = max(centerDistance, 0.0001).toVar();

    // Perspective inverse distance and orthographic distance are affine on a
    // screen-space plane. Use a signed relative change in either projection.
    const nearer = (neighbor: Node<'float'>) => perspective
      ? centerDistance.div(neighbor).sub(1)
      : centerDistance.sub(neighbor).div(centerRange);

    const distanceScale = float(LINE.referenceDistance).div(max(centerDistance, 0.1)).toVar();
    const cavityRadius = distanceScale.sqrt().mul(OCCLUSION_RADIUS).mul(pixelScale).toVar();
    const cavity = float(0).toVar('inkCavity');
    const valley = float(0).toVar('inkValley');
    for (const [index, [x, y]] of DIRECTIONS.entries()) {
      const offset = pairedOffset(vec2(x, y).mul(cavityRadius).mul(index % 2 === 0 ? 1 : 0.55)).toVar();
      const nearerA = nearer(distanceAt(texelAt(pixel.add(offset)))).toVar();
      const nearerB = nearer(distanceAt(texelAt(pixel.sub(offset)))).toVar();
      cavity.addAssign(clamp(nearerA, -OCCLUSION_CAP, OCCLUSION_CAP).add(clamp(nearerB, -OCCLUSION_CAP, OCCLUSION_CAP)));
      valley.addAssign(clamp(min(nearerA, nearerB), 0, OCCLUSION_CAP));
    }
    cavity.assign(clamp(cavity.div(DIRECTIONS.length * 2 * OCCLUSION_CAP), 0, 1));
    valley.assign(clamp(valley.div(DIRECTIONS.length * OCCLUSION_CAP), 0, 1));
    const crevice = smoothstep(0.2, 0.55, valley).toVar('inkCrevice');

    const width = min(distanceScale.pow(LINE.widthExponent).mul(LINE.width), LINE.maxWidth);
    const requestedRadius = width.mul(crevice.mul(1.1).add(1)).mul(0.5).mul(pixelScale).toVar();
    const radius = max(requestedRadius, LINE.minimumRadius).toVar();
    const thin = smoothstep(0.1, 0.7, requestedRadius.div(LINE.minimumRadius));

    const depthEdge = float(0).toVar('inkDepthEdge');
    const normalEdge = float(0).toVar('inkNormalEdge');
    const nearestDistance = centerDistance.toVar('inkNearestDistance');
    const nearestSurface = centerSurface.toVar('inkNearestSurface');
    const keepNearest = (distance: Node<'float'>, surface: Node<'vec4'>) => {
      If(distance.lessThan(nearestDistance), () => {
        nearestDistance.assign(distance);
        nearestSurface.assign(surface);
      });
    };

    for (const [x, y] of DIRECTIONS) {
      const offset = pairedOffset(vec2(x, y).mul(radius)).toVar();
      const texelA = texelAt(pixel.add(offset)).toVar();
      const texelB = texelAt(pixel.sub(offset)).toVar();
      const distanceA = distanceAt(texelA).toVar();
      const distanceB = distanceAt(texelB).toVar();
      const surfaceA = normalWeight.load(texelA).toVar();
      const surfaceB = normalWeight.load(texelB).toVar();

      const signedCurvature = nearer(distanceA).add(nearer(distanceB)).toVar();
      const distanceRatio = min(centerDistance, min(distanceA, distanceB)).div(centerDistance);
      const relativeDepthEdge = perspective ? signedCurvature.abs().mul(distanceRatio) : signedCurvature.abs();
      depthEdge.assign(max(depthEdge, relativeDepthEdge));

      const normalA = surfaceA.rgb.mul(2).sub(1);
      const normalB = surfaceB.rgb.mul(2).sub(1);
      const weightRatio = min(surfaceA.a, surfaceB.a).div(max(max(surfaceA.a, surfaceB.a), 0.001));
      const convex = select(signedCurvature.greaterThan(0), 1, LINE.convexKeep);
      const crease = dot(normalA, normalB).oneMinus().mul(weightRatio).mul(convex);
      normalEdge.assign(max(normalEdge, crease));

      keepNearest(distanceA, surfaceA);
      keepNearest(distanceB, surfaceB);
    }

    const contour = max(
      smoothstep(LINE.depthLow, LINE.depthHigh, depthEdge),
      smoothstep(LINE.normalLow, LINE.normalHigh, normalEdge).mul(LINE.creaseWeight),
    ).mul(thin).toVar('inkContour');
    const worldUp = nearestSurface.g.mul(2).sub(1);
    const upperStrength = mix(LINE.lowerKeep, 1, smoothstep(LINE.upLow, LINE.upHigh, worldUp));
    const distanceFade = mix(1, LINE.midDark, smoothstep(LINE.fadeNear, LINE.fadeFar, nearestDistance))
      .mul(smoothstep(LINE.fadeFar, LINE.fadeFar * 2.5, nearestDistance).oneMinus()).toVar();
    const lineStrength = upperStrength.mul(nearestSurface.a).mul(distanceFade);
    const cavityStrength = max(valley, cavity.mul(0.62))
      .mul(smoothstep(0.02, 0.2, centerSurface.a)).mul(distanceFade);
    return vec4(contour.mul(lineStrength), cavityStrength, crevice, contour);
  })();
}
