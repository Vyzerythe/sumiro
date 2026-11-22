import { Color, type Node, type OrthographicCamera, type PerspectiveCamera, type TextureNode } from 'three/webgpu';
import {
  Fn, If, asin, clamp, max, mix, orthographicDepthToViewZ, perspectiveDepthToViewZ,
  reference, screenUV, smoothstep, uvec2, vec2, vec3, vec4,
} from 'three/tsl';
import { textureSize2D } from './texture-size.mts';

interface InkCompositeInputs {
  color: TextureNode;
  edge: TextureNode;
  depth: TextureNode;
  surfaceData: TextureNode;
}

interface InkCompositeOptions {
  referenceHeight?: number;
  fogStrength?: number;
  fogTint?: Node<'vec3'>;
  inkBold?: Node<'float'>;
}

// Ink hex colors are sRGB. The shipped fog palette is supplied in working space.
const LINE_INK = new Color('#0e0d0a');
const POOL_INK = new Color('#1a2024');
const FOG_PALETTE = [
  [200, 198, 192, 0, 3],
  [201, 202, 200, 3, 8],
  [188, 192, 191, 11, 16],
  [181, 186, 185, 16, 22],
  [179, 190, 195, 22, 28],
] as const;
const FOG_START_PER_BOLD = 22;
const FOG_DISTANCE_BASE = 90;
const FOG_DISTANCE_PER_BOLD = 0.3;

/**
 * Compose opaque working-space color from aligned scene and edge textures.
 * Edge R is weighted contour coverage and G is weighted cavity. Use a linear
 * clamp-to-edge sampler on the edge texture and NoColorSpace for data textures.
 * Sample forward projection depth and surfaceData.g at the same scene texel.
 * That channel scales fog distance from 0 (clear) to 1 (full distance).
 * Chapter uniforms can supply a working-space fog tint and ink boldness.
 *
 * Caller owns the input resources and any render target for this node. Apply
 * grading and display conversion after composition. Keyed brush fields and
 * wobble are separate from this screen-space compositor.
 */
export function createInkComposite(
  { color, edge, depth, surfaceData }: InkCompositeInputs,
  camera: PerspectiveCamera | OrthographicCamera,
  { referenceHeight = 704, fogStrength = 0.72, fogTint, inkBold }: InkCompositeOptions = {},
): Node<'vec4'> {
  if (!Number.isFinite(referenceHeight) || referenceHeight <= 0) {
    throw RangeError('Ink composition requires a positive, finite reference height');
  }
  if (!Number.isFinite(fogStrength) || fogStrength < 0 || fogStrength > 1) {
    throw RangeError('Fog strength must be between zero and one');
  }

  const perspective = 'isPerspectiveCamera' in camera;
  const toViewZ = perspective ? perspectiveDepthToViewZ : orthographicDepthToViewZ;
  const near = reference('near', 'float', camera);
  const far = reference('far', 'float', camera);
  const inverseProjection = reference('projectionMatrixInverse', 'mat4', camera);
  const cameraWorld = reference('matrixWorld', 'mat4', camera);

  return Fn(() => {
    const edgeSize = textureSize2D(edge).toVar();
    const pixelScale = edgeSize.y.div(referenceHeight).toVar();
    const spacing = vec2(max(pixelScale.mul(0.8), 1)).div(edgeSize).toVar();
    const center = edge.sample(screenUV).rg.toVar();
    const contour = center.r.mul(0.28).toVar();
    // Filter weighted coverage directly. With this normalized kernel a
    // uniform stroke keeps its opacity and zero-weight edges stay transparent.
    for (const [x, y, weight] of [
      [1, 0, 0.14], [0, 1, 0.14], [0.7, 0.7, 0.04], [0.7, -0.7, 0.04],
    ] as const) {
      const offset = vec2(x, y).mul(spacing).toVar();
      const sideA = edge.sample(screenUV.add(offset)).r;
      const sideB = edge.sample(screenUV.sub(offset)).r;
      contour.addAssign(sideA.add(sideB).mul(weight));
    }

    // Sampling above the fragment carries the stain downward in screen UVs.
    const bleed = vec2(0, pixelScale.mul(3).div(edgeSize.y));
    const cavity = clamp(max(center.g, edge.sample(screenUV.sub(bleed)).g.mul(0.8)), 0, 1).toVar();
    const stain = smoothstep(0.02, 0.6, cavity).mul(0.2);
    const pool = smoothstep(0.5, 0.74, cavity).mul(0.62);
    const sceneColor = color.sample(screenUV).rgb;
    const wash = mix(sceneColor.mul(stain.oneMinus()), vec3(POOL_INK.r, POOL_INK.g, POOL_INK.b), pool);
    const composed = mix(wash, vec3(LINE_INK.r, LINE_INK.g, LINE_INK.b), clamp(contour, 0, 1)).toVar();

    if (fogStrength > 0) {
      const depthSize = textureSize2D(depth).toVar();
      const texel = uvec2(clamp(screenUV.mul(depthSize), vec2(0), depthSize.sub(1))).toVar();
      const projectionDepth = depth.load(texel).r.toVar();
      If(projectionDepth.lessThan(1), () => {
        const ndc = vec2(screenUV.x.mul(2).sub(1), screenUV.y.mul(-2).add(1));
        const viewRay = perspective
          ? inverseProjection.mul(vec4(ndc, 0.5, 1)).xyz.normalize().toVar()
          : vec3(0, 0, -1);
        const worldRayY = cameraWorld.mul(vec4(viewRay, 0)).xyz.normalize().y;
        const belowHorizon = max(asin(clamp(worldRayY, -1, 1)).mul(-180 / Math.PI), 0).toVar();
        const fogColor = vec3(202 / 255, 193 / 255, 174 / 255).toVar();
        for (const [r, g, b, start, end] of FOG_PALETTE) {
          fogColor.assign(mix(fogColor, vec3(r / 255, g / 255, b / 255), smoothstep(start, end, belowHorizon)));
        }

        const distance = toViewZ(projectionDepth, near, far).negate();
        const rayDistance = perspective ? distance.div(max(viewRay.z.negate(), 0.0001)) : distance;
        const fogWeight = clamp(surfaceData.load(texel).g, 0, 1);
        const bold = inkBold ? max(inkBold, 0).toVar() : undefined;
        const fogStart = bold ? bold.mul(FOG_START_PER_BOLD) : FOG_START_PER_BOLD;
        const attenuationDistance = bold
          ? bold.mul(FOG_DISTANCE_PER_BOLD).add(1).mul(-FOG_DISTANCE_BASE)
          : -FOG_DISTANCE_BASE * (1 + FOG_DISTANCE_PER_BOLD);
        const travel = max(rayDistance.mul(fogWeight).sub(fogStart), 0);
        const opacity = travel.div(attenuationDistance).exp().oneMinus().mul(fogStrength);
        composed.assign(mix(composed, fogTint ? fogColor.mul(fogTint) : fogColor, opacity));
      });
    }

    return vec4(composed, 1);
  })();
}
