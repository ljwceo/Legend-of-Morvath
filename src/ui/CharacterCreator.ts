import type { GameContext } from '../core/GameContext';
import type { AppearanceFile } from '../data/types';
import { numberToHex, resolveColorToken } from '../render/palette';
import { type Appearance, checkName, hairstylesFor, sanitizeName } from '../scenes/creator';
import type { StatPoints } from '../systems/Stats';
import { button, el, segmented } from './dom';
import { dismissKeyboard, guardTextInput } from './keyboard';
import { pointsLeftText, statSummary, statsEditor, statsPresetRow } from './StatsPanel';

export interface CreatorHandlers {
  /** The player picked another option (body type, hairstyle or a color). */
  change(appearance: Appearance): void;
  random(): void;
  /** A point moved, or a suggestion / Random / Start over was used (fase 3.7). */
  changeStats(points: StatPoints): void;
  randomStats(): void;
  preset(presetId: string): void;
  clearStats(): void;
  /** "Begin your journey" with a valid name and the points spread. */
  begin(name: string): void;
  back(): void;
}

/** The creator has two steps: first how you look, then how you fight. */
export type CreatorStep = 'looks' | 'stats';

/** A clickable color dot; `selected` gets the gold ring. */
function swatch(
  color: string,
  label: string,
  selected: boolean,
  onPick: () => void,
  border?: string,
): HTMLButtonElement {
  const dot = el('button', {
    className: selected ? 'ui-swatch ui-swatch-active' : 'ui-swatch',
    attrs: {
      type: 'button',
      role: 'radio',
      'aria-checked': String(selected),
      'aria-label': label,
      title: label,
    },
    onClick: onPick,
  });
  dot.style.backgroundColor = color;
  if (border) dot.style.borderColor = border;
  return dot;
}

/**
 * The HTML side of the character creator: a transparent "stage" where the 3D figure shows
 * (and can be dragged to turn), and a panel with the name and all options. The name field
 * stays the same element while options change, so typing and the keyboard are never
 * interrupted.
 */
export class CharacterCreator {
  /** Area over the 3D figure; the scene centers the figure here and listens for drags. */
  readonly stage: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly nameError: HTMLParagraphElement;
  private readonly options: HTMLDivElement;
  private releaseInput: (() => void) | null = null;
  private step: CreatorStep = 'looks';

  constructor(
    private readonly ctx: GameContext,
    private readonly data: AppearanceFile,
    private readonly startItems: { weapon: string; mantle: string },
    private readonly handlers: CreatorHandlers,
    private appearance: Appearance,
    private points: Readonly<StatPoints>,
    name: string,
  ) {
    this.stage = el('div', { className: 'ui-creator-stage' });
    this.input = el('input', {
      className: 'ui-input',
      attrs: {
        type: 'text',
        id: 'creator-name',
        autocomplete: 'off',
        autocorrect: 'off',
        autocapitalize: 'off',
        spellcheck: 'false',
        enterkeyhint: 'done',
        inputmode: 'text',
      },
    });
    this.input.value = name;
    this.input.addEventListener('input', this.onInput);
    this.nameError = el('p', { className: 'ui-field-error', attrs: { 'aria-live': 'polite' } });
    this.options = el('div', { className: 'ui-creator-options' });
  }

  get name(): string {
    return this.input.value;
  }

  /** Builds the screen (again after a language change). The draft stays as it was. */
  build(): (Node | null)[] {
    const t = this.ctx.i18n.t.bind(this.ctx.i18n);
    const panel = this.step === 'stats' ? this.statsPanel() : this.looksPanel();
    this.stage.replaceChildren(
      el('p', { className: 'ui-note ui-creator-hint', text: t('creator.dragToTurn') }),
    );
    return [this.stage, panel];
  }

