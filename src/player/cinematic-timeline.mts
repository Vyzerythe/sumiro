/**
 * Recovered pure timing logic for Sumiro's scripted player sequence.
 *
 * Reference: published player-1_KrBWnI.js. This is a compatible reconstruction,
 * not the original authoring project. Preserve boundary and extrapolation behavior.
 */
export type HeadingKey = readonly [frame: number, degrees: number];
export type HeadingCurve = readonly [first: HeadingKey, ...rest: HeadingKey[]];

export const headingKeys: HeadingCurve = [
  [0,0],[207,0],[216,-4],[228,-6],[229,-8],[232,-30],[236,-34],[238,-50],[241,-75],[244,-85],
  [254,-96],[262,-100],[265,-98],[267,-70],[269,-26],[271,0],[296,0],[303,-14],[308,-32],[336,-32],[352,0],[360,0],
];

export const runFrameKeys: readonly number[] = [-13,1,14,28,43,57,72,86,100,114,128,143,157,169,183,197];
export const jogFrameKeys: readonly number[] = [263,270,277,284,290,296,303];

/** Piecewise-linear interpolation, with clamped end values. */
export function interpolateHeading(keys: HeadingCurve, frame: number): number {
  if (frame <= keys[0][0]) return keys[0][1];
  for (let index = 1; index < keys.length; index++) {
    if (frame <= keys[index]![0]) {
      const fraction = (frame - keys[index - 1]![0]) /
        (keys[index]![0] - keys[index - 1]![0]);
      return keys[index - 1]![1] + (keys[index]![1] - keys[index - 1]![1]) * fraction;
    }
  }
  return keys[keys.length - 1]![1];
}

/** Map the scripted motion frame to the animation's running phase. */
export function runAnimationFrame(frame: number): number {
  let i = 0;
  for (; i < runFrameKeys.length - 2 && frame > runFrameKeys[i + 1]!;) i++;
  const start = runFrameKeys[i]!, end = runFrameKeys[i + 1]!;
  return 11.5 + (i + (frame-start)/(end-start))*14;
}

/** Map a scripted plateau segment to the jogging animation's frame. */
export function jogAnimationFrame(frame: number): number {
  let i = 0;
  for (; i < jogFrameKeys.length - 2 && frame > jogFrameKeys[i + 1]!;) i++;
  const start = jogFrameKeys[i]!, end = jogFrameKeys[i + 1]!;
  return -3 + (i + (frame-start)/(end-start))*7;
}

/** Published scripted sequence state classification. */
export function timelineState(frame: number) {
  return frame < 78 ? 'RUN'
    : frame < 116 ? 'RUN_BRIDGE'
    : frame < 165 ? 'STAIR_RUN'
    : frame < 187 ? 'RUN_PAD'
    : frame < 203 ? 'LEAP_PREP'
    : frame < 212 ? 'LEAP'
    : frame < 216 ? 'GRAB'
    : frame < 229 ? 'HANG'
    : frame < 236 ? 'PRESS'
    : frame < 246 ? 'MANTLE'
    : frame < 250 ? 'CROUCH'
    : frame < 256 ? 'RISE'
    : frame < 266 ? 'STAND_BEAT'
    : frame < 270 ? 'PIVOT'
    : frame < 292 ? 'PLATEAU_RUN'
    : frame < 303 ? 'POOL_ARRIVE'
    : frame < 360 ? 'POOL_STAND'
    : 'FREE_IDLE';
}

export function timelineSurface(frame: number) {
  return frame < 78 ? 'stone'
    : frame < 116 ? 'wood'
    : frame < 165 ? 'stair'
    : frame < 203 ? 'rock'
    : frame < 290 ? 'ink-rock'
    : 'ink';
}
