/**
 * Chapter root and resource ownership derived from the level lifecycle in
 * sumiro/bundle/level-O-RtwNJJ.js. Preparation is isolated from live activation.
 */

interface ChapterScene<Root> {
  children: readonly Root[];
  add(root: Root): unknown;
  remove(root: Root): unknown;
}

type Cleanup = () => void | Promise<void>;
type Rollback = () => void | undefined;

export interface ChapterLifetime {
  readonly signal: AbortSignal;
  /** Register cleanup when a resource is acquired, before awaiting more work. */
  defer(cleanup: Cleanup): void;
}

export interface ChapterActivation extends ChapterLifetime {
  /** Undo a synchronous activation side effect if committing the chapter fails. */
  rollback(undo: Rollback): void;
}

export interface LoadedChapter<Root, Data> {
  readonly root: Root;
  readonly data: Data;
}

export interface ActiveChapter<Root, Data> extends LoadedChapter<Root, Data> {
  readonly id: string;
}

export interface ChapterManagerOptions<Root, Data> {
  scene: ChapterScene<Root>;
  /** The loader owns preparation and returns a detached root. */
  load(id: string, lifetime: ChapterLifetime): LoadedChapter<Root, Data> | Promise<LoadedChapter<Root, Data>>;
  /** Synchronous application work before the candidate root is added to the scene. */
  activate?(
    candidate: ActiveChapter<Root, Data>, previous: ActiveChapter<Root, Data> | null, lifetime: ChapterActivation,
  ): void | undefined;
  reportCleanupError?(id: string, error: unknown): void;
}

export interface ChapterManager<Root, Data> {
  readonly current: ActiveChapter<Root, Data> | null;
  switchTo(id: string, options?: { signal?: AbortSignal }): Promise<ActiveChapter<Root, Data>>;
  /** Wait for cleanup already acquired. An abandoned loader can register later cleanup. */
  dispose(): Promise<void>;
}

interface Request<Root, Data> {
  id: string;
  controller: AbortController;
  lifetime: ChapterLifetime;
  cleanups: Cleanup[];
  caller: AbortSignal | undefined;
  disconnectCaller(): void;
  promise: Promise<ActiveChapter<Root, Data>>;
  resolve(chapter: ActiveChapter<Root, Data>): void;
  reject(reason: unknown): void;
}

