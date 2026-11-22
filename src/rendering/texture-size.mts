import type { Node, TextureNode } from 'three/webgpu';
import { textureSize, vec2 } from 'three/tsl';

export function textureSize2D(texture: TextureNode) {
  // r187's TextureSizeNode emits uvec2. Its declaration omits that result type.
  return vec2(textureSize(texture) as unknown as Node<'uvec2'>);
}
