import { Color, NearestFilter, NoColorSpace, type Node, type PassNode } from 'three/webgpu';
import { mrt, normalWorld, output, vec4 } from 'three/tsl';

const NORMAL_WEIGHT_ATTACHMENT = 'normalWeight';

/**
 * A pass owns the textures it exposes here. Keep color separate from the
 * encoded world normal and line weight so neither uses the other's sampling.
 */
export function configureInkSurfacePass(scenePass: PassNode) {
  const normalWeightTexture = scenePass.getTexture(NORMAL_WEIGHT_ATTACHMENT);
  normalWeightTexture.colorSpace = NoColorSpace;
  normalWeightTexture.minFilter = NearestFilter;
  normalWeightTexture.magFilter = NearestFilter;

  const attachments = mrt({
    output,
    [NORMAL_WEIGHT_ATTACHMENT]: vec4(0.5, 0.5, 0.5, 0),
  });
  attachments.setClearColor(NORMAL_WEIGHT_ATTACHMENT, new Color(0.5, 0.5, 0.5), 0);
  scenePass.setMRT(attachments);

  return {
    color: scenePass.getTextureNode('output'),
    depth: scenePass.getTextureNode('depth'),
    normalWeight: scenePass.getTextureNode(NORMAL_WEIGHT_ATTACHMENT),
  };
}

/** Assign to an ink material's mrtNode. Non-ink materials use the neutral default. */
export function createInkSurfaceOutput(lineWeight: number | Node<'float'>) {
  const encodedNormal = normalWorld.mul(0.5).add(0.5);
  return mrt({ [NORMAL_WEIGHT_ATTACHMENT]: vec4(encodedNormal, lineWeight) });
}
