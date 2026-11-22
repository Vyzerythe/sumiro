interface Waiter {
  remaining: number;
  finish(): void;
}

interface Wash {
  from: number;
  target: number;
  duration: number;
  elapsed: number;
  finish(): void;
}

/** Presentation time advances only when the owning HUD receives a tick. */
export function createHudTimeline() {
  let opacity = 0;
  let activeWash: Wash | undefined;
  let disposed = false;
  const waits: Waiter[] = [];

  return {
    get opacity() { return opacity; },
    wash(target: number, duration: number): Promise<void> {
      if (disposed) return Promise.resolve();
      activeWash?.finish();
      return new Promise(finish => {
        activeWash = { from: opacity, target, duration, elapsed: 0, finish };
      });
    },
    wait(seconds: number): Promise<void> {
      if (disposed) return Promise.resolve();
      return new Promise(finish => { waits.push({ remaining: seconds, finish }); });
    },
    advance(seconds: number) {
      if (disposed || !Number.isFinite(seconds) || seconds <= 0) return;
      const wash = activeWash;
      if (wash) {
        wash.elapsed += seconds;
        const ratio = wash.duration > 0 ? Math.min(wash.elapsed / wash.duration, 1) : 1;
        const eased = ratio * ratio * (3 - 2 * ratio);
        opacity = wash.from + (wash.target - wash.from) * eased;
        if (ratio >= 1) {
          activeWash = undefined;
          wash.finish();
        }
      }
      for (let index = waits.length - 1; index >= 0; index--) {
        const waiter = waits[index]!;
        waiter.remaining -= seconds;
        if (waiter.remaining <= 0) {
          waits.splice(index, 1);
          waiter.finish();
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const wash = activeWash;
      activeWash = undefined;
      wash?.finish();
      for (const waiter of waits.splice(0)) waiter.finish();
    },
  };
}
