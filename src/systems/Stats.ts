import type { PlayerPath, StatDef, StatEffectsDef, StatsFile } from '../data/types';
import type { CombatState } from './Combat';

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

/** Every effect a **stat** can have; these keys match stats.json. */
export const STAT_EFFECT_KEYS = [
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

export type StatEffectKey = (typeof STAT_EFFECT_KEYS)[number];

/**
 * Everything that adds up: what your stats give, plus the two things only a path's perks can
 * give (fase 3.8) — max HP as a percentage (Iron Body) and walking speed (Cat's Paw).
 */
export const EFFECT_KEYS = [...STAT_EFFECT_KEYS, 'maxHpPercent', 'moveSpeedPercent'] as const;

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
function rateOf(effects: StatEffectsDef, key: StatEffectKey, path: PathKey): number | undefined {
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
  key: StatEffectKey,
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
 * `path` decides the Regen health (only a sword fighter gets it; mana is the same for every
 * path since fase G.2).
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
    for (const effect of STAT_EFFECT_KEYS) {
      if (def.effects[effect] === undefined) continue;
      out[effect] += effectValue(def, effect, spent, key);
    }
  }
  return clampStatEffects(file, out);
}

/**
 * Keeps the totals under the ceilings in stats.json. Called at the end of
 * `computeStatEffects` and again after a path's perks are added (fase 3.8), so a perk can
 * never push a stat past its cap either.
 */
export function clampStatEffects(file: StatsFile, out: StatEffects): StatEffects {
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

/**
 * Spending points in the world (the status window): the wanted spread, but a point that was
 * already spent can never come back out and the budget still holds. Returns null when nothing
 * would change, so the caller can skip saving.
 */
export function spendMore(
  file: StatsFile,
  level: number,
  before: Readonly<StatPoints>,
  wanted: Readonly<StatPoints>,
): StatPoints | null {
  const next = normalizeStatPoints(file, wanted, level);
  let changed = false;
  for (const def of file.stats) {
    const had = Math.max(0, Math.floor(before[def.id] ?? 0));
    if ((next[def.id] ?? 0) < had) next[def.id] = had;
    if ((next[def.id] ?? 0) !== had) changed = true;
  }
  if (!changed) return null;
  // A spread that no longer fits (e.g. the data changed) is refused rather than trimmed.
  return spentPoints(file, next) <= pointBudget(file, level) ? next : null;
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

/**
 * Writes what your points do into the fighting state: the maxima, how hard your attacks hit,
 * how fast you swing, your crit chance and how much damage reaches you (Defense together with
 * worn gear, under the ceiling in stats.json). The world and the balance tests both use this,
 * so a build means the same thing everywhere. `applyStats` then sets the actual maxima.
 */
export function applyStatsToCombat(
  file: StatsFile,
  effects: Readonly<StatEffects>,
  c: CombatState,
  gearReductionPercent = 0,
): void {
  c.statHp = effects.maxHp;
  c.statMana = effects.maxMana;
  c.hpFactor = 1 + effects.maxHpPercent / 100;
  c.normalFactor = 1 + effects.normalAttackPercent / 100;
  c.staffNormalFactor = 1 + (effects.normalAttackPercent + effects.staffNormalPercent) / 100;
  c.spellFactor = 1 + effects.spellPercent / 100;
  c.attackSpeedFactor = 1 + effects.attackSpeedPercent / 100;
  c.critChance = effects.critChancePercent / 100;
  c.critFactor = file.crit.damageFactor;
  // Defense is negative, so subtracting it adds to what gear already softens.
  const reduction = Math.min(
    file.caps.damageTakenPercent,
    gearReductionPercent - effects.damageTakenPercent,
  );
  c.damageTakenFactor = 1 - reduction / 100;
}
