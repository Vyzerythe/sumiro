interface SystemScene<Root> {
  children: readonly Root[];
  add(...roots: Root[]): unknown;
  remove(...roots: Root[]): unknown;
}

type Cleanup = () => void | Promise<void>;

export interface SystemLifetime<Root> {
  readonly signal: AbortSignal;
  ownRoot(root: Root): Root;
  defer(cleanup: Cleanup): void;
}

export interface RuntimeSystem<Root, Context> {
  name?: string;
  order?: number;
  chapter?: string | null;
  budgetMs?: number;
  whilePaused?: boolean;
  init?(context: Context, lifetime: SystemLifetime<Root>): void | Promise<void>;
  update?(elapsed: number, context: Context): void;
  beforeRender?(context: Context): void;
  dispose?(context: Context): void | Promise<void>;
}

interface HostOptions {
  defaultBudgetMs: number;
  initializeTimeoutMs: number;
  now?: () => number;
  markInitialize?: (name: string) => void;
  diagnostics?: Pick<Console, 'warn' | 'error'>;
}

type Loader = () => Promise<unknown>;
type FailurePhase = 'import' | 'init' | 'update' | 'beforeRender';
type HostPhase = 'idle' | 'loading' | 'ready' | 'disposed';

interface Entry<Root, Context> {
  name: string;
  order: number;
  chapter: string | null;
  budgetMs: number;
  system: RuntimeSystem<Root, Context> | null;
  roots: Set<Root>;
  cleanups: Cleanup[];
  abort: AbortController;
  enabled: boolean;
  started: boolean;
  initialized: boolean;
  closed: boolean;
  failed: FailurePhase | null;
  error: string | null;
  initMs: number;
  updateMs: number;
  updateMaxMs: number;
  updateCount: number;
}

function loadName(path: string): string {
  const name = /(?:^|\/)([^/]+)\.[cm]?[jt]s$/.exec(path)?.[1];
  if (!name) throw Error('Invalid system module path: ' + path);
  return name;
}

function resolveSystem<Root, Context>(module: unknown): RuntimeSystem<Root, Context> {
  const candidate: unknown = module && typeof module === 'object' && 'default' in module
    ? module.default ?? module
    : module;
  if (!candidate || (typeof candidate !== 'object' && typeof candidate !== 'function')) {
    throw Error('Expected a system module');
  }
  const system = candidate as RuntimeSystem<Root, Context>;
  if (typeof system.init !== 'function' && typeof system.update !== 'function') {
    throw Error('System exports neither init nor update');
  }
  return system;
}

function waitForInitialization(task: Promise<void>, signal: AbortSignal, timeoutMs: number): Promise<void> {
  if (signal.aborted) return Promise.race([Promise.reject(signal.reason), task]);
  let timer: ReturnType<typeof setTimeout>;
  let abort: () => void;
  const cancellation = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => reject(Error('Initialization timed out after ' + timeoutMs + ' ms')), timeoutMs);
  });
  return Promise.race([task, cancellation]).finally(() => {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  });
}

