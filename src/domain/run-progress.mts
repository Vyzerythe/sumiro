import { abilitiesAtChapter, findChapter, transitionToChapter, type ChapterAbilities } from './chapters.mts';
import { createDefaultRun, loadSave, writeSave, type LoadedSave } from './save.mts';

type RunStorage = Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'setItem'>>;
type Run = LoadedSave & {
  shrine: string | null;
  flags: Record<string, unknown>;
  abilities: ChapterAbilities;
  playS: number;
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...value } : {};
}

function recoverRun(saved: LoadedSave | null): Run {
  const data = saved ?? createDefaultRun();
  const abilities = abilitiesAtChapter(data.chapter);
  for (const [key, enabled] of Object.entries(record(data.abilities))) {
    if (enabled === true) Object.defineProperty(abilities, key, { value: true, writable: true, enumerable: true, configurable: true });
  }
  return {
    ...data, abilities, flags: record(data.flags),
    shrine: typeof data.shrine === 'string' ? data.shrine : null,
    playS: typeof data.playS === 'number' && Number.isFinite(data.playS) && data.playS >= 0 ? data.playS : 0,
  };
}

/** Holds one resumed run. Persistence occurs only through explicit checkpoint operations. */
export function createRunProgress(storage: RunStorage) {
  const saved = loadSave(storage);
  let run = recoverRun(saved);
  let hasSave = saved?.started === true;
  let switching = false;

  function persist() {
    if (!storage.setItem) return false;
    const written = writeSave(run, { setItem: storage.setItem.bind(storage) });
    hasSave ||= written;
    return written;
  }

  return {
    get current(): Readonly<Run> { return run; },
    get hasSave() { return hasSave; },
    tick(seconds: number) {
      if (!Number.isFinite(seconds) || seconds < 0) throw RangeError('Play time must be finite and nonnegative');
      run.playS += seconds;
    },
    checkpoint(shrine: string) {
      if (!shrine) throw Error('A checkpoint needs a shrine ID');
      run.shrine = shrine;
      return persist();
    },
    collectScroll(id: string) {
      if (!run.scrolls.includes(id)) run.scrolls = [...run.scrolls, id];
      return persist();
    },
    learnInkStep() {
      run.flags.inkStep = true;
      run.abilities.inkStep = true;
      return persist();
    },
    setFlag(flag: string) {
      Object.defineProperty(run.flags, flag, { value: true, enumerable: true, configurable: true, writable: true });
      return persist();
    },
    /** Commit progression after the incoming chapter has activated. */
    async completeChapter(activate: (id: string) => Promise<unknown>) {
      if (switching) throw Error('A chapter switch is in progress');
      const current = findChapter(run.chapter);
      if (!current) throw Error('Cannot complete an unknown chapter');
      if (current.next === null) {
        run.flags.finished = true;
      } else {
        switching = true;
        try { await activate(current.next); } finally { switching = false; }
        const unlocked = [...new Set([...run.unlocked, current.next])];
        const next = { ...run, unlocked, flags: { ...run.flags } };
        transitionToChapter(next, current.next);
        run = next;
      }
      return persist();
    },
  };
}
