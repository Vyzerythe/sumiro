import type { Node } from 'three/webgpu';
import { Discard, Fn, If, dot, fract, materialColor, max, mix, screenCoordinate, smoothstep, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { AssetManager } from '../assets/asset-manager.mts';
import { loadAnimatedPlayer, type AnimatedPlayer } from '../player/animated-player.mts';
import { createInkMaterial } from '../rendering/ink-material.mts';
import { bindInkMeshMaterials } from '../rendering/ink-mesh-materials.mts';
import type { ChapterLifetime } from '../runtime/chapter-manager.mts';
import type { CombatActorKind } from '../combat/encounters.mts';

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
  try {
    const presentation = createInkEnemyPresentation(visual, 'wraith');
    lifetime.defer(() => presentation.dispose());
    lifetime.signal.throwIfAborted();
    return presentation;
  } catch (error) {
    visual.dispose();
    throw error;
  }
}

export function createInkEnemyPresentation(visual: AnimatedPlayer, kind: CombatActorKind) {
  const dissolve = uniform(0);
  visual.root.name = 'sword_' + kind;
  visual.root.visible = false;
  const tintStrength = kind === 'archer' ? 0.75 : kind === 'wraith' ? 0.9 : 1;
  const release = bindInkMeshMaterials(visual.root, source => {
    const material = createInkMaterial(source, { preset: 'cloth', vertexPaint: false });
    material.colorNode = Fn(() => {
      const base = vec4(materialColor as unknown as Node<'vec4'>).toVar();
      const noise = fract(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715))).mul(52.9829189));
      If(dissolve.greaterThan(0).and(noise.lessThan(dissolve)), () => { Discard(); });
      const light = dot(base.rgb, vec3(0.3, 0.59, 0.11));
      const ink = mix(vec3(0.098, 0.094, 0.086), vec3(0.314, 0.286, 0.251), smoothstep(0.12, 0.62, light).mul(tintStrength));
      const warm = smoothstep(0.1, 0.3, base.r.sub(base.b));
      const neutral = mix(ink, vec3(0.09, 0.085, 0.078), warm);
      const red = smoothstep(0.42, 0.6, base.g.div(max(base.r, 0.02))).oneMinus().mul(smoothstep(0.16, 0.32, base.r));
      return vec4(kind === 'ronin' ? mix(neutral, base.rgb.mul(vec3(1.45, 0.95, 0.9)), red) : neutral, max(base.a, 0));
    })();
    return material;
  });
  return {
    root: visual.root,
    duration: visual.duration,
    update(pose: WraithPose, delta: number) {
      visual.root.visible = pose.visible;
      dissolve.value = pose.dissolve;
      if (pose.visible) visual.update({
        x: pose.x, y: pose.y, z: pose.z, heading: pose.heading,
        vx: 0, vz: 0, state: 'IDLE', stateT: 0, grounded: true, landHeavy: false, stickMag: 0,
      }, delta, { clip: pose.clip, frame: pose.frame });
    },
    dispose() {
      release();
      visual.dispose();
    },
  };
}
