/** Chapter Two authored mechanisms from ch2_pass-9Opjv4P2.js and level-O-RtwNJJ.js. */
import { extrudeWallPolyline, type PointXZ } from '../physics/geometry.mts';
import type { MovingTriangleBatch, MovingTriangleBody } from '../physics/moving-body.mts';
import type { CollisionWorld } from '../physics/world.mts';

type Position = Readonly<{ x: number; y: number; z: number }>;
type ChamberFlag = 'ch2_court_door' | 'ch2_sword_wraith';
type CrumblePhase = 'whole' | 'shaking' | 'falling' | 'gone' | 'rising';

export interface ChapterTwoMechanismPlayer extends Position {
  readonly carrier?: MovingTriangleBody | null;
}

export type ChapterTwoMechanismEvent =
  | { type: 'cue'; name: 'door' | 'stoneStop' | 'crumble' | 'crumbleFall' }
  | { type: 'cue'; name: 'bell'; pitch: number }
  | { type: 'shake'; strength: number }
  | { type: 'hint'; text: string; ms: number };

export interface ChapterTwoMechanismEffects {
  hasFlag?(flag: ChamberFlag): boolean;
  setFlag?(flag: ChamberFlag): void;
  onEvent?(event: ChapterTwoMechanismEvent): void;
}

const doorDefinition = { id: 'court_door', x: 14, y: 6, z: -37.6, width: 4, height: 3.6,
  hinge: 1.72, leafWidth: 1.7, leafHeight: 3.3, time: 0.8, lift: 3.6 + 0.2 } as const;
const slabDefinition = { id: 'court_slab', node: 'n_court_slab', x: 12.5, y: 6, farZ: -58.95, nearZ: -51.05,
  width: 4, depth: 4, thickness: 0.7, speed: 4 } as const;
const bellDefinitions = [
  { id: 'court_bell', node: 'n_court_bell', x: 17.4, y: 7.65, z: -36.4, radius: 1.1, pitch: 1.12 },
  { id: 'court_slab_bell', node: 'n_court_slab_bell', x: 14.8, y: 7.65, z: -48.75, radius: 1.3, pitch: 0.94 },
  { id: 'court_far_bell', node: 'n_court_far_bell', x: 10.2, y: 7.65, z: -61.25, radius: 1.3, pitch: 0.94 },
] as const;
type BellId = (typeof bellDefinitions)[number]['id'];

function stones(prefix: string, delay: number, positions: readonly (readonly [number, number, number])[]) {
  return positions.map(([x, y, z], index) => {
    const id = `${prefix}_${index}`;
    return { id, node: id, x, y, z, delay, width: 3.2, depth: 3.2, thickness: 1.2 } as const;
  });
}

const stoneDefinitions = [
  ...stones('safe', 0.85, [[-46, 39.9, -233], [-46, 39.9, -237.4], [-46, 39.9, -241.8], [-46, 39.9, -246.2]]),
  ...stones('rise', 0.72, [[-34.6, 39.9, -254.5], [-30.5, 40.1, -254.5], [-26.4, 40.3, -254.5], [-22.3, 40.5, -254.5], [-18.2, 40.7, -254.5]]),
  ...stones('tread', 0.7, [[37, 52.7, -273.4], [37, 53.4, -277.8]]),
  ...stones('last', 0.7, [[48, 64.9, -348.4], [48, 64.9, -352.8]]),
] as const;

export const chapterTwoMechanismSites = {
  door: doorDefinition, slab: slabDefinition, bells: bellDefinitions, crumbles: stoneDefinitions,
} as const;

function platformBatches(width: number, depth: number, thickness: number, surface: 'stone' | 'rock'): MovingTriangleBatch[] {
  const x = width / 2;
  const z = depth / 2;
  const rim: PointXZ[] = [[-x, -z], [x, -z], [x, z], [-x, z], [-x, -z]];
  return [
    { positions: [-x, 0, -z, x, 0, -z, x, 0, z, -x, 0, -z, x, 0, z, -x, 0, z], kind: 1, surface },
    { positions: extrudeWallPolyline(rim, () => -thickness, () => -0.02), kind: 2 },
  ];
}

const smooth = (x: number) => x * x * (3 - 2 * x);
const approach = (value: number, target: number, step: number) => value < target
  ? Math.min(value + step, target) : Math.max(value - step, target);

