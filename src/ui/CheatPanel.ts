import type { GameContext } from '../core/GameContext';
import type { Input } from '../core/Input';
import { PLAYER_PATHS, type PlayerPath } from '../data/schemas';
import { DEBUG_VIEWS } from '../render/DebugOverlay';
import { CHEAT_SPEEDS, type Cheats } from '../systems/Cheats';
import { el } from './dom';

export interface CheatPanelHandlers {
  teleport(zoneId: string): void;
  /** A cheat setting changed (speed, fly or chunk borders). */
  changed(): void;
  /** The current save as a text code (the world writes its latest state first). */
  exportSave(): string;
  /** Replaces the save with an exported code; false when the code is not valid. */
  importSave(code: string): boolean;
  /** Forgets the automatic preset, so the benchmark runs again (Settings back to "Auto"). */
  rerunBenchmark(): void;
  /** Night monsters alive now (test mode text). */
  nightMonsters(): number;
  /**
   * Gives XP, gold, potions, Slime Gel, gear or the pack animal (testing levels, dying,
   * drinking, quests, load, Biscuit).
   */
  grant(kind: 'xp' | 'gold' | 'potions' | 'slimeGel' | 'gear' | 'packAnimal'): void;
  /** Starts the Sultan fight right away (no quests needed). */
  bossFight(): void;
  /** Counts Sultan as defeated without the fight (the teachers ask right away). */
  skipBoss(): void;
  /** The chosen path (Your Resolve), null = none yet. */
  path(): PlayerPath | null;
  /** Sets the path or clears it (the teachers ask again). */
  setPath(path: PlayerPath | null): void;
}

type SaveTool = 'none' | 'export' | 'import';

/** Length of an fps measurement from the cheat menu (seconds). */
const MEASURE_SECONDS = 20;

/**
 * Debug-only cheat menu for quick testing: walk faster, fly through walls, teleport to a zone,
 * show chunk borders, give XP, gold or potions, pick the debug overlay size. Opens with F6 or the "Cheats" button (both
 * in debug mode, also when the overlay is hidden). It is a
 * small panel at the side, so the game keeps running behind it. While flying on a touch screen,
 * ▲ / ▼ buttons appear next to the dash button.
 */
export class CheatPanel {
  readonly root: HTMLElement;
  private readonly openButton: HTMLButtonElement;
  private readonly flyButtons: HTMLElement;
  private panel: HTMLElement | null = null;
  private debugVisible = false;
  private saveTool: SaveTool = 'none';
  private saveCode = '';
  private importFailed = false;
  /** Live text of the day-night section (phase and time left), updated by `sync`. */
  private dayNightText: HTMLElement | null = null;

  constructor(
    private readonly ctx: GameContext,
    private readonly cheats: Cheats,
    private readonly zones: readonly { id: string; name: string }[],
    private readonly input: Input,
    private readonly handlers: CheatPanelHandlers,
  ) {
    this.openButton = el('button', {
      className: 'ui-cheats-button',
      attrs: { type: 'button' },
      onClick: () => this.toggle(),
    });
    const up = this.holdButton('ui-fly-up', '▲', 'dash');
    const down = this.holdButton('ui-fly-down', '▼', 'down');
    this.flyButtons = el('div', { className: 'ui-fly-buttons' }, up, down);
    this.root = el('div', { className: 'ui-cheats-layer' }, this.openButton, this.flyButtons);
    this.updateTexts();
    this.sync();
  }

  get isOpen(): boolean {
    return this.panel !== null;
  }

  /** Debug mode switched on or off; leaving debug mode switches every cheat off. */
  setDebugVisible(visible: boolean): void {
    if (visible === this.debugVisible) return;
    this.debugVisible = visible;
    if (!visible) {
      this.close();
      if (this.cheats.active || this.cheats.chunkLines) {
        this.cheats.reset();
        this.handlers.changed();
      }
    }
    this.sync();
  }

  toggle(): void {
    if (this.panel) this.close();
    else if (this.debugVisible) this.open();
  }

