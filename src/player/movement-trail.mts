interface Position {
  x: number;
  y: number;
  z: number;
}

interface TrailGround {
  y: number;
  ny: number;
  surface: string | number | null;
}

interface TrailWorld {
  groundAt(x: number, z: number, maxY: number, minY: number): (TrailGround & { body: unknown }) | null;
  sweepCapsule(start: Position, dx: number, dz: number, capsule: typeof trailCapsule,
    result: { x?: number; z?: number }): unknown;
  raycast(x: number, y: number, z: number, dx: number, dy: number, dz: number,
    distance: number, kinds: number): number;
}

interface PlayerPosition extends Position {
  state: string;
  grounded: boolean;
  onCarrier: boolean;
}

interface TrailPoint extends Position {
  broken: boolean;
}

interface SegmentOptions {
  stepUp?: number;
  maxLen?: number;
}

const MAX_TRAIL_POINTS = 600;
const MAX_SAMPLE_SPACING = 0.25;
const MIN_GROUND_NORMAL_Y = 0.55;
const MIN_POINT_SPACING = 0.4;
const MIN_POINT_HEIGHT_DELTA = 0.3;
const TRAIL_OBSTRUCTION_KINDS = 6;

export const trailCapsule = { radius: 0.16, height: 0.27, guards: true };
export const trailHeightTolerance = 0.15;

const RECORDABLE_STATES = new Set([
  'IDLE', 'WALK', 'RUN', 'SPRINT', 'TURN', 'TEETER', 'LAND', 'DODGE', 'DRINK',
  'INTERACT', 'TOUCH', 'HIT', 'ATTACK', 'PARRY', 'DRAW', 'SHEATHE',
]);
const BREAK_STATES = new Set(['LEAP', 'GRAB', 'HANG', 'SHIMMY', 'CLIMB', 'MANTLE_LOW', 'DROP', 'DASH']);

export function trailGroundAt(world: TrailWorld, x: number, z: number, maxY: number, minY: number): TrailGround | null {
  const ground = world.groundAt(x, z, maxY, minY);
  if (!ground || ground.body) return null;
  const { y, ny, surface } = ground;
  return { y, ny, surface };
}

export function findWalkableSegment(
  world: TrailWorld, from: Position, to: Position, { stepUp = 0.42, maxLen = Infinity }: SegmentOptions = {},
): number | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (distance > maxLen) return null;

  let height = from.y;
  const sampleCount = Math.max(1, Math.ceil(distance / MAX_SAMPLE_SPACING));
  for (let sample = 1; sample <= sampleCount; sample++) {
    const fraction = sample / sampleCount;
    const ground = trailGroundAt(world, from.x + dx * fraction, from.z + dz * fraction,
      height + stepUp, height - stepUp);
    if (!ground || ground.ny < MIN_GROUND_NORMAL_Y) return null;
    height = ground.y;
  }
  if (Math.abs(height - to.y) > stepUp + trailHeightTolerance) return null;

  if (distance > 0.001) {
    const end: { x?: number; z?: number } = {};
    world.sweepCapsule({ x: from.x, y: Math.max(from.y, to.y), z: from.z }, dx, dz, trailCapsule, end);
    const sweptDistance = Math.hypot(end.x! - to.x, end.z! - to.z);
    if (sweptDistance > 0.12 || world.raycast(from.x, from.y + 0.16, from.z, dx / distance,
      0, dz / distance, distance, TRAIL_OBSTRUCTION_KINDS) < distance - 0.05) return null;
  }
  return height;
}

export function createMovementTrail() {
  const trail = {
    points: [] as TrailPoint[],
    since: false,
    base: 0,
    clear() {
      trail.points.length = 0;
      trail.since = false;
    },
    restart({ x, y, z }: Position) {
      trail.clear();
      trail.points.push({ x, y, z, broken: false });
    },
    record(world: TrailWorld, player: PlayerPosition | null | undefined) {
      if (!player) return false;
      if (BREAK_STATES.has(player.state) || player.onCarrier) trail.since = true;
      if (!player.grounded || player.onCarrier || !RECORDABLE_STATES.has(player.state)) return false;

      const previous = trail.points[trail.points.length - 1];
      if (previous && Math.hypot(player.x - previous.x, player.z - previous.z) < MIN_POINT_SPACING &&
        Math.abs(player.y - previous.y) < MIN_POINT_HEIGHT_DELTA && !trail.since) return false;

      const broken = previous !== undefined && (trail.since || findWalkableSegment(world, previous, player) === null);
      trail.points.push({ x: player.x, y: player.y, z: player.z, broken });
      trail.since = false;
      if (trail.points.length > MAX_TRAIL_POINTS) {
        trail.points.shift();
        trail.base++;
      }
      return true;
    },
    at(index: number) {
      return trail.points[index - trail.base] ?? null;
    },
    first() {
      return trail.base;
    },
    end() {
      return trail.base + trail.points.length;
    },
    last() {
      return trail.points[trail.points.length - 1] ?? null;
    },
    nextBreak(index: number) {
      for (let next = Math.max(index, trail.base) + 1; next < trail.end(); next++) {
        if (trail.at(next)!.broken) return next;
      }
      return trail.end();
    },
    lengthFrom(index: number) {
      let length = 0;
      for (let next = Math.max(index, trail.base); next + 1 < trail.end(); next++) {
        const from = trail.at(next)!;
        const to = trail.at(next + 1)!;
        length += Math.hypot(to.x - from.x, to.z - from.z);
      }
      return length;
    },
  };
  return trail;
}
