/**
 * Chapter registry and progression rules, checked against the published bundle.
 */

export interface ChapterDefinition {
  id: string;
  numeral: string;
  title: string;
  next: string | null;
  starts?: string;
  gives?: string;
  flags?: RegExp;
  line: string;
  closing?: string;
}

export type ChapterAbilities = Record<string, true>;

type ChapterSelection = string | null | undefined;

interface ChapterTransitionState {
  chapter: ChapterSelection;
  shrine: unknown;
  abilities: unknown;
  flags: Record<string, unknown>;
}

type ChapterTransition<Run extends ChapterTransitionState, Id extends ChapterSelection> =
  Omit<Run, keyof ChapterTransitionState> & {
    chapter: Id;
    shrine: null;
    abilities: Run["abilities"] | ChapterAbilities;
    flags: Partial<Run["flags"]> & Record<string, unknown>;
  };

export const chapters: [ChapterDefinition, ...ChapterDefinition[]] = [
  {id:"ch1_climb",numeral:"Chapter One",title:"The Climb",next:"ch2_pass",gives:"inkStep",flags:/^(inkStep|cat_found)$/,line:"Mist, a bridge, and a road that only goes up.",closing:"The rope is down. Whatever is past the gate has been waiting."},
  {id:"ch2_pass",numeral:"Chapter Two",title:"The Broken Pass",next:"ch3_pines",starts:"sword",flags:/^ch2_/,line:"Past the gate, his own blade comes out. Over the mountain, the stairs have fallen.",closing:"From the last tooth of rock, the pines hang out over nothing."},
  {id:"ch3_pines",numeral:"Chapter Three",title:"Hanging Pines",next:"ch4_temple",flags:/^ch3_/,line:"Down the far side, on what the cliff still holds.",closing:"Red roofs below. The bells down there have not rung in years."},
  {id:"ch4_temple",numeral:"Chapter Four",title:"Temple of Silent Bells",next:"ch5_sea",flags:/^ch4_/,line:"Courts that close behind him, and bells that have forgotten how.",closing:"Every bell has spoken. Behind the temple the road goes down into black water."},
  {id:"ch5_sea",numeral:"Chapter Five",title:"Sea of Ink",next:"ch6_summit",flags:/^ch5_/,line:"The tide comes in black, and it does not ask.",closing:"The tide closes behind him. Ahead there is only snow."},
  {id:"ch6_summit",numeral:"Chapter Six",title:"The Last Brushstroke",next:null,flags:/^ch6_/,line:"Snow, wind, and the one who walked ahead of him."}
];

export const firstChapterId = chapters[0].id;

export function findChapter(id: unknown): ChapterDefinition | null {
  return chapters.find((chapter) => chapter.id === id) ?? null;
}

export function abilitiesAtChapter(chapterId: unknown): ChapterAbilities {
  const abilities: ChapterAbilities = {};
  for (const chapter of chapters) {
    if (chapter.starts) abilities[chapter.starts] = true;
    if (chapter.id === chapterId) break;
    if (chapter.gives) abilities[chapter.gives] = true;
  }
  return abilities;
}

/**
 * Mutates and returns the original run, matching the shipped implementation.
 * An unknown ID sets chapter and clears shrine but leaves abilities/flags alone.
 */
export function transitionToChapter<Run extends ChapterTransitionState, Id extends ChapterSelection>(
  run: Run,
  chapterId: Id,
): ChapterTransition<Run, Id>;
export function transitionToChapter(run: ChapterTransitionState, chapterId: ChapterSelection): ChapterTransitionState {
  const target = findChapter(chapterId);
  run.chapter = chapterId;
  run.shrine = null;
  if (target) {
    run.abilities = abilitiesAtChapter(chapterId);
    if (target.flags) {
      for (const key of Object.keys(run.flags)) {
        if (target.flags.test(key)) delete run.flags[key];
      }
    }
  }
  return run;
}
