/**
 * A wait shorter than this (seconds) is not drawn: `readiness` reports 1 for it. A fill that
 * rises in a third of a second (the sword's fast hit, the staff's Shard) is a flicker, not a
 * cue, and a touch button's darkening would come and go faster than its own fade. Only real
 * waits animate: a spell, the intro's explosion, thunder and icicle.
 */
export const MIN_SHOWN_COOLDOWN = 0.5;

/**
 * How ready an ability is (0–1) from a cooldown that is running down: 1 when there is nothing
 * to wait for (nothing left, or a total too short to show, `MIN_SHOWN_COOLDOWN`), otherwise
 * how far the wait has come. Pure, so the HUD chips and the touch buttons draw the same fill
 * at any frame rate.
 */
export function readiness(left: number, total: number): number {
  if (total < MIN_SHOWN_COOLDOWN || left <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - left / total));
}
