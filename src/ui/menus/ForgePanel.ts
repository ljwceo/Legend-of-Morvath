import type { GameContext } from '../../core/GameContext';
import {
  checkUpgrade,
  effectiveDamageBonus,
  maxUpgradeLevel,
  type UpgradeResult,
  upgradeLevel,
} from '../../systems/Forge';
import { STAT_KEYS } from './BagPanel';
import { GOLD_ITEM } from '../../systems/Inventory';
import { button, el } from '../dom';
import type { Panel } from '../Overlays';
import { bindT } from './ConfirmPanel';

/**
 * Hilda's Forge: every weapon in your bag that can be upgraded, its level, what the next level
 * gives and costs, and an Upgrade button. Item names and "Gold" stay English (data).
 */
export function forgePanel(
  ctx: GameContext,
  smith: string,
  upgrade: (itemId: string) => UpgradeResult | 'inCombat',
  onClose: () => void,
): Panel {
  let message = '';
  return {
    build: () => {
      const { t } = bindT(ctx);
      const character = ctx.session?.character;
      const items = new Map(ctx.data?.items.items.map((item) => [item.id, item]) ?? []);
      const gold = items.get(GOLD_ITEM)?.name ?? 'Gold';
      const upgrades = character?.upgrades ?? {};
      const rows = (character?.inventory ?? [])
        .map((stack) => items.get(stack.item))
        .filter((def) => def?.upgrade !== undefined)
        .map((def) => {
          if (!def?.upgrade) return null;
          const level = upgradeLevel(upgrades, def.id);
          const next = def.upgrade.levels[level];
          const costs = next
            ? [
                t('forge.costItem', { count: next.gold, name: gold }),
                ...next.materials.map((m) =>
                  t('forge.costItem', { count: m.count, name: items.get(m.item)?.name ?? m.item }),
                ),
              ]
            : [];
          const effects: string[] = [];
          if (next?.damageBonus) effects.push(t('bag.stat.weaponDamage', { n: next.damageBonus }));
          for (const key of STAT_KEYS) {
            const n = next?.stats?.[key];
            if (n) effects.push(t(`bag.stat.${key}`, { n }));
          }
          const can =
            checkUpgrade(def, upgrades, character?.gold ?? 0, character?.inventory ?? []) ===
            'upgraded';
          return el(
            'li',
            { className: 'ui-bag-row' },
            el(
              'div',
              { className: 'ui-bag-item' },
              el('span', { className: 'ui-bag-name', text: def.name }),
              el('span', {
                className: 'ui-bag-desc',
                text: [
                  t('forge.level', { level, max: maxUpgradeLevel(def) }),
                  ...(def.weapon
                    ? [t('bag.stat.weaponDamage', { n: effectiveDamageBonus(def, upgrades) })]
                    : []),
                ].join(t('forge.effectSeparator')),
              }),
              el('span', {
                className: 'ui-shop-price',
                text: next
                  ? t('forge.next', {
                      effect: effects.join(t('forge.effectSeparator')),
                      cost: costs.join(t('forge.costSeparator')),
                    })
                  : t('forge.maxed'),
              }),
            ),
            next
              ? el('button', {
                  className: 'ui-chip',
                  text: t('forge.upgrade'),
                  attrs: {
                    type: 'button',
                    'aria-label': `${t('forge.upgrade')}: ${def.name}`,
                    ...(can ? {} : { 'aria-disabled': 'true' }),
                  },
                  onClick: () => {
                    const result = upgrade(def.id);
                    message =
                      result === 'upgraded'
                        ? t('forge.upgraded', {
                            item: def.name,
                            level: upgradeLevel(character?.upgrades ?? {}, def.id),
                          })
                        : result === 'notEnoughGold'
                          ? t('forge.notEnoughGold', { gold })
                          : result === 'inCombat'
                            ? t('forge.inCombat')
                            : t('forge.notEnoughMaterials');
                    ctx.overlays.refreshTop();
                  },
                })
              : null,
          );
        });
      return el(
        'div',
        { className: 'ui-panel ui-menu ui-bag ui-shop', attrs: { role: 'dialog' } },
        el('h2', { className: 'ui-heading', text: `${t('forge.title')} · ${smith}` }),
        el(
          'div',
          { className: 'ui-bag-stats' },
          el(
            'span',
            { className: 'ui-bag-gold' },
            el('span', { className: 'ui-hud-gold-coin' }),
            `${character?.gold ?? 0} ${gold}`,
          ),
        ),
        rows.length > 0
          ? el('ul', { className: 'ui-bag-list' }, ...rows)
          : el('p', { className: 'ui-shop-message', text: t('forge.empty') }),
        el('p', { className: 'ui-shop-message', attrs: { 'aria-live': 'polite' }, text: message }),
        button(t('common.close'), () => ctx.overlays.close(), true),
      );
    },
    onClose,
  };
}
