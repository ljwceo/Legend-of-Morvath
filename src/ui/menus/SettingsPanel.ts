import type { GameContext } from '../../core/GameContext';
import { LANGUAGES, type Language } from '../../i18n/I18n';
import type { SaveSettings } from '../../save/SaveData';
import { button, el, segmented } from '../dom';
import type { Panel } from '../Overlays';
import { bindT, confirmPanel } from './ConfirmPanel';
import { controlsPanel } from './ControlsPanel';

/**
 * Settings: language, graphics preset, frame rate cap, volume, camera sensitivity, controls
 * (own panel), debug mode and deleting the save (two confirmations). Every change is saved
 * immediately.
 */
export function settingsPanel(ctx: GameContext): Panel {
  const change = (apply: (settings: SaveSettings) => void): void => {
    if (!ctx.session) return;
    apply(ctx.session.settings);
    ctx.persist();
    ctx.events.emit('settingsChanged', {});
    ctx.overlays.refreshTop();
  };

  const setLanguage = async (language: Language): Promise<void> => {
    if (!ctx.session || ctx.session.language === language) return;
    ctx.session.language = language;
    ctx.persist();
    await ctx.i18n.setLanguage(language);
    ctx.events.emit('languageChanged', { language });
  };

  const deleteSave = (): void => {
    ctx.overlays.open(
      confirmPanel(ctx, 'settings.deleteConfirm1', () =>
        ctx.overlays.open(
          confirmPanel(ctx, 'settings.deleteConfirm2', () => {
            ctx.saves.delete();
            ctx.session = null;
            // Starting completely over also means the default keys again.
            ctx.bindings.resetToDefaults();
            ctx.overlays.closeAll();
            // Back to the very beginning: language choice, then a new game.
            ctx.goto('language');
          }),
        ),
      ),
    );
  };

  return {
    build: () => {
      const { t } = bindT(ctx);
      const settings = ctx.session?.settings;
      if (!settings) return el('div', { className: 'ui-panel' });

      const row = (label: string, control: HTMLElement): HTMLElement =>
        el(
          'div',
          { className: 'ui-setting' },
          el('span', { className: 'ui-label', text: label }),
          control,
        );

      const volume = el('input', {
        className: 'ui-slider',
        attrs: {
          type: 'range',
          min: '0',
          max: '100',
          step: '5',
          value: String(Math.round(settings.volume * 100)),
          'aria-label': t('settings.volume'),
        },
      });
      // `change` (not `input`) so the save is written once when the slider is released.
      volume.addEventListener('change', () => {
        if (ctx.session) {
          ctx.session.settings.volume = Number(volume.value) / 100;
          ctx.persist();
          ctx.events.emit('settingsChanged', {});
        }
      });

      // Camera sensitivity: range from player.json (e.g. 30–100%), shown as a percentage.
      const range = ctx.data?.player.camera.sensitivity ?? { min: 0.3, max: 1 };
      const percent = (value: number): string => `${Math.round(value * 100)}%`;
      const sensitivityValue = el('span', {
        className: 'ui-slider-value',
        text: percent(settings.cameraSensitivity),
      });
      const sensitivity = el('input', {
        className: 'ui-slider',
        attrs: {
          type: 'range',
          min: String(Math.round(range.min * 100)),
          max: String(Math.round(range.max * 100)),
          step: '5',
          value: String(Math.round(settings.cameraSensitivity * 100)),
          'aria-label': t('settings.cameraSensitivity'),
        },
      });
      sensitivity.addEventListener('input', () => {
        sensitivityValue.textContent = percent(Number(sensitivity.value) / 100);
      });
      sensitivity.addEventListener('change', () => {
        if (ctx.session) {
          ctx.session.settings.cameraSensitivity = Number(sensitivity.value) / 100;
          ctx.persist();
          ctx.events.emit('settingsChanged', {});
        }
      });

      return el(
        'div',
        { className: 'ui-panel ui-settings', attrs: { role: 'dialog' } },
        el('h2', { className: 'ui-heading', text: t('settings.title') }),
        row(
          t('settings.language'),
          segmented(
            LANGUAGES.map((language) => ({ value: language, label: t(`language.${language}`) })),
            ctx.session?.language ?? ctx.i18n.language,
            (language) => void setLanguage(language),
          ),
        ),
        row(
          t('settings.quality'),
          segmented(
            [
              { value: 'auto', label: t('settings.qualityAuto') },
              { value: 'low', label: t('settings.qualityLow') },
              { value: 'mid', label: t('settings.qualityMid') },
              { value: 'high', label: t('settings.qualityHigh') },
            ] as const,
            settings.quality,
            (quality) => change((s) => (s.quality = quality)),
          ),
        ),
        row(
          t('settings.fpsCap'),
          segmented(
            [
              { value: 'auto', label: t('settings.fpsAuto') },
              { value: '60', label: t('settings.fps60') },
              { value: '120', label: t('settings.fps120') },
            ] as const,
            settings.fpsCap,
            (fpsCap) => change((s) => (s.fpsCap = fpsCap)),
          ),
        ),
        row(t('settings.volume'), volume),
        row(
          t('settings.cameraSensitivity'),
          el('div', { className: 'ui-slider-row' }, sensitivity, sensitivityValue),
        ),
        row(
          t('settings.debug'),
          segmented(
            [
              { value: 'off', label: t('common.off') },
              { value: 'on', label: t('common.on') },
            ] as const,
            settings.debug ? 'on' : 'off',
            (value) => change((s) => (s.debug = value === 'on')),
          ),
        ),
        row(
          t('settings.controls'),
          button(t('settings.controlsOpen'), () => ctx.overlays.open(controlsPanel(ctx))),
        ),
        el('p', { className: 'ui-note', text: t('settings.browserDataWarning') }),
        el(
          'div',
          { className: 'ui-row' },
          button(t('settings.deleteSave'), deleteSave),
          button(t('common.close'), () => ctx.overlays.close(), true),
        ),
      );
    },
  };
}
