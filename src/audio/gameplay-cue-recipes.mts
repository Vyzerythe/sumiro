/** Live effects dispatch B / J and cue trims en from the published audio bundle. */
export interface GameplayCueOptions {
  signal?: AbortSignal;
  pitch?: number;
  gain?: number;
  tail?: number;
}

export interface CueFilter {
  type: BiquadFilterType;
  frequency: number;
  q?: number;
  gain?: number;
}

interface ToneOptions { endFrequency?: number; sweep?: number; attack?: number; duration?: number }
interface BurstOptions { attack?: number; duration?: number }
interface SweepOptions { from: number; peak: number; to: number; seconds: number; db: number; q: number }
export type CueOffset = number | readonly number[];
export interface CueSynth {
  random(): number;
  tone(at: CueOffset, frequency: number, db: number, decay: number, options?: ToneOptions): void;
  burst(at: CueOffset, db: number, decay: number, filters: readonly CueFilter[], options?: BurstOptions): void;
  rustle(at: number, db: number, shape: readonly [attack: number, hold: number, decay: number],
    filters: readonly CueFilter[], flutterHz?: number): void;
  sweepNoise(at: number, options: SweepOptions): void;
}

type Recipe = (synth: CueSynth, options: GameplayCueOptions) => void;
const bandpass = (frequency: number, q: number): CueFilter => ({ type: 'bandpass', frequency, q });
const highpass = (frequency: number): CueFilter => ({ type: 'highpass', frequency });
const lowpass = (frequency: number): CueFilter => ({ type: 'lowpass', frequency });

function swordHit(s: CueSynth) {
  s.burst(0,-10,.03,[bandpass(1900,.8)],{ attack: .001 });
  s.tone(0,150,-22,.06,{ endFrequency: 70, sweep: .08, attack: .002 });
  s.rustle(.02,-22,[.01,.02,.16],[bandpass(800,.7)],30);
}

const bellPartials = [
  [1,-22,3.2], [1.504,-28,2.6], [1.997,-25,2.2],
  [2.69,-31,1.5], [3.76,-36,.9], [5.42,-42,.5],
] as const;

