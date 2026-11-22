import { LinearFilter, NoColorSpace, type OrthographicCamera, type PassNode, type PerspectiveCamera } from 'three/webgpu';
import { rtt, texture3D } from 'three/tsl';
import { createInkComposite } from './ink-composite.mts';
import { createInkEdgeAnalysis } from './ink-edge.mts';
import { createInkGrade } from './ink-grade.mts';
import { createInkNoiseTexture, type InkWashControls } from './ink-paper-wash.mts';
import { configureInkSurfacePass } from './ink-surface-pass.mts';
import { createInkSurfaceSky, createInkWashSheet, type InkWashSheet } from './ink-surface-sky.mts';
import type { WebGpuOutputGraph } from './webgpu-renderer.mts';

type InkSettings = NonNullable<Parameters<typeof createInkComposite>[2]> & {
  paper?: { strength?: number };
  washSheets?: readonly (Omit<InkWashSheet, 'noise'> & { controls?: InkWashControls })[];
  noiseSeed?: number;
};

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
  let volume: ReturnType<typeof createInkNoiseTexture> | undefined;
  try {
    let layer = createInkComposite({ ...attachments, edge }, camera, settings);
    if (settings.paper || settings.washSheets?.length) {
      volume = createInkNoiseTexture(settings.noiseSeed);
      const noise = texture3D(volume);
      if (settings.paper) layer = createInkSurfaceSky(layer, attachments.depth, camera, { noise, ...settings.paper });
      for (const { controls, ...sheet } of settings.washSheets ?? []) {
        layer = createInkWashSheet(layer, attachments.depth, camera, { noise, ...sheet }, controls);
      }
    }
    const composite = rtt(layer, null, null, textureOptions);
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
          try { composite.dispose(); } finally {
            try { edge.dispose(); } finally { volume?.dispose(); }
          }
        },
      } satisfies WebGpuOutputGraph & { attachments: typeof attachments; edge: typeof edge; composite: typeof composite };
    } catch (error) {
      composite.dispose();
      throw error;
    }
  } catch (error) {
    try { edge.dispose(); } finally { volume?.dispose(); }
    throw error;
  }
}
