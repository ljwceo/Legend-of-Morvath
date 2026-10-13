import type { GameContext } from '../core/GameContext';
import type { GameState } from '../core/StateMachine';
import type { CutscenesFile } from '../data/types';
import { button, el } from '../ui/dom';
import { Screen } from '../ui/Screen';
import { PanelSequence } from './flow';

type Cutscene = CutscenesFile['cutscenes'][number];

/** Id of the intro in cutscenes.json. */
const INTRO_ID = 'intro';

/**
 * The intro: the panels from cutscenes.json as text cards (art and narration audio come
 * later). A panel with a `fight` is played in IntroFightState, which comes back here at the
 * panel after it. Tap, click, Space or Enter goes to the next panel; Skip ends the intro.
 */
export class IntroState implements GameState {
  private readonly screen: Screen;
  private cutscene: Cutscene | null = null;
  private sequence: PanelSequence | null = null;

  constructor(private readonly ctx: GameContext) {
    this.screen = new Screen(ctx, 'ui-intro', () => this.build());
  }

  enter(): void {
    const cutscene = this.ctx.data?.cutscenes.cutscenes.find((entry) => entry.id === INTRO_ID);
    if (!cutscene) {
      this.ctx.reportProblem(`cutscene "${INTRO_ID}" missing`);
      this.ctx.goto('world');
      return;
    }
    this.cutscene = cutscene;
    this.sequence = new PanelSequence((cutscene.panels ?? []).length, this.ctx.introPanel);
    // Coming back after the fight past the last panel: the intro is over.
    if (this.ctx.introPanel >= (cutscene.panels ?? []).length) {
      this.done();
      return;
    }
    if (this.playFight()) return;
    this.ctx.renderer.clear();
    this.screen.mount();
    this.screen.root?.addEventListener('click', this.onTap);
    window.addEventListener('keydown', this.onKeyDown);
  }

  exit(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.screen.unmount();
    this.sequence = null;
  }

  private advance(): void {
    if (!this.sequence) return;
    if (this.sequence.next()) this.done();
    else if (!this.playFight()) this.screen.refresh();
  }

  private skip(): void {
    if (this.sequence?.skip()) this.done();
  }

  /** Hands a playable panel to the fight scene; returns true when it did. */
  private playFight(): boolean {
    const index = this.sequence?.index ?? 0;
    if (!this.cutscene?.panels?.[index]?.fight) return false;
    this.ctx.introPanel = index;
    this.ctx.goto('introFight');
    return true;
  }

  private done(): void {
    this.ctx.introPanel = 0;
    this.ctx.goto('world');
  }

  private build(): (Node | null)[] {
    const panel = this.sequence && this.cutscene?.panels?.[this.sequence.index];
    if (!panel || !this.sequence) return [];
    const t = this.ctx.i18n.t.bind(this.ctx.i18n);
    const skip = button(t('intro.skip'), () => this.skip());
    skip.classList.add('ui-skip');
    // The skip button must not also count as a tap on the panel.
    skip.addEventListener('click', (event) => event.stopPropagation());

    const dots = el('div', { className: 'ui-dots' });
    for (let i = 0; i < this.sequence.count; i++) {
      dots.append(
        el('span', { className: i === this.sequence.index ? 'ui-dot ui-dot-active' : 'ui-dot' }),
      );
    }

    return [
      skip,
      el(
        'div',
        { className: `ui-intro-card ui-intro-card-${this.sequence.index % 6}` },
        panel.narration ? el('p', { className: 'ui-story', text: t(panel.narration) }) : null,
        ...(panel.lines ?? []).map((line) =>
          el(
            'p',
            { className: 'ui-story ui-line' },
            el('span', { className: 'ui-speaker', text: line.speaker }),
            t(line.text),
          ),
        ),
      ),
      dots,
      el('p', { className: 'ui-note', text: t('intro.tapToContinue') }),
    ];
  }

  private readonly onTap = (): void => this.advance();

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // A focused button handles Space/Enter itself (as a click).
    if (event.repeat || event.target instanceof HTMLButtonElement) return;
    if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault();
      this.advance();
    } else if (event.code === 'Escape') {
      event.preventDefault();
      this.skip();
    }
  };
}