  /** Rebuilds the texts after a language change. */
  updateTexts(): void {
    const t = this.ctx.i18n.t.bind(this.ctx.i18n);
    this.openButton.textContent = t('cheats.open');
    const [up, down] = this.flyButtons.children;
    up?.setAttribute('aria-label', t('cheats.flyUp'));
    down?.setAttribute('aria-label', t('cheats.flyDown'));
    if (this.panel) this.rebuild();
  }

  dispose(): void {
    this.close();
    this.root.remove();
  }

  private open(): void {
    this.panel = this.build();
    this.root.append(this.panel);
  }

  private close(): void {
    this.panel?.remove();
    this.panel = null;
    this.saveTool = 'none';
    this.saveCode = '';
    this.importFailed = false;
  }

  private rebuild(): void {
    if (!this.panel) return;
    const next = this.build();
    this.panel.replaceWith(next);
    this.panel = next;
  }

  private changed(): void {
    this.handlers.changed();
    this.sync();
    this.rebuild();
  }

  /** Shows the open button in debug mode, and on touch screens the ▲ / ▼ buttons while flying. */
  sync(): void {
    this.openButton.hidden = !this.debugVisible;
    this.flyButtons.hidden = !(this.debugVisible && this.cheats.fly && this.isTouch());
    this.updateDayNightText();
  }

  private build(): HTMLElement {
    const t = this.ctx.i18n.t.bind(this.ctx.i18n);
    const { cheats } = this;
    const chip = (label: string, active: boolean, onClick: () => void): HTMLButtonElement =>
      el('button', {
        className: active ? 'ui-chip ui-chip-active' : 'ui-chip',
        text: label,
        attrs: { type: 'button', 'aria-pressed': String(active) },
        onClick,
      });
    const toggle = (value: boolean, set: (on: boolean) => void): HTMLElement =>
      el(
        'div',
        { className: 'ui-chips' },
        chip(t('cheats.off'), !value, () => set(false)),
        chip(t('cheats.on'), value, () => set(true)),
      );
    const section = (label: string, ...content: (HTMLElement | null)[]): HTMLElement =>
      el(
        'div',
        { className: 'ui-cheats-section' },
        el('p', { className: 'ui-label', text: label }),
        ...content,
      );

    return el(
      'div',
      {
        className: 'ui-panel ui-cheats',
        attrs: { role: 'dialog', 'aria-label': t('cheats.title') },
      },
      el('h2', { className: 'ui-heading', text: t('cheats.title') }),
      el('p', { className: 'ui-note', text: t('cheats.note') }),
      section(
        t('cheats.debugView'),
        el(
          'div',
          { className: 'ui-chips' },
          ...DEBUG_VIEWS.map((view) =>
            chip(t(`cheats.debugView_${view}`), this.ctx.debug.view === view, () => {
              this.ctx.debug.setView(view);
              this.rebuild();
            }),
          ),
        ),
        el('p', { className: 'ui-note', text: t('cheats.debugViewNote') }),
      ),
      section(
        t('cheats.speed'),
        el(
          'div',
          { className: 'ui-chips' },
          ...CHEAT_SPEEDS.map((speed) =>
            chip(`${speed}×`, cheats.speed === speed, () => {
              cheats.speed = speed;
              this.changed();
            }),
          ),
        ),
      ),
      section(
        t('cheats.fly'),
        toggle(cheats.fly, (on) => {
          cheats.fly = on;
          this.changed();
        }),
        cheats.fly
          ? el('p', {
              className: 'ui-note',
              text: t(this.isTouch() ? 'cheats.flyHintTouch' : 'cheats.flyHintKeys'),
            })
          : null,
      ),
      section(
        t('cheats.monsters'),
        toggle(cheats.monsters, (on) => {
          cheats.monsters = on;
          this.changed();
        }),
      ),
      section(
        t('cheats.grant'),
        el(
          'div',
          { className: 'ui-chips' },
          chip(t('cheats.grantXp'), false, () => this.handlers.grant('xp')),
          chip(t('cheats.grantGold'), false, () => this.handlers.grant('gold')),
          chip(t('cheats.grantPotions'), false, () => this.handlers.grant('potions')),
          chip(t('cheats.grantSlimeGel'), false, () => this.handlers.grant('slimeGel')),
          chip(t('cheats.grantGear'), false, () => this.handlers.grant('gear')),
          chip(t('cheats.grantPackAnimal'), false, () => this.handlers.grant('packAnimal')),
        ),
      ),
      section(
        t('cheats.boss'),
        el(
          'div',
          { className: 'ui-chips' },
          chip(t('cheats.bossSultan'), false, () => this.handlers.bossFight()),
          chip(t('cheats.bossSkip'), false, () => this.handlers.skipBoss()),
        ),
      ),
      section(
        t('cheats.path'),
        el(
          'div',
          { className: 'ui-chips' },
          ...[null, ...PLAYER_PATHS].map((path) =>
            chip(t(`cheats.path_${path ?? 'none'}`), this.handlers.path() === path, () => {
              this.handlers.setPath(path);
              this.rebuild();
            }),
          ),
        ),
      ),
      section(
        t('cheats.chunkLines'),
        toggle(cheats.chunkLines, (on) => {
          cheats.chunkLines = on;
          this.changed();
        }),
      ),
      this.seasonSection(chip, section),
      this.dayNightSection(chip, section),
      section(
        t('cheats.quality'),
        el('p', { className: 'ui-note', text: this.ctx.quality.debugLine() }),
        el(
          'div',
          { className: 'ui-chips' },
          chip(t('cheats.rerunBenchmark'), false, () => {
            this.handlers.rerunBenchmark();
            this.rebuild();
          }),
        ),
      ),
      section(
        t('cheats.measure'),
        el('p', {
          className: 'ui-note',
          text: t('cheats.measureNote', { seconds: MEASURE_SECONDS }),
        }),
        el('p', { className: 'ui-note', text: this.ctx.perfText() }),
        el(
          'div',
          { className: 'ui-chips' },
          chip(t('cheats.measureStart', { seconds: MEASURE_SECONDS }), false, () => {
            this.ctx.perf.start(MEASURE_SECONDS);
            // The panel itself costs a little; measure the plain game.
            this.close();
          }),
        ),
      ),
      this.saveSection(chip, section),
      section(
        t('cheats.teleport'),
        el(
          'div',
          { className: 'ui-chips' },
          // Zone names stay English in both languages (CLAUDE.md §2.6).
          ...this.zones.map((zone) =>
            chip(zone.name, false, () => this.handlers.teleport(zone.id)),
          ),
        ),
      ),
      el('button', {
        className: 'ui-button',
        text: t('cheats.close'),
        attrs: { type: 'button' },
        onClick: () => this.close(),
      }),
    );
  }

