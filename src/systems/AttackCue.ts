import type { Enemy } from '../entities/Enemy';
import { currentSpecial, windupSeconds } from './EnemyAI';

/** What an announced attack looks like on the ground. */
export type CueShape = 'none' | 'area' | 'disc' | 'line';

/** Longest line a shot cue draws (m), so a long-range archer does not paint the whole map. */
export const MAX_CUE_LINE = 14;
/** A line cue is this wide (m). */
export const CUE_LINE_WIDTH = 0.9;

/** The cue of one announced attack (a reused object, filled by `attackCueFor`). */
export interface AttackCue {
  shape: CueShape;
  /** Radius (m) for 'area' and 'disc'. */
  radius: number;
  /** Length (m) for 'line'. */
  length: number;
  /** 0 at the start of the announcement, 1 when the hit window begins. */
  progress: number;
  /** Whole announcement in seconds (straight from monsters.json, the same on every preset). */
  seconds: number;
}

export function newAttackCue(): AttackCue {
  return { shape: 'none', radius: 0, length: 0, progress: 0, seconds: 0 };
}

/**
 * Fills `out` with the cue of the attack `e` is announcing, or shape 'none' when it is not
 * announcing one. Pure data: the duration is the announcement time from the data and the progress
 * comes from the simulation timer, so the cue lasts as long on Low, Mid and High and at any fps.
 * Allocation-free.
 */
export function attackCueFor(e: Enemy, out: AttackCue): AttackCue {
  out.shape = 'none';
  out.radius = 0;
  out.length = 0;
  out.progress = 0;
  out.seconds = 0;
  const attack = e.def.ai?.attack;
  if (!e.alive || e.mode !== 'windup' || !attack) return out;
  const seconds = windupSeconds(e);
  out.seconds = seconds;
  out.progress = Math.min(1, Math.max(0, 1 - e.timer / Math.max(1e-3, seconds)));
  const special = currentSpecial(e);
  if (special) {
    out.shape = 'area';
    out.radius = special.areaRadius ?? 0;
    return out;
  }
  switch (attack.style) {
    case 'strike':
      out.shape = 'disc';
      out.radius = e.radius + attack.range;
      break;
    case 'lunge':
      out.shape = 'line';
      out.length = attack.lungeDistance ?? 2;
      break;
    case 'shoot':
      out.shape = 'line';
      out.length = Math.min(MAX_CUE_LINE, attack.range);
      break;
  }
  return out;
}
