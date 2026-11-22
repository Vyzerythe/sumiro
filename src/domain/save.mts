/**
 * Save-data compatibility with the published game prelude.
 */
import { firstChapterId, findChapter } from "./chapters.mts";
import type { ChapterAbilities } from "./chapters.mts";

type SaveFields = Record<PropertyKey, unknown>;

export interface RunOptions extends SaveFields {
  master: number;
  music: number;
  ambience: number;
  effects: number;
  voice: number;
  sensitivity: number;
  invertY: boolean;
  shake: number;
  assist: boolean;
  vol: number;
}

interface ChapterProgress {
  chapter: string;
  unlocked: readonly unknown[];
  shrine?: unknown;
}

interface LoadedChapterProgress {
  chapter: string;
  unlocked: string[];
  shrine: unknown;
}

interface SupportedSave extends SaveFields, ChapterProgress {
  v: 1;
  scrolls: unknown[];
  abilities: unknown;
  flags: unknown;
}

/** The published check accepts stored values outside the default run schema. */
export interface LoadedSave extends SaveFields, LoadedChapterProgress {
  v: 1;
  scrolls: unknown[];
  abilities: unknown;
  flags: unknown;
  options: SaveFields;
}

export interface DefaultRun<Options = RunOptions> {
  v: 1;
  started: boolean;
  chapter: string;
  shrine: string | null;
  unlocked: string[];
  abilities: ChapterAbilities;
  scrolls: string[];
  flags: Record<string, unknown>;
  seen: Record<string, boolean>;
  playS: number;
  options: Options;
}

function propertiesOf(value: unknown): SaveFields {
  // JavaScript boxes primitives for property access and object spreading.
  return Object(value) as SaveFields;
}

export const saveKey = "sumiro.save.v1";
export const legacySaveKey = "ink_wanderer.save.v1";

export const legacyChapterAliases = { ch2_stub: "ch2_pass" };

export const defaultOptions: RunOptions = {
  master: 1,
  music: 0.8,
  ambience: 1,
  effects: 1,
  voice: 1,
  sensitivity: 1,
  invertY: false,
  shake: 1,
  assist: false,
  vol: 2,
};

/** Apply the shipped volume-settings migration, including its legacy quirks. */
export function migrateOptions(options: unknown): unknown {
  if (!options) return options;
  const values = propertiesOf(options);
  if (Number(values.vol) >= 2) return options;
  return {
    ...values,
    music: values.music === 1 || values.music === undefined
      ? defaultOptions.music
      : values.music,
    vol: 2,
  };
}

export function createDefaultRun(options?: Partial<RunOptions> | null): DefaultRun;
export function createDefaultRun(options: unknown): DefaultRun<SaveFields>;
export function createDefaultRun(options: unknown = defaultOptions): DefaultRun<SaveFields> {
  return {
    v: 1,
    started: true,
    chapter: "ch1_climb",
    shrine: null,
    unlocked: ["ch1_climb"],
    abilities: {},
    scrolls: [],
    flags: {},
    seen: {},
    playS: 0,
    options: { ...defaultOptions, ...propertiesOf(options) },
  };
}

/**
 * This matches the original permissive predicate; it is not a robust schema
 * validator, and intentionally returns the original truthy/falsy operand.
 */
export function isSupportedSave(data: unknown): unknown {
  if (!data) return data;
  const values = propertiesOf(data);
  return values.v === 1 && typeof values.chapter === "string"
    && Array.isArray(values.unlocked) && Array.isArray(values.scrolls)
    && values.abilities && values.flags;
}

function hasSupportedSaveShape(data: unknown): data is SupportedSave {
  return Boolean(isSupportedSave(data));
}

function isKnownChapter(id: unknown): id is string {
  return findChapter(id) !== null;
}

/** Normalize chapter aliases/unlocks without mutating the input save. */
export function normalizeSaveChapters<Data extends ChapterProgress>(
  data: Data,
): Omit<Data, keyof ChapterProgress> & LoadedChapterProgress {
  const aliases = propertiesOf(legacyChapterAliases);
  // The bracket access keeps the published key coercion and inherited lookup.
  const resolveAlias = (id: unknown): unknown => aliases[id as PropertyKey] ?? id;
  const unlocked = [...new Set(data.unlocked.map(resolveAlias))]
    .filter(isKnownChapter);
  if (!unlocked.includes(firstChapterId)) unlocked.unshift(firstChapterId);
  const mappedChapter = resolveAlias(data.chapter);
  const chapter = isKnownChapter(mappedChapter)
    ? mappedChapter
    : unlocked[unlocked.length - 1]!;
  if (!unlocked.includes(chapter)) unlocked.push(chapter);
  return {
    ...data,
    chapter,
    unlocked,
    shrine: chapter === data.chapter ? data.shrine : null,
  };
}

/**
 * Accepts an injected localStorage-compatible object for deterministic tests.
 * If not supplied, uses the browser's global localStorage at call time.
 */
export function loadSave(storage?: Pick<Storage, "getItem">): LoadedSave | null {
  try {
    const store = storage === undefined ? globalThis.localStorage : storage;
    const raw = store.getItem(saveKey) ?? store.getItem(legacySaveKey);
    const saved: unknown = JSON.parse(raw ?? "null");
    return hasSupportedSaveShape(saved)
      ? {
          ...createDefaultRun(migrateOptions(saved.options)),
          ...normalizeSaveChapters(saved),
          options: { ...defaultOptions, ...propertiesOf(migrateOptions(saved.options)) },
        }
      : null;
  } catch {
    return null;
  }
}

/** Return false, rather than throwing, on serialization/storage failure. */
export function writeSave(data: unknown, storage?: Pick<Storage, "setItem">): boolean {
  try {
    const store = storage === undefined ? globalThis.localStorage : storage;
    store.setItem(saveKey, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