export const gameplayCueRecipes = {
  swordDraw(s) {
    s.rustle(0,-24,[.04,.04,.12],[highpass(3200),bandpass(6000,1.4)]);
    s.tone(.09,2900,-46,.1,{ endFrequency: 3400, sweep: .05, attack: .002 });
  },
  swordSwing(s) {
    const pitch = .86 + s.random() * .28;
    s.sweepNoise(0,{ from: 900 * pitch, peak: 2700 * pitch, to: 1200 * pitch, seconds: .17, db: -14, q: 1.3 });
    s.tone(0,420 * pitch,-38,.05,{ endFrequency: 240 * pitch, sweep: .1, attack: .008 });
  },
  swordSwingHeavy(s) {
    const pitch = .9 + s.random() * .2;
    s.sweepNoise(0,{ from: 480 * pitch, peak: 1700 * pitch, to: 620 * pitch, seconds: .27, db: -11, q: 1 });
    s.tone(0,300 * pitch,-34,.08,{ endFrequency: 130 * pitch, sweep: .16, attack: .01 });
  },
  swordHit,
  swordHitHeavy(s) {
    swordHit(s);
    s.tone(0,92,-18,.14,{ endFrequency: 46, sweep: .14, attack: .002 });
  },
  parry(s) {
    s.burst(0,-15,.006,[highpass(2800)],{ attack: .0005 });
    s.tone(0,190,-26,.05,{ endFrequency: 110, sweep: .05 });
  },
  wraithBeat(s) {
    s.tone(0,74,-20,.1,{ endFrequency: 52, sweep: .1, attack: .004 });
    s.rustle(0,-28,[.2,.25,.2],[lowpass(900)]);
  },
  wraithCut(s) {
    s.rustle(0,-14,[.03,.02,.12],[bandpass(800,.9)]);
  },
  roninCut(s) {
    s.rustle(0,-13,[.018,.015,.09],[bandpass(1800,1)]);
    s.tone(0,600,-36,.05,{ endFrequency: 220, sweep: .08, attack: .004 });
  },
  roninSlam(s) {
    s.tone(0,86,-16,.2,{ endFrequency: 38, sweep: .2, attack: .002 });
    s.burst(0,-14,.08,[bandpass(600,.7)]);
  },
  roninSheath(s) {
    s.tone(0,3100,-40,.25,{ endFrequency: 2800, sweep: .2, attack: .002 });
    s.burst(0,-34 + 12,.0018,[bandpass(5000 + s.random() * 7000,1)],{ duration: .006 });
    s.rustle(0,-30,[.25,.3,.2],[highpass(3000)]);
  },
  roninPhase(s) {
    s.tone(0,55,-18,1,{ endFrequency: 41, sweep: 1.6, attack: .1, duration: 2.6 });
    s.rustle(0,-24,[.5,.4,.8],[lowpass(1200)]);
  },
  inkDissolve(s) {
    s.rustle(0,-18,[.15,.25,.8],[lowpass(1400)]);
    for (const at of [.2,.45,.7,.95]) s.tone(at,420 + s.random() * 300,-44,.03,{ endFrequency: 900, sweep: .05, attack: .002 });
  },
  inkRise(s) {
    s.rustle(0,-18,[.4,.2,.3],[lowpass(900)],14);
    s.tone(0,60,-26,.5,{ endFrequency: 92, sweep: .8, attack: .1, duration: 1.2 });
  },
  bowDraw(s) {
    for (let note = 0; note < 8; note++) s.tone([.1, note * .1],300 + note * 40,-44 + note,.02,{ attack: .002 });
  },
  arrowLoose(s) {
    s.tone(0,260,-26,.05,{ endFrequency: 120, sweep: .05 });
    s.rustle(0,-20,[.01,.02,.16],[bandpass(2600,1)]);
  },
  combatWarn(s) {
    for (const at of [0,.14]) {
      s.tone(at,1180,-22,.05);
      s.burst(at,-18,.008,[bandpass(2400,2)]);
    }
  },
  drink(s) {
    for (const at of [.4,.72,1.04]) s.tone(at,210,-34,.05,{ endFrequency: 340, sweep: .08, attack: .012 });
  },
  bell(s, { pitch = 1, gain = 0, tail = 1 }) {
    const fundamental = 196 * pitch;
    for (const [multiple, db, decay] of bellPartials) {
      const frequency = fundamental * multiple;
      s.tone(0,frequency,db + gain,decay * tail,{ attack: .004 });
      s.tone(0,frequency * 1.0045,db - 5 + gain,decay * tail * .9,{ attack: .004 });
    }
    s.burst(0,-30 + gain + 12,.012,[bandpass(1400,.8)],{ duration: .05 });
    s.tone(0,98 * pitch,-30 + gain,1.2 * tail,{ attack: .03 });
  },
  bladeOnBell(s) {
    s.burst(0,-24,.004,[highpass(2400)],{ attack: .0005, duration: .02 });
    for (const [frequency, db, decay] of [[3150,-28,.1],[4720,-32,.07],[6830,-38,.04]] as const) s.tone(0,frequency,db,decay);
  },
  crumble(s) {
    s.burst(0,-18,.03,[bandpass(700,.7)]);
    s.burst(.14,-24,.04,[bandpass(1100,.7)]);
    s.rustle(0,-28,[.05,.25,.3],[bandpass(2200,.6)],26);
    s.tone(.05,92,-28,.1,{ endFrequency: 70, sweep: .2, attack: .004, duration: .4 });
  },
  crumbleFall(s) {
    s.rustle(0,-18,[.02,.18,.8],[bandpass(520,.6)],22);
    s.tone(0,76,-24,.25,{ endFrequency: 44, sweep: .3, attack: .008 });
    for (let index = 0; index < 8; index++) {
      const at = [.08, index * .13, s.random() * .07];
      const db = -30 - index * 2.6;
      const frequency = (1050 - index * 70) * (.8 + s.random() * .4);
      s.burst(at,db + 12,.012,[bandpass(frequency,1.1)]);
      s.tone(at,frequency * .2,db - 2,.03,{ endFrequency: frequency * .13, sweep: .03 });
    }
  },
  door(s) {
    s.tone(0,72,-26,.5,{ endFrequency: 60, sweep: .7, attack: .05, duration: 1 });
    s.rustle(0,-24,[.08,.45,.3],[bandpass(460,.6)],16);
  },
  tipKnock(s) {
    s.tone(0,118,-28,.05,{ endFrequency: 80, sweep: .05 });
    s.rustle(.02,-32,[.03,.12,.2],[bandpass(1100,.7)],22);
  },
  stoneStop(s) {
    s.tone(0,84,-25,.09,{ endFrequency: 54, sweep: .08 });
    s.burst(0,-24,.02,[bandpass(520,.7)]);
  },
  inkStep(s) {
    s.rustle(0,-14,[.015,.05,.28],[bandpass(1400,.6),{ type: 'lowshelf', frequency: 400, gain: 6 }],26);
    s.tone(0,240,-26,.1,{ endFrequency: 60, sweep: .2, attack: .004 });
    s.tone(.02,1800,-46,.05,{ endFrequency: 700, sweep: .12 });
  },
} satisfies Record<string, Recipe>;

export type GameplayCue = keyof typeof gameplayCueRecipes;
export const gameplayCueTrims: Partial<Record<GameplayCue, number>> = {
  bell: -15.12, bladeOnBell: -15.12,
  swordDraw: -6.02, swordSwing: -6.02, swordSwingHeavy: -6.02, wraithCut: -6.02, roninCut: -6.02,
  arrowLoose: -6.02, inkStep: -6.02,
};

export function isGameplayCue(name: string): name is GameplayCue {
  return Object.hasOwn(gameplayCueRecipes, name);
}

export function scheduleGameplayCue(cue: GameplayCue, synth: CueSynth, options: GameplayCueOptions): void {
  gameplayCueRecipes[cue](synth, options);
}