  /** Force a season (or follow the calendar again). Same as F4, but also on a phone. */
  private seasonSection(
    chip: (label: string, active: boolean, onClick: () => void) => HTMLButtonElement,
    section: (label: string, ...content: (HTMLElement | null)[]) => HTMLElement,
  ): HTMLElement | null {
    const seasons = this.ctx.seasons;
    const data = this.ctx.data;
    if (!seasons || !data) return null;
    const t = this.ctx.i18n.t.bind(this.ctx.i18n);
    const set = (id: string | null): void => {
      seasons.override = id;
      this.rebuild();
    };
    return section(
      t('cheats.season'),
      el(
        'div',
        { className: 'ui-chips' },
        chip(t('cheats.seasonCalendar'), seasons.override === null, () => set(null)),
        ...data.seasons.order.map((id) => {
          const def = data.seasons.seasons.find((season) => season.id === id);
          return chip(def ? t(def.label) : id, seasons.override === id, () => set(id));
        }),
      ),
    );
  }

  /**
   * Test mode for day and night: the phase and how long it still lasts, jump to a phase, run the
   * clock faster, or follow the real clock again. Never saved.
   */
  private dayNightSection(
    chip: (label: string, active: boolean, onClick: () => void) => HTMLButtonElement,
    section: (label: string, ...content: (HTMLElement | null)[]) => HTMLElement,
  ): HTMLElement | null {
    const clock = this.ctx.dayNight;
    const data = this.ctx.data;
    if (!clock || !data) return null;
    const t = this.ctx.i18n.t.bind(this.ctx.i18n);
    const act = (change: () => void): void => {
      change();
      this.rebuild();
    };
    const text = el('p', { className: 'ui-note' });
    this.dayNightText = text;
    const result = section(
      t('cheats.dayNight'),
      text,
      el(
        'div',
        { className: 'ui-chips' },
        chip(t('cheats.dayNightClock'), !clock.overridden, () => act(() => clock.followClock())),
        ...data.daynight.phases.map((phase) =>
          chip(t(phase.label), false, () => act(() => clock.jumpTo(phase.id))),
        ),
      ),
      el('p', { className: 'ui-label', text: t('cheats.dayNightSpeed') }),
      el(
        'div',
        { className: 'ui-chips' },
        ...data.daynight.testSpeeds.map((speed) =>
          chip(`${speed}×`, clock.speed === speed, () => act(() => clock.setSpeed(speed))),
        ),
      ),
    );
    this.writeDayNightText(text);
    return result;
  }

