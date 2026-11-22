type Listener<Value> = (value: Value) => void;

/** A keyed value store with immediate replay and snapshot notifications. */
export class RuntimeRegistry<Values extends object = Record<string, unknown>> {
  private readonly values = new Map<keyof Values, Values[keyof Values]>();
  private readonly listeners = new Map<keyof Values, Set<Listener<Values[keyof Values]>>>();
  private readonly diagnostics: Pick<Console, 'error'>;

  constructor(diagnostics: Pick<Console, 'error'> = console) {
    this.diagnostics = diagnostics;
  }

  set<Key extends keyof Values>(key: Key, value: Values[Key]): Values[Key] {
    this.values.set(key, value);
    const listeners = this.listeners.get(key);
    if (!listeners) return value;
    for (const listener of [...listeners]) {
      try {
        listener(value);
      } catch (error) {
        this.diagnostics.error('[registry] Listener for ' + String(key) + ' failed', error);
      }
    }
    return value;
  }

  get<Key extends keyof Values>(key: Key, fallback?: Values[Key]): Values[Key] | undefined {
    return this.values.has(key) ? this.values.get(key) as Values[Key] : fallback;
  }

  has(key: keyof Values): boolean {
    return this.values.has(key);
  }

  delete(key: keyof Values): void {
    this.values.delete(key);
  }

  on<Key extends keyof Values>(key: Key, listener: Listener<Values[Key]>): () => boolean {
    // The map erases each listener's key type. Notification only uses its own bucket.
    const subscriber = listener as Listener<Values[keyof Values]>;
    let listeners = this.listeners.get(key);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(key, listeners);
    }
    const registered = listeners.has(subscriber);
    listeners.add(subscriber);
    const unsubscribe = () => {
      const removed = listeners.delete(subscriber);
      if (listeners.size === 0 && this.listeners.get(key) === listeners) this.listeners.delete(key);
      return removed;
    };
    try {
      if (this.values.has(key)) listener(this.values.get(key) as Values[Key]);
    } catch (error) {
      if (!registered) unsubscribe();
      throw error;
    }
    return unsubscribe;
  }

  keys(): (keyof Values)[] {
    return [...this.values.keys()];
  }
}
