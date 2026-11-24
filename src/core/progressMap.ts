/**
 * Story pacing. Scenes were authored on a 0..1 progress scale where Component 2 (You Believed → TAP HOLD) ended at 0.345.
 * The reference fits all of Component 2 between ruler -100 and -75 BZ (progress 0 → 0.25 on the ruler), so Component 2 is
 * compressed into 0 → 0.25 (≈27 % less scrolling) and everything after it is spread over 0.25 → 1. Timing and motion within
 * each part are unchanged — only how much scrolling they take.
 */
const OLD_SPLIT = 0.345, NEW_SPLIT = 0.25;
export function P(p: number) {
  if (p <= OLD_SPLIT) return (p / OLD_SPLIT) * NEW_SPLIT;
  return NEW_SPLIT + ((p - OLD_SPLIT) / (1 - OLD_SPLIT)) * (1 - NEW_SPLIT);
}
