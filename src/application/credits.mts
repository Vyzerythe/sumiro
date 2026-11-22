import { chapters } from '../domain/chapters.mts';
import { scrollCount, scrollsByChapter } from '../domain/scrolls.mts';

const creditsLines = [
  'Mountain, ink and paper painted in three.js and Blender.',
  'Music from ACE-Step 1.5 and MiniMax Music 3, the cat from Stable Audio 3, made in ComfyUI. Wind and steel made in the browser.',
  'Thanks for walking the road.',
] as const;

/** The published ending counts collected scrolls per authored chapter and rounds time to minutes. */
export function createCredits(run: { readonly scrolls: readonly unknown[]; readonly playS: number }) {
  const collected = new Set(run.scrolls);
  return {
    chapters: chapters.map(({ id, numeral, title }) => {
      const scrolls: readonly string[] = scrollsByChapter[id as keyof typeof scrollsByChapter] ?? [];
      return { numeral, title, found: scrolls.filter(scroll => collected.has(scroll)).length, total: scrolls.length };
    }),
    found: run.scrolls.length,
    total: scrollCount,
    minutes: Math.max(Math.round(run.playS / 60), 1),
    lines: creditsLines,
  };
}

export type Credits = ReturnType<typeof createCredits>;
