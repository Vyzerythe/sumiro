import { LinearFilter, NoColorSpace, type Node, type OrthographicCamera, type PassNode, type PerspectiveCamera, type Scene } from 'three/webgpu';
import { Fn, If, clamp, pass, rtt, screenUV, texture3D, uvec2, vec2, vec3, vec4 } from 'three/tsl';
import { createInkComposite } from './ink-composite.mts';
import { createInkEdgeAnalysis } from './ink-edge.mts';
import { createInkGrade } from './ink-grade.mts';
import { createInkNoiseTexture, type InkWashControls } from './ink-paper-wash.mts';
import { configureInkSurfacePass } from './ink-surface-pass.mts';
import { INK_PAPER_BASE, createInkSurfaceSky, createInkWashSheet, type InkWashSheet } from './ink-surface-sky.mts';
import { createSeaShoreline, type SeaShorelineInputs } from './sea-shoreline.mts';
import { blendSeaReflection, createSeaReflectionPass } from './sea-reflection.mts';
import { blendSummitAtmosphere, mountSummitAtmosphere } from './summit-atmosphere.mts';
import { textureSize2D } from './texture-size.mts';
import type { WebGpuOutputGraph } from './webgpu-renderer.mts';

type InkSettings = NonNullable<Parameters<typeof createInkComposite>[2]> & {
  paper?: { strength?: number };
  background?: { scene: Scene; camera: PerspectiveCamera | OrthographicCamera; enabled: Node<'bool'> };
  washSheets?: readonly (Omit<InkWashSheet, 'noise'> & { controls?: InkWashControls })[];
  sea?: Omit<SeaShorelineInputs, 'depth' | 'noise'> & { enabled: Node<'bool'>; reflection?: boolean };
  summit?: Node<'bool'>;
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
  let seaReflection: ReturnType<typeof createSeaReflectionPass> | undefined;
  let backgroundPass: PassNode | undefined;
  let summitAtmosphere: ReturnType<typeof mountSummitAtmosphere> | undefined;
  function disposeLayers() {
    try { seaReflection?.dispose(); } finally {
      try { backgroundPass?.dispose(); } finally {
        try { summitAtmosphere?.dispose(); } finally { volume?.dispose(); }
      }
    }
  }
  try {
    let layer = createInkComposite({ ...attachments, edge }, camera, settings);
    if (settings.paper || settings.washSheets?.length || settings.sea || settings.summit) {
      volume = createInkNoiseTexture(settings.noiseSeed);
      const noise = texture3D(volume);
      if (settings.paper) layer = createInkSurfaceSky(layer, attachments.depth, camera, { noise, ...settings.paper });
      const sea = settings.sea;
      if (sea) {
        const base = layer;
        const { enabled, reflection, ...water } = sea;
        seaReflection = reflection ? createSeaReflectionPass(camera, { depth: attachments.depth, noise }) : undefined;
        const mirror = seaReflection;
        layer = Fn(() => {
          const result = base.toVar();
          If(enabled, () => {
            result.assign(createSeaShoreline(result, camera, { ...water, depth: attachments.depth, noise }));
            if (mirror) result.assign(blendSeaReflection(result, mirror.texture));
          });
          return result;
        })();
      }
      for (const { controls, ...sheet } of settings.washSheets ?? []) {
        layer = createInkWashSheet(layer, attachments.depth, camera, { noise, ...sheet }, controls);
      }
      if (settings.summit) {
        const enabled = settings.summit;
        const summit = mountSummitAtmosphere(camera, attachments.depth, noise);
        summitAtmosphere = summit;
        summit.setEnabled(false);
        const base = layer;
        layer = Fn(() => {
          const result = base.toVar();
          If(enabled, () => { result.assign(blendSummitAtmosphere(result, summit.texture)); });
          return result;
        })();
      }
    }
    const background = settings.background;
    if (background) {
      const dedicated = pass(background.scene, background.camera, textureOptions);
      backgroundPass = dedicated;
      const draw = dedicated.updateBefore.bind(dedicated);
      dedicated.updateBefore = frame => { if (background.scene.children.length) draw(frame); };
      const backColor = dedicated.getTextureNode('output');
      const base = layer;
      const size = textureSize2D(attachments.depth);
      const rawDepth = attachments.depth.load(uvec2(clamp(screenUV.mul(size), vec2(0), size.sub(1)))).r;
      layer = Fn(() => {
        const result = base.toVar();
        If(background.enabled.and(rawDepth.equal(1)), () => {
          const inkedPaper = result.rgb.div(vec3(...INK_PAPER_BASE));
          result.assign(vec4(backColor.sample(screenUV).rgb.mul(inkedPaper), result.a));
        });
        return result;
      })();
    }
    const composite = rtt(layer, null, null, textureOptions);
    try {
      const outputNode = createInkGrade(composite);
      let disposed = false;
      return {
        attachments, edge, composite, outputNode, seaReflection, summitAtmosphere,
        setResolutionScale(scale: number) {
          edge.setResolutionScale(scale);
          composite.setResolutionScale(scale);
          seaReflection?.setResolutionScale(scale);
          backgroundPass?.setResolutionScale(scale);
          summitAtmosphere?.setResolutionScale(scale);
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          try { composite.dispose(); } finally {
            try { edge.dispose(); } finally { disposeLayers(); }
          }
        },
      } satisfies WebGpuOutputGraph & {
        attachments: typeof attachments; edge: typeof edge; composite: typeof composite; seaReflection: typeof seaReflection;
        summitAtmosphere: typeof summitAtmosphere;
      };
    } catch (error) {
      composite.dispose();
      throw error;
    }
  } catch (error) {
    try { edge.dispose(); } finally { disposeLayers(); }
    throw error;
  }
}
