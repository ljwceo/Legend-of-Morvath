import { el } from './dom';
import { type HudBars, type HudConfig, HudRules, HudVisibility } from './HudVisibility';

type BarId = 'hp' | 'mana' | 'energy' | 'xp';
const BAR_IDS: readonly BarId[] = ['hp', 'mana', 'energy', 'xp'];

/** One faded HUD element: its DOM node and why it is visible. */
class HudPart {
  readonly visibility = new HudVisibility();
  private shown = false;

  constructor(readonly element: HTMLElement) {}

  update(dt: number): void {
    this.visibility.update(dt);
    const visible = this.visibility.visible;
    if (visible === this.shown) return;
    this.shown = visible;
    this.element.classList.toggle('ui-hud-shown', visible);
  }
}

/**
 * The subtle in-game HUD (concept: "usually you see nothing"). Every element fades in when
 * there is a reason and fades out again (see HudVisibility / HudRules):
 * - zone name banner when entering a zone (top center),
 * - messages: first-visit texts, checkpoint, blocked gate, ... (one at a time, queued),
 * - HP / mana / energy / XP bars (top left) and gold (top right), following the HUD rules,
 * - the interaction icon above the nearest object you can use (tap it on a phone).
 * Everything sits at the top of the screen, so it never covers the joystick or the buttons
 * (their safe zones are the lower corners). Times come from player.json `hud`.
 */
/** Seconds the red edge glow stays on after a hit (then it fades out). */
const HURT_SECONDS = 0.12;
/** After a level up the XP bar stays full this long, then starts again from the leftover XP. */
const XP_FULL_SECONDS = 0.6;

export class HUD {
  readonly root: HTMLElement;
  readonly rules: HudRules;
  private readonly banner: HudPart;
  private readonly message: HudPart;
  private readonly interact: HudPart;
  private readonly bars: Record<BarId, HudPart>;
  private readonly fills: Record<BarId, HTMLElement>;
  private readonly fillValues: Record<BarId, number> = { hp: 1, mana: 1, energy: 1, xp: 0 };
  private readonly gold: HudPart;
  private readonly goldValue: HTMLElement;
  private readonly interactLabel: HTMLElement;
  private readonly interactKey: HTMLElement;
  private readonly queue: string[] = [];
  /** Seconds until the next queued message may appear (lets the previous one fade out). */
  private messageGap = 0;
  private interactX = Number.NaN;
  private interactY = Number.NaN;
  /** Red glow at the screen edges when the player is hit. */
  private readonly hurtGlow: HTMLElement;
  private hurtTime = 0;
  private hurtShown = false;
  /** Black screen when dying (opacity 0–1) with its text. */
  private readonly blackout: HTMLElement;
  private readonly blackoutTitle: HTMLElement;
  private readonly blackoutText: HTMLElement;
  private blackoutValue = 0;
  /** Boss fights: the boss's name and HP bar (top center), spoken lines and short tips. */
  private readonly boss: HTMLElement;
  private readonly bossName: HTMLElement;
  private readonly bossFill: HTMLElement;
  private bossValue = 1;
  private readonly subtitle: HTMLElement;
  private readonly subtitleName: HTMLElement;
  private readonly subtitleText: HTMLElement;
  private subtitleLeft = 0;
  private readonly hint: HTMLElement;
  private hintLeft = 0;
  /** XP left over after a level up, shown once the full bar has been seen (-1 = none). */
  private xpPending = -1;
  private xpFullTime = 0;
  /** The XP bar jumps (no animation) for one frame after a level up. */
  private xpInstant = false;
  /**
   * Reasons the whole HUD is hidden (a cinematic cutscene). Messages wait meanwhile, so none
   * is missed.
   */
  readonly hiddenBy = new HudVisibility();
  private hiddenShown = false;
  /** Big words after beating a boss ("BOND FORGED") with a small line under them. */
  private readonly victory: HTMLElement;
  private readonly victoryTitle: HTMLElement;
  private readonly victorySubtitle: HTMLElement;
  private victoryLeft = 0;

