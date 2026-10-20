import type { GameContext } from '../../core/GameContext';
import { button, el } from '../dom';
import type { Panel } from '../Overlays';
import { bindT } from './ConfirmPanel';
import { settingsPanel } from './SettingsPanel';

/**
 * Pause menu: resume, your status, settings, or save and go back to the title screen. The
 * status window also has its own key; from here it is reachable on a phone too.
 */
export function pausePanel(
  ctx: GameContext,
  onClose: () => void,
  onStatus?: () => void,
  onSpellbook?: () => void,
  onLoadout?: () => void,
): Panel {
  return {
    build: () => {
      const { t } = bindT(ctx);
      return el(
        'div',
        { className: 'ui-panel ui-menu', attrs: { role: 'dialog' } },
        el('h2', { className: 'ui-heading', text: t('pause.title') }),
        button(t('pause.resume'), () => ctx.overlays.close(), true),
        onStatus
          ? button(t('status.title'), () => {
              ctx.overlays.close();
              onStatus();
            })
          : null,
        onLoadout
          ? button(t('pause.loadout'), () => {
              ctx.overlays.close();
              onLoadout();
            })
          : null,
        onSpellbook
          ? button(t('pause.spellbook'), () => {
              ctx.overlays.close();
              onSpellbook();
            })
          : null,
        button(t('pause.settings'), () => ctx.overlays.open(settingsPanel(ctx))),
        button(t('pause.toTitle'), () => {
          ctx.persist();
          ctx.overlays.closeAll();
          ctx.goto('title');
        }),
      );
    },
    onClose,
  };
}
