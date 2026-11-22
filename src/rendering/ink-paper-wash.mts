import {
  Color, Data3DTexture, LinearFilter, NoColorSpace, RedFormat, RepeatWrapping, Vector3,
  type Node, type Texture3DNode,
} from 'three/webgpu';
import { Fn, clamp, dot, float, max, mix, smoothstep, vec2, vec3, vec4 } from 'three/tsl';

const NOISE_SIZE = 64;
const DEFAULT_SEED = 49_734_321;
const REFERENCE_RADIANS_PER_PIXEL = Math.tan(20 * Math.PI / 180) / 352;
const MIST_THIN = new Color('#b4b7b2');
const MIST_FULL = new Color('#babebb');

/** Caller owns the repeating, linear-filtered noise volume. Dispose it after all consumers. */
export function createInkNoiseTexture(seed = DEFAULT_SEED) {
  if (!Number.isInteger(seed) || seed < 1 || seed > 0xffff_ffff) {
    throw RangeError('Ink noise needs a nonzero unsigned 32-bit seed');
  }
  const values = new Uint8Array(NOISE_SIZE ** 3);
  let state = seed;
  for (let i = 0; i < values.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    values[i] = state & 0xff;
  }
  const texture = new Data3DTexture(values, NOISE_SIZE, NOISE_SIZE, NOISE_SIZE);
  texture.name = 'InkValueNoise';
  texture.format = RedFormat;
  texture.colorSpace = NoColorSpace;
  texture.wrapS = texture.wrapT = texture.wrapR = RepeatWrapping;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function valueNoise(noise: Texture3DNode, point: Node<'vec3'>) {
  // Match the shipped cubic interpolation and address the center of each lattice texel.
  const fraction = point.fract();
  const eased = fraction.mul(fraction).mul(fraction.mul(-2).add(3));
  const uvw = point.floor().add(eased).add(0.5).div(NOISE_SIZE);
  return noise.sample(uvw).level(float(0)).r;
}

function fractalNoise(noise: Texture3DNode, point: Node<'vec3'>) {
  return valueNoise(noise, point).mul(0.5333)
    .add(valueNoise(noise, point.mul(2.03).add(11.7)).mul(0.2667))
    .add(valueNoise(noise, point.mul(4.01).add(3.1)).mul(0.2));
}

function validStrength(strength: number) {
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) {
    throw RangeError('Ink texture strength must be between zero and one');
  }
}

export interface InkPaperControls {
  noise: Texture3DNode;
  /** Nonzero world-view ray, for a texture stable under camera translation. */
  direction: Node<'vec3'>;
  radiansPerPixel?: Node<'float'>;
  strength?: number;
}

const FIBRE_FRAMES = Array.from({ length: 4 }, (_, index) => {
  const angle = index * 0.81 + 0.4;
  const along = new Vector3(Math.cos(angle), 0.31 * Math.sin(angle * 2.3), Math.sin(angle)).normalize();
  const across = new Vector3().crossVectors(along, new Vector3(0.2, 0.9, 0.3)).normalize();
  return [along, across, new Vector3().crossVectors(along, across)] as const;
});

