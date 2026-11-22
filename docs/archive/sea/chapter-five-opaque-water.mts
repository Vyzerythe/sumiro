import { Mesh, MeshBasicNodeMaterial, PlaneGeometry } from 'three/webgpu';
import { Fn, cameraPosition, clamp, dot, max, mix, positionWorld, smoothstep, texture3D, uniform, vec2, vec3 } from 'three/tsl';
import { createInkNoiseTexture, sampleInkNoise } from '../rendering/ink-paper-wash.mts';
import { createInkSurfaceOutput } from '../rendering/ink-surface-pass.mts';
import type { ChapterLifetime } from '../runtime/chapter-manager.mts';
import { chapterFiveMechanismSites } from './chapter-five-mechanisms.mts';

/** Earlier opaque Sea prototype, superseded by the native depth-aware shoreline pass. */
export function createChapterFiveWater(lifetime: ChapterLifetime) {
  const noise = createInkNoiseTexture();
  lifetime.defer(() => noise.dispose());
  const grain = texture3D(noise);
  const seconds = uniform(0);
  const stir = uniform(0);
  const geometry = new PlaneGeometry(...chapterFiveMechanismSites.tide.size);
  lifetime.defer(() => geometry.dispose());
  const material = new MeshBasicNodeMaterial();
  lifetime.defer(() => material.dispose());
  material.mrtNode = createInkSurfaceOutput({ lineWeight: 0, fogWeight: 0 });
  material.colorNode = Fn(() => {
    const difference = positionWorld.sub(cameraPosition);
    const distance = max(difference.length(), 0.0001).toVar();
    const view = difference.div(distance).toVar();
    const flatness = clamp(view.y.negate(), 0, 1).oneMinus();
    const q = positionWorld.xz;
    const slow = sampleInkNoise(grain, vec3(q.mul(vec2(0.05, 0.19)), seconds.mul(0.05)));
    const across = view.xz.div(max(view.xz.length(), 0.0001));
    const smear = clamp(dot(across, vec2(0.1, -1).normalize()), 0, 1).pow(26).mul(slow.mul(0.8).add(0.45));
    const first = sampleInkNoise(grain, vec3(q.mul(vec2(0.22, 0.6)).add(vec2(seconds.mul(0.06), 0)), seconds.mul(0.07)));
    const second = sampleInkNoise(grain, vec3(q.mul(vec2(0.6, 0.2)).sub(vec2(0, seconds.mul(0.05))), seconds.mul(0.06).add(4)));
    const patches = smoothstep(0.56, 0.72, sampleInkNoise(grain, vec3(q.mul(0.035), seconds.mul(0.01).add(9))));
    const lines = smoothstep(0, 0.022, first.sub(0.5).abs()).oneMinus().mul(0.5)
      .add(smoothstep(0, 0.016, second.sub(0.52).abs()).oneMinus().mul(0.3));
    const ripple = lines.mul(stir.mul(0.1).add(0.05)).mul(mix(patches, 1, stir))
      .mul(smoothstep(stir.mul(25).add(25), stir.mul(70).add(110), distance).oneMinus());
    const reflection = flatness.pow(5).mul(0.065).add(flatness.pow(2.2).mul(smear).mul(0.2));
    const base = vec3(0.07, 0.07, 0.066).add(reflection).add(ripple);
    const drift = sampleInkNoise(grain, vec3(q.mul(vec2(0.006, 0.014)), 21)).sub(0.5)
      .add(sampleInkNoise(grain, vec3(q.mul(vec2(0.02, 0.05)), 25)).sub(0.5).mul(0.4));
    return mix(base, vec3(0.62, 0.61, 0.6), smoothstep(170, 620, distance.add(drift.mul(420))).mul(0.96));
  })();
  const node = new Mesh(geometry, material);
  node.name = 'sea';
  node.rotation.x = -Math.PI / 2;
  return {
    node,
    update(time: number, agitation: number) { seconds.value = time; stir.value = agitation; },
  };
}
