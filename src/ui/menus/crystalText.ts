import type { TextParams } from '../../i18n/I18n';

type Translate = (key: string, params?: TextParams) => string;

/** What the bag and the spellbook need to say about the crystal in your staff. */
export interface CrystalSummary {
  /** Element name (Fire, Water, ...). */
  element: string;
  /** Size id from items.json `crystalSizes`. */
  size: string;
  damageBonus: number;
  spellSizePercent: number;
}

/** "Medium Fire Crystal: +2 damage per hit, spells 15% bigger" (all text from the language files). */
export function crystalLine(t: Translate, c: CrystalSummary): string {
  const parts = [
    t('crystal.name', { size: t(`crystal.size.${c.size}`), element: c.element }),
    t('bag.stat.weaponDamage', { n: c.damageBonus }),
  ];
  if (c.spellSizePercent > 0) parts.push(t('crystal.spellSize', { n: c.spellSizePercent }));
  return parts.join(' · ');
}
