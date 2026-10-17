/**
 * Crystals on your staff (step 4.4). The crystal in your staff has an element (`character.crystal`)
 * and a worth in units (`character.crystalUnits`): a small crystal is 1 unit, merging two equal
 * crystals doubles it, so Medium is 2, Large 4 and Grand 8 (items.json `crystalLevels`). The size
 * follows from the units; it gives extra damage on every hit and bigger spell shots. A bigger
 * crystal only fits a bigger staff (`weapon.maxCrystalSize`). Pure rules, no DOM.
 */

/** One row of items.json `crystalLevels`. */
export interface CrystalLevel {
  size: string;
  units: number;
  damageBonus: number;
  spellSizePercent: number;
}

/** What a crystal gives the staff. */
export interface CrystalBonus {
  damageBonus: number;
  spellSizePercent: number;
}

export const NO_CRYSTAL_BONUS: CrystalBonus = { damageBonus: 0, spellSizePercent: 0 };

export type MergeFailure =
  | 'inCombat'
  | 'noStaff'
  | 'noCrystal'
  | 'otherElement'
  | 'staffTooSmall'
  | 'sizeMismatch'
  | 'maxSize';

export type MergeResult = { ok: true; units: number } | { ok: false; reason: MergeFailure };

/** The level a crystal of this worth has (the largest one it reaches), or null for no crystal. */
export function levelFor(levels: readonly CrystalLevel[], units: number): CrystalLevel | null {
  let found: CrystalLevel | null = null;
  for (const level of levels) if (units >= level.units) found = level;
  return found;
}

/**
 * Damage and spell size of the crystal in your staff; nothing without a crystal or a staff.
 * A crystal bigger than the staff can hold only works as the biggest size that staff holds.
 */
export function crystalBonus(
  levels: readonly CrystalLevel[],
  sizes: readonly string[],
  crystal: string | null,
  units: number,
  staffMax: string | undefined,
): CrystalBonus {
  const level = effectiveLevel(levels, sizes, crystal, units, staffMax);
  return level ?? NO_CRYSTAL_BONUS;
}

/** The level that counts for this crystal in this staff (capped by `staffMax`), or null. */
export function effectiveLevel(
  levels: readonly CrystalLevel[],
  sizes: readonly string[],
  crystal: string | null,
  units: number,
  staffMax: string | undefined,
): CrystalLevel | null {
  if (staffMax === undefined || crystal === null) return null;
  const own = levelFor(levels, units);
  if (!own) return null;
  const cap = sizes.indexOf(staffMax);
  if (cap < 0 || sizes.indexOf(own.size) <= cap) return own;
  return levels.find((level) => sizes.indexOf(level.size) === cap) ?? null;
}

/** The factor a spell shot grows by (1 = unchanged). */
export function spellSizeFactor(bonus: CrystalBonus): number {
  return 1 + bonus.spellSizePercent / 100;
}

/** Worth of a crystal item of the given size in units (0 for an unknown size). */
export function unitsOfSize(levels: readonly CrystalLevel[], size: string): number {
  return levels.find((level) => level.size === size)?.units ?? 0;
}

/** The element of a found crystal: only crystals of exactly one element can be merged. */
export function mergeElement(elements: readonly string[]): string | null {
  return elements.length === 1 ? (elements[0] ?? null) : null;
}

export interface MergeInput {
  /** Element and worth of the crystal in your staff. */
  crystal: string | null;
  units: number;
  /** The crystal from your bag: its element and size. */
  foundElement: string;
  foundSize: string;
  /** `weapon.maxCrystalSize` of the equipped staff; undefined for a sword or no weapon. */
  staffMax: string | undefined;
  inCombat: boolean;
  levels: readonly CrystalLevel[];
  sizes: readonly string[];
}

/**
 * Merges a crystal from your bag into the one in your staff: the same element and the same
 * size give one crystal of the next size. Never in a fight, never to a size your staff cannot
 * hold, never beyond the biggest size. Returns the new worth (units of the next size), or why
 * it did not work (nothing is used up then).
 */
export function mergeCrystal(input: MergeInput): MergeResult {
  if (input.inCombat) return { ok: false, reason: 'inCombat' };
  if (input.staffMax === undefined) return { ok: false, reason: 'noStaff' };
  if (input.crystal === null) return { ok: false, reason: 'noCrystal' };
  if (input.crystal !== input.foundElement) return { ok: false, reason: 'otherElement' };
  const own = levelFor(input.levels, input.units);
  if (!own) return { ok: false, reason: 'noCrystal' };
  if (own.size !== input.foundSize) return { ok: false, reason: 'sizeMismatch' };
  const next = input.levels[input.sizes.indexOf(own.size) + 1];
  if (!next) return { ok: false, reason: 'maxSize' };
  if (input.sizes.indexOf(next.size) > input.sizes.indexOf(input.staffMax)) {
    return { ok: false, reason: 'staffTooSmall' };
  }
  return { ok: true, units: next.units };
}
