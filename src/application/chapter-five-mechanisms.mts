/** Floating carriers and tide from ch5_sea-CpHUIhkX.js and level-O-RtwNJJ.js. */
import { Group, MathUtils, type Object3D } from 'three/webgpu';
import { extrudeWallPolyline, type PointXZ } from '../physics/geometry.mts';
import type { MovingTriangleBatch, MovingTriangleBody } from '../physics/moving-body.mts';
import type { CollisionWorld } from '../physics/world.mts';

type Point = readonly [x: number, y: number, z: number];
type TidePhase = 'low' | 'rising' | 'high' | 'falling';
type PlatformId = 'raft' | 'boat1' | 'grey' | 'slab_a' | 'slab_b' | 'slab_c' | 'barge';

interface PlatformSite {
  readonly id: PlatformId;
  readonly node: string;
  readonly templates: readonly string[];
  readonly time: number;
  readonly pause: number;
  readonly size: readonly [number, number];
  readonly thick: number;
  readonly surface: 'wood' | 'stone';
  readonly phase?: number;
  readonly yaw?: number;
  readonly path: readonly [Point, Point];
}

const boats = { time: 7, pause: 3, phase: 14 / 20, size: [3.6, 6.5], thick: 0.5, surface: 'wood' } as const;
const slabs = { time: 2.6, pause: 2.4, size: [4, 4], thick: 0.6, surface: 'stone' } as const;
const platformSites: readonly PlatformSite[] = [
  { id: 'raft', node: 'raft_node', templates: ['raft', 'raft_rope'], time: 5, pause: 0.5,
    size: [4.2, 6], thick: 0.5, surface: 'wood', path: [[32.5, 0.4, -212], [35.5, 0.4, -212]] },
  { id: 'boat1', node: 'boat1_node', templates: ['boat'], ...boats, path: [[34, 0.35, -265.2], [34, 0.35, -290.7]] },
  { id: 'grey', node: 'grey_node', templates: ['boat'], ...boats, yaw: 90, path: [[19.5, 0.35, -304], [-2.7, 0.35, -304]] },
  { id: 'slab_a', node: 'slab_a_node', templates: ['slab'], ...slabs, path: [[46, 0.5, -304], [53.7, 0.5, -304]] },
  { id: 'slab_b', node: 'slab_b_node', templates: ['roof_slab'], ...slabs, phase: 0.71, path: [[58.5, 0.5, -308.8], [58.5, 0.5, -319.2]] },
  { id: 'slab_c', node: 'slab_c_node', templates: ['column_raft'], ...slabs, phase: 0.75, path: [[63.3, 0.5, -324], [73, 0.5, -324]] },
  { id: 'barge', node: 'barge_node', templates: ['barge', 'barge_lamp'], ...boats, yaw: 90, size: [4.5, 9],
    path: [[153.5, 0.35, -530], [178.45, 0.35, -530]] },
];

const tideSite = { id: 'sea', node: 'sea', center: [100, -320], size: [3600, 3600],
  low: 0, high: 3, lowHold: 8, rise: 4, highHold: 4, fall: 4 } as const;
const driftTemplates = ['drift_wood', 'drift_lacquer', 'drift_rock'] as const;
export const chapterFiveMechanismSites = { tide: tideSite, platforms: platformSites } as const;

export type ChapterFiveTideCue =
  | { readonly name: 'tide'; readonly seconds: 4; readonly hold: 4 }
  | { readonly name: 'tideFall'; readonly seconds: 4 };

export interface ChapterFiveMechanismEffects {
  onCue?(cue: ChapterFiveTideCue): void;
  onFallOut?(): void;
}

export interface ChapterFiveMechanismFrame {
  readonly player?: Readonly<{ y: number; state: string }> | null;
  readonly playing?: boolean;
  /** Global presentation time, independent of the tide clock reset. */
  readonly seconds?: number;
}

const smooth = (x: number) => x * x * (3 - 2 * x);
const modulo = (value: number, period: number) => (value % period + period) % period;