  constructor(
    private readonly cfg: HudConfig,
    lowHpFraction: number,
    onInteract: () => void,
  ) {
    const part = (className: string, ...children: HTMLElement[]): HudPart =>
      new HudPart(el('div', { className: `ui-hud-part ${className}` }, ...children));

    this.banner = part('ui-hud-banner');
    this.message = part('ui-hud-message');

    // The key is set from the bindings (Settings -> Controls), so it shows what you really press.
    this.interactKey = el('span', { className: 'ui-hud-interact-key' });
    this.interactLabel = el('span', { className: 'ui-hud-interact-label' });
    const interactButton = el(
      'button',
      { className: 'ui-hud-part ui-hud-interact', attrs: { type: 'button' } },
      this.interactKey,
      this.interactLabel,
    );
    // pointerdown: no click delay on phones; the event must not reach the camera surface.
    interactButton.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      if (this.interact.visibility.visible) onInteract();
    });
    this.interact = new HudPart(interactButton);

    const fills = {} as Record<BarId, HTMLElement>;
    const bars = {} as Record<BarId, HudPart>;
    const barStack = el('div', { className: 'ui-hud-bars' });
    for (const id of BAR_IDS) {
      fills[id] = el('div', { className: 'ui-hud-bar-fill' });
      bars[id] = part(`ui-hud-bar ui-hud-bar-${id}`, fills[id]);
      barStack.append(bars[id].element);
    }
    this.fills = fills;
    this.bars = bars;
    for (const id of BAR_IDS) this.applyFill(id, this.fillValues[id]);

    this.goldValue = el('span', { className: 'ui-hud-gold-value', text: '0' });
    this.gold = part('ui-hud-gold', el('span', { className: 'ui-hud-gold-coin' }), this.goldValue);

    this.bossName = el('div', { className: 'ui-hud-boss-name' });
    this.bossFill = el('div', { className: 'ui-hud-boss-fill' });
    this.boss = el(
      'div',
      { className: 'ui-hud-boss' },
      this.bossName,
      el('div', { className: 'ui-hud-boss-bar' }, this.bossFill),
    );
    this.subtitleName = el('div', { className: 'ui-dialog-name' });
    this.subtitleText = el('p', { className: 'ui-dialog-text' });
    this.subtitle = el(
      'div',
      { className: 'ui-fight-subtitle' },
      this.subtitleName,
      this.subtitleText,
    );
    this.hint = el('div', { className: 'ui-fight-hint ui-hud-hint' });

    this.victoryTitle = el('p', { className: 'ui-hud-victory-title' });
    this.victorySubtitle = el('p', { className: 'ui-hud-victory-subtitle' });
    this.victory = el(
      'div',
      { className: 'ui-hud-victory' },
      this.victoryTitle,
      this.victorySubtitle,
    );

    this.hurtGlow = el('div', { className: 'ui-hud-hurt' });
    this.blackoutTitle = el('p', { className: 'ui-hud-blackout-title' });
    this.blackoutText = el('p', { className: 'ui-hud-blackout-text' });
    this.blackout = el(
      'div',
      { className: 'ui-hud-blackout' },
      this.blackoutTitle,
      this.blackoutText,
    );
    this.root = el(
      'div',
      { className: 'ui-hud', attrs: { 'aria-live': 'polite' } },
      this.hurtGlow,
      this.banner.element,
      this.message.element,
      barStack,
      this.gold.element,
      this.interact.element,
      this.boss,
      this.hint,
      this.subtitle,
      this.victory,
      this.blackout,
    );
    this.root.style.setProperty('--hud-fade', `${cfg.fadeSeconds}s`);

    const visibility: HudBars = {
      hp: bars.hp.visibility,
      mana: bars.mana.visibility,
      energy: bars.energy.visibility,
      xp: bars.xp.visibility,
      gold: this.gold.visibility,
    };
    this.rules = new HudRules(visibility, cfg, lowHpFraction);
  }

  /** The zone name, big and calm, for a few seconds. */
  showZone(name: string): void {
    this.banner.element.textContent = name;
    this.banner.visibility.show('zone', this.cfg.zoneBannerSeconds);
  }

  /** Queues a short message (shown one at a time). The same text twice in a row is skipped. */
  showMessage(text: string): void {
    if (this.queue[this.queue.length - 1] === text) return;
    if (this.message.visibility.visible && this.message.element.textContent === text) return;
    this.queue.push(text);
  }

  /**
   * A sword fighter has no mana at all (his path, fase 3.8), so his bar is simply not there.
   * Called whenever the path, gear or level changes.
   */
  setBarUsed(id: BarId, used: boolean): void {
    const element = this.bars[id].element;
    if (element.hidden === !used) return;
    element.hidden = !used;
  }

  /** Bar fill 0–1 (only touches the DOM when the value really changed). */
  setBar(id: BarId, fraction: number): void {
    const value = Math.min(1, Math.max(0, fraction));
    if (Math.abs(value - this.fillValues[id]) < 0.005) return;
    this.fillValues[id] = value;
    this.applyFill(id, value);
  }

  /**
   * The XP bar. After a level up it first fills to the end, stays full a moment and then
   * starts again from the XP that was left over.
   */
  setXp(fraction: number, leveledUp: boolean): void {
    if (leveledUp) {
      this.setBar('xp', 1);
      this.xpPending = Math.min(1, Math.max(0, fraction));
      this.xpFullTime = XP_FULL_SECONDS;
      return;
    }
    if (this.xpPending >= 0) {
      this.xpPending = Math.min(1, Math.max(0, fraction));
      return;
    }
    this.setBar('xp', fraction);
  }

  /** Dying: the screen goes black (0–1) with a title and a line of text. */
  setBlackout(opacity: number, title: string, text: string): void {
    const value = Math.min(1, Math.max(0, opacity));
    if (value === this.blackoutValue) return;
    if (this.blackoutValue === 0) {
      this.blackoutTitle.textContent = title;
      this.blackoutText.textContent = text;
    }
    this.blackoutValue = value;
    this.blackout.style.opacity = value.toFixed(3);
    this.blackout.classList.toggle('ui-hud-blackout-on', value > 0);
  }

  /** The key shown in the interaction icon ("E" by default, or whatever is bound to it). */
  setInteractKey(label: string): void {
    if (this.interactKey.textContent !== label) this.interactKey.textContent = label;
  }

  setGold(amount: number): void {
    const text = String(amount);
    if (this.goldValue.textContent !== text) this.goldValue.textContent = text;
  }

  /**
   * Shows the interaction icon at screen position (CSS px) with a label, or hides it (null).
   * `keyHint` false hides the "E" (touch screens: you tap the icon instead).
   */
  setInteraction(label: string | null, x: number, y: number, keyHint: boolean): void {
    if (label === null) {
      this.interact.visibility.hide('near');
      return;
    }
    this.interact.visibility.show('near');
    if (this.interactLabel.textContent !== label) this.interactLabel.textContent = label;
    this.interactKey.hidden = !keyHint;
    // Whole pixels: no sub-pixel jitter and fewer style writes.
    const px = Math.round(x);
    const py = Math.round(y);
    if (px === this.interactX && py === this.interactY) return;
    this.interactX = px;
    this.interactY = py;
    this.interact.element.style.transform = `translate(${px}px, ${py}px) translate(-50%, -100%)`;
  }

  /** Shows the boss bar with a name (fight starts), or hides it (null). */
  setBoss(name: string | null): void {
    this.boss.classList.toggle('ui-hud-boss-on', name !== null);
    if (name !== null) {
      this.bossName.textContent = name;
      this.bossValue = -1;
      this.setBossHp(1);
    }
  }

  /** The boss's HP, 0–1 (touches the DOM only when it changed). */
  setBossHp(fraction: number): void {
    const value = Math.min(1, Math.max(0, fraction));
    if (Math.abs(value - this.bossValue) < 0.002) return;
    this.bossValue = value;
    this.bossFill.style.transform = `scaleX(${value})`;
  }

  /** A spoken line at the bottom (name + text) for `seconds`. */
  say(name: string, text: string, seconds: number): void {
    this.subtitleName.textContent = name;
    this.subtitleText.textContent = text;
    this.subtitle.classList.add('ui-fight-show');
    this.subtitleLeft = seconds;
  }

  /** A short fight tip near the top ("Dash sideways!") for `seconds`. */
  showHint(text: string, seconds: number): void {
    this.hint.textContent = text;
    this.hint.classList.add('ui-fight-show');
    this.hintLeft = seconds;
  }

  /** The big victory words after a boss, for `seconds` (they fade in and out). */
  showVictory(title: string, subtitle: string | null, seconds: number): void {
    this.victoryTitle.textContent = title;
    this.victorySubtitle.textContent = subtitle ?? '';
    this.victorySubtitle.hidden = subtitle === null;
    this.victory.classList.add('ui-hud-victory-on');
    this.victoryLeft = seconds;
  }

  /** A short red glow at the screen edges: the player was hit. */
  hurt(): void {
    this.hurtTime = HURT_SECONDS;
  }

  /** Call every rendered frame with real seconds (fades and timers are fps-independent). */
  update(seconds: number): void {
    this.hiddenBy.update(seconds);
    const hidden = this.hiddenBy.visible;
    if (hidden !== this.hiddenShown) {
      this.hiddenShown = hidden;
      this.root.classList.toggle('ui-hud-hidden', hidden);
    }
    if (!hidden) this.updateMessages(seconds);
    if (this.victoryLeft > 0) {
      this.victoryLeft -= seconds;
      if (this.victoryLeft <= 0) this.victory.classList.remove('ui-hud-victory-on');
    }
    if (this.subtitleLeft > 0) {
      this.subtitleLeft -= seconds;
      if (this.subtitleLeft <= 0) this.subtitle.classList.remove('ui-fight-show');
    }
    if (this.hintLeft > 0) {
      this.hintLeft -= seconds;
      if (this.hintLeft <= 0) this.hint.classList.remove('ui-fight-show');
    }
    this.updateXp(seconds);
    this.hurtTime = Math.max(0, this.hurtTime - seconds);
    const hurt = this.hurtTime > 0;
    if (hurt !== this.hurtShown) {
      this.hurtShown = hurt;
      this.hurtGlow.classList.toggle('ui-hud-hurt-on', hurt);
    }
    this.banner.update(seconds);
    this.message.update(seconds);
    this.interact.update(seconds);
    this.gold.update(seconds);
    for (let i = 0; i < BAR_IDS.length; i++) this.bars[BAR_IDS[i] as BarId].update(seconds);
  }

  dispose(): void {
    this.root.remove();
    this.queue.length = 0;
  }

  private updateMessages(seconds: number): void {
    if (this.message.visibility.visible) return;
    if (this.messageGap > 0) {
      this.messageGap -= seconds;
      return;
    }
    const text = this.queue.shift();
    if (text === undefined) return;
    const cfg = this.cfg;
    const duration = Math.min(
      cfg.messageMaxSeconds,
      cfg.messageMinSeconds + text.length * cfg.messagePerCharacterSeconds,
    );
    this.message.element.textContent = text;
    this.message.visibility.show('message', duration);
    this.messageGap = cfg.fadeSeconds;
  }

  private updateXp(seconds: number): void {
    const xpBar = this.bars.xp.element;
    if (this.xpInstant) {
      this.xpInstant = false;
      xpBar.classList.remove('ui-hud-bar-instant');
    }
    if (this.xpPending < 0) return;
    this.xpFullTime -= seconds;
    if (this.xpFullTime > 0) return;
    xpBar.classList.add('ui-hud-bar-instant');
    this.xpInstant = true;
    this.setBar('xp', this.xpPending);
    this.xpPending = -1;
  }

  private applyFill(id: BarId, value: number): void {
    this.fills[id].style.transform = `scaleX(${value})`;
  }
}
