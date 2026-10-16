import { effectiveDamageBonus } from '../../systems/Forge';
import type { GameContext } from '../../core/GameContext';
import type { ItemDef } from '../../data/types';
import { EQUIPMENT_SLOTS, type EquipmentSlot, isGear, wornCount } from '../../systems/Gear';
import { el } from '../dom';
import type { QuestSummary } from '../questText';
import type { Panel } from '../Overlays';
import { bindT } from './ConfirmPanel';

/** The two tabs of the bag: your things, and the quests you are running. */
type BagTab = 'items' | 'quests';

/** Bag rows are sorted by item type in this order (then as they were picked up). */
export const BAG_TYPE_ORDER: readonly ItemDef['type'][] = [
  'potion',
  'weapon',
  'armor',
  'crystal',
  'egg',
  'quest',
  'recipe',
  'resource',
  'currency',
];

/** What the bag needs to show and change your gear (the world does the rules). */
export interface BagGear {
  /** Puts an item on; closing / rebuilding the panel is up to the bag. */
  equip(itemId: string): void;
  unequip(slot: EquipmentSlot): void;
  /** Carried and maximum kg, and the load tier (id for the colour, label key for the text). */
  load(): { kg: number; maxKg: number; tierId: string; tierLabel: string };
}

/** Item stats in the order they are listed under a gear row. */
export const STAT_KEYS = [
  'hp',
  'mana',
  'damagePercent',
  'damageReductionPercent',
  'moveSpeedPercent',
] as const;

/**
 * The bag (I / B or the bag button), in two tabs: **Bag** (gold, level and XP, equip load, the
 * six worn slots and every item with its count and description) and **Quests** (the running
 * quests with what is still missing). Potions have a Drink button, gear a Wear button (and worn
 * gear Take off). Item names stay English in both languages (CLAUDE.md §2.6).
 *
 * The ⤢ button next to the title makes the bag fill the whole playing field (remembered in the
 * save), and the lists scroll as one, so a long bag is never a tiny box inside a window
 * (Bo, 2026-10-13). Closing is the ✕ in the corner, Escape, your own close key, or the bag key
 * again — the panel has no Close button of its own. The game is paused while the bag is open.
 */
