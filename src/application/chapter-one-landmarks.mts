/** Chapter One's gate rope and ink decals, derived from the shipped chapter and fx_ink system. */
import {
  BufferGeometry, CatmullRomCurve3, ClampToEdgeWrapping, Color, DoubleSide, Float32BufferAttribute, Group,
  LinearMipmapLinearFilter, Mesh, MeshBasicNodeMaterial, MeshStandardMaterial, NoColorSpace, TubeGeometry, Vector3,
  type Texture, type Texture3DNode,
} from 'three/webgpu';
import { Fn, cameraPosition, clamp, float, max, mix, positionWorld, smoothstep, texture, texture3D, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { disposeGLTF, type AssetManager } from '../assets/asset-manager.mts';
import { createInkMaterial } from '../rendering/ink-material.mts';
import { createInkNoiseTexture, sampleInkNoise } from '../rendering/ink-paper-wash.mts';
import type { ChapterLifetime } from '../runtime/chapter-manager.mts';
import type { ChapterOneInteractionEvent } from './chapter-one-interactions.mts';

type GatePhase = Extract<ChapterOneInteractionEvent, { type: 'gate' }>['phase'];
type LandmarkAssets = Pick<AssetManager, 'loadGLTF' | 'loadTexture'>;

const gate = { x: 14.23, y: 8.35, z: -61.255, yaw: Math.PI / 180 * -45.4 };
const gateFallSeconds = 1.5;
const inkLift = 0.025;
const stainWindow = [3, 16, -66, -50] as const;
const pool = { center: [5.65, -59.4] as const, radius: [1.64, 1.44] as const, span: 1.25 };

function makeRope(lifetime: ChapterLifetime) {
  const curve = new CatmullRomCurve3(Array.from({ length: 9 }, (_, index) => {
    const t = index / 8;
    return new Vector3(-3.04 + 6.08 * t, 1.9 - 0.5 * (1 - (2 * t - 1) ** 2), 0);
  }));
  const ropeGeometry = new TubeGeometry(curve, 48, 0.05, 7);
  const shideGeometry = new BufferGeometry();
  const positions: number[] = [];
  for (let strip = 0; strip < 5; strip++) {
    const knot = curve.getPoint((strip + 0.5) / 5);
    for (let fold = 0; fold < 3; fold++) {
      const y = knot.y - fold * 0.13;
      const x = knot.x + (fold % 2 ? 0.045 : 0);
      const left = x - 0.045, right = x + 0.045;
      positions.push(left, y, 0.01, right, y, 0.01, right, y - 0.14, 0.01,
        left, y, 0.01, right, y - 0.14, 0.01, left, y - 0.14, 0.01);
    }
  }
  shideGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  shideGeometry.computeVertexNormals();
  lifetime.defer(() => { ropeGeometry.dispose(); shideGeometry.dispose(); });
  const ropeSource = new MeshStandardMaterial({ color: 9405031 });
  const shideSource = new MeshStandardMaterial({ color: 14209210, side: DoubleSide });
  const ropeMaterial = createInkMaterial(ropeSource, { preset: 'wood', lineWeight: 0.8 });
  const shideMaterial = createInkMaterial(shideSource, { preset: 'cloth', lineWeight: 0.3 });
  ropeSource.dispose();
  shideSource.dispose();
  lifetime.defer(() => { ropeMaterial.dispose(); shideMaterial.dispose(); });
  const rope = new Mesh(ropeGeometry, ropeMaterial);
  const shide = new Mesh(shideGeometry, shideMaterial);
  rope.name = 'rope';
  shide.name = 'shide';
  rope.castShadow = rope.receiveShadow = shide.castShadow = shide.receiveShadow = true;

  const root = new Group();
  root.name = 'gate_rope';
  root.position.set(gate.x, gate.y, gate.z);
  root.rotation.y = gate.yaw;
  root.add(rope, shide);
  return root;
}

function displayPigment(hex: number) {
  const color = new Color(hex);
  return vec3(color.r, color.g, color.b);
}

function createPoolMaterials(stain: Texture, poolMask: Texture, noise: Texture3DNode, lifetime: ChapterLifetime) {
  const seconds = uniform(0);
  const growth = uniform(0);
  const spray = texture(stain);
  const mask = texture(poolMask);
  const stainMaterial = new MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
  });
  const poolMaterial = new MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -6,
  });
  lifetime.defer(() => { stainMaterial.dispose(); poolMaterial.dispose(); });

  const grain = (x: ReturnType<typeof vec3>) => sampleInkNoise(noise, x).mul(0.5333)
    .add(sampleInkNoise(noise, x.mul(2.03).add(11.7)).mul(0.2667))
    .add(sampleInkNoise(noise, x.mul(4.01).add(3.1)).mul(0.2));
  const thin = displayPigment(0x2e2a22), solid = displayPigment(0x090807), sheen = displayPigment(0x5c503e);
  stainMaterial.colorNode = Fn(() => {
    const [west, east, south, north] = stainWindow;
    const uv = positionWorld.xz.sub(vec2(west, south)).div(vec2(east - west, north - south)).toVar();
    const field = spray.sample(uv).level(float(3)).r;
    const alpha = max(spray.sample(uv).r, smoothstep(float(0.62).sub(growth), float(0.7).sub(growth), field).mul(0.5)).toVar();
    const pigment = mix(thin, solid, smoothstep(0.45, 0.92, alpha));
    const graze = clamp(cameraPosition.sub(positionWorld).normalize().y, 0, 1).oneMinus();
    const x = positionWorld.x.mul(0.887).sub(positionWorld.z.mul(0.462)).toVar();
    const z = positionWorld.x.mul(0.462).add(positionWorld.z.mul(0.887)).toVar();
    const slowly = grain(vec3(x.mul(0.34), 3, z.mul(1.7)));
    const fine = grain(vec3(x.mul(0.9), 9, z.mul(5.5)));
    const patches = smoothstep(0.36, 0.58, sampleInkNoise(noise, vec3(x.mul(0.42), 14, z.mul(0.9))));
    const glint = smoothstep(0.44, 0.64, slowly.mul(0.55).add(fine.mul(0.45)))
      .mul(patches).mul(smoothstep(0.66, 0.86, graze)).mul(smoothstep(0.5, 0.9, alpha)).mul(0.72);
    return vec4(mix(pigment, sheen, glint), alpha);
  })();

  const core = displayPigment(0x040404), ring = displayPigment(0x14120e);
  poolMaterial.colorNode = Fn(() => {
    const p = positionWorld.xz.sub(vec2(...pool.center)).div(vec2(...pool.radius)).toVar();
    const time = seconds.mul(0.03);
    const offset = vec2(
      sampleInkNoise(noise, vec3(p.mul(1.7), time.add(3))),
      sampleInkNoise(noise, vec3(p.mul(1.7).add(19), time.add(8))),
    ).sub(0.5).mul(0.012);
    const uv = p.add(offset).div(pool.span).mul(0.5).add(0.5);
    return vec4(mix(core, ring, smoothstep(0.34, 0.62, p.length())), mask.sample(uv).r);
  })();
  return { stainMaterial, poolMaterial, seconds, growth };
}

