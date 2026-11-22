/** Native swarm lifecycle from bt in combat-Dp_zXhrv.js. */
import {
  BufferGeometry, DoubleSide, DynamicDrawUsage, Euler, Float32BufferAttribute,
  InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicNodeMaterial, Quaternion, Vector3,
  type Object3D,
} from 'three/webgpu';
import { attribute, positionLocal, uniform, vec3 } from 'three/tsl';
import { createInkSurfaceOutput } from '../rendering/ink-surface-pass.mts';

type Point = readonly [x: number, y: number, z: number];

export interface CrowSwarmDefinition {
  readonly id: string;
  readonly line: readonly [Point, Point, ...Point[]];
  readonly speed?: number;
  readonly radius?: number;
  readonly pause?: number;
  readonly reform?: number | null;
  readonly count?: number;
  readonly flag?: string;
}

export interface CrowSwarmPlayer {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly down?: boolean;
}

export interface CrowSwarmContact {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly damage: 1;
  readonly reason: 'crows';
}

export type CrowSwarmEvent =
  | { readonly type: 'broken'; readonly id: string; readonly quiet: boolean }
  | { readonly type: 'reformed' | 'gone' | 'call'; readonly id: string };

export interface CrowSwarmOptions {
  parent?: Object3D;
  seed?: number;
  hasFlag?(flag: string): boolean;
  setFlag?(flag: string): void;
  onContact?(contact: CrowSwarmContact): void;
  onState?(event: CrowSwarmEvent): void;
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

type FeatherPoint = readonly [x: number, z: number, flap: number];

/** Procedural low-poly silhouette with a per-vertex flap weight. Caller owns the geometry. */
export function createCrowWingGeometry() {
  const positions: number[] = [];
  const weights: number[] = [];
  function triangle(a: FeatherPoint, b: FeatherPoint, c: FeatherPoint) {
    for (const [x, z, flap] of [a, b, c]) {
      positions.push(x, 0, z);
      weights.push(flap);
    }
  }
  const front = [0, -0.24, 0] as const;
  const tail = [0, 0.32, 0] as const;
  for (const side of [-1, 1]) {
    const shoulder: FeatherPoint = [side * 0.07, -0.06, 0];
    const elbow: FeatherPoint = [side * 0.34, -0.17, 0.42];
    const tip: FeatherPoint = [side * 0.67, 0.01, 1];
    const outerFeather: FeatherPoint = [side * 0.48, 0.15, 0.8];
    const rear: FeatherPoint = [side * 0.1, 0.12, 0.12];
    triangle(front, shoulder, tail);
    triangle(shoulder, elbow, rear);
    triangle(elbow, tip, outerFeather);
    triangle(elbow, outerFeather, rear);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aWing', new Float32BufferAttribute(weights, 1));
  geometry.computeVertexNormals();
  return geometry;
}

function crowMaterial() {
  const seconds = uniform(0).setName('crowFlapSeconds');
  const material = new MeshBasicNodeMaterial({ name: 'swarm_crow', color: 1315343, side: DoubleSide, fog: false });
  const flap = seconds.mul(19).add(attribute('aPhase', 'float')).sin().mul(attribute('aWing', 'float')).mul(0.17);
  material.positionNode = positionLocal.add(vec3(0, flap, 0));
  material.mrtNode = createInkSurfaceOutput({ lineWeight: 0 });
  return { material, seconds };
}

function traceLine(line: CrowSwarmDefinition['line']) {
  const cumulative = [0];
  for (let i = 1; i < line.length; i++) {
    const from = line[i - 1]!, to = line[i]!;
    cumulative.push(cumulative[i - 1]! + Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]));
  }
  const length = cumulative.at(-1) || 1;
  return {
    length,
    sample(distance: number, out: { x: number; y: number; z: number }) {
      const along = Math.min(Math.max(distance, 0), length);
      let index = 0;
      while (index < cumulative.length - 2 && cumulative[index + 1]! < along) index++;
      const fraction = (along - cumulative[index]!) / (cumulative[index + 1]! - cumulative[index]! || 1);
      const from = line[index]!, to = line[index + 1]!;
      out.x = from[0] + (to[0] - from[0]) * fraction;
      out.y = from[1] + (to[1] - from[1]) * fraction;
      out.z = from[2] + (to[2] - from[2]) * fraction;
    },
  };
}

