import { effectiveDamageBonus } from '../../systems/Forge';
import type { GameContext } from '../../core/GameContext';
import { emptyGearStats, gearStats } from '../../systems/Gear';
import type { StatPoints } from '../../systems/Stats';
import { el } from '../dom';
import type { Panel } from '../Overlays';
import { pointsLeftText, statSummary, statsEditor } from '../StatsPanel';
import { bindT } from './ConfirmPanel';

/** What the status window needs from the world (the world keeps the rules). */
export interface StatusHandlers {
  /** Spends points: the world saves them and recomputes everything. */
  spend(points: StatPoints): void;
  /** False in a fight: you can look, but not spend (concept: not while fighting). */
  canSpend(): boolean;
  /** "Level 3 · 120 / 220 XP". */
  xpLine(): string;
}

/**
 * The status window (its own key, Settings → Controls): your level and XP, the points you
 * still have, the ten stats with what they give you, and what worn gear adds on top. Points
 * can be spent any time but not in a fight; a point you spent stays spent (until you hand an
 * egg to Sultan, fase 3.9). The game is paused while it is open. It has no Close button of its
 * own: the ✕ in the corner, Escape, your own close key or the status key again (Bo, 2026-10-13).
 */
export function statusPanel(
  ctx: GameContext,
  handlers: StatusHandlers,
  onClose: () => void,
): Panel {
  return {
    closeActions: ['status'],
    build: () => {
      const { t } = bindT(ctx);
      const session = ctx.session;
      const level = session?.progress.level ?? 1;
      const points: StatPoints = { ...(session?.character?.stats ?? {}) };
      const path = session?.path ?? null;
      const canSpend = handlers.canSpend();
      const left = pointsLeftText(ctx, level, points);
      return el(
        'div',
        {
          className: 'ui-panel ui-menu ui-status',
          attrs: { role: 'dialog', 'aria-label': t('status.title') },
        },
        el('h2', { className: 'ui-heading', text: t('status.title') }),
        el('p', { className: 'ui-note', text: handlers.xpLine() }),
        el('p', { className: 'ui-stat-left', attrs: { 'aria-live': 'polite' }, text: left.text }),
        left.left > 0 && !canSpend
          ? el('p', { className: 'ui-note ui-note-warn', text: t('status.inCombat') })
          : null,
        statsEditor(ctx, {
          points,
          level,
          path,
          canSpend: canSpend && left.left > 0,
          // Spent is spent in the world; Sultan undoes it later (fase 3.9).
          canRefund: false,
          onChange: (next) => handlers.spend(next),
        }),
        statSummary(ctx, points, level, path),
        gearLine(ctx),
      );
    },
    onClose,
  };
}

/** One line with what worn gear adds on top of your stats (nothing shown without gear). */
function gearLine(ctx: GameContext): HTMLElement | null {
  const { t } = bindT(ctx);
  const character = ctx.session?.character;
  const items = ctx.data?.items.items;
  if (!character || !items) return null;
  const byId = new Map(items.map((item) => [item.id, item]));
  const stats = gearStats(character.equipment, byId, emptyGearStats(), character.upgrades);
  const parts: string[] = [];
  const n = (value: number): string => value.toLocaleString(ctx.i18n.language);
  if (stats.hp) parts.push(t('bag.stat.hp', { n: n(stats.hp) }));
  if (stats.mana) parts.push(t('bag.stat.mana', { n: n(stats.mana) }));
  if (stats.damagePercent) {
    parts.push(t('bag.stat.damagePercent', { n: n(stats.damagePercent) }));
  }
  if (stats.damageReductionPercent) {
    parts.push(t('bag.stat.damageReductionPercent', { n: n(stats.damageReductionPercent) }));
  }
  if (stats.moveSpeedPercent) {
    parts.push(t('bag.stat.moveSpeedPercent', { n: n(stats.moveSpeedPercent) }));
  }
  const weapon = character.equipment.weapon;
  const bonus = weapon ? effectiveDamageBonus(byId.get(weapon), character.upgrades) : undefined;
  if (bonus) parts.push(t('bag.stat.weaponDamage', { n: n(bonus) }));
  return el(
    'div',
    { className: 'ui-stat-summary' },
    el('span', { className: 'ui-label', text: t('status.fromGear') }),
    el('span', {
      className: 'ui-stat-line',
      text: parts.length > 0 ? parts.join(' · ') : t('status.noGear'),
    }),
  );
}
