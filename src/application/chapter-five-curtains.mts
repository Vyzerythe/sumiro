import { DoubleSide, Mesh, MeshBasicNodeMaterial, PlaneGeometry, type Object3D } from 'three/webgpu';
import { Discard, Fn, If, max, mix, positionWorld, smoothstep, texture3D, uniform, vec3, vec4 } from 'three/tsl';
import { createInkNoiseTexture, sampleInkNoise } from '../rendering/ink-paper-wash.mts';
import type { ChapterLifetime } from '../runtime/chapter-manager.mts';
import { chapterFiveGateSites, type ChapterFiveGateVisuals } from './chapter-five-gates.mts';

export function mountChapterFiveCurtains(root: Object3D, lifetime: ChapterLifetime): NonNullable<ChapterFiveGateVisuals['onVeil']> {
  const volume = createInkNoiseTexture();
  lifetime.defer(() => volume.dispose());
  const noise = texture3D(volume);
  const uniforms = new Map<string, { time: ReturnType<typeof uniform<'float'>>; fade: ReturnType<typeof uniform<'float'>> }>();
  for (const site of chapterFiveGateSites.veils) {
    const { left, right, bottom, top, arch } = site.curtain;
    const geometry = new PlaneGeometry(right - left, top - bottom);
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
    lifetime.defer(() => geometry.dispose());
    lifetime.defer(() => material.dispose());
    const time = uniform(0);
    const fade = uniform(1);
    uniforms.set(site.id, { time, fade });
    material.colorNode = Fn(() => {
      const y = positionWorld.y;
      const ceiling = arch[1] > 0 ? max(positionWorld.x.sub(arch[0]).div(arch[1]).pow(2).oneMinus(), 0).pow(0.31)
        .mul(arch[2]).sub(3) : uniform(top);
      If(y.greaterThan(ceiling), () => { Discard(); });
      const x = positionWorld.x.add(positionWorld.z.mul(0.3));
      const wander = sampleInkNoise(noise, vec3(x.mul(0.35), y.mul(0.22).add(time.mul(0.12)), 3)).sub(0.5).mul(1.1);
      const strand = x.add(wander);
      const ropes = sampleInkNoise(noise, vec3(strand.mul(0.75), 1, 1)).mul(0.55)
        .add(sampleInkNoise(noise, vec3(strand.mul(2.1), 5, 2)).mul(0.32))
        .add(sampleInkNoise(noise, vec3(strand.mul(5.3), y.mul(0.08), 4)).mul(0.13));
      const flow = sampleInkNoise(noise, vec3(strand.mul(3.1), y.mul(0.42).add(time.mul(1.5)), 6));
      const topWeight = smoothstep(0.4, 5.5, ceiling.sub(y)).oneMinus().mul(0.26);
      const coverage = mix(0.5, 0.985, smoothstep(0.34, 0.5, ropes.add(flow.sub(0.5).mul(0.22)).add(topWeight)));
      const sheen = smoothstep(0.62, 0.72, sampleInkNoise(noise, vec3(strand.mul(6.5), y.mul(0.18).add(time.mul(1.9)), 8)))
        .mul(smoothstep(0.6, 0.9, coverage));
      return vec4(vec3(0.045, 0.042, 0.04).add(vec3(0.075, 0.074, 0.07).mul(sheen)), coverage.mul(fade));
    })();
    const curtain = new Mesh(geometry, material);
    curtain.name = site.node;
    curtain.position.set((left + right) / 2, (bottom + top) / 2, site.z);
    curtain.renderOrder = 6;
    root.add(curtain);
  }
  return (id, { seconds, fade }) => {
    const values = uniforms.get(id);
    if (values) { values.time.value = seconds; values.fade.value = fade; }
  };
}