export function sampleChapterFiveTide(seconds: number) {
  const { low, high, lowHold, rise, highHold, fall } = tideSite;
  const period = lowHold + rise + highHold + fall;
  const time = modulo(seconds, period);
  let phase: TidePhase;
  let y: number;
  if (time < lowHold) {
    phase = 'low';
    y = low;
  } else if (time < lowHold + rise) {
    phase = 'rising';
    y = low + (high - low) * smooth((time - lowHold) / rise);
  } else if (time < lowHold + rise + highHold) {
    phase = 'high';
    y = high;
  } else {
    phase = 'falling';
    y = high - (high - low) * smooth((time - lowHold - rise - highHold) / fall);
  }
  return { y, phase, rising: phase === 'rising', toRise: phase === 'low' ? lowHold - time : phase === 'falling' ? period - time + lowHold : 0 };
}

function platformBatches(site: PlatformSite): MovingTriangleBatch[] {
  const x = site.size[0] / 2;
  const z = site.size[1] / 2;
  const rim: readonly PointXZ[] = [[-x, -z], [x, -z], [x, z], [-x, z], [-x, -z]];
  return [
    { positions: [-x, 0, -z, x, 0, -z, x, 0, z, -x, 0, -z, x, 0, z, -x, 0, z], kind: 1, surface: site.surface },
    { positions: extrudeWallPolyline(rim, () => -site.thick, () => -0.02), kind: 2 },
  ];
}

function createPlatform(site: PlatformSite, body: MovingTriangleBody) {
  const [[fromX, fromY, fromZ], [toX, toY, toZ]] = site.path;
  const length = Math.hypot(toX - fromX, toY - fromY, toZ - fromZ);
  const speed = length / site.time;
  const travel = length / (speed || 1);
  const halfCycle = travel + site.pause;
  const period = 2 * halfCycle;
  const startTime = (site.phase ?? 0) * period;
  const yaw = (site.yaw ?? 0) * MathUtils.DEG2RAD;
  let time = startTime;
  let distance = 0;

  function place(tideY: number, delta: number) {
    const cycle = modulo(time, period);
    const progress = cycle < halfCycle ? Math.min(cycle / travel, 1) : Math.max(1 - (cycle - halfCycle) / travel, 0);
    distance = smooth(progress) * length;
    const fraction = MathUtils.clamp(distance, 0, length) / length;
    body.setPose(fromX + (toX - fromX) * fraction, fromY + (toY - fromY) * fraction + tideY,
      fromZ + (toZ - fromZ) * fraction, yaw, 0, 0, delta);
  }

  return {
    site, body, length,
    get distance() { return distance; },
    step(delta: number, tideY: number) {
      time += delta;
      place(tideY, delta);
    },
    reset(tideY: number) {
      time = startTime;
      body.enabled = true;
      place(tideY, 0);
    },
  };
}