/** Prepares one candidate at a time and commits its scene and state in the same turn. */
export function createChapterManager<Root, Data>({
  scene, load, activate, reportCleanupError = (id, error) => console.error(`[chapter:${id}] cleanup failed`, error),
}: ChapterManagerOptions<Root, Data>): ChapterManager<Root, Data> {
  type Chapter = ActiveChapter<Root, Data>;
  type Flight = Request<Root, Data>;

  let current: { chapter: Chapter; request: Flight } | null = null;
  let pending: Flight | undefined;
  let disposal: Promise<void> | undefined;
  const cleanupTasks = new Set<Promise<void>>();

  function report(id: string, error: unknown) {
    try { reportCleanupError(id, error); } catch (reportingError) {
      console.error(`[chapter:${id}] cleanup reporting failed`, reportingError);
    }
  }

  function queueCleanup(id: string, cleanups: Cleanup[]) {
    if (cleanups.length === 0) return;
    const task = Promise.resolve().then(async () => {
      for (const cleanup of cleanups) {
        try { await cleanup(); } catch (error) { report(id, error); }
      }
    });
    cleanupTasks.add(task);
    const forget = () => { cleanupTasks.delete(task); };
    void task.then(forget, forget);
  }

  function release(request: Flight, reason: unknown) {
    if (request.controller.signal.aborted) return;
    request.controller.abort(reason);
    queueCleanup(request.id, request.cleanups.splice(0).reverse());
  }

  function reject(request: Flight, reason: unknown) {
    if (pending === request) pending = undefined;
    request.disconnectCaller();
    release(request, reason);
    request.reject(reason);
  }

  function commit(request: Flight, loaded: LoadedChapter<Root, Data>): Chapter {
    request.lifetime.signal.throwIfAborted();
    if (scene.children.includes(loaded.root)) throw Error('A chapter loader must return a detached root');
    const next: Chapter = { id: request.id, root: loaded.root, data: loaded.data };
    const previous = current;
    const rollbacks: Rollback[] = [];
    let attaching = false;
    try {
      const result = activate?.(next, previous?.chapter ?? null, {
        ...request.lifetime,
        rollback(undo) { rollbacks.push(undo); },
      });
      if (result !== undefined) throw Error('Chapter activation must be synchronous');
      request.lifetime.signal.throwIfAborted();
      attaching = true;
      scene.add(next.root);
      request.lifetime.signal.throwIfAborted();
      if (previous) scene.remove(previous.chapter.root);
      request.lifetime.signal.throwIfAborted();
    } catch (error) {
      const failures = [error];
      if (attaching && scene.children.includes(next.root)) {
        try { scene.remove(next.root); } catch (failure) { failures.push(failure); }
      }
      if (previous && current === previous && !scene.children.includes(previous.chapter.root)) {
        try { scene.add(previous.chapter.root); } catch (failure) { failures.push(failure); }
      }
      for (const undo of rollbacks.reverse()) {
        try { undo(); } catch (failure) { failures.push(failure); }
      }
      if (failures.length > 1) throw new AggregateError(failures, 'Chapter activation and rollback failed');
      throw error;
    }

    current = { chapter: next, request };
    pending = undefined;
    request.disconnectCaller();
    request.resolve(next);
    if (previous) release(previous.request, new DOMException('Chapter replaced', 'AbortError'));
    return next;
  }

  function switchTo(id: string, { signal }: { signal?: AbortSignal } = {}): Promise<Chapter> {
    if (disposal) return Promise.reject(new DOMException('Chapter manager disposed', 'AbortError'));
    if (signal?.aborted) return Promise.reject(signal.reason);
    const previousRequest = pending;
    const superseded = new DOMException('Chapter request superseded', 'AbortError');
    if (current?.chapter.id === id) {
      const active = current.chapter;
      if (previousRequest) reject(previousRequest, superseded);
      return Promise.resolve(active);
    }
    if (previousRequest?.id === id && previousRequest.caller === signal) return previousRequest.promise;

    const controller = new AbortController();
    const cleanups: Cleanup[] = [];
    let resolve!: (chapter: Chapter) => void;
    let fail!: (reason: unknown) => void;
    const promise = new Promise<Chapter>((accept, reject) => { resolve = accept; fail = reject; });
    const request: Flight = {
      id, controller, cleanups, caller: signal,
      lifetime: {
        signal: controller.signal,
        defer(cleanup) {
          if (controller.signal.aborted) queueCleanup(id, [cleanup]);
          else cleanups.push(cleanup);
        },
      },
      disconnectCaller() { signal?.removeEventListener('abort', abort); },
      promise, resolve, reject: fail,
    };
    const abort = () => reject(request, signal?.reason);
    pending = request;
    signal?.addEventListener('abort', abort, { once: true });
    if (previousRequest) reject(previousRequest, superseded);

    void Promise.resolve().then(async () => {
      try {
        controller.signal.throwIfAborted();
        const candidate = await load(id, request.lifetime);
        commit(request, candidate);
      } catch (error) {
        if (pending === request) reject(request, error);
      }
    });
    return promise;
  }

  function dispose() {
    if (disposal) return disposal;
    disposal = Promise.resolve().then(async () => {
      while (cleanupTasks.size) await Promise.allSettled([...cleanupTasks]);
    });
    const reason = new DOMException('Chapter manager disposed', 'AbortError');
    if (pending) reject(pending, reason);
    if (current) {
      const { chapter, request } = current;
      current = null;
      try { scene.remove(chapter.root); } catch (error) { report(chapter.id, error); }
      release(request, reason);
    }
    return disposal;
  }

  return { get current() { return current?.chapter ?? null; }, switchTo, dispose };
}
