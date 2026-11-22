/** Authored camera zones in chapter order. Track rows are x, z, yaw, pitch, distance and height. */
import type { PointXZ } from '../physics/geometry.mts';

interface ZoneConditions {
  poly?: readonly PointXZ[];
  yMin?: number;
  yMax?: number;
  onHold?: boolean;
  air?: boolean;
  ride?: string;
  fight?: string;
  pinX?: readonly [x: number, weight: number];
  blend?: number;
}
export type CameraTrackPoint = readonly [x: number, z: number, yaw: number, pitch: number, distance: number, height: number];
export interface CameraFraming { yaw: number; pitch: number; distance: number; height: number }
export type CameraZone = ZoneConditions & { id: string } & (
  | ({ kind: 'fixed' | 'leap' } & CameraFraming)
  | { kind: 'track'; line: readonly CameraTrackPoint[] }
);
export interface ChapterCameraDefinition {
  zones: readonly CameraZone[];
  sightMeshes: string;
  twoSided?: boolean;
}

const rectangle = (x0: number, z0: number, x1: number, z1: number): readonly PointXZ[] =>
  [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const fixed = (id: string, yaw: number, pitch: number, distance: number, height: number, conditions: ZoneConditions = {}): CameraZone =>
  ({ id, kind: 'fixed', ...conditions, yaw, pitch, distance, height });
const track = (id: string, conditions: ZoneConditions, line: readonly CameraTrackPoint[]): CameraZone =>
  ({ id, kind: 'track', ...conditions, line });

export const laterChapterCameraDefinitions = {
  ch2_pass: {
    sightMeshes: "^pass_(side|boulder|stack|lip|top|tread|wall)",
    zones: [
      fixed('court_slab', -35, -12, 9.5, 3.8, { ride: "court_slab" }),
      fixed('court_dock', -12, -13, 9, 3.8, { poly: rectangle(7.5, -37.3, 19, -49.6), yMin: 5 }),
      fixed('court', 0, -17, 9.5, 4.8, { poly: rectangle(3, -11, 25.5, -37.3), yMin: 5 }),
      fixed('ink_a_hold', -90, -6, 8, 3, { onHold: true, poly: rectangle(14, -216.5, 15.05, -223.5) }),
      fixed('ink_b_hold', -90, -6, 8, 3, { onHold: true, poly: rectangle(3, -216.5, 4.05, -223.5) }),
      fixed('ink_c_hold', -90, -6, 8, 3, { onHold: true, poly: rectangle(-9.5, -216.5, -8.45, -223.5) }),
      fixed('ink_d_hold', -90, -6, 8, 3, { onHold: true, poly: rectangle(-21, -216.5, -19.95, -223.5) }),
      fixed('ink_e_hold', -90, -6, 8, 3, { onHold: true, poly: rectangle(-34, -216.5, -32.95, -223.5) }),
      fixed('land1_hold', -90, -5, 8, 2.4, { onHold: true, poly: rectangle(54, -156.95, 64, -158) }),
      fixed('land3_hold', 180, -10, 8, 4.5, { onHold: true, poly: rectangle(53.5, -175, 63.5, -176.2) }),
      fixed('cleft_s_hold', 180, -8, 8, 3, { onHold: true, poly: rectangle(46, -216, 51, -217.2) }),
      fixed('well_s_hold', 180, -8, 6, 3, { onHold: true, poly: rectangle(56, -209, 62, -210) }),
      fixed('well_n_hold', 0, -8, 6, 3, { onHold: true, poly: rectangle(56, -215, 62, -216.05) }),
      fixed('spur', -4, -12, 15, 6.5, { poly: rectangle(40, -358, 66, -385), yMin: 60 }),
      track('k_top', { poly: rectangle(37, -336.9, 64, -358), yMin: 63 }, [
        [48, -337, 96, -9, 8.5, 4.4],
        [48, -339, 88, -9, 8.5, 4.4],
        [48, -341, 74, -9, 8.5, 4.4],
        [48, -343, 58, -9, 8.5, 4.4],
        [48, -345, 38, -9, 8.5, 4.4],
        [48, -347, 8, -9, 8.5, 4.4],
        [48, -350, 0, -9, 10, 4.4],
      ]),
      fixed('k_face', 30, -5, 11, 3, { poly: rectangle(70, -400, 70.2, -400.2) }),
      fixed('i_top', 0, -6, 11, 3.6, { poly: rectangle(41, -304, 58, -319), yMin: 57 }),
      fixed('i_wall', -16, -3, 12, 2.8, { poly: rectangle(28, -292, 41, -305.5), yMin: 53 }),
      fixed('i_stair', 0, -7, 11, 4.5, { poly: rectangle(30, -264.2, 46, -291), yMin: 48 }),
      fixed('snow', 8, -14, 9, 4.5, { poly: rectangle(24.5, -264.3, 34, -271.5), yMin: 56 }),
      track('h_top', { poly: rectangle(23.5, -250, 43, -264.2), yMin: 48 }, [
        [30, -250, 56, -4, 9, 3.2],
        [30, -252.5, 36, -4, 9, 3.2],
        [30, -254.6, 12, -4, 9, 3.2],
        [30, -264, 12, -4, 9, 3.2],
      ]),
      fixed('tooth_face', -45, -6, 11, 3.2, { poly: rectangle(9, -262.5, 9.2, -262.6) }),
      track('tooth_gap', { poly: rectangle(9.2, -262.5, 9.4, -262.6) }, [
        [26, -245, -96, -2, 11, 2.4],
        [26, -250, -84, -2, 11, 2.4],
      ]),
      fixed('g_far', -62, -5, 9, 3.4, { poly: rectangle(-10.5, -245, 9, -263), yMin: 40 }),
      fixed('g_rise', -90, -13, 10, 5.6, { poly: rectangle(-55, -249.1, -10.5, -260), yMin: 38 }),
      fixed('crumb_shelf', 90, -14, 10, 5, { poly: rectangle(-56, -230, -36, -249.1), yMax: 38.7 }),
      fixed('g_safe', 0, -11, 10, 4.8, { poly: rectangle(-58, -221, -36, -249.1), yMin: 36 }),
      fixed('ink_far', 22, -9, 9, 3.6, { poly: rectangle(-58, -205, -40.4, -221), yMin: 38 }),
      fixed('ink_shelf', 0, -52, 6, 9, { poly: rectangle(-9.5, -209, 22.3, -229), yMax: 38.5 }),
      fixed('ink', 90, -10, 11, 4.6, { poly: rectangle(-40.4, -208, 23, -230), yMin: 35 }),
      track('ridge_fight', { fight: "ridge", poly: rectangle(23, -210, 47, -231), yMin: 38 }, [
        [47, -222, 26, -16, 9.5, 5],
        [42.5, -222, 26, -16, 9.5, 5],
        [39.5, -222, 68, -16, 9.5, 5],
        [23, -222, 68, -16, 9.5, 5],
      ]),
      track('west_top', { poly: rectangle(23, -210, 47, -231), yMin: 38 }, [
        [47, -222, 26, -8, 9, 3.4],
        [42.5, -222, 26, -8, 9, 3.4],
        [39.5, -222, 68, -8, 9, 3.4],
        [23, -222, 68, -8, 9, 3.4],
      ]),
      fixed('cleft', 0, -44, 6.5, 8.5, { poly: rectangle(45.5, -216.4, 51.5, -229), yMax: 34, pinX: [48.5,0.25], blend: 5 }),
      fixed('well', 0, -60, 4, 9, { poly: rectangle(55.8, -209.2, 62.2, -216), yMax: 33 }),
      fixed('r6', 22, -7, 9, 3.4, { poly: rectangle(44, -201.4, 70, -222), yMin: 33 }),
      fixed('stair_leap', 0, -5, 10, 2.8, { poly: rectangle(50, -186, 64, -195), yMin: 28 }),
      fixed('stair_shelf', -90, -5, 9, 2.4, { poly: rectangle(52.5, -156.95, 65.5, -159.85), yMax: 23.5 }),
      fixed('stair', 0, -9, 9, 4.4, { poly: rectangle(50, -146.5, 68, -186), yMin: 20 }),
      fixed('r5', 10, -6, 9, 3.4, { poly: rectangle(53, -135, 68, -146.5), yMin: 20 }),
      track('hop', { poly: rectangle(27, -124, 47, -137), yMin: 13 }, [
        [38, -124.3, 92, -5, 9, 2.6],
        [38, -125.5, 84, -5, 9, 2.6],
        [38, -127, 75, -5, 9, 2.6],
        [38, -129, 60, -5, 9, 2.6],
        [38, -131, 44, -5, 9, 2.6],
        [38, -133, 12, -5, 9, 2.6],
        [38, -136.5, 0, -5, 9, 2.6],
      ]),
      fixed('cornice', 26, -6, 10, 3.2, { poly: rectangle(20.5, -99, 44, -111), yMin: 10 }),
      fixed('first_shelf', 90, -8, 10, 3.2, { poly: rectangle(15, -92, 29, -101), yMax: 7.4 }),
      fixed('first_holds', 0, -3, 10, 2.4, { poly: rectangle(2, -91, 30, -101), yMax: 10 }),
      fixed('low', -2, -9, 8, 3.2),
    ],
  },
  ch3_pines: {
    sightMeshes: "^(a\\d+|cl\\d+)_(rock|top)",
    zones: [
      fixed('r8_face_hold', 66, -6, 9, 3, { onHold: true, poly: rectangle(-196, -205.5, -194.8, -203.4) }),
      fixed('face', -58, -5, 8.4, 2.4, { poly: rectangle(20, -136.6, 34.1, -117.5), yMin: 15 }),
      fixed('walk', 0, -7, 7.6, 3, { poly: rectangle(20, -117.5, 45, -40) }),
      track('shelf', { poly: rectangle(34, -158.6, 45, -136.4) }, [
        [37, -136.4, -86, -9, 7.8, 3.1],
        [37, -138.5, -76, -9, 7.8, 3.1],
        [37, -140, -66, -9, 7.8, 3.1],
        [37, -142, -48, -9, 7.8, 3.1],
        [37, -144, -20, -9, 7.8, 3.1],
        [37, -145.5, 0, -9, 7.8, 3.1],
      ]),
      fixed('low', 112, -12, 8.4, 3.4, { poly: rectangle(8, -170, 28.5, -150) }),
      fixed('trunk1', 16, -13, 8.8, 3.6, { poly: rectangle(14, -188, 45, -158.6) }),
      fixed('trunk2', 74, -13, 8.8, 3.6, { poly: rectangle(-6, -192, 22.5, -176) }),
      fixed('wind1', 90, -13, 9.4, 5.6, { poly: rectangle(-59, -212, -6, -178) }),
      fixed('gale', 90, -8, 9.4, 3.8, { poly: rectangle(-115, -212, -59, -180) }),
      fixed('stones', 90, -15, 10, 4.6, { poly: rectangle(-151, -212, -115, -188) }),
      fixed('crow', 90, -13, 8.6, 3.4, { poly: rectangle(-170, -189.4, -142, -170) }),
      fixed('long', 90, -8, 10.6, 3.8, { poly: rectangle(-195.6, -212, -151, -189.4) }),
      fixed('r8_fight', -25, -28, 24, 13, { fight: "pines_far", poly: rectangle(-211, -214.1, -179, -192) }),
      fixed('r8_north', 15, -13, 10, 4.6, { poly: rectangle(-211, -214.1, -195.6, -204.6) }),
      track('r8_table', { poly: rectangle(-211, -204.6, -195.6, -192) }, [
        [-195.6, -198, 10, -14, 10.4, 4.8],
        [-207.5, -198, 10, -14, 10.4, 4.8],
        [-211, -198, 90, -16, 10.6, 5],
      ]),
      fixed('gale2', 90, -16, 10.6, 5, { poly: rectangle(-280.4, -216, -195.6, -188) }),
      fixed('half', 180, -11, 9, 3.4, { poly: rectangle(-318.59999999999997, -195.9, -308.59999999999997, -165) }),
      fixed('gust', 45, -10, 12, 3.8, { poly: rectangle(-302.59999999999997, -216, -280.4, -188) }),
      fixed('torn', 90, -8, 9.6, 3.8, { poly: rectangle(-380.59999999999997, -216, -302.59999999999997, -188) }),
      fixed('wall', 26, -3, 9.4, 1.6, { poly: rectangle(-437.09999999999997, -214.05, -417.59999999999997, -205) }),
      fixed('span', 0, -7, 9.4, 3.6, { poly: rectangle(-469.59999999999997, -320, -437.09999999999997, -231) }),
      track('gate', { poly: rectangle(-455.59999999999997, -231, -437.09999999999997, -214.05) }, [
        [-444.59999999999997, -214, -88, -9, 8.4, 3.2],
        [-444.59999999999997, -216, -76, -9, 8.4, 3.2],
        [-444.59999999999997, -218, -60, -9, 8.4, 3.2],
        [-444.59999999999997, -220, -42, -9, 8.4, 3.2],
        [-444.59999999999997, -222, -20, -9, 8.4, 3.2],
        [-444.59999999999997, -223.5, 0, -9, 8.4, 3.2],
      ]),
      fixed('ascent', 90, -7, 8.8, 3.2),
    ],
  },
  ch4_temple: {
    sightMeshes: "^t_(side|floor|plaster|stone|step|boulder|tile|hwall|hfloor|ceiling)_a",
    zones: [
      fixed('gate_rock', 42, -13, 9, 3.4, { poly: rectangle(-8, -80, 8, -58) }),
      fixed('foot', 0, -12, 9, 3, { poly: rectangle(10, -60, 50, -30) }),
      fixed('t1', 6, -13, 9.5, 3.4, { poly: rectangle(10, -92, 50, -60) }),
      fixed('t2', -6, -15, 10, 4, { poly: rectangle(10, -120, 50, -92) }),
      fixed('t3', 4, -12, 9.5, 3, { poly: rectangle(10, -144.2, 50, -120) }),
      fixed('fore', 0, -17, 9.5, 4.8, { poly: rectangle(10, -170, 50, -144.2) }),
      fixed('c1', 0, -19, 9.5, 5, { poly: rectangle(10, -200, 50, -170) }),
      fixed('dock', -10, -11, 10.5, 3.6, { poly: rectangle(14, -236, 46, -200) }),
      fixed('mid', -28, -13, 10.5, 4, { poly: rectangle(14, -275, 38.4, -236) }),
      fixed('stones', -62, -12, 11, 4, { poly: rectangle(38.4, -275, 68, -245) }),
      fixed('shelf', 8, -11, 10.5, 3.8, { poly: rectangle(92.1, -300, 130, -270), yMax: 37 }),
      fixed('far', 0, -3, 11, 2, { poly: rectangle(68, -270, 96, -245), yMax: 32 }),
      fixed('cars', 0, -8, 11, 3, { poly: rectangle(66, -274, 92.1, -270) }),
      fixed('top_fight', 0, -15, 10, 4.2, { fight: "top_guard", poly: rectangle(66, -292, 92, -274), yMin: 37 }),
      fixed('top', 0, -15, 10, 4.2, { poly: rectangle(60, -300, 96, -274), yMin: 37 }),
      fixed('p6', 0, -14, 9.5, 3.8, { poly: rectangle(60, -318, 96, -300) }),
      fixed('c2', 12, -19, 10, 5.2, { poly: rectangle(62, -350, 100, -318) }),
      fixed('yard', 68, -8, 9.5, 2.6, { poly: rectangle(44.1, -350, 62, -312) }),
      fixed('r1', 78, -14, 10, 4, { poly: rectangle(19, -346, 44.1, -316) }),
      fixed('cap', 150, -14, 9, 3.8, { poly: rectangle(0, -322, 19, -304) }),
      fixed('r2', 14, -9, 10.5, 2.8, { poly: rectangle(-4, -347, 19, -322) }),
      fixed('r3', 0, -17, 11.5, 5.2, { poly: rectangle(-6, -376, 24.1, -347) }),
      fixed('e8', 0, -12, 10.5, 3.6, { poly: rectangle(24.1, -394, 46, -350) }),
      fixed('f8', 0, -12, 9.5, 3.4, { poly: rectangle(14, -416, 46, -394) }),
      fixed('gc_fight', 0, -18, 18, 9, { fight: "great", poly: rectangle(8, -452, 52, -416) }),
      fixed('gc', 0, -27, 10, 8, { poly: rectangle(8, -452, 52, -416) }),
      fixed('hall', 0, -9, 8.6, 2.8, { poly: rectangle(8, -508, 52, -452) }),
      fixed('dais_bell', 28, -7, 8.6, 2.8, { poly: rectangle(16, -526, 44, -513) }),
      fixed('dais', 0, -6, 8.6, 2.6),
    ],
  },
  ch5_sea: {
    sightMeshes: "^(arches|pads_side|pads_top|pads_wet|shoulders|rim_boulders|monoliths|stairs|court_wall|road_rock|road_steps)",
    zones: [
      fixed('on_raft', -14, -47, 7.5, 9.5, { ride: "raft", blend: 5 }),
      fixed('on_boat1', 8, -47, 8, 10, { ride: "boat1", blend: 5 }),
      fixed('on_grey', 82, -47, 8, 10, { ride: "grey", blend: 5 }),
      fixed('on_barge', -80, -47, 8.5, 10.5, { ride: "barge", blend: 5 }),
      fixed('raft', -14, -47, 7.5, 9.5, { air: true, blend: 5, poly: rectangle(14, -217.4, 54, -207), yMax: 5.2 }),
      fixed('corridor', 14, -13, 9.2, 4, { poly: rectangle(2, -196, 22, -166) }),
      fixed('scroll_top', 32, -12, 9, 3.6, { poly: rectangle(4, -168, 22, -150) }),
      fixed('shore', 6, -9, 8.4, 3, { poly: rectangle(8, -90, 56, -50) }),
      fixed('flat1', 5, -11, 9, 3.4, { poly: rectangle(14, -119, 56, -90) }),
      fixed('r1', -6, -13, 9.5, 4, { poly: rectangle(14, -139, 56, -119) }),
      fixed('stones1', 3, -18, 11, 5.2, { poly: rectangle(22, -162, 50, -139) }),
      fixed('stones2', -2, -18, 11, 5.2, { poly: rectangle(22, -187, 50, -162) }),
      fixed('r2', 4, -10, 9, 3.4, { poly: rectangle(14, -207, 54, -187) }),
      fixed('r3', 10, -11, 9, 3.6, { poly: rectangle(14, -241, 54, -207), yMin: 5.2 }),
      fixed('dock4', 8, -10, 9, 3.4, { poly: rectangle(20, -262, 50, -241) }),
      fixed('boat1', 8, -47, 8, 10, { air: true, blend: 5, poly: rectangle(20, -294, 50, -262) }),
      fixed('grey', 82, -9, 11, 3.6, { poly: rectangle(-24, -316, 24, -292) }),
      fixed('m4', -44, -11, 9.6, 3.8, { poly: rectangle(24, -314, 45, -294) }),
      fixed('ferries', -74, -15, 12, 5, { poly: rectangle(45, -334, 75, -296) }),
      fixed('i5', -12, -11, 9.6, 3.8, { poly: rectangle(75, -333, 100, -312) }),
      fixed('veils', 6, -7, 8.8, 2.6, { poly: rectangle(74, -379, 98, -333) }),
      fixed('i6', -42, -11, 9.6, 3.8, { poly: rectangle(70, -402, 98, -379) }),
      track('across_fight', { fight: "across", poly: rectangle(102, -408, 148, -384) }, [
        [141, -389, -30, -28, 21, 11.5],
        [139, -395.5, -30, -28, 21, 11.5],
        [139, -401, 25, -24, 16, 8],
        [118, -403, 35, -22, 14, 7],
        [104, -403, 40, -22, 14, 7],
      ]),
      fixed('row', -85, -13, 11.5, 4.6, { poly: rectangle(98, -399.2, 148, -380), yMax: 5.2 }),
      fixed('archers', 80, -15, 9.4, 4, { poly: rectangle(98, -408, 148, -398) }),
      fixed('causeway', 4, -13, 10.4, 4.4, { poly: rectangle(110, -464, 140, -408) }),
      fixed('i9', 3, -10, 9, 3.4, { poly: rectangle(110, -486, 140, -464) }),
      fixed('court', 0, -29, 9.5, 6.8, { poly: rectangle(108, -512, 142, -486) }),
      fixed('gap', 4, -9, 9.4, 3.2, { poly: rectangle(108, -539, 133, -512) }),
      fixed('barge', -80, -10, 12, 4.2, { poly: rectangle(133, -546, 183, -514) }),
      fixed('gw', -8, -10, 9.4, 3.6, { poly: rectangle(183, -538, 210, -520) }),
      fixed('gate', 3, -4, 9.4, 2.1, { poly: rectangle(180, -577, 204, -538) }),
      fixed('end', 3, -7, 9, 2.8),
    ],
  },
  ch6_summit: {
    sightMeshes: "^(rock|snow|stone|ice)_",
    twoSided: true,
    zones: [
      track('z_end', { poly: rectangle(-302, -364, -259, -336) }, [
        [-262, -350, 90, -13, 8.6, 3.2],
        [-276, -350, 82, -8, 9, 2.8],
        [-292, -350, 60, -3, 9.5, 1.8],
      ]),
      fixed('z_duel', 90, -17, 10, 4.2, { poly: rectangle(-262, -372, -224, -328) }),
      fixed('z_a11b', 90, -11, 8.6, 3.1, { poly: rectangle(-224, -368, -196, -332) }),
      fixed('z_a11', 86, -7, 8.6, 2.8, { poly: rectangle(-196, -368, -156, -332) }),
      track('z_gaunt_fight', { fight: "gauntlet", poly: rectangle(-156, -372, -105, -332) }, [
        [-108, -350, 90, -20, 9, 5],
        [-116, -350, 90, -20, 9.5, 5.2],
        [-126, -350, 90, -24, 17, 8.5],
        [-134, -350, 90, -29, 22, 12.5],
        [-156, -350, 90, -29, 22, 12.5],
      ]),
      fixed('z_gaunt', 90, -17, 9.4, 4.2, { poly: rectangle(-156, -372, -105, -332) }),
      fixed('z_lift_top', 42, -11, 8.8, 3.2, { poly: rectangle(-105, -364, -78, -334.9) }),
      fixed('z_lift', 28, -5, 9.5, 2.6, { poly: rectangle(-98, -334.9, -78, -310) }),
      fixed('z_a8', 84, -12, 9, 3.4, { poly: rectangle(-78, -340, -34, -305) }),
      fixed('z_a7', 82, -10, 8.6, 3, { poly: rectangle(-34, -340, 18, -305) }),
      fixed('z_a7a', 50, -11, 8.6, 3.2, { poly: rectangle(18, -340, 44, -317) }),
      fixed('z_fall', 2, 6, 10, 1.1, { poly: rectangle(18, -317, 44, -303) }),
      fixed('z_cairn', 0, -17, 9.2, 4.2, { poly: rectangle(16, -303, 46, -277) }),
      fixed('z_a4_end', 4, -12, 8.4, 3.2, { poly: rectangle(16, -277, 46, -262) }),
      fixed('z_a4', 9, -13, 8.6, 3.4, { poly: rectangle(10, -262, 46, -197) }),
      fixed('z_a3', 7, -11, 9, 3.2, { poly: rectangle(16, -197, 46, -158) }),
      fixed('z_a2b', -3, -4, 9.4, 2.3, { poly: rectangle(16, -158, 46, -136.1) }),
      fixed('z_a2', 0, -6, 9.4, 2.5, { poly: rectangle(16, -136.1, 46, -118) }),
      fixed('z_a1_wall', -5, -11, 8.4, 3.2, { poly: rectangle(33.4, -118, 41, -70) }),
      fixed('z_a1', 9, -11, 8.4, 3.2),
    ],
  },
} satisfies Record<string, ChapterCameraDefinition>;
export type LaterCameraChapter = keyof typeof laterChapterCameraDefinitions;