/** Install the seven authored collision carriers in an isolated chapter world. */
export function createChapterFiveMechanisms(
  world: Pick<CollisionWorld, 'addBody' | 'body'>,
  { onCue, onFallOut }: ChapterFiveMechanismEffects = {},
) {
  const duplicate = platformSites.find(site => world.body(site.id));
  if (duplicate) throw Error('Chapter Five body ' + duplicate.id + ' was already installed');
  const platforms = platformSites.map(site => createPlatform(site, world.addBody(site.id, platformBatches(site))));
  const tide = sampleChapterFiveTide(0);
  let tideSeconds = 0;
  let presentationSeconds = 0;
  let stir = 0;
  let disposed = false;
  let visuals: { platforms: Group[]; drift: Group; sea: Object3D | undefined; release(): void } | undefined;

  function updateVisuals() {
    if (!visuals) return;
    const [x, z] = tideSite.center;
    visuals.sea?.position.set(x, tide.y, z);
    visuals.drift.position.y = tide.y + Math.sin(presentationSeconds * 0.7) * 0.05;
    for (const [index, platform] of platforms.entries()) {
      const { body } = platform;
      const node = visuals.platforms[index]!;
      node.position.set(body.x, body.y, body.z);
      node.rotation.set(0, body.yaw, 0, 'YXZ');
    }
  }

  function bind(root: Object3D, waterNode?: Object3D) {
    if (disposed || visuals) throw Error('Chapter Five mechanism visuals cannot be rebound while active or disposed');
    const candidate = waterNode ?? root.getObjectByName(tideSite.node);
    const sea = candidate === root ? undefined : candidate;
    const templates = new Map<string, Object3D>();
    for (const name of [...platformSites.flatMap(site => site.templates), ...driftTemplates]) {
      if (templates.has(name)) continue;
      const node = root.getObjectByName(name);
      if (!node) throw Error('Chapter Five is missing the mechanism template ' + name);
      templates.set(name, node);
    }
    const wrapper = (name: string, names: readonly string[]) => {
      if (root.getObjectByName(name)) throw Error('Chapter Five already has the mechanism node ' + name);
      const group = new Group();
      group.name = name;
      for (const template of names) group.add(templates.get(template)!.clone(true));
      return group;
    };
    const carriers = platformSites.map(site => wrapper(site.node, site.templates));
    const drift = wrapper('drift', driftTemplates);
    const originalSea = sea?.position.clone();
    const originalVisibility = [...templates.values()].map(node => [node, node.visible] as const);
    const owned = [...carriers, drift];
    function restore() {
      for (const node of owned) node.removeFromParent();
      for (const [node, visible] of originalVisibility) node.visible = visible;
      if (sea && originalSea) sea.position.copy(originalSea);
    }
    try {
      for (const node of owned) root.add(node);
      for (const node of templates.values()) node.visible = false;
      visuals = { platforms: carriers, drift, sea, release: restore };
      updateVisuals();
    } catch (error) {
      visuals = undefined;
      restore();
      throw error;
    }
  }

  function reset() {
    if (disposed) return;
    tideSeconds = 0;
    Object.assign(tide, sampleChapterFiveTide(0));
    for (const platform of platforms) platform.reset(tide.y);
    updateVisuals();
  }

  function step(delta: number, { player, playing = false, seconds }: ChapterFiveMechanismFrame = {}) {
    if (!Number.isFinite(delta) || delta < 0 || (seconds !== undefined && !Number.isFinite(seconds))) {
      throw RangeError('Chapter Five mechanism clocks must be finite and elapsed time nonnegative');
    }
    if (disposed) return;
    const before = tide.phase;
    tideSeconds += delta;
    presentationSeconds = seconds ?? presentationSeconds + delta;
    Object.assign(tide, sampleChapterFiveTide(tideSeconds));
    for (const platform of platforms) platform.step(delta, tide.y);
    const target = tide.phase === 'rising' ? 1 : tide.phase === 'low' ? MathUtils.smoothstep(2.5 - tide.toRise, 0, 2) : 0;
    stir += (target - stir) * Math.min(1, delta * 3);
    updateVisuals();
    if (tide.phase !== before) {
      if (tide.phase === 'rising') onCue?.({ name: 'tide', seconds: tideSite.rise, hold: tideSite.highHold });
      if (tide.phase === 'falling') onCue?.({ name: 'tideFall', seconds: tideSite.fall });
    }
    if (playing && player && player.state !== 'LEAP' && player.y < tide.y - 0.04) onFallOut?.();
  }

  reset();
  return {
    tide: tide as Readonly<typeof tide>,
    platforms: platforms.map(platform => ({
      id: platform.site.id, node: platform.site.node, body: platform.body, length: platform.length,
      get distance() { return platform.distance; },
    })),
    get presentation() {
      return { seconds: presentationSeconds, stir, mirrorY: tide.y * 2,
        driftY: tide.y + Math.sin(presentationSeconds * 0.7) * 0.05 };
    },
    /** Authored maximum tide protection for placement and support queries. */
    unsafeAt(_x: number, y: number, _z: number) { return y < tideSite.high + 0.05; },
    bind, step, reset,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const { body } of platforms) {
        body.enabled = false;
        body.setPose(body.x, body.y, body.z, body.yaw);
      }
      visuals?.release();
      visuals = undefined;
    },
  };
}