/** Install the authored moving collision bodies and project mechanism state for presentation. */
export function createChapterTwoMechanisms(
  world: Pick<CollisionWorld, 'addBody' | 'body'>, effects: ChapterTwoMechanismEffects = {},
) {
  const ids = [doorDefinition.id, slabDefinition.id, ...stoneDefinitions.map(stone => stone.id)];
  const duplicate = ids.find(id => world.body(id));
  if (duplicate) throw Error(`Chapter Two body ${duplicate} was already installed`);
  const { width, height } = doorDefinition;
  const doorBody = world.addBody(doorDefinition.id, [{
    positions: extrudeWallPolyline([[-width / 2, 0], [width / 2, 0]], () => 0, () => height), kind: 2,
  }]);
  const slabBody = world.addBody(slabDefinition.id, platformBatches(slabDefinition.width, slabDefinition.depth, slabDefinition.thickness, 'stone'));
  const slabLength = slabDefinition.nearZ - slabDefinition.farZ;
  const flags = new Set<ChamberFlag>();
  const hasFlag = (flag: ChamberFlag) => effects.hasFlag?.(flag) ?? flags.has(flag);
  const emit = (event: ChapterTwoMechanismEvent) => effects.onEvent?.(event);
  const grant = (flag: ChamberFlag) => {
    if (hasFlag(flag)) return;
    flags.add(flag);
    effects.setFlag?.(flag);
  };

  const door = { body: doorBody, progress: 0, leafAngle: 0 };
  const slab = { body: slabBody, called: false, distance: 0, length: slabLength };
  const bells = bellDefinitions.map(site => ({ ...site, rings: 0, roll: 0, swing: 0, time: 0, lastRing: -10 }));
  const crumbles = stoneDefinitions.map(site => ({
    ...site,
    body: world.addBody(site.id, platformBatches(site.width, site.depth, site.thickness, 'rock')),
    phase: 'whole' as CrumblePhase,
    pose: { x: site.x, y: site.y, z: site.z, visible: true },
    time: 0, velocity: 0, drop: 0,
  }));
  let moving = false;
  let disposed = false;

  function doorPose(delta: number) {
    const opening = smooth(door.progress);
    door.leafAngle = opening * 1.75;
    doorBody.enabled = door.progress < 0.7;
    doorBody.setPose(doorDefinition.x, doorDefinition.y + doorDefinition.lift * opening,
      doorDefinition.z, 0, 0, 0, delta);
  }

  function stepDoor(delta: number, player?: ChapterTwoMechanismPlayer | null) {
    const open = hasFlag('ch2_court_door');
    const obstruction = player && Math.abs(player.z - doorDefinition.z) < 0.35 / 2 + 0.3 + 0.1 &&
      Math.abs(player.x - doorDefinition.x) < width / 2 + 0.2 && player.y < doorDefinition.y + height &&
      player.y + 1.7 > doorDefinition.y;
    if (open || !obstruction) {
      const previous = door.progress;
      door.progress = approach(previous, Number(open), delta / doorDefinition.time);
      if (previous !== door.progress && (previous === 0 || previous === 1)) emit({ type: 'cue', name: 'door' });
    }
    doorPose(delta);
  }

  function slabPose(delta: number) {
    slabBody.setPose(slabDefinition.x, slabDefinition.y,
      slabDefinition.farZ + (slab.distance / slabLength) * slabLength, 0, 0, 0, delta);
  }

  function stepSlab(delta: number) {
    const distance = approach(slab.distance, slab.called ? slabLength : 0, slabDefinition.speed * delta);
    const previousZ = slabBody.z;
    slab.distance = distance;
    slabPose(delta);
    const changed = Math.abs(slabBody.z - previousZ) > 1e-4;
    if (changed !== moving) {
      moving = changed;
      emit({ type: 'cue', name: moving ? 'door' : 'stoneStop' });
    }
  }

  function ringBell(id: BellId, { byHit = true, fighting = false, catBlocksCrossing = false } = {}): boolean {
    if (disposed) return false;
    const bell = bells.find(bell => bell.id === id);
    if (!bell) return false;
    const cat = id !== 'court_bell' && catBlocksCrossing;
    const blocked = byHit && fighting || cat;
    if ((byHit || blocked) && bell.time - bell.lastRing < 0.9) return false;
    bell.lastRing = bell.time;
    bell.swing = 1;
    emit({ type: 'cue', name: 'bell', pitch: bell.pitch });
    if (blocked) {
      if (cat && !(byHit && fighting)) emit({ type: 'hint', text: 'F  pick up the cat. It cannot cross on its own', ms: 4200 });
      return false;
    }
    bell.rings++;
    emit({ type: 'shake', strength: 0.1 });
    if (id === 'court_bell') grant('ch2_court_door');
    else slab.called = !slab.called;
    return true;
  }

  function occupied(stone: typeof crumbles[number], player?: ChapterTwoMechanismPlayer | null) {
    const { body } = stone;
    return player && player.x > body.minX - 0.5 && player.x < body.maxX + 0.5 &&
      player.z > body.minZ - 0.5 && player.z < body.maxZ + 0.5 && Math.abs(player.y - stone.y) < 2.5;
  }

  function stepStone(stone: typeof crumbles[number], delta: number, player?: ChapterTwoMechanismPlayer | null) {
    stone.time += delta;
    let shakeX = 0;
    let shakeZ = 0;
    switch (stone.phase) {
      case 'whole':
        if (player?.carrier === stone.body) {
          stone.phase = 'shaking';
          stone.time = 0;
          emit({ type: 'cue', name: 'crumble' });
        }
        break;
      case 'shaking': {
        const amplitude = 0.012 + 0.05 * (stone.time / stone.delay);
        shakeX = Math.sin(stone.time * 71) * amplitude;
        shakeZ = Math.sin(stone.time * 93) * amplitude;
        if (stone.time >= stone.delay) {
          stone.phase = 'falling';
          stone.time = stone.velocity = stone.drop = 0;
          stone.body.enabled = false;
          emit({ type: 'cue', name: 'crumbleFall' });
          emit({ type: 'shake', strength: 0.12 });
        }
        break;
      }
      case 'falling':
        stone.velocity += 20 * delta;
        stone.drop += stone.velocity * delta;
        if (stone.time >= 1.3) {
          stone.phase = 'gone';
          stone.time = 0;
          stone.pose.visible = false;
        }
        break;
      case 'gone':
        if (stone.time >= 4 && !occupied(stone, player)) {
          stone.phase = 'rising';
          stone.time = 0;
          stone.drop = 1.2;
          stone.pose.visible = true;
        }
        break;
      case 'rising':
        stone.drop = 1.2 * (1 - smooth(Math.min(stone.time / 0.5, 1)));
        if (stone.time >= 0.5) {
          stone.phase = 'whole';
          stone.drop = 0;
          stone.body.enabled = true;
        }
        break;
    }
    stone.body.setPose(stone.x, stone.y, stone.z, 0, 0, 0, delta);
    stone.pose.x = stone.x + shakeX;
    stone.pose.y = stone.y - stone.drop;
    stone.pose.z = stone.z + shakeZ;
  }

  function step(delta: number, player?: ChapterTwoMechanismPlayer | null) {
    if (!Number.isFinite(delta) || delta < 0) throw RangeError('Mechanism step must be finite and nonnegative');
    if (disposed || delta === 0) return;
    // Chapter order is crumble stones, door, court bell, slab, near bell, far bell.
    for (const stone of crumbles) stepStone(stone, delta, player);
    stepDoor(delta, player);
    stepSlab(delta);
    for (const bell of bells) {
      bell.time += delta;
      bell.swing = Math.max(0, bell.swing - delta * 0.45);
      bell.roll = Math.sin(bell.time * 7) * 0.32 * bell.swing;
    }
  }

  function reset() {
    if (disposed) return;
    for (const stone of crumbles) {
      stone.phase = 'whole';
      stone.time = stone.velocity = stone.drop = 0;
      stone.body.enabled = true;
      stone.body.setPose(stone.x, stone.y, stone.z);
      Object.assign(stone.pose, { x: stone.x, y: stone.y, z: stone.z, visible: true });
    }
    door.progress = Number(hasFlag('ch2_court_door'));
    doorPose(0);
    slab.called = false;
    slab.distance = 0;
    moving = false;
    slabPose(0);
    for (const bell of bells) {
      bell.swing = bell.roll = 0;
      if (bell.id !== 'court_bell') bell.rings = 0;
    }
  }

  function enter(progress?: Readonly<{ chapter: string; shrine: string | null; flags: Record<string, unknown> }>) {
    if (disposed) return;
    if (progress) {
      for (const flag of ['ch2_court_door', 'ch2_sword_wraith'] as const) {
        if (progress.flags[flag]) flags.add(flag);
        else flags.delete(flag);
      }
      if (progress.chapter === 'ch2_pass' && progress.shrine && progress.shrine !== 'court' && !progress.flags.ch2_sword_wraith) {
        grant('ch2_sword_wraith');
        grant('ch2_court_door');
      }
    }
    reset();
  }

  reset();
  return {
    door: door as Readonly<typeof door>, slab: slab as Readonly<typeof slab>,
    bells: bells as readonly Readonly<Position & { id: BellId; node: string; pitch: number; radius: number; roll: number; rings: number }>[],
    crumbles: crumbles as readonly Readonly<Position & { id: string; node: string; body: MovingTriangleBody; phase: CrumblePhase;
      pose: Readonly<Position & { visible: boolean }> }>[],
    ringBell, step, reset, enter,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const body of [doorBody, slabBody, ...crumbles.map(stone => stone.body)]) {
        body.enabled = false;
        body.setPose(body.x, body.y, body.z, body.yaw, body.pitch, body.roll, 0);
      }
    },
  };
}
