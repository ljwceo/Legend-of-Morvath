import type { GameContext } from '../../core/GameContext';
import type { StatPoints } from '../../systems/Stats';
import { button, el } from '../dom';
import type { Panel } from '../Overlays';
import { pointsLeftText, statSummary, statsEditor, statsPresetRow } from '../StatsPanel';
import { bindT } from './ConfirmPanel';

/** What spreading your points again needs from the world (the world keeps the rules). */
export interface RedistributeHandlers {
  /** A point moved: the world saves the spread and recomputes everything. */
  change(points: StatPoints): void;
  /** A suggestion from stats.json ("Sword Fighter"). */
  preset(presetId: string): void;
  random(): void;
  clear(): void;
  /** "Level 5 · 120 / 400 XP". */
  xpLine(): string;
}

/**
 * Spreading your points again after handing an egg to Sultan (fase 3.9): the same stat list as
 * the character creator, so points can also come back out while this window is open. Your
 * level, path, gear and quests are untouched — only the points move. Closing it is fine with
 * points left over: they stay yours and the status window spends them later (one way, as usual).
 */
export function redistributePanel(
  ctx: GameContext,
  handlers: RedistributeHandlers,
  onClose: () => void,
): Panel {
  return {
    build: () => {
      const { t } = bindT(ctx);
      const session = ctx.session;
      const level = session?.progress.level ?? 1;
      const points: StatPoints = { ...(session?.character?.stats ?? {}) };
      const path = session?.path ?? null;
      const left = pointsLeftText(ctx, level, points);
      return el(
        'div',
        {
          className: 'ui-panel ui-menu ui-status',
          attrs: { role: 'dialog', 'aria-label': t('stats.reset.title') },
        },
        el('h2', { className: 'ui-heading', text: t('stats.reset.title') }),
        el('p', { className: 'ui-note', text: t('stats.reset.hint') }),
        el('p', { className: 'ui-note', text: handlers.xpLine() }),
        el('p', { className: 'ui-stat-left', attrs: { 'aria-live': 'polite' }, text: left.text }),
        statsPresetRow(
          ctx,
          (presetId) => handlers.preset(presetId),
          () => handlers.random(),
          () => handlers.clear(),
        ),
        statsEditor(ctx, {
          points,
          level,
          path,
          canSpend: left.left > 0,
          // Sultan freed every point: they may move back and forth until you walk away.
          canRefund: true,
          onChange: (next) => handlers.change(next),
        }),
        statSummary(ctx, points, level, path),
        button(t('stats.reset.done'), onClose, true),
      );
    },
    onClose,
  };
}
