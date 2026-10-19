import type { PlayerConfig } from '../data/types';

/**
 * Whether one HUD element should be visible, and why. An element is visible while it has at
 * least one reason (`show('combat')`, `show('xp', 3)`); reasons with a time run out by
 * themselves. Pure logic without DOM, so the HUD rules can be tested.
 * Allocation-free after the first use of a reason.
 */
export class HudVisibility {
  private readonly reasons: string[] = [];
  /** Seconds left per reason (Infinity = until hidden). */
  private readonly timers: number[] = [];

  get visible(): boolean {
    return this.reasons.length > 0;
  }

  has(reason: string): boolean {
    return this.reasons.includes(reason);
  }

  /** Adds a reason; with `seconds` it ends by itself (showing it again restarts the time). */
  show(reason: string, seconds = Infinity): void {
    const i = this.reasons.indexOf(reason);
    if (i >= 0) {
      this.timers[i] = seconds;
      return;
    }
    this.reasons.push(reason);
    this.timers.push(seconds);
  }

  hide(reason: string): void {
    const i = this.reasons.indexOf(reason);
    if (i < 0) return;
    this.remove(i);
  }

  clear(): void {
    this.reasons.length = 0;
    this.timers.length = 0;
  }

  /** Counts down timed reasons. */
  update(dt: number): void {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const left = (this.timers[i] as number) - dt;
      if (left <= 0) this.remove(i);
      else this.timers[i] = left;
    }
  }

  private remove(i: number): void {
    const last = this.reasons.length - 1;
    this.reasons[i] = this.reasons[last] as string;
    this.timers[i] = this.timers[last] as number;
    this.reasons.length = last;
    this.timers.length = last;
  }
}

export type HudConfig = PlayerConfig['hud'];

/** The bars, counters and the ability chips the HUD rules talk about. */
export interface HudBars {
  hp: HudVisibility;
  mana: HudVisibility;
  energy: HudVisibility;
  xp: HudVisibility;
  gold: HudVisibility;
  /** The row of ability chips (which abilities are ready again). */
  abilities: HudVisibility;
  /** The small cross with the current spell, weapon, off hand and quick item. */
  loadout: HudVisibility;
  /** The Flask charges under the bars (G.5); shown whenever the HP bar is. */
  flasks: HudVisibility;
}

/**
 * The HUD rules from the concept, in one place:
 * - Gold (top right) only at a shop, or for a moment when gold changes.
 * - HP, mana and energy only during a fight.
 * - The XP bar only after defeating an enemy; when it is done, all bars fade out.
 * - Under 30 % HP the HP bar stays until it is higher again.
 * - Energy (phase 1 test): shows while it refills after a dash, then fades out.
 * - The ability chips (Bo, 2026-10-15) while fighting or while one cools, then they linger
 *   like the bars; a dialogue window on top of them hides them at once.
 * - The loadout cross (spell, weapon, off hand, quick item; 2026-10-17) during a fight and for
 *   a moment after a switch, then it lingers and fades like the bars.
 */
export class HudRules {
  constructor(
    readonly bars: HudBars,
    private readonly cfg: HudConfig,
    private readonly lowHpFraction: number,
  ) {}

  setCombat(fighting: boolean): void {
    const { hp, mana, energy, loadout, flasks } = this.bars;
    if (fighting) {
      hp.show('combat');
      mana.show('combat');
      energy.show('combat');
      loadout.show('combat');
      flasks.show('combat');
      return;
    }
    // Fight over: the bars linger a moment (longer when an XP bar is running).
    for (const bar of [hp, mana, energy, loadout, flasks]) {
      bar.hide('combat');
      bar.show('afterCombat', this.cfg.barLingerSeconds);
    }
  }

  /** An enemy was defeated: the XP bar fills, then everything fades together. */
  xpGained(): void {
    const seconds = this.cfg.xpShowSeconds;
    const { hp, mana, energy, xp, flasks } = this.bars;
    xp.show('xp', seconds);
    hp.show('xp', seconds);
    mana.show('xp', seconds);
    energy.show('xp', seconds);
    flasks.show('xp', seconds);
  }

  /** A quick switch was pressed: the loadout cross shows what you have now, for a moment. */
  loadoutChanged(): void {
    this.bars.loadout.show('changed', this.cfg.barLingerSeconds);
  }

  /** A Flask was used: HP, mana and the charges show for a moment (you see them change). */
  healed(): void {
    const seconds = this.cfg.xpShowSeconds;
    this.bars.hp.show('healed', seconds);
    this.bars.mana.show('healed', seconds);
    this.bars.flasks.show('healed', seconds);
  }

  setHpFraction(fraction: number): void {
    if (fraction < this.lowHpFraction) this.bars.hp.show('lowHp');
    else this.bars.hp.hide('lowHp');
  }

  goldChanged(): void {
    this.bars.gold.show('changed', this.cfg.goldShowSeconds);
  }

  setShop(open: boolean): void {
    if (open) this.bars.gold.show('shop');
    else this.bars.gold.hide('shop');
  }

  /**
   * The ability chips: on while `fighting` or while one is still `cooling`; once both are over
   * they linger as long as the bars do and fade. `covered` (a dialogue window opens on the same
   * spot) hides them at once; closed again, they come back only while there is still a reason.
   * Safe to call every frame: a running linger is not restarted.
   */
  setAbilities(fighting: boolean, cooling: boolean, covered = false): void {
    const chips = this.bars.abilities;
    if (covered) {
      chips.hide('active');
      chips.hide('linger');
      return;
    }
    if (fighting || cooling) {
      chips.hide('linger');
      chips.show('active');
    } else if (chips.has('active')) {
      chips.hide('active');
      chips.show('linger', this.cfg.barLingerSeconds);
    }
  }

  /** Energy below full shows the bar; once full again it lingers briefly and fades. */
  setEnergyFraction(fraction: number): void {
    const energy = this.bars.energy;
    if (fraction < 1) {
      energy.show('energy');
    } else if (energy.has('energy')) {
      energy.hide('energy');
      energy.show('energyFull', this.cfg.barLingerSeconds);
    }
  }
}
