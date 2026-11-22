import { pointInPolygon, type PointXZ } from '../physics/geometry.mts';

interface ChapterExit {
  polygon: readonly PointXZ[];
  wait?: number;
  flag?: string;
  finale?: true;
}

const rectangle = (x0: number, z0: number, x1: number, z1: number): readonly PointXZ[] =>
  [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

const exits: Readonly<Record<string, ChapterExit>> = {
  ch2_pass: { polygon: rectangle(45.5, -374, 50, -380), wait: 1.6 },
  ch3_pines: { polygon: rectangle(-450.59999999999997, -305, -438.59999999999997, -301) },
  ch4_temple: { polygon: rectangle(26, -544, 34, -534) },
  ch5_sea: { polygon: rectangle(182, -604, 201, -597), flag: 'ch5_last_rock' },
  ch6_summit: { polygon: rectangle(-300, -356, -286, -344), flag: 'ch6_duel', wait: 11, finale: true },
};

/** Poll a late chapter's authored exit while the run is in play. */
export function createChapterExit(id: string) {
  const exit = Object.hasOwn(exits, id) ? exits[id] : undefined;
  if (!exit) return null;
  let elapsed = 0;
  let finishing = false;
  let used = false;
  return {
    get finishing() { return finishing; },
    update(delta: number, feet: Readonly<{ x: number; z: number; grounded: boolean }>, flags: Readonly<Record<string, unknown>>) {
      if (!Number.isFinite(delta) || delta < 0) throw RangeError('Exit step must be finite and nonnegative');
      if (used || delta === 0) return false;
      const reachesExit = feet.grounded && (!exit.flag || Boolean(flags[exit.flag])) &&
        pointInPolygon(feet.x, feet.z, exit.polygon);
      if (exit.finale) finishing ||= reachesExit;
      const active = finishing || reachesExit;
      elapsed = active ? elapsed + delta : 0;
      if (!active || elapsed <= (exit.wait ?? 0)) return false;
      used = true;
      return true;
    },
    retry() { used = false; finishing = false; elapsed = 0; },
  };
}