  /** Step 1: your name and your looks. */
  private looksPanel(): HTMLElement {
    const t = this.ctx.i18n.t.bind(this.ctx.i18n);
    this.input.placeholder = t('creator.namePlaceholder');
    this.nameError.textContent = '';
    this.renderOptions();

    const next = button(t('creator.next'), () => this.toStats(), true);
    next.classList.add('ui-creator-begin');
    return el(
      'div',
      { className: 'ui-panel ui-creator-panel' },
      el('h2', { className: 'ui-heading', text: t('creator.title') }),
      el(
        'div',
        { className: 'ui-setting' },
        el('label', {
          className: 'ui-label',
          text: t('creator.name'),
          attrs: { for: 'creator-name' },
        }),
        this.input,
        this.nameError,
      ),
      this.options,
      el('p', {
        className: 'ui-note',
        text: t('creator.startItems', this.startItems),
      }),
      el(
        'div',
        { className: 'ui-row' },
        button(t('creator.back'), () => this.handlers.back()),
        button(t('creator.random'), () => this.handlers.random()),
      ),
      next,
    );
  }

  /** Step 2: spread your 20 points over the ten stats (fase 3.7). */
  private statsPanel(): HTMLElement {
    const ctx = this.ctx;
    const t = ctx.i18n.t.bind(ctx.i18n);
    const left = pointsLeftText(ctx, 1, this.points);
    const begin = button(t('creator.start'), () => this.begin(), true);
    begin.classList.add('ui-creator-begin');
    return el(
      'div',
      { className: 'ui-panel ui-creator-panel' },
      el('h2', { className: 'ui-heading', text: t('stats.title') }),
      el('p', { className: 'ui-note', text: t('stats.hint') }),
      el('p', { className: 'ui-stat-left', attrs: { 'aria-live': 'polite' }, text: left.text }),
      statsPresetRow(
        ctx,
        (presetId) => this.handlers.preset(presetId),
        () => this.handlers.randomStats(),
        () => this.handlers.clearStats(),
      ),
      statsEditor(ctx, {
        points: this.points,
        level: 1,
        path: null,
        canSpend: true,
        canRefund: true,
        onChange: (points) => this.handlers.changeStats(points),
      }),
      statSummary(ctx, this.points, 1, null),
      el(
        'div',
        { className: 'ui-row' },
        button(t('creator.backToLooks'), () => this.toLooks()),
      ),
      begin,
    );
  }

  /** Call once the screen is in the document. */
  attach(root: HTMLElement): void {
    this.releaseInput?.();
    this.releaseInput = guardTextInput(this.input, root);
  }

  detach(): void {
    this.releaseInput?.();
    this.releaseInput = null;
    dismissKeyboard();
  }

  /** Shows a new appearance (after an option, Random, ...). */
  setAppearance(appearance: Appearance): void {
    this.appearance = appearance;
    if (this.step === 'looks') this.renderOptions();
  }

  /** Shows a new point spread (after a plus, a suggestion, Random, ...). */
  setPoints(points: Readonly<StatPoints>): void {
    this.points = points;
    this.rebuild();
  }

  /** On to the points, but only with a name the game accepts. */
  private toStats(): void {
    if (!this.validName()) return;
    this.step = 'stats';
    this.rebuild();
  }

  private toLooks(): void {
    this.step = 'looks';
    this.rebuild();
  }

  /** Builds the screen again (the scene mounted it, so it owns the rebuild). */
  private rebuild(): void {
    this.onRebuild?.();
  }

  /** Set by the scene: rebuilds the screen with `build()`. */
  onRebuild: (() => void) | null = null;

  private begin(): void {
    const name = this.validName();
    if (name === null) return;
    this.handlers.begin(name);
  }

  /** The typed name, or null (with the reason shown) when the game cannot use it. */
  private validName(): string | null {
    dismissKeyboard();
    const check = checkName(this.input.value, this.data.name);
    if (check.ok) return check.name;
    const t = this.ctx.i18n.t.bind(this.ctx.i18n);
    // Back to the name field; the message is set after the rebuild, which clears it.
    if (this.step !== 'looks') {
      this.step = 'looks';
      this.rebuild();
    }
    this.nameError.textContent =
      check.reason === 'empty'
        ? t('creator.nameEmpty')
        : t('creator.nameInvalid', { max: this.data.name.maxLength });
    this.input.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return null;
  }