function createBird(random: () => number, phases: Float32Array, index: number) {
  phases[index] = random() * 6.28;
  const radius = Math.cbrt(random());
  const azimuth = random() * 6.28;
  const polar = Math.acos(random() * 2 - 1);
  return {
    x: radius * Math.sin(polar) * Math.cos(azimuth),
    y: radius * Math.cos(polar) * 0.6,
    z: radius * Math.sin(polar) * Math.sin(azimuth),
    size: 0.7 + random() * 0.4, speed: 0.8 + random() * 1.3, phase: random() * 6.28,
    vx: 0, vy: 0, vz: 0, burstX: 0, burstY: 0, burstZ: 0,
  };
}

/** Make an owned native swarm. Moving contacts and state notifications are injected. */
export function createCrowSwarm({
  id, line, speed = 5, radius = 1.3, pause = 1.2, reform = 8, count = 36, flag,
}: CrowSwarmDefinition, {
  parent, seed = 714025, hasFlag, setFlag, onContact, onState,
}: CrowSwarmOptions = {}) {
  if (!Number.isInteger(count) || count < 1 || !Number.isFinite(speed) || speed <= 0 ||
      !Number.isFinite(radius) || radius <= 0 || !Number.isFinite(pause) || pause < 0 ||
      (reform !== null && (!Number.isFinite(reform) || reform < 0))) {
    throw RangeError('Crow swarms require positive count, speed and radius and nonnegative timing');
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff ||
      line.length < 2 || !line.every(point => point.every(Number.isFinite))) {
    throw RangeError('Crow swarm seed and path coordinates must be valid');
  }
  const random = seededRandom(seed);
  const path = traceLine(line);
  const phases = new Float32Array(count);
  const birds = Array.from({ length: count }, (_, index) => createBird(random, phases, index));
  const geometry = createCrowWingGeometry();
  geometry.setAttribute('aPhase', new InstancedBufferAttribute(phases, 1));
  const { material, seconds: flapTime } = crowMaterial();
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.name = 'swarm_' + id;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  parent?.add(mesh);

  const state = {
    id, radius, x: 0, y: 0, z: 0, heading: 0, distance: 0, direction: 1, waitSeconds: 0,
    broken: false, gone: false, brokenSeconds: 0, reformProgress: 1,
    hurtWait: 0, callWait: 1 + random() * 3,
  };
  let disposed = false;
  let lastSeconds = 0;
  const matrix = new Matrix4();
  const heading = new Euler(0, 0, 0, 'YXZ');
  const rotation = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  path.sample(0, state);

  function placeBirds(seconds: number) {
    const radiusScale = radius * 1.25 * (state.waitSeconds > 0 ? 1.35 : 1);
    const burstScale = state.broken ? Math.max(1 - state.brokenSeconds / 2, 0) : 1;
    for (const [index, bird] of birds.entries()) {
      let yaw = state.heading;
      if (state.broken) {
        const time = state.brokenSeconds;
        position.set(bird.burstX + bird.vx * time, bird.burstY + bird.vy * time - 1.5 * time * time * 0.3,
          bird.burstZ + bird.vz * time);
        yaw = Math.atan2(-bird.vx, -bird.vz);
      } else {
        const phase = seconds * bird.speed + bird.phase;
        position.set(state.x + (bird.x + Math.sin(phase) * 0.28) * radiusScale,
          state.y + (bird.y + Math.cos(phase * 1.3) * 0.2) * radiusScale,
          state.z + (bird.z + Math.cos(phase * 0.8) * 0.28) * radiusScale);
        if (state.reformProgress < 1) position.y += (1 - state.reformProgress) * (1 - state.reformProgress) * 14;
        yaw += Math.sin(phase) * 0.5;
      }
      heading.set(0, yaw, Math.sin(seconds * bird.speed * 1.7 + bird.phase) * 0.3);
      rotation.setFromEuler(heading);
      scale.setScalar(bird.size * 1.5 * burstScale);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  function breakIt(quiet = false) {
    if (disposed || state.broken || state.gone) return false;
    state.broken = true;
    state.brokenSeconds = 0;
    for (const bird of birds) {
      const length = Math.hypot(bird.x, bird.y, bird.z) || 1;
      const velocity = 5 + random() * 7;
      bird.vx = bird.x / length * velocity;
      bird.vy = bird.y / length * velocity + 3 + random() * 3;
      bird.vz = bird.z / length * velocity;
      bird.burstX = state.x + bird.x * radius;
      bird.burstY = state.y + bird.y * radius;
      bird.burstZ = state.z + bird.z * radius;
    }
    if (reform === null) {
      state.gone = true;
      if (flag) setFlag?.(flag);
    }
    onState?.({ type: 'broken', id, quiet });
    return true;
  }

  function stepFormation(delta: number, player?: CrowSwarmPlayer | null) {
    if (state.waitSeconds > 0) state.waitSeconds -= delta;
    else {
      state.distance += state.direction * speed * delta;
      if (state.distance >= path.length) {
        state.distance = path.length;
        state.direction = -1;
        state.waitSeconds = pause;
      } else if (state.distance <= 0) {
        state.distance = 0;
        state.direction = 1;
        state.waitSeconds = pause;
      }
    }
    const beforeX = state.x, beforeZ = state.z;
    path.sample(state.distance, state);
    if (delta > 0 && (state.x !== beforeX || state.z !== beforeZ)) {
      state.heading = Math.atan2(-(state.x - beforeX), -(state.z - beforeZ));
    }
    state.reformProgress = Math.min(state.reformProgress + delta * 0.8, 1);
    state.callWait -= delta;
    const separation = player ? Math.hypot(player.x - state.x, player.z - state.z) : Infinity;
    if (state.callWait <= 0 && separation < 22) {
      state.callWait = 3 + random() * 4;
      onState?.({ type: 'call', id });
    }
    if (state.hurtWait > 0) state.hurtWait -= delta;
    else if (player && separation < radius + 0.3 && player.y + 1.7 > state.y - radius &&
        player.y < state.y + radius && !player.down) {
      state.hurtWait = 1.4;
      onContact?.({ id, x: state.x, z: state.z, radius, damage: 1, reason: 'crows' });
    }
  }

  function step(delta: number, seconds: number, player?: CrowSwarmPlayer | null) {
    if (!Number.isFinite(delta) || delta < 0 || !Number.isFinite(seconds)) {
      throw RangeError('Crow swarm clocks must be finite and elapsed time nonnegative');
    }
    if (disposed) return;
    lastSeconds = flapTime.value = seconds;
    if (state.gone && !state.broken) {
      mesh.visible = false;
      return;
    }
    if (state.broken) {
      state.brokenSeconds += delta;
      if (state.gone && state.brokenSeconds > 2.2) {
        state.broken = false;
        mesh.visible = false;
        onState?.({ type: 'gone', id });
        return;
      }
      if (!state.gone && reform !== null && state.brokenSeconds > reform) {
        state.broken = false;
        state.reformProgress = 0;
        onState?.({ type: 'reformed', id });
      }
    } else stepFormation(delta, player);
    mesh.visible = true;
    placeBirds(seconds);
  }

  function reset() {
    if (disposed) return;
    state.distance = 0;
    state.direction = 1;
    state.waitSeconds = 0;
    state.broken = false;
    state.brokenSeconds = 0;
    state.reformProgress = 1;
    state.gone = Boolean(flag && hasFlag?.(flag));
    mesh.visible = !state.gone;
    path.sample(0, state);
    if (!state.gone) placeBirds(lastSeconds);
  }

  reset();
  return {
    id, mesh, state: state as Readonly<typeof state>, step, breakIt, reset,
    dispose() {
      if (disposed) return;
      disposed = true;
      mesh.removeFromParent();
      mesh.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
