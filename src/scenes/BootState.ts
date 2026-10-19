import type { GameContext } from '../core/GameContext';
import type { GameState } from '../core/StateMachine';
import { loadDataFiles } from '../data/DataLoader';
import { formatIssue, validateGameData } from '../data/DataValidator';
import { dataFileNames } from '../data/schemas';
import { detectLanguage, isLanguage, type Language } from '../i18n/I18n';
import { colorTokens } from '../render/palette';
import { DayNightService } from '../services/DayNightService';
import { SeasonService } from '../services/SeasonService';
import { el } from '../ui/dom';
import { Screen } from '../ui/Screen';
import { bootRoute } from './flow';

/**
 * First scene: loads the save, the language file and all game data (with a loading bar),
 * validates the data, then continues to the language choice or the title screen.
 */
export class BootState implements GameState {
  private readonly screen: Screen;
  private progress = 0;
  private message: string | null = null;
  private started = false;

  constructor(private readonly ctx: GameContext) {
    this.screen = new Screen(ctx, 'ui-boot', () => this.build());
  }

  enter(): void {
    this.ctx.renderer.clear();
    this.screen.mount();
    if (this.started) return;
    this.started = true;
    this.run().catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      this.ctx.reportProblem(`boot failed: ${detail}`);
      this.showMessage(this.ctx.i18n.t('boot.error'));
    });
  }

  exit(): void {
    this.screen.unmount();
  }

  private async run(): Promise<void> {
    const { ctx } = this;
    const loaded = ctx.saves.load();
    if (loaded.status === 'ok') ctx.session = loaded.save;
    if (loaded.status === 'ok' && loaded.migratedFrom !== undefined) {
      // The original is backed up (SaveManager.load); store the migrated form right away, so
      // what is stored and what the game plays never differ in version.
      console.info(`save: migrated from version ${loaded.migratedFrom}`);
      ctx.persist();
      if (ctx.saves.backupPending) {
        ctx.reportProblem('save: no room for a backup of the old save; it is kept as it was');
      }
    }
    if (loaded.status === 'corrupt') ctx.reportProblem('save: corrupt, backup kept');
    if (!ctx.saves.available) ctx.reportProblem('save: localStorage unavailable');

    // `?lang=nl` forces a language (testing); otherwise the save, then the browser language.
    const langParam = ctx.params.get('lang');
    const language: Language = isLanguage(langParam)
      ? langParam
      : (ctx.session?.language ?? detectLanguage(navigator.language));
    await ctx.i18n.setLanguage(language);
    this.setProgress(1 / (dataFileNames.length + 1));

    const route = bootRoute(loaded);
    if (route === 'blocked') {
      ctx.reportProblem(
        `save: made by newer version ${loaded.status === 'newer' ? loaded.version : '?'}`,
      );
      this.showMessage(ctx.i18n.t('save.newerVersion'));
      return;
    }

    const raw = await loadDataFiles((done, total) => this.setProgress((done + 1) / (total + 1)));
    const { data, issues } = validateGameData(raw, { textKeys: ctx.i18n.keys, colorTokens });
    for (const issue of issues) ctx.reportProblem(formatIssue(issue));
    if (issues.length > 0)
      ctx.reportProblem(ctx.i18n.t('boot.dataErrors', { count: issues.length }));
    if (!data) {
      this.showMessage(ctx.i18n.t('boot.error'));
      return;
    }

    ctx.data = data;
    // Keys and mouse buttons: defaults from controls.json, the player's own choices from the save.
    ctx.bindings.configure(data.controls, ctx.session?.settings.keybindings);
    ctx.pads.configure(data.controls.gamepad);
    ctx.seasons = new SeasonService(data.seasons);
    ctx.dayNight = new DayNightService(data.daynight);
    const seasonParam = ctx.params.get('season');
    if (seasonParam && data.seasons.order.includes(seasonParam)) ctx.seasons.override = seasonParam;
    // Apply the saved settings (frame cap, debug mode) now that the save is known.
    ctx.events.emit('settingsChanged', {});

    if (!ctx.session && !ctx.saves.available) {
      ctx.reportProblem(ctx.i18n.t('save.storageUnavailable'));
    }
    ctx.goto(route);
  }

  private setProgress(fraction: number): void {
    this.progress = Math.min(1, fraction);
    this.screen.refresh();
  }

  private showMessage(text: string): void {
    this.message = text;
    this.screen.refresh();
  }

  private build(): (Node | null)[] {
    const percent = Math.round(this.progress * 100);
    const t = this.ctx.i18n;
    const bar = el(
      'div',
      { className: 'ui-loading', attrs: { role: 'progressbar', 'aria-valuenow': String(percent) } },
      el('div', { className: 'ui-loading-fill', attrs: { style: `width: ${percent}%` } }),
    );
    return [
      el('h1', { className: 'ui-title', text: t.has('game.title') ? t.t('game.title') : '' }),
      this.message ? el('p', { className: 'ui-text ui-error', text: this.message }) : bar,
      this.message || !t.has('boot.loading')
        ? null
        : el('p', { className: 'ui-note', text: t.t('boot.loading', { percent }) }),
    ];
  }
}
