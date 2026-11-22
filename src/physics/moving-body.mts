/**
 * Moving collision triangles, with the shipped transform and mutation contract.
 */

export interface TriangleCoordinates extends ArrayLike<number>, Iterable<number> {
  [index: number]: number;
  slice(start?: number, end?: number): TriangleCoordinates;
}

export interface MovingTriangleBatch {
  positions: TriangleCoordinates;
  kind?: number;
  surface?: string | null;
}

export interface MovingTriangle extends TriangleCoordinates {
  local: TriangleCoordinates;
  kind: number;
  surface: string | null;
  group: string | null;
  fades: string | null;
  round?: boolean;
  body: MovingTriangleBody;
}

interface Position3 {
  x: number;
  y: number;
  z: number;
}

interface DirectionXZ {
  ox: number;
  oz: number;
}

interface PointTransform {
  (x: number, y: number, z: number, out?: undefined): Position3;
  <Output extends object>(x: number, y: number, z: number, out: Output): Output & Position3;
}

export interface MovingTriangleBody extends Position3 {
  id: string;
  tris: MovingTriangle[];
  enabled: boolean;
  placed?: boolean;
  yaw: number;
  pitch: number;
  roll: number;
  vx: number;
  vy: number;
  vz: number;
  dyaw: number;
  moved: boolean;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  setPose(x: number, y: number, z: number, yaw?: number, pitch?: number, roll?: number, deltaSeconds?: number): void;
  carry(point: Position3): void;
  toWorld: PointTransform;
  toLocal: PointTransform;
  dirToWorld<Output extends object>(x: number, z: number, out: Output): Output & DirectionXZ;
}

/** Mirrors the published squared-cross-product degeneracy threshold. */
function isDegenerateTriangle(triangle: TriangleCoordinates): boolean {
  const ax = triangle[3]! - triangle[0]!;
  const ay = triangle[4]! - triangle[1]!;
  const az = triangle[5]! - triangle[2]!;
  const bx = triangle[6]! - triangle[0]!;
  const by = triangle[7]! - triangle[1]!;
  const bz = triangle[8]! - triangle[2]!;
  return (ay * bz - az * by) ** 2 +
    (az * bx - ax * bz) ** 2 +
    (ax * by - ay * bx) ** 2 < 1e-12;
}

/**
 * Construct a rigid moving triangle collection with pose and point-conversion
 * helpers. The original engine uses a 3×3 rotation plus 3 translation values
 * in row-major Float64Array(12); both matrices are kept private.
 */
