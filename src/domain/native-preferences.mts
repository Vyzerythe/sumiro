import { defaultOptions, type RunOptions } from './save.mts';

export const preferenceSliders = {
  master: { label: 'Volume', min: 0, max: 1, step: .1 },
  music: { label: 'Music', min: 0, max: 1, step: .1 },
  ambience: { label: 'Wind', min: 0, max: 1, step: .1 },
  effects: { label: 'Effects', min: 0, max: 1, step: .1 },
  voice: { label: 'Voice', min: 0, max: 1, step: .1 },
  sensitivity: { label: 'Look sensitivity', min: .2, max: 3, step: .2 },
  shake: { label: 'Camera shake', min: 0, max: 1, step: .25 },
} as const;
export const preferenceToggles = { invertY: 'Invert vertical look', assist: 'Assist · two extra strokes' } as const;
export type NativePreferences = Pick<RunOptions, keyof typeof preferenceSliders | keyof typeof preferenceToggles>;
const sliders = Object.keys(preferenceSliders) as (keyof typeof preferenceSliders)[];
const toggles = Object.keys(preferenceToggles) as (keyof typeof preferenceToggles)[];
export const nativePreferencesKey = 'sumiro.native.preferences.v1';

/** Normalize presentation settings independently of permissive historical save data. */
export function normalizeNativePreferences(value: unknown, fallback: Record<string, unknown> = defaultOptions) {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const preferences = {} as NativePreferences;
  for (const key of sliders) {
    const { min, max } = preferenceSliders[key];
    const primary = input[key];
    const legacy = fallback[key];
    const candidate = typeof primary === 'number' && Number.isFinite(primary) ? primary
      : typeof legacy === 'number' && Number.isFinite(legacy) ? legacy : defaultOptions[key];
    preferences[key] = Math.min(max, Math.max(min, candidate));
  }
  for (const key of toggles) {
    const primary = input[key], legacy = fallback[key];
    preferences[key] = typeof primary === 'boolean' ? primary : typeof legacy === 'boolean' ? legacy : defaultOptions[key];
  }
  return preferences;
}

export function createNativePreferencesStorage(access: () => Pick<Storage, 'getItem' | 'setItem'>) {
  let memory: NativePreferences | undefined;
  return {
    read(fallback?: Record<string, unknown>) {
      if (memory) return { ...memory };
      try {
        const raw = access().getItem(nativePreferencesKey);
        if (raw !== null) return normalizeNativePreferences(JSON.parse(raw), fallback);
      } catch { /* Settings remain available if the browser denies storage. */ }
      return normalizeNativePreferences(undefined, fallback);
    },
    write(input: NativePreferences) {
      memory = normalizeNativePreferences(input);
      try { access().setItem(nativePreferencesKey, JSON.stringify(memory)); } catch { /* Keep the in-memory settings. */ }
      return { ...memory };
    },
  };
}
