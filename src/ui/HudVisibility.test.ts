import { describe, expect, it } from 'vitest';
import { playerFileSchema } from '../data/schemas';
import { readPublicJson } from '../test/loadPublic';
import { type HudBars, HudRules, HudVisibility } from './HudVisibility';

const player = playerFileSchema.parse(readPublicJson('data/player.json'));

function bars(): HudBars {
  return {
    hp: new HudVisibility(),
    mana: new HudVisibility(),
    energy: new HudVisibility(),
    xp: new HudVisibility(),
    gold: new HudVisibility(),
    abilities: new HudVisibility(),
    loadout: new HudVisibility(),
  };
}

function run(seconds: number, all: HudBars): void {
  // Small steps, like frames.
  for (let t = 0; t < seconds; t += 0.1) for (const v of Object.values(all)) v.update(0.1);
}

describe('HudVisibility', () => {
  it('is visible while it has a reason; timed reasons run out', () => {
    const v = new HudVisibility();
    expect(v.visible).toBe(false);
    v.show('a');
    v.show('b', 1);
    v.update(1.5);
    expect(v.visible).toBe(true);
    expect(v.has('b')).toBe(false);
    v.hide('a');
    expect(v.visible).toBe(false);
  });

  it('showing a reason again restarts its time', () => {
    const v = new HudVisibility();
    v.show('flash', 1);
    v.update(0.8);
    v.show('flash', 1);
    v.update(0.8);
    expect(v.visible).toBe(true);
  });
});

describe('HudRules (concept)', () => {
  const cfg = player.hud;

  it('shows HP, mana and energy only in a fight, and fades them after the XP bar', () => {
    const b = bars();
    const rules = new HudRules(b, cfg, player.lowHpThreshold);
    expect(b.hp.visible).toBe(false);
    rules.setCombat(true);
    expect(b.hp.visible && b.mana.visible && b.energy.visible).toBe(true);
    expect(b.xp.visible).toBe(false);
    rules.xpGained();
    rules.setCombat(false);
    expect(b.xp.visible).toBe(true);
    run(cfg.xpShowSeconds + 0.5, b);
    expect(b.hp.visible || b.mana.visible || b.energy.visible || b.xp.visible).toBe(false);
  });

  it('keeps the HP bar under 30 % HP until it is higher again', () => {
    const b = bars();
    const rules = new HudRules(b, cfg, player.lowHpThreshold);
    rules.setHpFraction(0.2);
    run(60, b);
    expect(b.hp.visible).toBe(true);
    rules.setHpFraction(0.5);
    expect(b.hp.visible).toBe(false);
  });

  it('shows gold at a shop and briefly when it changes', () => {
    const b = bars();
    const rules = new HudRules(b, cfg, player.lowHpThreshold);
    rules.goldChanged();
    expect(b.gold.visible).toBe(true);
    run(cfg.goldShowSeconds + 0.5, b);
    expect(b.gold.visible).toBe(false);
    rules.setShop(true);
    run(60, b);
    expect(b.gold.visible).toBe(true);
    rules.setShop(false);
    expect(b.gold.visible).toBe(false);
  });

  it('shows the energy bar after a dash until energy is full again, then fades', () => {
    const b = bars();
    const rules = new HudRules(b, cfg, player.lowHpThreshold);
    rules.setEnergyFraction(1);
    expect(b.energy.visible).toBe(false);
    rules.setEnergyFraction(0.75);
    expect(b.energy.visible).toBe(true);
    rules.setEnergyFraction(1);
    expect(b.energy.visible).toBe(true);
    run(cfg.barLingerSeconds + 0.5, b);
    expect(b.energy.visible).toBe(false);
  });

  it('shows the ability chips in a fight or while one cools, then lets them linger', () => {
    const b = bars();
    const rules = new HudRules(b, cfg, player.lowHpThreshold);
    rules.setAbilities(false, false);
    expect(b.abilities.visible).toBe(false);
    rules.setAbilities(true, false);
    expect(b.abilities.visible).toBe(true);
    rules.setAbilities(false, true);
    expect(b.abilities.visible).toBe(true);
    rules.setAbilities(false, false);
    expect(b.abilities.visible).toBe(true);
    // Called every frame (as the HUD does) the linger still runs out.
    for (let t = 0; t < cfg.barLingerSeconds + 0.5; t += 0.1) {
      rules.setAbilities(false, false);
      b.abilities.update(0.1);
    }
    expect(b.abilities.visible).toBe(false);
  });

  it('hides the ability chips under a dialogue window and brings them back only with a reason', () => {
    const b = bars();
    const rules = new HudRules(b, cfg, player.lowHpThreshold);
    rules.setAbilities(true, false);
    rules.setAbilities(true, false, true);
    expect(b.abilities.visible).toBe(false);
    // Still fighting when the window closes: back at once.
    rules.setAbilities(true, false, false);
    expect(b.abilities.visible).toBe(true);
    // The fight ended while talking: nothing left to linger.
    rules.setAbilities(false, false, true);
    rules.setAbilities(false, false, false);
    expect(b.abilities.visible).toBe(false);
    // A linger that was running is cut short by the window, not resumed after it.
    rules.setAbilities(true, false);
    rules.setAbilities(false, false);
    expect(b.abilities.visible).toBe(true);
    rules.setAbilities(false, false, true);
    rules.setAbilities(false, false, false);
    expect(b.abilities.visible).toBe(false);
  });
});

describe('the loadout cross (2026-10-17)', () => {
  it('shows during a fight and lingers like the bars after it', () => {
    const all = bars();
    const rules = new HudRules(all, player.hud, player.lowHpThreshold);
    expect(all.loadout.visible).toBe(false);
    rules.setCombat(true);
    run(10, all);
    expect(all.loadout.visible).toBe(true);
    rules.setCombat(false);
    expect(all.loadout.visible).toBe(true);
    run(player.hud.barLingerSeconds + 0.2, all);
    expect(all.loadout.visible).toBe(false);
  });

  it('shows for a moment after a switch, also out of a fight', () => {
    const all = bars();
    const rules = new HudRules(all, player.hud, player.lowHpThreshold);
    rules.loadoutChanged();
    expect(all.loadout.visible).toBe(true);
    run(player.hud.barLingerSeconds + 0.2, all);
    expect(all.loadout.visible).toBe(false);
  });
});
