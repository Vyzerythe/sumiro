/**
 * Recover the player ledge-path sampling/nearest-hold helper from the
 * immutable published bundle. NOT original authoring source.
 *
 * Each point is [x, y, z, outwardX, outwardZ]. Length is measured in the
 * horizontal X/Z plane; output positions include interpolated height.
 */
import type { CollisionPosition } from '../physics/world.mts';

export type LedgePoint = readonly [x: number, y: number, z: number, outwardX: number, outwardZ: number];

export interface LedgeSample extends CollisionPosition {
  ox: number;
  oz: number;
  s: number;
}

interface LedgeTransform {
  toWorld(x: number, y: number, z: number, out: LedgeSample): unknown;
  dirToWorld(x: number, z: number, out: LedgeSample): unknown;
}

export interface LedgePathDefinition {
  readonly points: readonly LedgePoint[];
  readonly body?: LedgeTransform | null;
}

export interface LedgePath {
  s: number[];
  length: number;
  at(distance?: number, out?: undefined): LedgeSample;
  at<Output extends object>(distance: number | undefined, out: Output): Omit<Output, keyof LedgeSample> & LedgeSample;
  nearest(x: number, z: number, minimum?: number, maximum?: number): number;
}

export function createLedgePath<Definition extends LedgePathDefinition>(
  ledge: Definition,
): Omit<Definition, keyof LedgePath> & LedgePath {
  const points = ledge.points;
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    distances.push(distances[i-1]! + Math.hypot(
      points[i]![0] - points[i-1]![0],
      points[i]![2] - points[i-1]![2],
    ));
  }
  const totalLength = distances[distances.length - 1]!;

  function at(distance?: number, out?: undefined): LedgeSample;
  function at<Output extends object>(distance: number | undefined, out: Output): Omit<Output, keyof LedgeSample> & LedgeSample;
  function at(distance?: number, output: object = {}): LedgeSample {
    // An omitted distance intentionally becomes NaN through the shipped clamp.
    const amount = Math.min(Math.max(distance!, 0), totalLength);
    let segment = 0;
    while (segment < distances.length - 2 && distances[segment+1]! < amount) segment++;
    const fraction = (amount-distances[segment]!) /
      (distances[segment+1]!-distances[segment]! || 1);
    const start = points[segment]!, end = points[segment+1]!;
    // The existing output object receives every sample field before it is read.
    const out = output as LedgeSample;
    out.x = start[0] + (end[0]-start[0])*fraction;
    out.y = start[1] + (end[1]-start[1])*fraction;
    out.z = start[2] + (end[2]-start[2])*fraction;
    const outwardX = start[3] + (end[3]-start[3])*fraction;
    const outwardZ = start[4] + (end[4]-start[4])*fraction;
    const length = Math.hypot(outwardX, outwardZ) || 1;
    out.ox = outwardX/length;
    out.oz = outwardZ/length;
    out.s = amount;
    if (ledge.body) {
      ledge.body.toWorld(out.x,out.y,out.z,out);
      ledge.body.dirToWorld(out.ox,out.oz,out);
    }
    return out;
  }

  function nearest(x: number, z: number, minimum = 0, maximum = totalLength): number {
    let best = minimum;
    let bestSquaredDistance = Infinity;
    const sample: Partial<LedgeSample> = {};
    // Preserve the published 0.1-unit sampling rather than optimizing it:
    // changes in tie-breaking can affect grip and movement behavior.
    for(let distance=minimum;distance<=maximum+1e-6;distance+=.1) {
      at(distance,sample);
      const squared = (sample.x!-x)**2+(sample.z!-z)**2;
      if(squared<bestSquaredDistance) {
        bestSquaredDistance=squared;
        best=distance;
      }
    }
    return best;
  }

  return {...ledge,s:distances,length:totalLength,at,nearest};
}
