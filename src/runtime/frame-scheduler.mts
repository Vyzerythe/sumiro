export interface FrameSchedulerOptions {
  fixedDt: number;
  maxFrameDt: number;
  maxStepsPerFrame: number;
}

export interface FrameAdmission {
  admitted: boolean;
  paused: boolean;
}

export interface FrameDecision {
  /** When paused, these are input/update passes without clock advancement. */
  steps: number;
  render: boolean;
  alpha: number;
  paused: boolean;
}

const CADENCE_SAMPLES = 30;
const CADENCE_MARGIN = 1.02;
const TICK_EPSILON = 1e-9;

/** Schedules live work independently of the renderer and the simulation clock. */
export class FrameScheduler {
  readonly #fixedDt: number;
  readonly #maxFrameDt: number;
  readonly #maxStepsPerFrame: number;
  readonly #intervals: number[] = [];
  #lastTimestamp: number | undefined;
  #lastAdmittedTimestamp: number | undefined;
  #cadence = 1;
  #admittedFrames = 0;
  #tickRemainder = 0;
  #paused = false;
  #pausedRendered = false;

  constructor({ fixedDt, maxFrameDt, maxStepsPerFrame }: FrameSchedulerOptions) {
    if (!Number.isFinite(fixedDt) || !(fixedDt > 0 && maxFrameDt > 0) ||
      !Number.isSafeInteger(Math.ceil(maxFrameDt / fixedDt)) ||
      !Number.isSafeInteger(maxStepsPerFrame) || maxStepsPerFrame < 1) {
      throw new RangeError('Frame scheduler requires positive finite timing and a positive integer step limit');
    }
    this.#fixedDt = fixedDt;
    this.#maxFrameDt = maxFrameDt;
    this.#maxStepsPerFrame = maxStepsPerFrame;
  }

  reset(): void {
    this.#intervals.length = 0;
    this.#lastTimestamp = undefined;
    this.#lastAdmittedTimestamp = undefined;
    this.#cadence = 1;
    this.#admittedFrames = 0;
    this.#tickRemainder = 0;
    this.#paused = false;
    this.#pausedRendered = false;
  }

  invalidatePausedFrame(): void {
    this.#pausedRendered = false;
  }

  schedule(timestampMs: number, { admitted, paused }: FrameAdmission): FrameDecision {
    if (!Number.isFinite(timestampMs)) return this.#idle(paused);
    if (this.#lastTimestamp !== undefined && timestampMs < this.#lastTimestamp) this.reset();
    if (this.#lastTimestamp === undefined || this.#lastAdmittedTimestamp === undefined) {
      this.#lastTimestamp = this.#lastAdmittedTimestamp = timestampMs;
      this.#paused = paused;
      return this.#idle(paused);
    }

    const intervalMs = timestampMs - this.#lastTimestamp;
    this.#lastTimestamp = timestampMs;
    if (intervalMs > 0 && Number.isFinite(intervalMs)) this.#recordInterval(intervalMs);

    if (paused !== this.#paused) {
      // Neither a paused gap nor the fractional tick from the preceding mode carries over.
      this.#paused = paused;
      this.#pausedRendered = false;
      this.#lastAdmittedTimestamp = timestampMs;
      this.#tickRemainder = 0;
    }
    if (!admitted || ++this.#admittedFrames < this.#cadence) return this.#idle(paused);
    this.#admittedFrames = 0;

    const elapsed = Math.min((timestampMs - this.#lastAdmittedTimestamp) / 1000, this.#maxFrameDt);
    this.#lastAdmittedTimestamp = timestampMs;
    // As in the original loop, advance to the first tick at or beyond the frame time.
    // Discard work beyond the cap while retaining the fractional interpolation phase.
    const pendingTicks = this.#tickRemainder + elapsed / this.#fixedDt;
    const ticksDue = Math.max(0, Math.ceil(pendingTicks - TICK_EPSILON));
    this.#tickRemainder = Math.min(0, pendingTicks - ticksDue);
    const render = !paused || !this.#pausedRendered;
    if (paused) this.#pausedRendered = true;
    return {
      steps: Math.min(ticksDue, this.#maxStepsPerFrame),
      render,
      alpha: this.#alpha(paused),
      paused,
    };
  }

  #recordInterval(intervalMs: number): void {
    this.#intervals.push(intervalMs);
    if (this.#intervals.length < CADENCE_SAMPLES) return;
    this.#intervals.sort((a, b) => a - b);
    const medianMs = this.#intervals[CADENCE_SAMPLES / 2]!;
    const cadence = Math.floor(this.#fixedDt * 1000 * CADENCE_MARGIN / medianMs);
    this.#cadence = Math.max(1, Number.isSafeInteger(cadence) ? cadence : 1);
    this.#intervals.length = 0;
  }

  #alpha(paused: boolean): number {
    return paused ? 1 : 1 + this.#tickRemainder;
  }

  #idle(paused: boolean): FrameDecision {
    return { steps: 0, render: false, alpha: this.#alpha(paused), paused };
  }
}
