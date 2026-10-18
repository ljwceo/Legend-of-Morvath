/**
 * The spellbook (step 4.3): which of the spells you know sit in the slots of your staff.
 * A staff has `spellSlots` slots (items.json); you fill them from the spells you know, outside
 * a fight. The wheel / D-pad up picks which filled slot the cast button fires, also in a fight
 * (see Loadout). Pure rules, no DOM.
 */

/** An empty slot in the stored loadout. */
export const EMPTY_SLOT = '';

/**
 * Makes a stored loadout fit the staff: one entry per slot, only spells you know, none twice.
 * Slots beyond the staff's are dropped (the learned spells stay known). A loadout that was
 * never chosen (an older save) is filled from the spells you know, in the order learned.
 */
export function normalizeLoadout(
  loadout: readonly string[],
  known: readonly string[],
  slots: number,
): string[] {
  const out: string[] = [];
  const used = new Set<string>();
  const fresh = loadout.length === 0;
  for (let i = 0; i < slots; i++) {
    const wanted = fresh ? (known.find((id) => !used.has(id)) ?? EMPTY_SLOT) : loadout[i];
    if (wanted && wanted !== EMPTY_SLOT && known.includes(wanted) && !used.has(wanted)) {
      out.push(wanted);
      used.add(wanted);
    } else {
      out.push(EMPTY_SLOT);
    }
  }
  return out;
}

/**
 * Puts a spell (or nothing) in a slot. A spell that sat in another slot moves, so no spell is
 * ever in two slots. Returns null when the change is not allowed: not in a fight, a slot the
 * staff does not have, or a spell you do not know.
 */
export function setSlot(
  loadout: readonly string[],
  slot: number,
  spellId: string,
  known: readonly string[],
  slots: number,
  inCombat: boolean,
): string[] | null {
  if (inCombat || !Number.isInteger(slot) || slot < 0 || slot >= slots) return null;
  if (spellId !== EMPTY_SLOT && !known.includes(spellId)) return null;
  const next = normalizeLoadout(loadout, known, slots);
  if (spellId !== EMPTY_SLOT) {
    for (let i = 0; i < next.length; i++) if (next[i] === spellId) next[i] = EMPTY_SLOT;
  }
  next[slot] = spellId;
  return next;
}

/** The first filled slot, or null (the cast button's spell when no slot was picked). */
export function activeSpell(loadout: readonly string[]): string | null {
  return loadout.find((id) => id !== EMPTY_SLOT) ?? null;
}

/** The part of a spell the spellbook rules need (spells.json). */
export interface SpellInfo {
  id: string;
  element: string;
  learnLevel?: number | undefined;
}

/**
 * The known spells your staff can use: only those of the element of your crystal (concept:
 * element branches work with a crystal of that element). Without a crystal nothing fits.
 */
export function usableSpells(
  known: readonly string[],
  defs: readonly SpellInfo[],
  crystal: string | null,
): string[] {
  if (crystal === null) return [];
  return known.filter((id) => defs.some((def) => def.id === id && def.element === crystal));
}

/** Spells of your crystal's element you reach by level (`learnLevel`) and do not know yet. */
export function spellsToLearn(
  known: readonly string[],
  defs: readonly SpellInfo[],
  crystal: string | null,
  level: number,
): string[] {
  if (crystal === null) return [];
  return defs
    .filter(
      (def) =>
        def.element === crystal &&
        def.learnLevel !== undefined &&
        def.learnLevel <= level &&
        !known.includes(def.id),
    )
    .map((def) => def.id);
}
