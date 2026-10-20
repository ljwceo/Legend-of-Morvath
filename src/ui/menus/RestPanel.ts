import type { GameContext } from '../../core/GameContext';
import type { FlaskState } from '../../systems/Flasks';
import { button, el } from '../dom';
import type { Panel } from '../Overlays';
import { bindT } from './ConfirmPanel';

/** What the rest panel needs from the world (the world owns the one rest transaction). */
export interface RestHandlers {
  /** The Flasks as they are now (already refilled by the rest that opened this panel). */
  flasks(): FlaskState;
  /**
   * Changes the split while still resting: `health` charges for the Health Flask, the rest for
   * mana. The world refills to the new split at once; nothing else happens again (no second
   * checkpoint event, no second save; the save follows when the panel closes).
   */
  setHealth(health: number): void;
}

/**
 * Resting at a checkpoint (G.5): HP, mana and the Flasks are full again, and this is the one
 * place to change how the charges are split over the Health Flask and the Mana Flask. The
 * panel only opens through a real rest (out of a fight, at a checkpoint), never from the bag
 * or another menu; the game pauses while it is open. Names (Health Flask, Mana Flask) stay
 * English in both languages, like item names.
 */
export function restPanel(ctx: GameContext, handlers: RestHandlers, onClose: () => void): Panel {
  return {
    build: () => {
      const { t } = bindT(ctx);
      const flasks = handlers.flasks();
      const row = (
        name: string,
        left: number,
        max: number,
        less: { label: string; to: number } | null,
        more: { label: string; to: number } | null,
      ): HTMLElement => {
        const minus = button('−', () => {
          if (less) handlers.setHealth(less.to);
        });
        minus.classList.add('ui-rest-step');
        minus.disabled = less === null;
        minus.setAttribute('aria-label', less?.label ?? '');
        const plus = button('+', () => {
          if (more) handlers.setHealth(more.to);
        });
        plus.classList.add('ui-rest-step');
        plus.disabled = more === null;
        plus.setAttribute('aria-label', more?.label ?? '');
        return el(
          'div',
          { className: 'ui-rest-row' },
          el('span', { className: 'ui-rest-name', text: name }),
          el('span', {
            className: 'ui-rest-count',
            attrs: { 'aria-live': 'polite' },
            text: t('rest.charges', { left, max }),
          }),
          minus,
          plus,
        );
      };
      const health = flasks.health;
      const canMoveToMana = health > 0;
      const canMoveToHealth = health < flasks.capacity;
      return el(
        'div',
        {
          className: 'ui-panel ui-menu ui-rest',
          attrs: { role: 'dialog', 'aria-label': t('rest.title') },
        },
        el('h2', { className: 'ui-heading', text: t('rest.title') }),
        el('p', { className: 'ui-note', text: t('rest.capacity', { capacity: flasks.capacity }) }),
        row(
          t('hud.flask.health'),
          flasks.healthLeft,
          flasks.health,
          canMoveToMana ? { label: t('rest.lessHealth'), to: health - 1 } : null,
          canMoveToHealth ? { label: t('rest.moreHealth'), to: health + 1 } : null,
        ),
        row(
          t('hud.flask.mana'),
          flasks.manaLeft,
          flasks.mana,
          canMoveToHealth ? { label: t('rest.lessMana'), to: health + 1 } : null,
          canMoveToMana ? { label: t('rest.moreMana'), to: health - 1 } : null,
        ),
        el('p', { className: 'ui-note', text: t('rest.hint') }),
        button(t('common.close'), () => ctx.overlays.close(), true),
      );
    },
    onClose,
  };
}
