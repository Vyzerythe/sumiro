import { NearestFilter, NoColorSpace, RGFormat, type OrthographicCamera, type PerspectiveCamera, type TextureNode } from 'three/webgpu';
import { Fn, If, orthographicDepthToViewZ, perspectiveDepthToViewZ, reference, rtt, screenUV, vec2, vec4 } from 'three/tsl';
import { textureSize2D } from './texture-size.mts';

const ANGULAR_TAPS = [
  [1, 0], [0.9239, 0.3827], [0.7071, 0.7071], [0.3827, 0.9239],
  [0, 1], [-0.3827, 0.9239], [-0.7071, 0.7071], [-0.9239, 0.3827],
] as const;
const KEY_DOWNSAMPLE = 4;

interface SurfaceInputs {
  depth: TextureNode;
  surfaceData: TextureNode;
}

interface KeyOptions {
  radiusPixels?: number;
  referenceHeight?: number;
}

/** Finds the nearest forward-depth sample and its discrete moving-surface ID. */
export function createInkDepthKey(
  { depth, surfaceData }: SurfaceInputs,
  camera: PerspectiveCamera | OrthographicCamera,
  { radiusPixels = 7, referenceHeight = 704 }: KeyOptions = {},
) {
  if (!Number.isFinite(radiusPixels) || radiusPixels < 0 ||
    !Number.isFinite(referenceHeight) || referenceHeight <= 0) {
    throw RangeError('Depth-key sampling requires a finite radius and a positive reference height');
  }

  const near = reference('near', 'float', camera);
  const far = reference('far', 'float', camera);
  const toViewZ = 'isPerspectiveCamera' in camera ? perspectiveDepthToViewZ : orthographicDepthToViewZ;
  const size = textureSize2D(depth);
  const tapRadius = vec2(size.y.mul(radiusPixels / referenceHeight)).div(size);
  const key = Fn(() => {
    const nearestDepth = depth.sample(screenUV).r.toVar();
    const nearestUv = screenUV.toVar();
    for (const [x, y] of ANGULAR_TAPS) {
      for (const sign of [1, -1]) {
        const uv = screenUV.add(vec2(x * sign, y * sign).mul(tapRadius));
        const sample = depth.sample(uv).r;
        If(sample.lessThan(nearestDepth), () => {
          nearestDepth.assign(sample);
          nearestUv.assign(uv);
        });
      }
    }
    // Both camera projections are monotonic in forward depth. Convert the winner once.
    const distance = toViewZ(nearestDepth, near, far).negate();
    return vec4(distance, surfaceData.sample(nearestUv).r, 0, 1);
  })();

  const texture = rtt(key, 1, 1, {
    format: RGFormat,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    colorSpace: NoColorSpace,
    depthBuffer: false,
  });
  let disposed = false;
  return {
    texture,
    resize(sceneWidth: number, sceneHeight: number) {
      if (disposed) throw Error('Depth-key target is disposed');
      if (![sceneWidth, sceneHeight].every(dimension => Number.isInteger(dimension) && dimension >= 1)) {
        throw RangeError('Depth-key source dimensions must be positive integers');
      }
      texture.setSize(Math.ceil(sceneWidth / KEY_DOWNSAMPLE), Math.ceil(sceneHeight / KEY_DOWNSAMPLE));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      texture.dispose();
    },
  };
}
