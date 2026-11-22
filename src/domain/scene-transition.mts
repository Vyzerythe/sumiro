export type SceneDestination = 'PLAY' | 'TITLE' | 'CREDITS';

interface TransitionState {
  covering: boolean;
}

interface TransitionEffects<Card> {
  closeMenu(): void;
  begin(): void;
  wash(opacity: number, seconds: number): Promise<void>;
  setPaused(paused: boolean): void;
  setDucked(ducked: boolean): void;
  showClosing(text: string): void;
  hideClosing(): void;
  showCard(card: Card): void;
  hideCard(): void;
  wait(seconds: number): Promise<void>;
  now(): number;
  recoverToTitle(error: unknown): Promise<void>;
  synchronize(): void;
  arrive(destination: SceneDestination): void;
}

interface TransitionOptions<Card> {
  card?: Card | null;
  hold?: number;
  then?: SceneDestination;
  duck?: boolean;
  closing?: string | null;
  washIn?: number;
  signal?: AbortSignal;
}

function cancellable<T>(operation: () => T | Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  const task = Promise.resolve().then(() => {
    signal?.throwIfAborted();
    return operation();
  });
  if (!signal) return task;

  let abort: () => void;
  const cancellation = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  return Promise.race([task, cancellation]).finally(() => signal.removeEventListener('abort', abort));
}

/** Serializes chapter changes and releases the transition overlay on failure. */
export async function runSceneTransition<Card>(
  state: TransitionState,
  effects: TransitionEffects<Card>,
  change: () => void | Promise<void>,
  { card, hold = 0.25, then = 'PLAY', duck = true, closing, washIn = 0.75, signal }: TransitionOptions<Card> = {},
): Promise<boolean> {
  if (state.covering || signal?.aborted) return false;
  state.covering = true;
  let arrived = false;
  let closingVisible = false;
  const run = <T,>(operation: () => T | Promise<T>) => cancellable(operation, signal);

  try {
    effects.closeMenu();
    effects.begin();
    if (duck) effects.setDucked(true);
    await run(() => effects.wash(1, washIn));
    effects.setPaused(true);
    if (closing) {
      closingVisible = true;
      effects.showClosing(closing);
      await run(() => effects.wait(3.2));
      effects.hideClosing();
      closingVisible = false;
      await run(() => effects.wait(0.6));
    }
    if (card != null) effects.showCard(card);
    await run(() => effects.wait(0.05));

    const start = effects.now();
    let destination = then;
    try {
      await run(change);
    } catch (error) {
      if (signal?.aborted) return false;
      await run(() => effects.recoverToTitle(error));
      destination = 'TITLE';
    }
    await run(() => effects.wait(Math.max(hold - (effects.now() - start) / 1000, 0)));
    if (destination !== 'CREDITS') {
      effects.hideCard();
      effects.setPaused(false);
      effects.setDucked(false);
      effects.synchronize();
    }
    effects.arrive(destination);
    arrived = true;
    if (destination !== 'CREDITS') await run(() => effects.wash(0, 1.1));
    return true;
  } catch (error) {
    if (signal?.aborted) return false;
    const failures = [error];
    for (const restore of [
      () => { if (closingVisible) effects.hideClosing(); },
      () => effects.hideCard(),
      () => effects.setPaused(false),
      () => effects.setDucked(false),
      () => { if (!arrived) effects.arrive('TITLE'); },
    ]) {
      try { restore(); } catch (failure) { failures.push(failure); }
    }
    // The HUD progresses the wash on future ticks. Release the transition
    // guard even if this final presentation operation also fails.
    void run(() => effects.wash(0, 0)).catch(() => {});
    if (failures.length > 1) throw new AggregateError(failures, 'Chapter transition and recovery both failed');
    throw error;
  } finally {
    state.covering = false;
  }
}