/** Load authored terrain-conformed decals and a gate rope, without owning interaction or collision. */
export async function loadChapterOneLandmarks(assets: LandmarkAssets, lifetime: ChapterLifetime) {
  lifetime.signal.throwIfAborted();
  const root = new Group();
  root.name = 'chapter_one_landmarks';
  const rope = makeRope(lifetime);
  root.add(rope);

  async function loadMask(path: string) {
    const mask = await assets.loadTexture(path, { colorSpace: NoColorSpace, signal: lifetime.signal });
    lifetime.defer(() => mask.dispose());
    lifetime.signal.throwIfAborted();
    mask.wrapS = mask.wrapT = ClampToEdgeWrapping;
    mask.generateMipmaps = true;
    mask.minFilter = LinearMipmapLinearFilter;
    mask.needsUpdate = true;
    return mask;
  }

  async function loadDecals() {
    const model = await assets.loadGLTF('fx_ink/fx_ink.glb', { displaySpace: false, signal: lifetime.signal });
    lifetime.defer(() => disposeGLTF(model));
    lifetime.signal.throwIfAborted();
    return model.scene;
  }

  const [model, stainMask, poolMask] = await Promise.all([
    loadDecals(), loadMask('fx_ink/stain.webp'), loadMask('fx_ink/pool.webp'),
  ]);
  lifetime.signal.throwIfAborted();
  const noise = createInkNoiseTexture();
  lifetime.defer(() => noise.dispose());
  const { stainMaterial, poolMaterial, seconds, growth } = createPoolMaterials(stainMask, poolMask, texture3D(noise), lifetime);
  const decals = new Group();
  decals.name = 'fx_ink';
  function addDecal(name: string, material: MeshBasicNodeMaterial, lift: number, order: number) {
    const authored = model.getObjectByName(name);
    if (!(authored instanceof Mesh)) throw Error('Chapter One ink asset is missing ' + name);
    const mesh = new Mesh(authored.geometry, material);
    mesh.name = name;
    mesh.position.copy(authored.position).y += lift;
    mesh.quaternion.copy(authored.quaternion);
    mesh.scale.copy(authored.scale);
    mesh.renderOrder = order;
    decals.add(mesh);
    return mesh;
  }
  const stain = addDecal('ink_stain', stainMaterial, inkLift, 1);
  const inkPool = addDecal('ink_pool', poolMaterial, inkLift + 0.002, 2);
  root.add(decals);
  lifetime.defer(() => { root.removeFromParent().clear(); decals.clear(); });

  let phase: GatePhase = 'barred';
  let fallingFor = 0;
  function resetRope(visible: boolean) {
    fallingFor = 0;
    rope.visible = visible;
    rope.position.y = gate.y;
    rope.rotation.z = 0;
  }
  function update(delta: number, gatePhase: GatePhase) {
    if (!Number.isFinite(delta) || delta < 0) throw RangeError('Landmark step must be finite and nonnegative');
    if (lifetime.signal.aborted) return;
    seconds.value += delta;
    growth.value = Math.min(Math.max(seconds.value - 10, 0), 5) * 0.012;
    if (gatePhase !== phase) {
      phase = gatePhase;
      resetRope(phase !== 'open');
    } else if (phase === 'dropping' && rope.visible) {
      fallingFor += delta;
      const progress = fallingFor / gateFallSeconds;
      rope.position.y -= (0.3 + 4.2 * progress) * delta;
      rope.rotation.z = 0.25 * progress;
      if (progress >= 1) resetRope(false);
    }
  }
  return { root, rope, stain, pool: inkPool, update };
}
