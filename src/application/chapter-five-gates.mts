/** Chapter Five barriers, bell, and encounter door state from the shipped game. */
import type { Object3D } from 'three/webgpu';
import { extrudeWallPolyline } from '../physics/geometry.mts';
import type { CollisionWorld } from '../physics/world.mts';

export type ChapterFiveCourtState = 'idle' | 'fighting' | 'clear';
type VeilId = 'veil0' | 'veil1' | 'veil2' | 'gate_veil';
type BellTrigger = 'interact' | 'strike';

const arch = [86, 8.6, 14.4] as const;
const veilSites = [
  { id: 'veil0', node: 'veil0_node', z: -348, left: 79.5, right: 92.5, bottom: -2, top: 10,
    curtain: { left: 77.4, right: 94.6, bottom: -3, top: 11.4, arch } },
  { id: 'veil1', node: 'veil1_node', z: -359, left: 79.5, right: 92.5, bottom: -2, top: 10,
    curtain: { left: 77.4, right: 94.6, bottom: -3, top: 11.4, arch } },
  { id: 'veil2', node: 'veil2_node', z: -370, left: 79.5, right: 92.5, bottom: -2, top: 10,
    curtain: { left: 77.4, right: 94.6, bottom: -3, top: 11.4, arch } },
  { id: 'gate_veil', node: 'gate_veil_node', z: -557, left: 184.5, right: 198.5, bottom: -2, top: 11,
    curtain: { left: 184, right: 199, bottom: -3, top: 11.2, arch: [0, 0, 0] } },
] as const;
const bellSite = {
  id: 'crow_bell', x: 122, y: 7.4, z: -405.8, r: 0.8, standY: 7.4 - 2,
  reach: 2, prompt: 'E  ring the bell', swarm: 'causeway_crows', strikeCooldown: 0.9, hitCue: 'bladeOnBell',
} as const;
const courtSite = {
  id: 'court', flag: 'ch5_court', start: [125, -499, 7], leash: [125, -499, 13],
  catHide: [[118, -489], [132, -489]], travelSeconds: 0.8,
  doors: [
    { group: 'court_in', node: 'court_door_in', lift: -4.9, startsOpen: true, x: 125, y: 3.6, z: -486.4 },
    { group: 'court_out', node: 'court_door_out', lift: -4.9, startsOpen: false, x: 125, y: 3.6, z: -507.4 },
  ],
} as const;

export const chapterFiveGateSites = { veils: veilSites, bell: bellSite, court: courtSite } as const;

export interface ChapterFiveGatePlayer {
  readonly x: number;
  readonly z: number;
  readonly state: string;
  readonly grounded?: boolean;
}

interface GateFrame {
  player?: ChapterFiveGatePlayer | null;
  cameraZ?: number;
  /** Global presentation seconds, normally shared with the tide. */
  seconds?: number;
  court?: ChapterFiveCourtState;
}

export interface ChapterFiveGateEffects {
  hasFlag?(flag: typeof courtSite.flag): boolean;
  setFlag?(flag: typeof courtSite.flag): void;
  onCue?(cue: 'bell' | 'gate'): void;
  onShake?(strength: number): void;
  breakSwarm?(id: typeof bellSite.swarm): void;
}

interface VeilPresentation {
  readonly seconds: number;
  readonly fade: number;
  readonly passable: boolean;
}

export interface ChapterFiveGateVisuals {
  /** Caller-owned bell visual. The original generated it instead of loading it in the GLB. */
  bell?: Object3D;
  /** Supply uTime/uFade to caller-owned curtain nodes or materials. */
  onVeil?(id: VeilId, presentation: VeilPresentation): void;
}

const veilGroup = (id: VeilId) => 'veil_' + id;

