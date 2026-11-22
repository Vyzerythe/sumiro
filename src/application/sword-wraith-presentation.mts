import type { Node } from 'three/webgpu';
import { Discard, Fn, If, dot, fract, materialColor, max, mix, screenCoordinate, smoothstep, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { AssetManager } from '../assets/asset-manager.mts';
import { loadAnimatedPlayer } from '../player/animated-player.mts';
import { createInkMaterial } from '../rendering/ink-material.mts';
import { bindInkMeshMaterials } from '../rendering/ink-mesh-materials.mts';
import type { ChapterLifetime } from '../runtime/chapter-manager.mts';

interface WraithPose {
  x: number;
  y: number;
  z: number;
  heading: number;
  clip: string;
  frame: number;
  visible: boolean;
  dissolve: number;
}

/** Uses the supplied player rig and the shipped wraith ink palette. */
export async function loadSwordWraithPresentation(assets: AssetManager, lifetime: ChapterLifetime) {
  const visual = await loadAnimatedPlayer(assets, { signal: lifetime.signal });
  lifetime.defer(() => visual.dispose());
  lifetime.signal.throwIfAborted();
  const dissolve = uniform(0);
  visual.root.name = 'sword_wraith';
  visual.root.visible = false;
  lifetime.defer(bindInkMeshMaterials(visual.root, source => {
    const material = createInkMaterial(source, { preset: 'cloth', vertexPaint: false });
    material.colorNode = Fn(() => {
      const base = vec4(materialColor as unknown as Node<'vec4'>).toVar();
      const noise = fract(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715))).mul(52.9829189));
      If(dissolve.greaterThan(0).and(noise.lessThan(dissolve)), () => { Discard(); });
      const light = dot(base.rgb, vec3(0.3, 0.59, 0.11));
      const ink = mix(vec3(0.098, 0.094, 0.086), vec3(0.314, 0.286, 0.251), smoothstep(0.12, 0.62, light).mul(0.9));
      const warm = smoothstep(0.1, 0.3, base.r.sub(base.b));
      return vec4(mix(ink, vec3(0.09, 0.085, 0.078), warm), max(base.a, 0));
    })();
    return material;
  }));
  return {
    root: visual.root,
    update(pose: WraithPose, delta: number) {
      visual.root.visible = pose.visible;
      dissolve.value = pose.dissolve;
      if (pose.visible) visual.update({
        x: pose.x, y: pose.y, z: pose.z, heading: pose.heading,
        vx: 0, vz: 0, state: 'IDLE', stateT: 0, grounded: true, landHeavy: false, stickMag: 0,
      }, delta, { clip: pose.clip, frame: pose.frame });
    },
  };
}
