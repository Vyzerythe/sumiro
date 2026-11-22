export interface StrokePool {
  readonly strokes: number;
  hurt(amount: number): number;
}

export interface RunVitalsSnapshot {
  readonly strokes: number;
  readonly maxStrokes: number;
  readonly drinks: number;
  readonly maxDrinks: number;
}

const BASE_STROKES = 5;
const GOURD_CAPACITY = 3;
const DRINK_RESTORE = 2;
const DRINK_HEAL_TIME = 1.1;

/** Runtime-only health and gourd charges, shared across combat and traversal. */
export function createRunVitals() {
  let maxStrokes = BASE_STROKES;
  let strokes = maxStrokes;
  let drinks = GOURD_CAPACITY;
  let drinking: { elapsed: number; duration: number; healed: boolean } | null = null;

  function updateCapacity(scrolls: number, assist: boolean) {
    const capacity = BASE_STROKES + Math.floor(scrolls / 3) + (assist ? 2 : 0);
    strokes = Math.min(capacity, strokes + Math.max(0, capacity - maxStrokes));
    maxStrokes = capacity;
  }

  return {
    get strokes() { return strokes; },
    get drinking(): Readonly<NonNullable<typeof drinking>> | null { return drinking; },
    snapshot(): RunVitalsSnapshot { return { strokes, maxStrokes, drinks, maxDrinks: GOURD_CAPACITY }; },
    hurt(amount: number) {
      if (!Number.isFinite(amount) || amount < 0) throw RangeError('Damage must be finite and nonnegative');
      if (amount > 0) drinking = null;
      strokes = Math.max(0, strokes - amount);
      return strokes;
    },
    updateCapacity,
    refill(scrolls: number, assist: boolean) {
      updateCapacity(scrolls, assist);
      strokes = maxStrokes;
      drinks = GOURD_CAPACITY;
      drinking = null;
    },
    beginDrink(duration: number) {
      if (!Number.isFinite(duration) || duration < DRINK_HEAL_TIME) throw RangeError('Drink clip must reach the healing cue');
      if (drinking || strokes === 0 || strokes >= maxStrokes || drinks <= 0) return false;
      drinks--;
      drinking = { elapsed: 0, duration, healed: false };
      return true;
    },
    step(delta: number) {
      if (!Number.isFinite(delta) || delta < 0) throw RangeError('Vitals time must be finite and nonnegative');
      if (!drinking) return;
      drinking.elapsed += delta;
      if (!drinking.healed && drinking.elapsed >= DRINK_HEAL_TIME) {
        strokes = Math.min(maxStrokes, strokes + DRINK_RESTORE);
        drinking.healed = true;
      }
      if (drinking.elapsed >= drinking.duration) drinking = null;
    },
  };
}