/** Build veil collision and control the existing static court groups. */
export function createChapterFiveGates(
  world: Pick<CollisionWorld, 'addTriangles' | 'setGroup' | 'triangles'>, effects: ChapterFiveGateEffects = {},
) {
  if (world.triangles().some(triangle => veilSites.some(site => triangle.group === veilGroup(site.id)))) {
    throw Error('Chapter Five veil collision was already installed');
  }
  const veils = veilSites.map(site => {
    const group = veilGroup(site.id);
    world.addTriangles(extrudeWallPolyline([[site.left, site.z], [site.right, site.z]],
      () => site.bottom, () => site.top), { kind: 2, group });
    return { site, group, passable: false, seconds: 0, fade: 1 };
  });
  const doors = courtSite.doors.map(site => ({
    site, open: false, offset: 0,
    get y() { return site.y + this.offset; },
  }));
  const bell = { rings: 0, swing: 0, roll: 0 };
  let bellTime = 0;
  let lastRing = -10;
  let seconds = 0;
  let cleared = false;
  let court: ChapterFiveCourtState = 'idle';
  let disposed = false;
  let visuals: { doors: Object3D[]; options: ChapterFiveGateVisuals; release(): void } | undefined;

  function publish() {
    if (!visuals) return;
    for (const [index, door] of doors.entries()) {
      const { x, z } = door.site;
      visuals.doors[index]!.position.set(x, door.y, z);
    }
    visuals.options.bell?.position.set(bellSite.x, bellSite.y, bellSite.z);
    visuals.options.bell?.rotation.set(0, 0, bell.roll, 'YXZ');
    for (const veil of veils) {
      visuals.options.onVeil?.(veil.site.id, { seconds: veil.seconds, fade: veil.fade, passable: veil.passable });
    }
  }

  function projectDoors(snap: boolean) {
    for (const door of doors) {
      door.open = court === 'clear' || court !== 'fighting' && door.site.startsOpen;
      world.setGroup(door.site.group, !door.open);
      if (snap) door.offset = door.open ? door.site.lift : 0;
    }
  }

  function setCourtState(state: ChapterFiveCourtState) {
    if (disposed || court === state) return;
    court = state;
    if (state === 'clear') {
      cleared = true;
      effects.setFlag?.(courtSite.flag);
    }
    projectDoors(false);
    if (state !== 'idle') effects.onCue?.('gate');
  }

  /** Trigger eligibility so the encounter owner can decide when to start combat. */
  function canStartCourt(player: ChapterFiveGatePlayer | null | undefined, playing: boolean) {
    if (disposed || !playing || !player?.grounded || court !== 'idle') return false;
    const [x, z, radius] = courtSite.start;
    return Math.hypot(player.x - x, player.z - z) < radius;
  }

  function ringBell(trigger: BellTrigger = 'interact') {
    if (disposed || trigger === 'strike' && bellTime - lastRing < bellSite.strikeCooldown) return false;
    lastRing = bellTime;
    bell.rings++;
    bell.swing = 1;
    effects.onCue?.('bell');
    effects.onShake?.(0.1);
    effects.breakSwarm?.(bellSite.swarm);
    return true;
  }

  /** Open collision immediately when Ink Step starts, before the next velocity step. */
  function inkStep() {
    if (disposed) return;
    for (const veil of veils) world.setGroup(veil.group, false);
  }

  function step(delta: number, frame: GateFrame = {}) {
    if (!Number.isFinite(delta) || delta < 0 || (frame.seconds !== undefined && !Number.isFinite(frame.seconds))) {
      throw RangeError('Chapter Five gate time must be finite and elapsed time nonnegative');
    }
    if (disposed) return;
    seconds = frame.seconds ?? seconds + delta;
    const { player, cameraZ } = frame;
    const passable = player?.state === 'DASH' || player?.state === 'DODGE';
    for (const veil of veils) {
      veil.passable = passable;
      world.setGroup(veil.group, !passable);
      const opposite = player && cameraZ !== undefined && Math.sign(player.z - veil.site.z) !== Math.sign(cameraZ - veil.site.z);
      veil.fade += ((opposite ? 0.14 : 1) - veil.fade) * Math.min(1, delta * 6);
      veil.seconds = seconds;
    }
    bellTime += delta;
    bell.swing = Math.max(0, bell.swing - delta * 0.45);
    bell.roll = Math.sin(bellTime * 7) * 0.32 * bell.swing;
    if (frame.court !== undefined) setCourtState(frame.court);
    for (const door of doors) {
      const rate = Math.abs(door.site.lift) / courtSite.travelSeconds;
      const target = door.open ? door.site.lift : 0;
      const distance = target - door.offset;
      door.offset += Math.min(Math.max(distance, -rate * delta), rate * delta);
    }
    publish();
  }

  function reset() {
    if (disposed) return;
    court = (effects.hasFlag?.(courtSite.flag) ?? cleared) ? 'clear' : 'idle';
    for (const veil of veils) {
      veil.passable = false;
      world.setGroup(veil.group, true);
    }
    bell.rings = 0;
    bell.swing = 0;
    projectDoors(true);
    publish();
  }

  function bind(root: Object3D, options: ChapterFiveGateVisuals = {}) {
    if (disposed || visuals) throw Error('Chapter Five gates cannot be rebound while active or disposed');
    const nodes = courtSite.doors.map(({ node }) => {
      const found = root.getObjectByName(node);
      if (!found) throw Error('Chapter Five is missing the court door ' + node);
      return found;
    });
    const positions = nodes.map(node => node.position.clone());
    const bellPosition = options.bell?.position.clone();
    const bellRotation = options.bell?.rotation.clone();
    const release = () => {
      for (const [index, node] of nodes.entries()) node.position.copy(positions[index]!);
      if (options.bell && bellPosition && bellRotation) {
        options.bell.position.copy(bellPosition);
        options.bell.rotation.copy(bellRotation);
      }
    };
    visuals = { doors: nodes, options, release };
    try {
      publish();
    } catch (error) {
      visuals = undefined;
      release();
      throw error;
    }
  }

  reset();
  return {
    veils: veils as readonly Readonly<(typeof veils)[number]>[],
    doors: doors as readonly Readonly<(typeof doors)[number]>[],
    bell: bell as Readonly<typeof bell>,
    get court() { return court; },
    canStartCourt, setCourtState, ringBell, inkStep, step, reset, bind,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const veil of veils) world.setGroup(veil.group, false);
      for (const door of doors) world.setGroup(door.site.group, true);
      visuals?.release();
      visuals = undefined;
    },
  };
}
