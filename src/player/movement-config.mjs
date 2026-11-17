/**
 * Movement tuning constants recovered from the shipped Sumiro player chunk.
 * These values are intentionally mutable for legacy runtime compatibility;
 * change parameters only with new game-design tests, not as recovery cleanup.
 */
export const movementConfig = {
  walk: 1.6, jog: 3.5, run: 6.5, sprint: 8,
  stairsUp: 4.7, stairsDown: 5.4,
  accelStart: 22, accel: 11, accelSprint: 3.5, decel: 28,
  grip: 26, turnSlow: 20, turnFast: 13,
  turn180From: 4.8, turnRate: 1.8, guardBrake: 34,
  gravity: 24, jumpHeight: 1.3, jumpCut: .45,
  coyote: .1, buffer: .15, inkBuffer: .2,
  airAccel: 8, airMin: 2.5,
  leapGravity: 18, leapMaxSpeed: 9.6, shimmyRate: 2.75,
  stepUp: .5, stepDown: .6, safeDrop: 3,
  radius: .3, height: 1.7, heavyFall: 7,
  dodgeSpeed: 11, dashSpeed: 15, dashCarry: 6.5,
  inkRecharge: 1.3, inkGuard: .36, assistReach: 1.5,
  stride: {walk: 1.2, jog: 2.6, run: 3, sprint: 3.2, run_stairs: 2},
};
