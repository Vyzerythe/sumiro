/**
 * Reconstructed collectible scroll catalog from the published kit chunk.
 * This is readable recovered behavior, not the original authoring source.
 * Preserve content and insertion order for save/credits compatibility.
 */
type Verse = readonly [string, string, string];

export const scrollTexts = {
  first_mist: ['Mist on the old road', 'the bridge remembers my weight', 'better than I do'],
  low_pine: ['A pine bent double', 'still holding up the evening', 'with one crooked arm'],
  dry_well: ['Dry well in the rock', 'I lower my voice to it', 'and it hands it back'],
  red_gate: ['Red gate, no temple', 'whoever built it for me', 'never asked my name'],
  cold_bell: ['The bell has no tongue', 'yet the whole valley flinches', 'when my sword goes by'],
  crow_debt: ['Crows on every branch', 'each one owed a little ink', 'none of them collect'],
  rope_bridge: ['Rope bridge in the wind', 'half of it is here today', 'I take the good half'],
  black_tide: ['The tide comes in black', 'and goes out with my footprints', 'folded in its sleeve'],
  grey_boat: ['A boat with no oars', 'drifts up to the drowned stair', 'patient as a debt'],
  snow_line: ['Above the snow line', 'nothing I carried up here', 'weighs what it weighed once'],
  wet_brush: ['A wet brush, one stroke', 'the mountain was never more', 'than this much black ink'],
  last_stroke: ['Set the brush aside', 'the paper is still breathing', 'let it have the rest'],
} as const satisfies Record<string, Verse>;

export type ScrollId = keyof typeof scrollTexts;

export const scrollCount = Object.keys(scrollTexts).length;

export const scrollsByChapter = {
  ch1_climb: ['first_mist'],
  ch2_pass: ['dry_well', 'snow_line'],
  ch3_pines: ['low_pine', 'rope_bridge', 'crow_debt'],
  ch4_temple: ['cold_bell', 'red_gate', 'wet_brush'],
  ch5_sea: ['black_tide', 'grey_boat'],
  ch6_summit: ['last_stroke'],
} as const satisfies Record<string, readonly ScrollId[]>;
