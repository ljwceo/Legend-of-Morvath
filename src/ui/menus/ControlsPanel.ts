import { type Action, BINDINGS_PER_ACTION, isBindableCode, mouseCode } from '../../core/Bindings';
import type { GameContext } from '../../core/GameContext';
import { button, el } from '../dom';
import { keyLabel } from '../keyLabels';
import type { Panel } from '../Overlays';
import { bindT } from './ConfirmPanel';

/**
 * Settings -> Controls: every action on the key or mouse button you want. Clicking a slot waits
 * for the next key or button; Escape cancels and Backspace clears the slot. A code that is
 * already in use is taken away from the other action, and the panel says so. The touch buttons
 * are their own buttons and never change, and the debug keys (F3, F4, F6) stay fixed.
 */
export function controlsPanel(ctx: GameContext): Panel {
  /** The action and slot waiting for a key, or null. */
  let listening: { action: Action; slot: number } | null = null;
  let message = '';
  let stopListening: (() => void) | null = null;

  const save = (): void => {
    if (ctx.session) {
      ctx.session.settings.keybindings = ctx.bindings.toSave() as Record<string, string[]>;
      ctx.persist();
    }
    ctx.events.emit('settingsChanged', {});
  };

  const refresh = (): void => ctx.overlays.refreshTop();

  const cancel = (): void => {
    stopListening?.();
    stopListening = null;
    listening = null;
  };

  /** Binds `code` to the slot that is listening and tells what it did. */
  const take = (code: string): void => {
    const target = listening;
    const { t } = bindT(ctx);
    if (!target) return;
    cancel();
    if (code === 'Backspace') {
      ctx.bindings.clear(target.action, target.slot);
      message = '';
      save();
      refresh();
      return;
    }
    if (!isBindableCode(code)) {
      message = t('controls.reserved', { key: keyLabel(code, t) });
      refresh();
      return;
    }
    const takenFrom = ctx.bindings.bind(target.action, target.slot, code);
    message = takenFrom
      ? t('controls.takenFrom', {
          key: keyLabel(code, t),
          action: t(`controls.action.${takenFrom}`),
        })
      : '';
    save();
    refresh();
  };

  const listen = (action: Action, slot: number): void => {
    cancel();
    listening = { action, slot };
    message = '';
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape') {
        cancel();
        refresh();
        return;
      }
      take(event.code);
    };
    const onMouseDown = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      take(mouseCode(event.button));
    };
    // Capture phase, so a key being bound never also does its old job in the game or the menu.
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('contextmenu', preventDefault, true);
    stopListening = () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('contextmenu', preventDefault, true);
    };
    refresh();
  };

  const resetAll = (): void => {
    cancel();
    ctx.bindings.resetToDefaults();
    message = '';
    save();
    refresh();
  };

  return {
    onClose: cancel,
    build: () => {
      const { t } = bindT(ctx);
      const debug = ctx.session?.settings.debug ?? false;
      const rows = ctx.bindings.actions
        .filter((action) => debug || !ctx.bindings.isDebugOnly(action))
        .map((action) => {
          const codes = ctx.bindings.codesFor(action);
          const slots = [];
          for (let slot = 0; slot < BINDINGS_PER_ACTION; slot++) {
            const code = codes[slot];
            const waiting = listening?.action === action && listening.slot === slot;
            slots.push(
              el('button', {
                className: waiting ? 'ui-key ui-key-waiting' : 'ui-key',
                text: waiting ? t('controls.pressAKey') : keyLabel(code ?? '', t),
                attrs: {
                  type: 'button',
                  'aria-label': `${t(`controls.action.${action}`)} ${slot + 1}`,
                },
                onClick: () => listen(action, slot),
              }),
            );
          }
          return el(
            'div',
            { className: 'ui-setting ui-control-row' },
            el('span', { className: 'ui-label', text: t(`controls.action.${action}`) }),
            el('div', { className: 'ui-key-row' }, ...slots),
          );
        });

      const unbound = ctx.bindings.unbound();
      return el(
        'div',
        { className: 'ui-panel ui-settings ui-controls', attrs: { role: 'dialog' } },
        el('h2', { className: 'ui-heading', text: t('controls.title') }),
        el('p', { className: 'ui-note', text: t('controls.help') }),
        ...rows,
        message !== '' ? el('p', { className: 'ui-note ui-note-warn', text: message }) : null,
        unbound.length > 0
          ? el('p', {
              className: 'ui-note ui-note-warn',
              text: t('controls.unbound', {
                actions: unbound.map((action) => t(`controls.action.${action}`)).join(', '),
              }),
            })
          : null,
        el(
          'div',
          { className: 'ui-row' },
          button(t('controls.reset'), resetAll),
          button(t('common.close'), () => ctx.overlays.close(), true),
        ),
      );
    },
  };
}

function preventDefault(event: Event): void {
  event.preventDefault();
}
