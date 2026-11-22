import { LinearFilter, NoColorSpace, type OrthographicCamera, type PassNode, type PerspectiveCamera } from 'three/webgpu';
import { rtt } from 'three/tsl';
import { createInkComposite } from './ink-composite.mts';
import { createInkEdgeAnalysis } from './ink-edge.mts';
import { createInkGrade } from './ink-grade.mts';
import { configureInkSurfacePass } from './ink-surface-pass.mts';
import type { WebGpuOutputGraph } from './webgpu-renderer.mts';

type InkSettings = Parameters<typeof createInkComposite>[2];

/** Draw opaque scene data, analyze edges, composite ink and fog, then grade. */
export function createInkRenderGraph(
  scenePass: PassNode,
  camera: OrthographicCamera | PerspectiveCamera,
  settings: InkSettings = {},
) {
  const attachments = configureInkSurfacePass(scenePass);
  const textureOptions = {
    colorSpace: NoColorSpace, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter,
  };
  const edge = rtt(createInkEdgeAnalysis(attachments, camera, settings),
    null, null, textureOptions);
  try {
    const composite = rtt(createInkComposite({ ...attachments, edge }, camera, settings), null, null, textureOptions);
    try {
      const outputNode = createInkGrade(composite);
      let disposed = false;
      return {
        attachments, edge, composite, outputNode,
        setResolutionScale(scale: number) {
          edge.setResolutionScale(scale);
          composite.setResolutionScale(scale);
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          try { composite.dispose(); } finally { edge.dispose(); }
        },
      } satisfies WebGpuOutputGraph & { attachments: typeof attachments; edge: typeof edge; composite: typeof composite };
    } catch (error) {
      composite.dispose();
      throw error;
    }
  } catch (error) {
    edge.dispose();
    throw error;
  }
}
