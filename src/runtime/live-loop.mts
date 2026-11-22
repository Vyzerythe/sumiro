import { FrameScheduler, type FrameSchedulerOptions } from './frame-scheduler.mts';

type FrameCallback = (timestampMs: number) => void;

interface FrameSource {
  request(callback: FrameCallback): number;
  cancel(handle: number): void;
}

interface LiveLoopOptions extends FrameSchedulerOptions {
  isPaused(): boolean;
  canSubmitFrame(): boolean;
  beforeStep(): void;
  step(): void;
  render(alpha: number): void;
  afterRender(timestampMs: number): void;
}

const browserFrames: FrameSource = {
  request: callback => requestAnimationFrame(callback),
  cancel: handle => cancelAnimationFrame(handle),
};

/** Drives simulation and rendering from one cancellable frame subscription. */
export function startLiveLoop(options: LiveLoopOptions, frames: FrameSource = browserFrames) {
  const scheduler = new FrameScheduler(options);
  let pausedRendered = false;
  let stopped = false;
  let handle = frames.request(tick);

  function stop() {
    if (stopped) return;
    stopped = true;
    frames.cancel(handle);
  }

  function tick(timestampMs: number) {
    if (stopped) return;
    handle = frames.request(tick);
    try {
      const frame = scheduler.schedule(timestampMs, {
        admitted: options.canSubmitFrame(),
        paused: options.isPaused(),
      });
      for (let index = 0; index < frame.steps && !stopped; index++) {
        options.beforeStep();
        if (!stopped) options.step();
      }
      if (stopped) return;

      const paused = options.isPaused();
      const resumedInStep = frame.paused && !paused && frame.steps > 0;
      if (!frame.render && !resumedInStep) return;
      if (paused && pausedRendered) return;
      pausedRendered = paused;
      options.render(paused ? 1 : frame.alpha);
      if (!stopped) options.afterRender(timestampMs);
    } catch (error) {
      stop();
      throw error;
    }
  }

  return {
    invalidate() {
      pausedRendered = false;
      scheduler.invalidatePausedFrame();
    },
    stop,
  };
}