  private pick(change: Partial<Appearance>): void {
    this.handlers.change({ ...this.appearance, ...change });
  }

  private renderOptions(): void {
    const t = this.ctx.i18n.t.bind(this.ctx.i18n);
    const a = this.appearance;
    const d = this.data;
    const section = (labelKey: string, chosen: string | undefined, content: Node) =>
      el(
        'div',
        { className: 'ui-setting' },
        el(
          'span',
          { className: 'ui-label' },
          t(labelKey),
          chosen ? el('span', { className: 'ui-label-value', text: ` · ${chosen}` }) : null,
        ),
        content,
      );
    const labelOf = (list: readonly { id: string; label: string }[], id: string) => {
      const entry = list.find((item) => item.id === id);
      return entry ? t(entry.label) : undefined;
    };

    const hairstyles = el('div', { className: 'ui-chips', attrs: { role: 'radiogroup' } });
    for (const style of hairstylesFor(d, a.bodyType)) {
      const active = style.id === a.hairstyle;
      hairstyles.append(
        el('button', {
          className: active ? 'ui-chip ui-chip-active' : 'ui-chip',
          text: t(style.label),
          attrs: { type: 'button', role: 'radio', 'aria-checked': String(active) },
          onClick: () => this.pick({ hairstyle: style.id }),
        }),
      );
    }

    const swatches = (
      list: readonly { id: string; label: string }[],
      selected: string,
      colorOf: (index: number) => string,
      onPick: (id: string) => void,
      borderOf?: (index: number) => string,
    ) => {
      const row = el('div', { className: 'ui-swatches', attrs: { role: 'radiogroup' } });
      list.forEach((entry, index) =>
        row.append(
          swatch(
            colorOf(index),
            t(entry.label),
            entry.id === selected,
            () => onPick(entry.id),
            borderOf?.(index),
          ),
        ),
      );
      return row;
    };

    this.options.replaceChildren(
      section(
        'creator.bodyType',
        undefined,
        segmented(
          d.bodyTypes.map((body) => ({ value: body.id, label: t(body.label) })),
          a.bodyType,
          (bodyType) => this.handlers.change({ ...a, bodyType }),
        ),
      ),
      section('creator.hairstyle', undefined, hairstyles),
      section(
        'creator.hairColor',
        labelOf(d.hairColors, a.hairColor),
        swatches(
          d.hairColors,
          a.hairColor,
          (i) => d.hairColors[i]?.hex ?? '',
          (hairColor) => this.pick({ hairColor }),
        ),
      ),
      section(
        'creator.skinTone',
        labelOf(d.skinTones, a.skinTone),
        swatches(
          d.skinTones,
          a.skinTone,
          (i) => d.skinTones[i]?.hex ?? '',
          (skinTone) => this.pick({ skinTone }),
        ),
      ),
      section(
        'creator.mantleColor',
        labelOf(d.mantleColors, a.mantleColor),
        swatches(
          d.mantleColors,
          a.mantleColor,
          (i) => tokenCss(d.mantleColors[i]?.color),
          (mantleColor) => this.pick({ mantleColor }),
          (i) => tokenCss(d.mantleColors[i]?.embroidery),
        ),
      ),
    );
  }

  /** Filters while typing, so only letters and numbers (max 16) can ever be in the field. */
  private readonly onInput = (event: Event): void => {
    // Leave text alone while an input method (e.g. accents on a long press) is composing.
    if ((event as InputEvent).isComposing) return;
    const clean = sanitizeName(this.input.value, this.data.name);
    if (clean !== this.input.value) this.input.value = clean;
    if (clean.length > 0) this.nameError.textContent = '';
  };
}

function tokenCss(token: string | undefined): string {
  return token ? numberToHex(resolveColorToken(token)) : '';
}
