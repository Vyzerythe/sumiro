export class FixedStepClock {
  readonly hz: number;
  readonly videoFps: number;
  readonly fixedDt: number;
  step = 0;
  t = 0;
  dt = 0;
  alpha = 1;

  constructor(hz: number, videoFps: number) {
    if (![hz, videoFps].every(rate => Number.isFinite(rate) && rate > 0)) {
      throw RangeError('Clock rates must be positive and finite');
    }
    this.hz = hz;
    this.videoFps = videoFps;
    this.fixedDt = 1 / hz;
  }

  now(): number {
    return this.t;
  }

  get frame(): number {
    return Math.round(this.t * this.videoFps);
  }

  advance(): void {
    this.step++;
    this.t = this.step * this.fixedDt;
    this.dt = this.fixedDt;
  }
}

/** A consumer-local delta over simulation time. */
export class SimulationTimeReader {
  readonly time: Pick<FixedStepClock, 't'>;
  last = 0;
  running = true;

  constructor(time: Pick<FixedStepClock, 't'>) {
    this.time = time;
  }

  get elapsedTime(): number {
    return this.time.t;
  }

  getElapsedTime(): number {
    return this.elapsedTime;
  }

  getDelta(): number {
    const current = this.elapsedTime;
    const delta = current - this.last;
    this.last = current;
    return delta;
  }
}