/** Owns system order, chapter membership, and the lifetime of attached roots. */
export function createSystemHost<Root, Context extends { scene: SystemScene<Root> }>(
  context: Context & { scene: SystemScene<Root> },
  {
    defaultBudgetMs, initializeTimeoutMs, now = () => performance.now(), markInitialize,
    diagnostics = console,
  }: HostOptions,
) {
  if (!Number.isFinite(initializeTimeoutMs) || initializeTimeoutMs <= 0) {
    throw RangeError('System initialization timeout must be positive and finite');
  }
  const scene = context.scene;
  let phase: HostPhase = 'idle';
  let entries: Entry<Root, Context>[] = [];
  let updates: Entry<Root, Context>[] = [];
  let pausedUpdates: Entry<Root, Context>[] = [];
  let renders: Entry<Root, Context>[] = [];
  let disposal: Promise<void> | undefined;
  const cleanupTasks = new Set<Promise<void>>();

  function refresh() {
    const active = entries.filter(entry => entry.enabled && entry.initialized && !entry.closed);
    updates = active.filter(entry => typeof entry.system?.update === 'function');
    pausedUpdates = updates.filter(entry => entry.system?.whilePaused);
    renders = active.filter(entry => typeof entry.system?.beforeRender === 'function');
  }

  function reportCleanupError(name: string, error: unknown) {
    diagnostics.error('[system:' + name + '] dispose failed', error);
  }

  function runCleanup(name: string, cleanup: Cleanup) {
    try {
      const task = Promise.resolve(cleanup()).catch(error => reportCleanupError(name, error));
      cleanupTasks.add(task);
      const forget = () => { cleanupTasks.delete(task); };
      void task.then(forget, forget);
    } catch (error) {
      reportCleanupError(name, error);
    }
  }

  function release(entry: Entry<Root, Context>) {
    if (entry.closed) return;
    entry.closed = true;
    entry.abort.abort();
    for (const cleanup of entry.cleanups.reverse()) runCleanup(entry.name, cleanup);
    entry.cleanups.length = 0;
    const system = entry.system;
    if (entry.started && typeof system?.dispose === 'function') {
      runCleanup(entry.name, () => system.dispose!(context));
    }
    if (entry.roots.size) scene.remove(...entry.roots);
    entry.roots.clear();
  }

  function fail(entry: Entry<Root, Context>, during: FailurePhase, error: unknown) {
    entry.failed = during;
    entry.error = String(typeof error === 'object' && error !== null && 'stack' in error
      ? error.stack ?? error
      : error);
    diagnostics.error('[system:' + entry.name + '] ' + during + ' failed, system disabled', error);
    release(entry);
  }

  function lifetimeFor(entry: Entry<Root, Context>): SystemLifetime<Root> {
    return {
      signal: entry.abort.signal,
      ownRoot(root) {
        if (entry.closed) scene.remove(root);
        else {
          if (!scene.children.includes(root)) scene.add(root);
          entry.roots.add(root);
        }
        return root;
      },
      defer(cleanup) {
        if (entry.closed) runCleanup(entry.name, cleanup);
        else entry.cleanups.push(cleanup);
      },
    };
  }

  function captureRoots(entry: Entry<Root, Context>, original: Set<Root>) {
    for (const root of [...scene.children]) {
      if (original.has(root)) continue;
      if (entry.closed) scene.remove(root);
      else entry.roots.add(root);
    }
  }

  async function loadEntry(name: string, loader: Loader): Promise<Entry<Root, Context>> {
    const entry: Entry<Root, Context> = {
      name, order: 0, chapter: null, budgetMs: defaultBudgetMs, system: null,
      roots: new Set(), cleanups: [], abort: new AbortController(),
      enabled: true, started: false, initialized: false, closed: false, failed: null, error: null,
      initMs: 0, updateMs: 0, updateMaxMs: 0, updateCount: 0,
    };
    try {
      const system = resolveSystem<Root, Context>(await loader());
      if (system.name !== undefined && system.name !== name) {
        diagnostics.warn('[system:' + name + '] exports name ' + system.name);
      }
      entry.system = system;
      if (typeof system.order === 'number' && Number.isFinite(system.order)) entry.order = system.order;
      if (typeof system.budgetMs === 'number' && Number.isFinite(system.budgetMs)) entry.budgetMs = system.budgetMs;
      entry.chapter = system.chapter ?? null;
    } catch (error) {
      fail(entry, 'import', error);
    }
    return entry;
  }

  const isDisposed = () => phase === 'disposed';
  return {
    async load(loaders: Record<string, Loader>, only?: readonly string[] | null) {
      if (phase !== 'idle') throw Error('System host can only load once');
      const named = Object.entries(loaders).map(([path, loader]) => ({ name: loadName(path), loader }));
      const names = new Set(named.map(({ name }) => name));
      if (names.size !== named.length) throw Error('System module names must be unique');
      phase = 'loading';
      if (only) for (const name of only) {
        if (!names.has(name)) diagnostics.error('[engine] Unknown requested system ' + name);
      }
      const defaultSystems = named.filter(({ name }) => !name.startsWith('_'));
      const selected = only ? named.filter(({ name }) => only.includes(name))
        : defaultSystems.length ? defaultSystems : named;
      const loaded = await Promise.all(selected.map(({ name, loader }) => loadEntry(name, loader)));
      if (isDisposed()) return;
      entries = loaded.sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

      for (const entry of entries) {
        if (isDisposed()) return;
        if (entry.failed) continue;
        const original = new Set(scene.children);
        const start = now();
        try {
          markInitialize?.(entry.name);
          const system = entry.system;
          entry.started = true;
          if (typeof system?.init === 'function') {
            await waitForInitialization(Promise.resolve(system.init(context, lifetimeFor(entry))),
              entry.abort.signal, initializeTimeoutMs);
          }
          entry.initialized = true;
        } catch (error) {
          captureRoots(entry, original);
          if (!isDisposed()) fail(entry, 'init', error);
        }
        entry.initMs = now() - start;
        if (!entry.closed) captureRoots(entry, original);
      }
      if (isDisposed()) return;
      phase = 'ready';
      refresh();
    },
    setChapter(chapter: string) {
      if (phase !== 'ready') return;
      for (const entry of entries) {
        if (!entry.chapter || entry.failed || entry.closed) continue;
        const enabled = entry.chapter === chapter;
        if (entry.enabled === enabled) continue;
        entry.enabled = enabled;
        for (const root of entry.roots) {
          if (enabled) scene.add(root);
          else scene.remove(root);
        }
      }
      refresh();
    },
    chapterRoots(chapter: string): Root[] {
      return entries.filter(entry => entry.chapter === chapter).flatMap(entry => [...entry.roots]);
    },
    update(elapsed: number, paused = false) {
      let changed = false;
      for (const entry of paused ? pausedUpdates : updates) {
        if (entry.closed) continue;
        const start = now();
        try {
          entry.system!.update!(elapsed, context);
        } catch (error) {
          fail(entry, 'update', error);
          changed = true;
        }
        const duration = now() - start;
        entry.updateMs += duration;
        entry.updateMaxMs = Math.max(entry.updateMaxMs, duration);
        entry.updateCount++;
      }
      if (changed) refresh();
    },
    beforeRender() {
      let changed = false;
      for (const entry of renders) {
        if (entry.closed) continue;
        try {
          entry.system!.beforeRender!(context);
        } catch (error) {
          fail(entry, 'beforeRender', error);
          changed = true;
        }
      }
      if (changed) refresh();
    },
    dispose() {
      if (disposal) return disposal;
      phase = 'disposed';
      disposal = Promise.resolve().then(async () => {
        while (cleanupTasks.size > 0) await Promise.allSettled([...cleanupTasks]);
      });
      for (const entry of [...entries].reverse()) release(entry);
      refresh();
      return disposal;
    },
    report() {
      return entries.map(entry => {
        const avgMs = entry.updateCount ? entry.updateMs / entry.updateCount : 0;
        return {
          name: entry.name, order: entry.order, failed: entry.failed, error: entry.error,
          initMs: Math.round(entry.initMs * 10) / 10, avgMs,
          maxMs: entry.updateMaxMs, budgetMs: entry.budgetMs,
          overBudget: entry.updateCount > 0 && avgMs > entry.budgetMs,
        };
      });
    },
  };
}