  /** Refreshes "Night · 12:31 left" while the panel is open (called on the debug timer). */
  private updateDayNightText(): void {
    if (this.panel && this.dayNightText) this.writeDayNightText(this.dayNightText);
  }

  private writeDayNightText(target: HTMLElement): void {
    const clock = this.ctx.dayNight;
    if (!clock) return;
    const t = this.ctx.i18n.t.bind(this.ctx.i18n);
    const phase = clock.phase();
    const seconds = Math.ceil(phase.remainingMs / 1000);
    const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    target.textContent =
      `${t('cheats.dayNightNow', { phase: t(phase.label), time })} · ` +
      t('cheats.dayNightMonsters', { count: this.handlers.nightMonsters() });
  }

  /** Save as a text code: export (to copy) and import (paste a code), for testing. */
  private saveSection(
    chip: (label: string, active: boolean, onClick: () => void) => HTMLButtonElement,
    section: (label: string, ...content: (HTMLElement | null)[]) => HTMLElement,
  ): HTMLElement {
    const t = this.ctx.i18n.t.bind(this.ctx.i18n);
    const choose = (tool: SaveTool): void => {
      this.saveTool = this.saveTool === tool ? 'none' : tool;
      this.saveCode = this.saveTool === 'export' ? this.handlers.exportSave() : '';
      this.importFailed = false;
      this.rebuild();
    };
    let tool: HTMLElement | null = null;
    if (this.saveTool !== 'none') {
      const exporting = this.saveTool === 'export';
      const area = el('textarea', {
        className: 'ui-code',
        attrs: {
          rows: '4',
          spellcheck: 'false',
          autocomplete: 'off',
          'aria-label': t(exporting ? 'cheats.saveExport' : 'cheats.saveImport'),
          ...(exporting ? { readonly: '' } : { placeholder: t('cheats.savePaste') }),
        },
      });
      area.value = this.saveCode;
      if (exporting) area.addEventListener('focus', () => area.select());
      const action = exporting
        ? chip(t('cheats.saveCopy'), false, () => {
            area.select();
            void navigator.clipboard?.writeText(this.saveCode).catch(() => undefined);
          })
        : chip(t('cheats.saveLoad'), false, () => {
            if (this.handlers.importSave(area.value)) {
              this.close();
              return;
            }
            this.saveCode = area.value;
            this.importFailed = true;
            this.rebuild();
          });
      tool = el(
        'div',
        { className: 'ui-cheats-tool' },
        area,
        el('div', { className: 'ui-chips' }, action),
        this.importFailed
          ? el('p', { className: 'ui-note ui-error', text: t('cheats.saveInvalid') })
          : null,
      );
    }
    return section(
      t('cheats.save'),
      el(
        'div',
        { className: 'ui-chips' },
        chip(t('cheats.saveExport'), this.saveTool === 'export', () => choose('export')),
        chip(t('cheats.saveImport'), this.saveTool === 'import', () => choose('import')),
      ),
      tool,
    );
  }

  private isTouch(): boolean {
    return this.input.usedTouch || window.matchMedia('(pointer: coarse)').matches;
  }

  /** A touch button that holds an input action while pressed. */
  private holdButton(className: string, label: string, action: 'dash' | 'down'): HTMLButtonElement {
    const button = el('button', {
      className: `ui-touch-button ui-fly-button ${className}`,
      text: label,
      attrs: { type: 'button' },
    });
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.input.press(action);
    });
    const release = (): void => this.input.release(action);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('pointerleave', release);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
    return button;
  }
}