/** Modulate a paper-colored layer in working space while preserving its alpha. */
export function createInkPaperColor(base: Node<'vec4'>, {
  noise, direction, radiansPerPixel = float(REFERENCE_RADIANS_PER_PIXEL), strength = 1,
}: InkPaperControls): Node<'vec4'> {
  validStrength(strength);
  if (strength === 0) return base;
  return Fn(() => {
    const ray = direction.normalize().toVar();
    const scale = max(radiansPerPixel, 0.000001).toVar();
    const sample = (size: number, offset = 0) => valueNoise(noise, ray.div(scale.mul(size)).add(offset));
    const mottle = (size: number) => sample(size).sub(0.5);
    const texture = mottle(3).mul(4.8).add(mottle(6).mul(4.2)).add(mottle(12).mul(3.6))
      .add(mottle(24).mul(3)).add(mottle(48).mul(6.5)).add(mottle(110).mul(6));

    const fibres = float(0).toVar();
    for (const [i, [along, across, depth]] of FIBRE_FRAMES.entries()) {
      const u = vec3(along.x, along.y, along.z);
      const v = vec3(across.x, across.y, across.z);
      const w = vec3(depth.x, depth.y, depth.z);
      const point = u.mul(dot(ray, u).div(26)).add(v.mul(dot(ray, v).div(1.5)))
        .add(w.mul(dot(ray, w).div(1.5))).div(scale).add(i * 19).toVar();
      const gate = smoothstep(0.46, 0.62, sample(34, i * 7 + 150));
      const fibre = smoothstep(0.66, 0.86, valueNoise(noise, point))
        .sub(smoothstep(0.7, 0.88, valueNoise(noise, point.add(31))).mul(0.5));
      fibres.addAssign(fibre.mul(gate));
    }

    const stain = smoothstep(0.05, 0.35, mottle(130).add(mottle(55).mul(0.5)));
    const stainTint = mix(vec3(1), vec3(0.975, 0.955, 0.925), stain);
    const fleck = smoothstep(0.92, 0.98, sample(8, 40));
    const patch = smoothstep(0.4, 0.6, sample(40, 70));
    const depth = sample(23, 90).mul(0.75).add(0.25);
    const tooth = texture.div(160).add(1).mul(fibres.mul(0.026).oneMinus())
      .mul(depth.mul(fleck).mul(patch).mul(0.1).oneMinus());
    return vec4(base.rgb.mul(mix(vec3(1), stainTint.mul(tooth), strength)), base.a);
  })();
}

export interface InkWashInputs {
  noise: Texture3DNode;
  position: Node<'vec3'>;
  /** Local plane UV, with Y rising from foot to top. */
  uv: Node<'vec2'>;
  seconds: Node<'float'>;
  /** Positive linear view distances in world units from the same camera. */
  sceneDistance: Node<'float'>;
  washDistance: Node<'float'>;
}

export interface InkWashControls {
  kind?: 'bank' | 'billow';
  strength?: number;
  frequency?: number;
  rise?: number;
  softDepth?: number;
  /** Working-space colors. Defaults decode the shipped CSS hex colors once. */
  thinColor?: Node<'vec3'>;
  fullColor?: Node<'vec3'>;
}

function bankDensity(noise: Texture3DNode, plane: Node<'vec2'>, world: Node<'vec3'>, drift: Node<'vec3'>) {
  const roll = fractalNoise(noise, world.mul(vec3(0.36, 0.2, 0.36)).add(drift)).sub(0.5).toVar();
  const wide = fractalNoise(noise, world.mul(vec3(0.9, 0.34, 0.9)).add(drift.mul(1.6)).add(19)).sub(0.5).toVar();
  const wisp = fractalNoise(noise, world.mul(vec3(1.3, 0.3, 1.3)).add(drift.mul(2)).add(41)).sub(0.5).toVar();
  const fine = fractalNoise(noise, world.mul(vec3(4, 0.7, 4)).add(drift.mul(3)).add(71)).sub(0.5);
  const y = plane.y.mul(0.5).add(0.5);
  const top = roll.mul(0.9).add(wide.mul(0.22)).add(0.82).toVar();
  const height = top.sub(y).div(max(top, 0.05)).toVar();
  const body = smoothstep(-0.02, 0.5, height.add(wisp.mul(mix(0.6, 0.2, smoothstep(0, 0.6, height))))
    .add(fine.mul(0.1))).mul(wide.mul(0.5).add(wisp.mul(0.22)).add(0.76));
  const sides = smoothstep(0.42, 0.98, plane.x.abs().add(roll.mul(0.3))).oneMinus();
  const foot = smoothstep(0, 0.14, y).mul(smoothstep(0.78, 1, y).oneMinus());
  // Keep the procedural bank transparent at the exact side even at extreme rolls.
  const rim = smoothstep(0.9, 1, plane.x.abs()).oneMinus();
  return clamp(body, 0, 1).mul(sides).mul(foot).mul(rim);
}

