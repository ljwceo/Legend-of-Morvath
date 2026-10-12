import type { GameContext } from '../../core/GameContext';
import { button, el } from '../dom';
import type { Panel } from '../Overlays';

/**
 * A yes/no question. "No" is focused first, so pressing Enter by accident never confirms.
 * @param messageKey text key of the question
 */
export function confirmPanel(
  ctx: GameContext,
  messageKey: string,
  onYes: () => void,
  onNo?: () => void,
): Panel {
  return {
    // A question is answered with Yes or No, so it has no corner close button.
    closable: false,
    build: () => {
      const { t } = bindT(ctx);
      return el(
        'div',
        { className: 'ui-panel ui-confirm', attrs: { role: 'alertdialog' } },
        el('p', { className: 'ui-text', text: t(messageKey) }),
        el(
          'div',
          { className: 'ui-row' },
          button(t('common.no'), () => {
            ctx.overlays.close();
            onNo?.();
          }),
          button(t('common.yes'), () => {
            ctx.overlays.close();
            onYes();
          }),
        ),
      );
    },
  };
}

/** `t` bound to the context's I18n, for terse panel code. */
export function bindT(ctx: GameContext): { t: GameContext['i18n']['t'] } {
  return { t: ctx.i18n.t.bind(ctx.i18n) };
}
