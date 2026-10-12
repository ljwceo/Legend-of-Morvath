import type { PlayerPath, StatDef, StatEffectsDef, StatsFile } from '../data/types';

/**
 * Stats and builds (fase 3.7). You get `startPoints` in the character creator and one point per
 * level; nothing grows by itself any more. Everything one point does lives in stats.json, so
 * balancing is data only. Pure logic (no DOM, no Three.js), reused by the creator, the status
 * window and the world.
 */

/** Points spent per stat id (missing = 0). */
export type StatPoints = Record<string, number>;

/** How much `path` matters for a stat: no path chosen yet counts as "none". */
export type PathKey = 'none' | PlayerPath;

export function pathKey(path: PlayerPath | null | undefined): PathKey {
  return path ?? 'none';
}

/** Every effect a stat can have; the keys match stats.json. */
export const EFFECT_KEYS = [
  'maxHp',
  'maxMana',
  'carryKg',
  'damageTakenPercent',
  'normalAttackPercent',
  'staffNormalPercent',
  'spellPercent',
  'attackSpeedPercent',
  'energyRegenPercent',
  'manaRegenPerSecond',
  'hpRegenPerSecond',
  'potionPercent',
  'critChancePercent',
] as const;

export type EffectKey = (typeof EFFECT_KEYS)[number];

/** What all your points add up to. Percentages are totals (3 = +3%), the rest is flat. */
export type StatEffects = Record<EffectKey, number>;

export function emptyStatEffects(): StatEffects {
  const out = {} as StatEffects;
  for (const key of EFFECT_KEYS) out[key] = 0;
  return out;
}

/** A per-point value for one path (a plain number counts for every path). */
function pathNumber(value: number | Record<string, number | undefined>, path: PathKey): number {
  if (typeof value === 'number') return value;
  return value[path] ?? value.none ?? 0;
}

/** What one point gives at this point of the ladder, or undefined when the stat skips it. */
function rateOf(effects: StatEffectsDef, key: EffectKey, path: PathKey): number | undefined {
  const value = effects[key];
  return value === undefined ? undefined : pathNumber(value, path);
}

/**
 * What `points` in one stat give for one effect, with the soft caps: up to the first
 * `fromPoints` every point gives the base amount, after that whatever the cap says (Elden Ring).
 * Soft caps are in ascending order (checked by the DataValidator).
 */
export function effectValue(
  def: StatDef,
  key: EffectKey,
  points: number,
  path: PathKey = 'none',
): number {
  let rate = rateOf(def.effects, key, path);
  if (rate === undefined || points <= 0) return 0;
  let total = 0;
  let from = 0;
  for (const cap of def.softCaps) {
    if (points <= cap.fromPoints) break;
    total += (cap.fromPoints - from) * rate;
    from = cap.fromPoints;
    rate = rateOf(cap.effects, key, path) ?? rate;
  }
  return total + (points - from) * rate;
}

/**
 * Adds up every stat into `out` (reused, so the game loop allocates nothing) and returns it.
 * `path` decides the Regen split (mage: mana, sword fighter: health).
 */
export function computeStatEffects(
  file: StatsFile,
  points: Readonly<StatPoints>,
  path: PlayerPath | null,
  out: StatEffects,
): StatEffects {
  for (const key of EFFECT_KEYS) out[key] = 0;
  const key = pathKey(path);
  for (const def of file.stats) {
    const spent = points[def.id] ?? 0;
    if (spent <= 0) continue;
    for (const effect of EFFECT_KEYS) {
      if (def.effects[effect] === undefined) continue;
      out[effect] += effectValue(def, effect, spent, key);
    }
  }
  const caps = file.caps;
  // Defense is negative (less damage taken), so its ceiling is a floor.
  out.damageTakenPercent = Math.max(out.damageTakenPercent, -caps.damageTakenPercent);
  out.critChancePercent = Math.min(out.critChancePercent, caps.critChancePercent);
  out.attackSpeedPercent = Math.min(out.attackSpeedPercent, caps.attackSpeedPercent);
  return out;
}

/** Zero points in every stat. */
export function emptyStatPoints(file: StatsFile): StatPoints {
  const out: StatPoints = {};
  for (const def of file.stats) out[def.id] = 0;
  return out;
}

/** Points spent in total (unknown stat ids are ignored). */
export function spentPoints(file: StatsFile, points: Readonly<StatPoints>): number {
  let total = 0;
  for (const def of file.stats) total += Math.max(0, Math.floor(points[def.id] ?? 0));
  return total;
}

/** Every point you ever get at this level: the start points plus one per level. */
export function pointBudget(file: StatsFile, level: number): number {
  return file.startPoints + file.pointsPerLevel * Math.max(0, level - 1);
}

/** Points you may still spend (never below zero, even after a data change). */
export function unspentPoints(
  file: StatsFile,
  level: number,
  points: Readonly<StatPoints>,
): number {
  return Math.max(0, pointBudget(file, level) - spentPoints(file, points));
}

/** True when this stat may take one more point (budget and its own maximum allow it). */
export function canAddPoint(
  file: StatsFile,
  level: number,
  points: Readonly<StatPoints>,
  statId: string,
): boolean {
  if (!file.stats.some((def) => def.id === statId)) return false;
  if (unspentPoints(file, level, points) <= 0) return false;
  return (points[statId] ?? 0) < file.maxPointsPerStat;
}

/**
 * Makes any (possibly outdated or hand-edited) spread valid: whole numbers, no unknown stats,
 * never more than a stat's maximum and never more than the budget. Points that do not fit are
 * dropped, so they come back as unspent.
 */
export function normalizeStatPoints(
  file: StatsFile,
  raw: Readonly<Record<string, unknown>> | null | undefined,
  level: number,
): StatPoints {
  const out = emptyStatPoints(file);
  let left = pointBudget(file, level);
  for (const def of file.stats) {
    const value = raw?.[def.id];
    const wanted = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
    const spend = Math.max(0, Math.min(wanted, file.maxPointsPerStat, left));
    out[def.id] = spend;
    left -= spend;
  }
  return out;
}

/** A suggested spread from stats.json ("Sword Fighter"), padded out with zeros. */
export function presetPoints(file: StatsFile, presetId: string, level = 1): StatPoints {
  const preset = file.presets.find((entry) => entry.id === presetId);
  return normalizeStatPoints(file, preset?.points, level);
}

/** The Random button: spreads every point you have at random over the ten stats. */
export function randomStatPoints(
  file: StatsFile,
  level: number,
  nextFloat: () => number,
): StatPoints {
  const out = emptyStatPoints(file);
  const stats = file.stats;
  let left = pointBudget(file, level);
  // Give one point at a time to a random stat that still has room, so the total always fits.
  while (left > 0) {
    const open = stats.filter((def) => (out[def.id] ?? 0) < file.maxPointsPerStat);
    if (open.length === 0) break;
    const pick = open[Math.min(open.length - 1, Math.floor(nextFloat() * open.length))];
    if (!pick) break;
    out[pick.id] = (out[pick.id] ?? 0) + 1;
    left--;
  }
  return out;
}
