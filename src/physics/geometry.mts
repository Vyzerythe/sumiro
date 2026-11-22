/**
 * Reconstructed geometry routines extracted from collision-DtBQEpmQ.js.
 *
 * The published implementation is the compatibility reference for winding,
 * boundary behavior, and mutation of caller-owned arrays.
 */

export type PointXZ = readonly [x: number, z: number];

type HeightAt = (x: number, z: number) => number;

/**
 * Build a triangle list of vertical walls along an X/Z polyline.
 * bottomAt/topAt are callbacks evaluated at each segment endpoint.
 * The output array is mutated and returned. It defaults to a new array.
 */
export function extrudeWallPolyline(
  points: readonly PointXZ[],
  bottomAt: HeightAt,
  topAt: HeightAt,
  output: number[] = [],
): number[] {
  for (let index = 0; index + 1 < points.length; index++) {
    const [x0, z0] = points[index]!;
    const [x1, z1] = points[index + 1]!;

    // Intentionally evaluate bottom/top at the first point before the second.
    const bottom0 = bottomAt(x0, z0);
    const top0 = topAt(x0, z0);
    const bottom1 = bottomAt(x1, z1);
    const top1 = topAt(x1, z1);

    output.push(
      x0, bottom0, z0,
      x1, bottom1, z1,
      x1, top1, z1,
      x0, bottom0, z0,
      x1, top1, z1,
      x0, top0, z0,
    );
  }
  return output;
}

/**
 * The shipped ray-casting rule, including its strict inequality for edges.
 * Points on a polygon boundary are not guaranteed to be considered inside.
 */
export function pointInPolygon(x: number, z: number, polygon: readonly PointXZ[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1;
    index < polygon.length; previous = index++) {
    const x0 = polygon[index]![0];
    const z0 = polygon[index]![1];
    const x1 = polygon[previous]![0];
    const z1 = polygon[previous]![1];
    if ((z0 > z) !== (z1 > z) &&
      x < ((x1 - x0) * (z - z0)) / (z1 - z0) + x0) {
      inside = !inside;
    }
  }
  return inside;
}
