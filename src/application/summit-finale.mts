import { Mesh, MeshBasicNodeMaterial, PlaneGeometry, Vector3, type Object3D } from 'three/webgpu';
import { Fn, atan, mix, smoothstep, uniform, uv, vec3, vec4 } from 'three/tsl';
import type { ChapterLifetime } from '../runtime/chapter-manager.mts';

export const summitHaiku = ['The last stroke lifted', 'only the red sun still wet', 'on the empty page'] as const;

/** Summit's hand-painted sun, expressed as a mask and pigment in TSL. */
export function mountSummitFinale(root: Object3D, lifetime: ChapterLifetime) {
  const geometry = new PlaneGeometry(150, 150);
  const reveal = uniform(0);
  const material = new MeshBasicNodeMaterial({
    name: 'summit_sun', transparent: true, depthWrite: false, toneMapped: false, fog: false,
  });
  material.colorNode = Fn(() => {
    const point = uv().mul(2).sub(1).toVar();
    const angle = atan(point.y, point.x);
    const edge = angle.mul(7).add(1).sin().mul(.009).add(angle.mul(23).add(2).sin().mul(.005));
    const mask = smoothstep(.917, .947, point.length().sub(edge)).oneMinus();
    const variation = point.x.mul(21).sin().mul(.027).add(point.x.mul(64).cos().mul(.015));
    const bands = point.y.add(variation).mul(23).sin().mul(.2).add(.34);
    const absorption = smoothstep(-.7, .96, point.y.oneMinus()).mul(bands);
    const pigment = mix(vec3(187 / 255, 84 / 255, 56 / 255), vec3(137 / 255, 44 / 255, 29 / 255), absorption);
    return vec4(pigment, mask.mul(reveal).mul(.82));
  })();
  const sun = new Mesh(geometry, material);
  sun.name = 'ink_sun';
  sun.position.set(-500, 128, -470);
  sun.lookAt(new Vector3(-292, 95, -350));
  sun.renderOrder = -2;
  sun.visible = false;
  root.add(sun);
  lifetime.defer(() => { sun.removeFromParent(); geometry.dispose(); material.dispose(); });

  return {
    update(delta: number, playerX: number, duelCleared: boolean, ending: boolean) {
      const target = ending ? 1 : duelCleared ? Math.min(1, Math.max(0, (-258 - playerX) / 24)) : 0;
      reveal.value += (target - reveal.value) * Math.min(delta * 1.6, 1);
      sun.visible = reveal.value > .004;
      sun.position.y = 92 + reveal.value * 36;
    },
    reset() { reveal.value = 0; sun.visible = false; },
  };
}