function billowDensity(noise: Texture3DNode, plane: Node<'vec2'>, world: Node<'vec3'>, drift: Node<'vec3'>) {
  const warp = world.mul(vec3(0.3, 0.34, 0.3)).add(drift).toVar();
  const wobble = vec2(fractalNoise(noise, warp), fractalNoise(noise, warp.add(37))).sub(0.5).toVar();
  const shape = plane.add(wobble.mul(vec2(1.3, 1.1))).toVar();
  const radius = shape.mul(vec2(0.92, 0.8)).add(vec2(0, 0.34)).length();
  const body = smoothstep(0, 0.95, radius).oneMinus();
  const point = world.mul(vec3(0.44, 0.5, 0.44)).add(wobble.xyx.mul(1.6)).add(drift).toVar();
  const lobe = (at: Node<'vec3'>) => valueNoise(noise, at).mul(2).sub(1).abs();
  const lobes = lobe(point).mul(0.55).add(lobe(point.mul(2.07).add(11.3)).mul(0.3))
    .add(lobe(point.mul(4.13).add(5.1)).mul(0.15)).toVar();
  const rise = smoothstep(-0.25, 0.75, shape.y.add(lobes.sub(0.4).mul(0.5))).oneMinus().toVar();
  const density = body.mul(lobes.add(0.6)).mul(mix(0.34, 1, rise.mul(rise)));
  const alpha = smoothstep(0, 0.66, density).toVar();
  const rim = smoothstep(0.66, 0.98, max(plane.x.abs(), plane.y.abs())).oneMinus();
  return alpha.mul(mix(alpha, 1, 0.55)).mul(rim);
}

/** Straight-alpha working-space wash, for a caller-positioned atmospheric layer. */
export function createInkAnimatedWash({
  noise, position, uv, seconds, sceneDistance, washDistance,
}: InkWashInputs, {
  kind = 'billow', strength = 0.95, frequency = 1, rise = 0.05, softDepth = 1.2, thinColor, fullColor,
}: InkWashControls = {}): Node<'vec4'> {
  validStrength(strength);
  if (!Number.isFinite(frequency) || frequency <= 0 || !Number.isFinite(softDepth) || softDepth <= 0 ||
      !Number.isFinite(rise) || rise < 0) {
    throw RangeError('Ink wash needs positive frequency and soft depth and a nonnegative rise');
  }
  if (strength === 0) return vec4(0);
  const thin = thinColor ?? vec3(MIST_THIN.r, MIST_THIN.g, MIST_THIN.b);
  const full = fullColor ?? vec3(MIST_FULL.r, MIST_FULL.g, MIST_FULL.b);
  return Fn(() => {
    const plane = uv.mul(2).sub(1).toVar();
    const world = position.mul(frequency).toVar();
    const drift = seconds.mul(vec3(0.02, -rise, 0.01)).toVar();
    const separation = smoothstep(0, softDepth, sceneDistance.sub(washDistance));
    const alpha = (kind === 'bank'
      ? bankDensity(noise, plane, world, drift).mul(smoothstep(10, 40, washDistance))
      : billowDensity(noise, plane, world, drift)).mul(separation).toVar();
    const color = mix(thin, full, kind === 'bank' ? smoothstep(0.1, 0.7, alpha) : smoothstep(0.15, 0.8, alpha));
    return vec4(color, alpha.mul(strength));
  })();
}

/** Layer the wash over opaque color before grade, preserving the base alpha channel. */
export function blendInkWash(base: Node<'vec4'>, wash: Node<'vec4'>): Node<'vec4'> {
  return vec4(mix(base.rgb, wash.rgb, clamp(wash.a, 0, 1)), base.a);
}
