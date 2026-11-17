/**
 * Reconstructed save-data operations from the prelude of the published
 * sumiro/bundle/game-B5zfa1fm.js. This is NOT original editable source.
 *
 * Keep compatibility behavior separate from future validation improvements.
 */
import { firstChapterId, findChapter } from "./chapters.mjs";

export const saveKey = "sumiro.save.v1";
export const legacySaveKey = "ink_wanderer.save.v1";

export const legacyChapterAliases = { ch2_stub: "ch2_pass" };

export const defaultOptions = {
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
export function migrateOptions(options) {
  if (!options || options.vol >= 2) return options;
  return {
    ...options,
    music: options.music === 1 || options.music === undefined
      ? defaultOptions.music
      : options.music,
    vol: 2,
  };
}

export function createDefaultRun(options = defaultOptions) {
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
    options: { ...defaultOptions, ...options },
  };
}

/**
 * This matches the original permissive predicate; it is not a robust schema
 * validator, and intentionally returns the original truthy/falsy operand.
 */
export function isSupportedSave(data) {
  return data && data.v === 1 && typeof data.chapter === "string"
    && Array.isArray(data.unlocked) && Array.isArray(data.scrolls)
    && data.abilities && data.flags;
}

/** Normalize chapter aliases/unlocks without mutating the input save. */
export function normalizeSaveChapters(data) {
  const resolveAlias = (id) => legacyChapterAliases[id] ?? id;
  const unlocked = [...new Set(data.unlocked.map(resolveAlias))]
    .filter((id) => findChapter(id));
  if (!unlocked.includes(firstChapterId)) unlocked.unshift(firstChapterId);
  const mappedChapter = resolveAlias(data.chapter);
  const chapter = findChapter(mappedChapter)
    ? mappedChapter
    : unlocked[unlocked.length - 1];
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
export function loadSave(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(saveKey) ?? storage.getItem(legacySaveKey);
    const saved = JSON.parse(raw);
    return isSupportedSave(saved)
      ? {
          ...createDefaultRun(migrateOptions(saved.options)),
          ...normalizeSaveChapters(saved),
          options: { ...defaultOptions, ...migrateOptions(saved.options) },
        }
      : null;
  } catch {
    return null;
  }
}

/** Return false, rather than throwing, on serialization/storage failure. */
export function writeSave(data, storage = globalThis.localStorage) {
  try {
    storage.setItem(saveKey, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