export function createMovingTriangleBody(id: string, batches: Iterable<MovingTriangleBatch>): MovingTriangleBody {
  const triangles: MovingTriangle[] = [];
  for (const {positions, kind = 1, surface = null} of batches) {
    for (let offset = 0; offset + 8 < positions.length; offset += 9) {
      // Slicing preserves the input's array type. Its metadata and body link are filled in below.
      const triangle = positions.slice(offset, offset + 9) as MovingTriangle;
      if (isDegenerateTriangle(triangle)) continue;
      triangle.local = triangle.slice();
      triangle.kind = kind;
      triangle.surface = surface;
      triangle.group = null;
      triangle.fades = null;
      triangles.push(triangle);
    }
  }

  const matrix = new Float64Array(12);
  const previousMatrix = new Float64Array(12);
  const body: MovingTriangleBody = {
    id,
    tris: triangles,
    enabled: true,
    x: 0, y: 0, z: 0,
    yaw: 0, pitch: 0, roll: 0,
    vx: 0, vy: 0, vz: 0, dyaw: 0,
    moved: false,
    minX: 0, maxX: 0,
    minY: 0, maxY: 0,
    minZ: 0, maxZ: 0,

    setPose(x, y, z, yaw = 0, pitch = 0, roll = 0, deltaSeconds = 0) {
      previousMatrix.set(matrix);
      const unchanged =
        x === body.x && y === body.y && z === body.z &&
        yaw === body.yaw && pitch === body.pitch && roll === body.roll;

      body.vx = deltaSeconds > 0 ? (x - body.x) / deltaSeconds : 0;
      body.vy = deltaSeconds > 0 ? (y - body.y) / deltaSeconds : 0;
      body.vz = deltaSeconds > 0 ? (z - body.z) / deltaSeconds : 0;
      // Intentionally *not* divided by deltaSeconds in the published engine.
      body.dyaw = deltaSeconds > 0 ? yaw - body.yaw : 0;
      body.moved = deltaSeconds > 0 && !unchanged;
      if (unchanged && body.placed) return;

      body.placed = true;
      body.x = x; body.y = y; body.z = z;
      body.yaw = yaw; body.pitch = pitch; body.roll = roll;

      const cosineYaw = Math.cos(yaw);
      const sineYaw = Math.sin(yaw);
      const cosinePitch = Math.cos(pitch);
      const sinePitch = Math.sin(pitch);
      const cosineRoll = Math.cos(roll);
      const sineRoll = Math.sin(roll);

      matrix[0] = cosineYaw * cosineRoll + sineYaw * sinePitch * sineRoll;
      matrix[1] = -cosineYaw * sineRoll + sineYaw * sinePitch * cosineRoll;
      matrix[2] = sineYaw * cosinePitch;
      matrix[3] = cosinePitch * sineRoll;
      matrix[4] = cosinePitch * cosineRoll;
      matrix[5] = -sinePitch;
      matrix[6] = -sineYaw * cosineRoll + cosineYaw * sinePitch * sineRoll;
      matrix[7] = sineYaw * sineRoll + cosineYaw * sinePitch * cosineRoll;
      matrix[8] = cosineYaw * cosinePitch;
      matrix[9] = x; matrix[10] = y; matrix[11] = z;

      if (deltaSeconds <= 0) previousMatrix.set(matrix);

      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;

      for (const triangle of triangles) {
        const local = triangle.local;
        for (let index = 0; index < 9; index += 3) {
          const wx = matrix[0]! * local[index]! +
            matrix[1]! * local[index + 1]! + matrix[2]! * local[index + 2]! + x;
          const wy = matrix[3]! * local[index]! +
            matrix[4]! * local[index + 1]! + matrix[5]! * local[index + 2]! + y;
          const wz = matrix[6]! * local[index]! +
            matrix[7]! * local[index + 1]! + matrix[8]! * local[index + 2]! + z;
          triangle[index] = wx;
          triangle[index + 1] = wy;
          triangle[index + 2] = wz;
          if (wx < minX) minX = wx;
          if (wx > maxX) maxX = wx;
          if (wy < minY) minY = wy;
          if (wy > maxY) maxY = wy;
          if (wz < minZ) minZ = wz;
          if (wz > maxZ) maxZ = wz;
        }
      }
      body.minX = minX; body.maxX = maxX;
      body.minY = minY; body.maxY = maxY;
      body.minZ = minZ; body.maxZ = maxZ;
    },

    carry(point) {
      if (!body.moved) return;
      const dx = point.x - previousMatrix[9]!;
      const dy = point.y - previousMatrix[10]!;
      const dz = point.z - previousMatrix[11]!;
      const localX = previousMatrix[0]! * dx + previousMatrix[3]! * dy + previousMatrix[6]! * dz;
      const localY = previousMatrix[1]! * dx + previousMatrix[4]! * dy + previousMatrix[7]! * dz;
      const localZ = previousMatrix[2]! * dx + previousMatrix[5]! * dy + previousMatrix[8]! * dz;
      point.x = matrix[0]! * localX + matrix[1]! * localY + matrix[2]! * localZ + matrix[9]!;
      point.y = matrix[3]! * localX + matrix[4]! * localY + matrix[5]! * localZ + matrix[10]!;
      point.z = matrix[6]! * localX + matrix[7]! * localY + matrix[8]! * localZ + matrix[11]!;
    },

    toWorld<Output extends object = object>(x: number, y: number, z: number, out = {} as Output) {
      const point = out as Output & Position3;
      point.x = matrix[0]! * x + matrix[1]! * y + matrix[2]! * z + matrix[9]!;
      point.y = matrix[3]! * x + matrix[4]! * y + matrix[5]! * z + matrix[10]!;
      point.z = matrix[6]! * x + matrix[7]! * y + matrix[8]! * z + matrix[11]!;
      return point;
    },

    toLocal<Output extends object = object>(x: number, y: number, z: number, out = {} as Output) {
      const dx = x - matrix[9]!;
      const dy = y - matrix[10]!;
      const dz = z - matrix[11]!;
      const point = out as Output & Position3;
      point.x = matrix[0]! * dx + matrix[3]! * dy + matrix[6]! * dz;
      point.y = matrix[1]! * dx + matrix[4]! * dy + matrix[7]! * dz;
      point.z = matrix[2]! * dx + matrix[5]! * dy + matrix[8]! * dz;
      return point;
    },

    dirToWorld<Output extends object>(x: number, z: number, out: Output) {
      const direction = out as Output & DirectionXZ;
      direction.ox = matrix[0]! * x + matrix[2]! * z;
      direction.oz = matrix[6]! * x + matrix[8]! * z;
      return direction;
    },
  };
  for (const triangle of triangles) triangle.body = body;
  body.setPose(0, 0, 0);
  return body;
}
