/**
 * How ready an ability is (0–1) from a cooldown that is running down: 1 when there is nothing
 * to wait for (no total, or nothing left), otherwise how far the wait has come. Pure, so the
 * HUD chips and the touch buttons draw the same fill at any frame rate.
 */
export function readiness(left: number, total: number): number {
  if (total <= 0 || left <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - left / total));
}