export function bagPanel(
  ctx: GameContext,
  drink: (itemId: string) => void,
  xpLine: () => string,
  quests: () => readonly QuestSummary[],
  gear: BagGear,
  onClose: () => void,
): Panel {
  // Which tab is open; it survives a rebuild (another item, another language).
  let tab: BagTab = 'items';
  return {
    closeActions: ['bag'],
    build: () => {
      const { t } = bindT(ctx);
      const settings = ctx.session?.settings;
      const full = settings?.bagFullscreen ?? false;
      const character = ctx.session?.character;
      const data = ctx.data;
      const items = new Map(data?.items.items.map((item) => [item.id, item]) ?? []);
      const equipment = character?.equipment ?? {};
      const kg = (value: number): string =>
        value.toLocaleString(ctx.i18n.language, { maximumFractionDigits: 1 });
      const nameEl = (def: ItemDef | undefined, fallback: string): HTMLElement =>
        itemNameEl(ctx, def, fallback);
      const gearLine = (def: ItemDef): string => {
        const parts = [t('bag.weight', { kg: kg(def.weight ?? 0) })];
        if (def.rarity !== 'common') parts.unshift(t(`bag.rarity.${def.rarity}`));
        const damage = effectiveDamageBonus(def, character?.upgrades ?? {});
        if (def.weapon && damage > 0) parts.push(t('bag.stat.weaponDamage', { n: damage }));
        for (const key of STAT_KEYS) {
          const n = def.stats?.[key];
          if (n) parts.push(t(`bag.stat.${key}`, { n }));
        }
        return parts.join(' · ');
      };
      const stacks = [...(character?.inventory ?? [])].sort(
        (a, b) =>
          BAG_TYPE_ORDER.indexOf(items.get(a.item)?.type ?? 'resource') -
          BAG_TYPE_ORDER.indexOf(items.get(b.item)?.type ?? 'resource'),
      );
      const rows = stacks.map((stack) => {
        const def = items.get(stack.item);
        const name = def?.name ?? stack.item;
        const worn = wornCount(equipment, stack.item);
        // A ring you have twice can be worn twice; anything else once.
        const canWearMore =
          isGear(def) && worn < Math.min(stack.count, def?.slot === 'ring' ? 2 : 1);
        const chip = (text: string, label: string, onClick: () => void): HTMLElement =>
          el('button', {
            className: 'ui-chip',
            text,
            attrs: { type: 'button', 'aria-label': `${label}: ${name}` },
            onClick,
          });
        const action =
          def?.type === 'potion'
            ? chip(t('bag.drink'), t('bag.drink'), () => drink(stack.item))
            : canWearMore
              ? chip(t('bag.equip'), t('bag.equip'), () => gear.equip(stack.item))
              : worn > 0
                ? el('span', { className: 'ui-bag-equipped', text: t('bag.equipped') })
                : null;
        return el(
          'li',
          { className: 'ui-bag-row' },
          el(
            'div',
            { className: 'ui-bag-item' },
            nameEl(def, stack.item),
            stack.count > 1
              ? el('span', { className: 'ui-bag-count', text: `×${stack.count}` })
              : null,
            def && isGear(def)
              ? el('span', { className: 'ui-bag-gear', text: gearLine(def) })
              : null,
            def?.description
              ? el('span', { className: 'ui-bag-desc', text: t(def.description) })
              : null,
          ),
          action,
        );
      });
      const load = gear.load();
      const slots = EQUIPMENT_SLOTS.map((slot) => {
        const id = equipment[slot];
        const def = id ? items.get(id) : undefined;
        return el(
          'li',
          { className: 'ui-bag-slot' },
          el('span', { className: 'ui-bag-slot-label', text: t(`bag.slot.${slot}`) }),
          id ? nameEl(def, id) : el('span', { className: 'ui-bag-slot-empty', text: '—' }),
          id && slot !== 'weapon'
            ? el('button', {
                className: 'ui-chip',
                text: t('bag.unequip'),
                attrs: { type: 'button', 'aria-label': `${t('bag.unequip')}: ${def?.name ?? id}` },
                onClick: () => gear.unequip(slot),
              })
            : null,
        );
      });
      const expand = el('button', {
        className: 'ui-bag-expand',
        text: full ? '⤡' : '⤢',
        attrs: {
          type: 'button',
          'aria-label': t(full ? 'bag.collapse' : 'bag.expand'),
          title: t(full ? 'bag.collapse' : 'bag.expand'),
        },
        onClick: () => {
          if (!settings) return;
          settings.bagFullscreen = !settings.bagFullscreen;
          ctx.persist();
          ctx.overlays.refreshTop();
        },
      });
      const tabButton = (id: BagTab, label: string): HTMLElement =>
        el('button', {
          className: tab === id ? 'ui-bag-tab ui-bag-tab-active' : 'ui-bag-tab',
          text: label,
          attrs: { type: 'button', role: 'tab', 'aria-selected': String(tab === id) },
          onClick: () => {
            tab = id;
            ctx.overlays.refreshTop();
          },
        });
      return el(
        'div',
        {
          className: full ? 'ui-panel ui-menu ui-bag ui-bag-full' : 'ui-panel ui-menu ui-bag',
          attrs: { role: 'dialog' },
        },
        el(
          'div',
          { className: 'ui-bag-head' },
          el('h2', { className: 'ui-heading', text: t('bag.title') }),
          expand,
        ),
        el(
          'div',
          { className: 'ui-bag-tabs', attrs: { role: 'tablist' } },
          tabButton('items', t('bag.tab.items')),
          tabButton('quests', t('bag.tab.quests')),
        ),
        el(
          'div',
          { className: 'ui-bag-content' },
          tab === 'quests'
            ? questList(quests(), t)
            : el(
                'div',
                { className: 'ui-bag-pane' },
                el(
                  'div',
                  { className: 'ui-bag-stats' },
                  el(
                    'span',
                    { className: 'ui-bag-gold' },
                    el('span', { className: 'ui-hud-gold-coin' }),
                    // "Gold" is a temporary name and stays English (data, not a text key).
                    `${character?.gold ?? 0} ${items.get('gold')?.name ?? 'Gold'}`,
                  ),
                  el('span', { className: 'ui-bag-level', text: xpLine() }),
                ),
                el(
                  'p',
                  { className: `ui-bag-load ui-bag-load-${load.tierId}` },
                  t('bag.load', { kg: kg(load.kg), max: kg(load.maxKg), tier: t(load.tierLabel) }),
                ),
                el('h3', { className: 'ui-bag-subheading', text: t('bag.equipment') }),
                el('ul', { className: 'ui-bag-slots' }, ...slots),
                el('h3', { className: 'ui-bag-subheading', text: t('bag.items') }),
                rows.length > 0
                  ? el('ul', { className: 'ui-bag-list' }, ...rows)
                  : el('p', { className: 'ui-note', text: t('bag.empty') }),
              ),
        ),
      );
    },
    onClose,
  };
}

/** An item name (English, data) in its rarity colour; common items keep the text colour. */
export function itemNameEl(
  ctx: GameContext,
  def: ItemDef | undefined,
  fallback: string,
): HTMLElement {
  const span = el('span', { className: 'ui-bag-name', text: def?.name ?? fallback });
  if (def && def.rarity !== 'common') {
    const token = ctx.data?.items.rarities.find((r) => r.id === def.rarity)?.color;
    // Mixed with the text colour: the pure blue / violet are too dark on the panel.
    if (token) span.style.color = `color-mix(in srgb, var(--gh-${token}) 65%, var(--gh-tekst))`;
  }
  return span;
}

/** The running quests: name (English) and each objective with ✓ / ✗. */
function questList(quests: readonly QuestSummary[], t: (key: string) => string): HTMLElement {
  const heading = el('h3', { className: 'ui-bag-subheading', text: t('bag.quests') });
  if (quests.length === 0) {
    return el('div', {}, heading, el('p', { className: 'ui-note', text: t('bag.noQuests') }));
  }
  const items = quests.map((quest) =>
    el(
      'li',
      { className: 'ui-bag-row ui-bag-quest' },
      el('span', { className: 'ui-bag-name', text: quest.name }),
      ...quest.rows.map((row) =>
        el('span', {
          className: row.done ? 'ui-bag-objective ui-bag-objective-done' : 'ui-bag-objective',
          text: `${row.done ? '✓' : '✗'} ${row.text}`,
        }),
      ),
    ),
  );
  return el('div', {}, heading, el('ul', { className: 'ui-bag-list' }, ...items));
}
