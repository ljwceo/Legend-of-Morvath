import type { CutscenesFile } from '../data/types';
import { numberToHex, resolveColorToken } from '../render/palette';
import { button, el } from './dom';

type Cutscene = CutscenesFile['cutscenes'][number];

/**
 * A comic-strip cutscene over the game (concept: "5 plaatjes die in beeld schuiven met
 * tekstballonnen, inzoomen en schudden"). Panels from cutscenes.json slide in one at a time:
 * a caption of what you see (there is no art yet), a speech bubble, and per panel a slow zoom,
 * a shake or a flash. Tap, click, Space or Enter goes to the next panel; Skip or Escape ends it.
 * The world waits underneath (the caller pauses it).
 */
export class ComicCutscene {
  readonly root: HTMLElement;
  private index = 0;
  private finished = false;
  private readonly stage: HTMLElement;
  private readonly note: HTMLElement;
  private readonly skip: HTMLButtonElement;

  constructor(
    private readonly cutscene: Cutscene,
    private readonly t: (key: string) => string,
    private readonly onDone: (skipped: boolean) => void,
  ) {
    this.stage = el('div', { className: 'ui-comic-stage' });
    this.note = el('p', { className: 'ui-note', text: t('cutscene.tapToContinue') });
    this.skip = button(t('cutscene.skip'), () => this.end(true));
    this.skip.classList.add('ui-skip');
    // The skip button must not also count as a tap on the panel.
    this.skip.addEventListener('click', (event) => event.stopPropagation());
    this.skip.hidden = !cutscene.skippable;
    this.root = el('div', { className: 'ui-comic' }, this.skip, this.stage, this.note);
    this.root.addEventListener('click', this.onTap);
    window.addEventListener('keydown', this.onKeyDown);
    this.show();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.root.remove();
  }

  private show(): void {
    const panel = this.cutscene.panels?.[this.index];
    if (!panel) return;
    const t = this.t;
    const classes = ['ui-comic-frame'];
    if (panel.zoom) classes.push('ui-comic-zoom');
    if (panel.shake) classes.push('ui-comic-shake');
    if (panel.flash) classes.push('ui-comic-flash');
    const art = el('div', { className: 'ui-comic-art' });
    const color = numberToHex(resolveColorToken(panel.background ?? 'schemerviolet'));
    art.style.background = `radial-gradient(circle at 50% 60%, ${color} 0%, color-mix(in srgb, ${color} 45%, var(--gh-nachtinkt)) 70%)`;
    const line = panel.lines?.[0];
    const frame = el(
      'div',
      { className: classes.join(' ') },
      art,
      panel.caption ? el('p', { className: 'ui-comic-caption', text: t(panel.caption) }) : null,
      panel.narration ? el('p', { className: 'ui-comic-caption', text: t(panel.narration) }) : null,
      line
        ? el(
            'p',
            { className: 'ui-comic-bubble' },
            el('span', { className: 'ui-comic-speaker', text: line.speaker }),
            t(line.text),
          )
        : null,
    );
    this.stage.replaceChildren(frame);
  }

  private next(): void {
    if (this.finished) return;
    this.index++;
    if (this.index >= (this.cutscene.panels ?? []).length) this.end(false);
    else this.show();
  }

  private end(skipped: boolean): void {
    if (this.finished) return;
    this.finished = true;
    this.dispose();
    this.onDone(skipped);
  }

  private readonly onTap = (): void => this.next();

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || event.target instanceof HTMLButtonElement) return;
    if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault();
      this.next();
    } else if (event.code === 'Escape' && this.cutscene.skippable) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.end(true);
    }
  };
}
