import { chapters } from '../domain/chapters.mts';
import { preferenceSliders, preferenceToggles, type NativePreferences } from '../domain/native-preferences.mts';

/** Build the native options form and keep its controls synchronized with the active settings. */
export function createOptionsView(root: HTMLElement, preview: (settings: NativePreferences) => void, persist: () => void) {
  const sliders = new Map<keyof typeof preferenceSliders, HTMLInputElement>();
  const toggles = new Map<keyof typeof preferenceToggles, HTMLInputElement>();
  let values: NativePreferences;
  for (const key of Object.keys(preferenceSliders) as (keyof typeof preferenceSliders)[]) {
    const definition = preferenceSliders[key];
    const label = document.createElement('label');
    label.textContent = definition.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(definition.min);
    input.max = String(definition.max);
    input.step = String(definition.step);
    sliders.set(key, input);
    input.addEventListener('input', () => { values = { ...values, [key]: input.valueAsNumber }; preview(values); });
    input.addEventListener('change', persist);
    label.append(input);
    root.append(label);
  }
  for (const [key, text] of Object.entries(preferenceToggles) as [keyof typeof preferenceToggles, string][]) {
    const label = document.createElement('label');
    label.textContent = text;
    const input = document.createElement('input');
    input.type = 'checkbox';
    toggles.set(key, input);
    input.addEventListener('change', () => { values = { ...values, [key]: input.checked }; preview(values); persist(); });
    label.append(input);
    root.append(label);
  }
  return (settings: NativePreferences) => {
    values = settings;
    for (const [key, input] of sliders) input.value = String(settings[key]);
    for (const [key, input] of toggles) input.checked = settings[key];
  };
}

export function renderChapterMenu(root: HTMLElement, unlocked: readonly string[], select: (id: string) => void) {
  const available = new Set(unlocked);
  const buttons = chapters.filter(chapter => available.has(chapter.id)).map(chapter => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = chapter.numeral + ' · ' + chapter.title;
    button.addEventListener('click', () => select(chapter.id));
    return button;
  });
  root.replaceChildren(...buttons);
  return buttons[0] ?? null;
}
