import { Color, NearestFilter, NoColorSpace, RGFormat, type Node, type PassNode } from 'three/webgpu';
import { mrt, normalWorld, output, vec4 } from 'three/tsl';

const NORMAL_WEIGHT_ATTACHMENT = 'normalWeight';
const SURFACE_DATA_ATTACHMENT = 'surfaceData';

interface InkSurfaceData {
  lineWeight: number | Node<'float'>;
  movingSurfaceId?: number | Node<'float'>;
  fogWeight?: number | Node<'float'>;
}

/**
 * A pass owns the textures it exposes here. Keep color separate from the
 * encoded world normal and line weight so neither uses the other's sampling.
 */
export function configureInkSurfacePass(scenePass: PassNode) {
  const normalWeightTexture = scenePass.getTexture(NORMAL_WEIGHT_ATTACHMENT);
  normalWeightTexture.colorSpace = NoColorSpace;
  normalWeightTexture.minFilter = NearestFilter;
  normalWeightTexture.magFilter = NearestFilter;
  const surfaceDataTexture = scenePass.getTexture(SURFACE_DATA_ATTACHMENT);
  surfaceDataTexture.format = RGFormat;
  surfaceDataTexture.colorSpace = NoColorSpace;
  surfaceDataTexture.minFilter = NearestFilter;
  surfaceDataTexture.magFilter = NearestFilter;

  const attachments = mrt({
    output,
    [NORMAL_WEIGHT_ATTACHMENT]: vec4(0.5, 0.5, 0.5, 0),
    [SURFACE_DATA_ATTACHMENT]: vec4(0, 1, 0, 1),
  });
  attachments.setClearColor(NORMAL_WEIGHT_ATTACHMENT, new Color(0.5, 0.5, 0.5), 0);
  attachments.setClearColor(SURFACE_DATA_ATTACHMENT, new Color(0, 1, 0), 1);
  scenePass.setMRT(attachments);

  return {
    color: scenePass.getTextureNode('output'),
    depth: scenePass.getTextureNode('depth'),
    normalWeight: scenePass.getTextureNode(NORMAL_WEIGHT_ATTACHMENT),
    surfaceData: scenePass.getTextureNode(SURFACE_DATA_ATTACHMENT),
  };
}

/** Assign to an ink material's mrtNode. Non-ink materials use the neutral default. */
export function createInkSurfaceOutput({ lineWeight, movingSurfaceId = 0, fogWeight = 1 }: InkSurfaceData) {
  const encodedNormal = normalWorld.mul(0.5).add(0.5);
  return mrt({
    [NORMAL_WEIGHT_ATTACHMENT]: vec4(encodedNormal, lineWeight),
    [SURFACE_DATA_ATTACHMENT]: vec4(movingSurfaceId, fogWeight, 0, 1),
  });
}
