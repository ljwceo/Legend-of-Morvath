/** The announcement pose of a boss attack, straight from monsters.json (`attacks[].pose`). */
export interface BossPoseDef {
  lean: number;
  roll: number;
  crouch: number;
  shakeAmplitude: number;
  shakeHz: number;
  spin: number;
  flickerHz: number;
  gold: boolean;
}

/** The result of `bossPoseAt` (a reused object): visual offsets only. */
export interface BossPose {
  lean: number;
  roll: number;
  squash: number;
  /** Extra yaw (rad): the shake plus the spin. */
  twist: number;
  /** 0 or 1: the colour flicker is on. */
  flicker: number;
}

export function newBossPose(): BossPose {
  return { lean: 0, roll: 0, squash: 0, twist: 0, flicker: 0 };
}

/**
 * Pose `elapsed` seconds into an announcement of `duration` seconds (both simulation time, so the
 * same on every graphics preset and at 60 and 120 Hz). Everything is reached at the end of the
 * announcement. Pure and allocation free: fills `out`. Visual only, it never touches timing.
 */
export function bossPoseAt(
  def: BossPoseDef,
  elapsed: number,
  duration: number,
  out: BossPose,
): BossPose {
  const progress = duration > 0 ? Math.min(1, Math.max(0, elapsed / duration)) : 1;
  const ease = progress * progress * (3 - 2 * progress);
  out.lean = def.lean * ease;
  out.roll = def.roll * ease;
  out.squash = def.crouch * ease;
  out.twist =
    def.spin * progress +
    Math.sin(elapsed * def.shakeHz * Math.PI * 2) * def.shakeAmplitude * progress;
  out.flicker = def.flickerHz > 0 && Math.sin(elapsed * def.flickerHz * Math.PI * 2) > 0 ? 1 : 0;
  return out;
}
