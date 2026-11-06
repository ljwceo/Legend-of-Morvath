import { describe, expect, it } from 'vitest';
import { Random } from '../core/Random';
import {
  monstersFileSchema,
  playerFileSchema,
  questsFileSchema,
  spellsFileSchema,
  zonesFileSchema,
} from '../data/schemas';
import type { MonstersFile, PlayerConfig, SpellsFile, WaveFightDef, Zone } from '../data/types';
import type { Enemy } from '../entities/Enemy';
import { createNewSave } from '../save/SaveData';
import { readPublicJson } from '../test/loadPublic';
import type { PointXZ } from '../world/Colliders';
import { emptyBox, shapeBounds } from '../world/Shapes';
import { castConfig } from './Casting';
import {
  CHEAT_KILL_RADII,
  Cheats,
  DEFAULT_KILL_RADIUS,
  KILL_HOTKEY,
  killAllowed,
  killHotkeyActive,
  powerCheatsAllowed,
} from './Cheats';
import { eggReward } from './Eggs';
import { Enemies, type EnemiesWorld, type KillNearResult } from './Enemies';
import { applyMonsterStance, type EnemyTarget } from './EnemyAI';
import { type ItemStack, rollDrops } from './Inventory';
import { WaveFight, type WaveFightWorld } from './WaveFight';

// GG.8.5 step 5: Kill Nearby Enemies (cheat menu, and F8 once its hotkey is on). Every monster
// within the radius falls through `Enemies.hit`, so the defeat is the normal one, and the world
// pays each reward through its normal `defeated` (here: the same XP, drop roll and
// `monsterDefeated` count). Real monsters.json, quests.json, zones.json, npcs.json, spells.json,
// controls.json; the real Enemies pool and WaveFight.

const DT = 1 / 60;
const monsters = monstersFileSchema.parse(readPublicJson('data/monsters.json')) as MonstersFile;
const zones = zonesFileSchema.parse(readPublicJson('data/zones.json'));
const quests = questsFileSchema.parse(readPublicJson('data/quests.json'));
const npcIds = new Set(
  (readPublicJson('data/npcs.json') as { npcs: { id: string }[] }).npcs.map((npc) => npc.id),
);
const controls = readPublicJson('data/controls.json') as {
  actions: { id: string; keys: string[] }[];
};
const spells = spellsFileSchema.parse(readPublicJson('data/spells.json')) as SpellsFile;
const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;
const FIELD = 'academy_training_field';
const drillDef = quests.waveFights.find((f) => f.id === 'garrick_field_drill') as WaveFightDef;
const greyhaven = zones.zones.find((z) => z.id === 'greyhaven') as Zone;
const greenwood = zones.zones.find((z) => z.id === 'greenwood') as Zone;
const fieldShape = greyhaven.areas.find((a) => a.id === FIELD)?.shape;
if (!drillDef || !fieldShape || !greenwood) throw new Error('missing data');
const box = shapeBounds(fieldShape, emptyBox());
const CX = (box.minX + box.maxX) / 2;
const CZ = (box.minZ + box.maxZ) / 2;
const safeAreas = new Map(zones.zones.flatMap((z) => z.areas.map((a) => [a.id, a.shape] as const)));
const free = {
  moveCircle(p: PointXZ, _r: number, dx: number, dz: number) {
    p.x += dx;
    p.z += dz;
  },
};

/** One reward as WorldState.rewardDefeat pays it: the monster, its XP and its drop roll. */
interface Reward {
  e: Enemy;
  xp: number;
  drops: ItemStack[];
}

/** A world with the real pool, Sir Garrick's drill and the rewards the world would pay. */
class World {
  readonly enemies: Enemies;
  readonly target: EnemyTarget = { x: CX, z: CZ, radius: 0.4, hostile: true };
  readonly fight: WaveFight;
  readonly cleared: number[] = [];
  finished = 0;
  /** `monsterDefeated` as the quests hear it. */
  readonly events: string[] = [];
  readonly rewards: Reward[] = [];
  private readonly loot = new Random(7);
  private readonly drops: ItemStack[] = [];
  private readonly world: EnemiesWorld = {
    mover: free,
    heightAt: () => 0,
    hitPlayer: () => {},
    shoot: () => {},
    alert: (e) => this.enemies.alert(e),
    bossEvent: () => {},
  };

  constructor(zoneList: readonly Zone[] = [greyhaven]) {
    this.enemies = new Enemies(
      zoneList,
      monsters,
      { showRadius: 160, hideMargin: 20 },
      safeAreas,
      null,
      0,
      [drillDef],
    );
    const fightWorld: WaveFightWorld = {
      alive: () => this.enemies.waveAlive(drillDef.id),
      spawnWave: (i) => void this.enemies.spawnWave(drillDef.id, i, CX, CZ, drillDef.spawnRadius),
      clear: () => this.enemies.clearWave(drillDef.id),
      inArea: () => true,
      say: () => {},
      waveCleared: (i) => this.cleared.push(i),
      finished: () => this.finished++,
      reset: () => {},
    };
    this.fight = new WaveFight(drillDef, fightWorld);
    applyMonsterStance(this.target, true, false, false);
    this.enemies.step(DT, this.target, this.world);
  }

  at(x: number, z: number): this {
    this.target.x = x;
    this.target.z = z;
    this.enemies.step(DT, this.target, this.world);
    return this;
  }

  run(seconds: number): void {
    for (let t = 0; t < seconds; t += DT) {
      this.fight.step(DT);
      this.enemies.step(DT, this.target, this.world);
    }
  }

  /** Starts the drill at wave `index` (0-based) and lets that wave arrive. */
  wave(index: number): void {
    this.fight.start(index);
    this.run(drillDef.pauseSeconds + 0.1);
  }

  /** What WorldState.killNearby does: the cheat, then the normal reward for each that fell. */
  kill(
    radius = DEFAULT_KILL_RADIUS,
    includeBosses = false,
    inOwnFight: (e: Enemy) => boolean = () => false,
  ): KillNearResult {
    const result = this.enemies.killNear(this.target.x, this.target.z, radius, (e) =>
      killAllowed(e.def, includeBosses, inOwnFight(e)),
    );
    for (const e of result.defeated) this.reward(e);
    return result;
  }

  /** A killing blow by hand (sword), with the same reward. */
  hitToDeath(e: Enemy): void {
    while (e.alive) if (this.enemies.hit(e, 7, 0)) this.reward(e);
  }

  private reward(e: Enemy): void {
    this.events.push(e.def.id);
    this.rewards.push({ e, xp: e.def.xp, drops: rollDrops(e.def, this.loot, this.drops).slice() });
  }

  /** Living monsters of the drill on the field, optionally of one kind. */
  field(kind?: string): Enemy[] {
    return this.enemies.list.filter(
      (e) => e.alive && e.id.startsWith(drillDef.id) && (!kind || e.def.id === kind),
    );
  }

  living(prefix: string): Enemy[] {
    return this.enemies.list.filter((e) => e.alive && e.id.startsWith(prefix));
  }
}

const dist = (e: Enemy, x: number, z: number): number => Math.hypot(e.x - x, e.z - z);
const xpOf = (list: readonly Reward[]): number => list.reduce((sum, r) => sum + r.xp, 0);

describe('Kill Nearby Enemies (GG.8.5 step 5)', () => {
  it('1. one slime within the radius falls, the one next to it does not', () => {
    const w = new World();
    const yard = w.living('greyhaven_slime_yard');
    expect(yard.length).toBe(3);
    const [a] = yard as [Enemy];
    w.at(a.x, a.z);
    const others = yard.filter((e) => e !== a).map((e) => dist(e, a.x, a.z));
    const r = w.kill(Math.min(...others) / 2);
    expect(r.defeated).toEqual([a]);
    expect(a.alive).toBe(false);
    expect(w.living('greyhaven_slime_yard').length).toBe(2);
    expect(w.events).toEqual(['green_slime']);
  });

  it('2. several monsters within the radius all fall, each once', () => {
    const w = new World();
    w.wave(1);
    expect(w.field().length).toBe(5);
    const r = w.kill(15);
    expect(r.defeated.length).toBe(5);
    expect(new Set(r.defeated).size).toBe(5);
    expect(w.field().length).toBe(0);
  });

  it('3. monsters outside the radius stay alive and untouched', () => {
    const w = new World();
    w.wave(1);
    const before = w.field().map((e) => e.hp);
    w.at(CX + 30, CZ);
    const r = w.kill(15);
    expect(r.defeated.length).toBe(0);
    expect(w.field().map((e) => e.hp)).toEqual(before);
    // Halfway: only those within the radius.
    w.at(CX, CZ);
    const sorted = w.field().sort((p, q) => dist(p, CX, CZ) - dist(q, CX, CZ));
    const cut = (dist(sorted[1] as Enemy, CX, CZ) + dist(sorted[2] as Enemy, CX, CZ)) / 2;
    expect(dist(sorted[2] as Enemy, CX, CZ) - dist(sorted[1] as Enemy, CX, CZ)).toBeGreaterThan(
      0.01,
    );
    expect(w.kill(cut).defeated.length).toBe(2);
    expect(w.field().length).toBe(3);
    for (const e of w.field()) expect(dist(e, CX, CZ)).toBeGreaterThan(cut);
  });

  it('4. a Big Slime falls the normal way and both its Green Slimes fall in the same go', () => {
    const w = new World();
    w.wave(2);
    expect(w.field('big_slime').length).toBe(3);
    expect(w.field('green_slime').length).toBe(2);
    const r = w.kill(15);
    // 3 Big Slimes + their 6 Green Slimes + the 2 Green Slimes of the wave.
    expect(r.defeated.length).toBe(11);
    expect(r.splits).toBe(6);
    expect(r.defeated.filter((e) => e.def.id === 'big_slime').length).toBe(3);
    expect(w.enemies.waveAlive(drillDef.id)).toBe(0);
    expect(w.field().length).toBe(0);
  });

  it('4b. split slimes that land outside the radius stay (nothing is chased down)', () => {
    const w = new World();
    w.wave(2);
    const big = w.field('big_slime')[0] as Enemy;
    // Just around this one Big Slime: its slimes land 0.9 m to its sides, outside.
    w.at(big.x, big.z);
    const r = w.kill(0.5);
    expect(r.defeated).toEqual([big]);
    expect(r.splits).toBe(0);
    expect(w.field('green_slime').length).toBe(4);
  });

  it('5 + 6. the drill counts every wave once, and a new wave is never taken along', () => {
    const w = new World();
    w.wave(0);
    expect(w.kill().defeated.length).toBe(3);
    // The drill sees the empty field on its next step, not during the cheat.
    expect(w.cleared).toEqual([]);
    w.run(DT * 2);
    expect(w.cleared).toEqual([0]);
    // Wave 2 is not there yet: pressing again takes nothing.
    expect(w.kill().defeated.length).toBe(0);
    w.run(drillDef.pauseSeconds + 0.1);
    // It arrived whole: no earlier press touched it.
    expect(w.field().length).toBe(5);
    expect(w.kill().defeated.length).toBe(5);
    w.run(DT * 2);
    expect(w.cleared).toEqual([0, 1]);
    w.run(drillDef.pauseSeconds + 0.1);
    expect(w.field().length).toBe(5);
    expect(w.kill().defeated.length).toBe(11);
    w.run(DT * 2);
    expect(w.cleared).toEqual([0, 1, 2]);
    expect(w.finished).toBe(1);
    expect(w.fight.state).toBe('won');
    // Every monster of the three waves counted once for the quests: 3 + 5 + 11.
    expect(w.events.length).toBe(19);
  });

  it('7. XP, gold and loot exactly once, and the same as defeating them by hand', () => {
    const cheat = new World();
    cheat.wave(2);
    cheat.kill();
    const byHand = new World();
    byHand.wave(2);
    for (let i = 0; i < 20 && byHand.field().length > 0; i++) {
      for (const e of byHand.field()) byHand.hitToDeath(e);
    }
    expect(cheat.rewards.length).toBe(11);
    expect(new Set(cheat.rewards.map((r) => r.e)).size).toBe(11);
    expect(xpOf(cheat.rewards)).toBe(3 * 30 + 8 * 10);
    expect(xpOf(cheat.rewards)).toBe(xpOf(byHand.rewards));
    expect(cheat.rewards.length).toBe(byHand.rewards.length);
    expect(cheat.events.sort()).toEqual(byHand.events.sort());
  });

  it('8. pressing again pays nothing twice, and a defeated monster does not come straight back', () => {
    const w = new World();
    const yard = w.living('greyhaven_slime_yard');
    const [first] = yard as [Enemy];
    w.at(first.x, first.z);
    expect(w.kill(20).defeated.length).toBe(3);
    const paid = w.rewards.length;
    for (let i = 0; i < 3; i++) expect(w.kill(20).defeated.length).toBe(0);
    expect(w.rewards.length).toBe(paid);
    for (const e of yard) expect(w.enemies.hit(e, 999, 0)).toBe(false);
    // Standing right there for longer than the yard's respawn time: nobody gets up again.
    w.run(40);
    expect(w.living('greyhaven_slime_yard').length).toBe(0);
    expect(w.kill(20).defeated.length).toBe(0);
  });

  it('9. NPCs, teachers, animals, training dummies and guardians at home are never touched', () => {
    const w = new World([greyhaven, greenwood]);
    // Nobody from npcs.json (teachers, merchants, Biscuit, Pringle) is in the monster pool.
    for (const e of w.enemies.list) expect(npcIds.has(e.id)).toBe(false);
    // The three training dummies on the field, with a huge radius.
    w.at(CX, CZ);
    const dummies = w.enemies.list.filter((e) => e.def.behavior === 'static');
    expect(dummies.length).toBe(3);
    const r = w.kill(60);
    expect(r.defeated.some((e) => e.def.behavior === 'static')).toBe(false);
    for (const d of dummies) expect([d.alive, d.hp]).toEqual([true, d.maxHp]);
    // A Treewarden inside the elven city is a guardian at home: it cannot be hit there.
    const warden = w.enemies.list.find((e) => e.id === 'treewarden_1_0') as Enemy;
    w.at(warden.x, warden.z);
    expect(warden.safe).toBe(true);
    const near = w.kill(15);
    expect(near.defeated.includes(warden)).toBe(false);
    expect(warden.alive).toBe(true);
    // Everything that ever falls is a monster from monsters.json that is not a dummy.
    const all = new World([greyhaven, greenwood]).kill(1e6).defeated;
    for (const e of all) expect(e.def.behavior === 'static' || npcIds.has(e.id)).toBe(false);
  });

  it('10. bosses and mini-bosses stay standing by default', () => {
    const w = new World([greyhaven, greenwood]);
    const chief = w.enemies.list.find((e) => e.def.id === 'goblin_chief') as Enemy;
    w.at(chief.x, chief.z);
    const r = w.kill(15);
    expect(chief.alive).toBe(true);
    expect(r.skipped).toBeGreaterThanOrEqual(1);
    expect(r.defeated.some((e) => e.def.rank)).toBe(false);
    // Sultan in his own fight, right next to you.
    const g = new World();
    const sultan = g.enemies.bossOf('sultan') as Enemy;
    const def = sultan.boss?.def;
    if (!def) throw new Error('no Sultan');
    g.at(def.playerStart.x, def.playerStart.z);
    g.enemies.startBoss(sultan, 0);
    expect(g.kill(50, false, (e) => e === sultan).skipped).toBe(1);
    expect(sultan.alive).toBe(true);
  });

  it('11. Include Bosses: a mini-boss falls the normal way; Sultan only during his own fight', () => {
    const w = new World([greyhaven, greenwood]);
    const mossback = w.enemies.list.find((e) => e.def.id === 'mossback') as Enemy;
    w.at(mossback.x, mossback.z);
    const r = w.kill(15, true);
    expect(r.defeated.includes(mossback)).toBe(true);
    expect(w.rewards.filter((x) => x.e === mossback).length).toBe(1);
    // Its egg the normal way: the first time only.
    const found: string[] = [];
    const egg = eggReward(mossback.def, found);
    expect(egg).toBe('mossback_egg');
    found.push(egg as string);
    expect(eggReward(mossback.def, found)).toBeNull();
    // Sultan: not while his fight is not running (or a cutscene plays)...
    const g = new World();
    const sultan = g.enemies.bossOf('sultan') as Enemy;
    const def = sultan.boss?.def;
    if (!def) throw new Error('no Sultan');
    g.at(def.playerStart.x, def.playerStart.z);
    g.enemies.startBoss(sultan, 0);
    expect(g.kill(50, true, () => false).defeated.includes(sultan)).toBe(false);
    expect(sultan.alive).toBe(true);
    // ...and during it, even guarded between openings: his own defeat (`hit` → `defeat`).
    sultan.guarded = true;
    const won = g.kill(50, true, (e) => e === sultan);
    expect(won.defeated).toEqual([sultan]);
    expect([sultan.alive, sultan.guarded]).toEqual([false, false]);
    expect(g.events).toEqual(['sultan']);
    // The rule itself.
    const plain = { rank: undefined };
    expect(killAllowed(plain, false, false)).toBe(true);
    expect(killAllowed({ rank: 'miniboss' }, false, false)).toBe(false);
    expect(killAllowed({ rank: 'miniboss' }, true, false)).toBe(true);
    expect(killAllowed({ rank: 'boss', boss: {} }, true, false)).toBe(false);
    expect(killAllowed({ rank: 'boss', boss: {} }, true, true)).toBe(true);
    expect(killAllowed({ rank: 'boss', boss: {} }, false, true)).toBe(false);
  });

  it('12. works the same with Monsters Off, Fly, Invincibility and Max All Stats', () => {
    const normal = new World();
    normal.wave(2);
    const plain = normal.kill().defeated.map((e) => e.id);
    expect(plain.length).toBe(11);
    const w = new World();
    const cheats = new Cheats();
    cheats.monsters = false;
    cheats.fly = true;
    cheats.invincible = true;
    cheats.maxStats = true;
    applyMonsterStance(w.target, cheats.monsters, cheats.fly, false);
    w.wave(2);
    expect(w.kill().defeated.map((e) => e.id)).toEqual(plain);
    // The kill changes none of them.
    expect([cheats.monsters, cheats.fly, cheats.invincible, cheats.maxStats]).toEqual([
      false,
      true,
      true,
      true,
    ]);
  });

  it('13. never saved; reload and leaving debug mode reset radius, Include Bosses and hotkey', () => {
    const cheats = new Cheats();
    expect([cheats.killRadius, cheats.killBosses, cheats.killHotkey]).toEqual([15, false, false]);
    expect(CHEAT_KILL_RADII).toContain(DEFAULT_KILL_RADIUS);
    expect(cheats.active).toBe(false);
    cheats.killRadius = 50;
    expect(cheats.active).toBe(true);
    cheats.killRadius = DEFAULT_KILL_RADIUS;
    cheats.killBosses = true;
    expect(cheats.active).toBe(true);
    cheats.killBosses = false;
    cheats.killHotkey = true;
    expect(cheats.active).toBe(true);
    cheats.killRadius = 25;
    cheats.killBosses = true;
    cheats.reset();
    expect([cheats.killRadius, cheats.killBosses, cheats.killHotkey]).toEqual([15, false, false]);
    expect(JSON.stringify(createNewSave('en'))).not.toMatch(/kill/i);
    // The hotkey only works with debug mode on, the strong cheats allowed and the hotkey on.
    const on = { killHotkey: true };
    expect(killHotkeyActive(on, true, true)).toBe(true);
    expect(killHotkeyActive(on, false, true)).toBe(false);
    expect(killHotkeyActive(on, true, false)).toBe(false);
    expect(killHotkeyActive({ killHotkey: false }, true, true)).toBe(false);
  });

  it('a normal player cannot reach it: no key, no spell, no setting, no save field', () => {
    // No action in controls.json uses the hotkey, so it is not in the key settings or a save.
    for (const action of controls.actions) expect(action.keys).not.toContain(KILL_HOTKEY);
    // Not a spell or incantation (nothing to put in a slot).
    const ids = [...spells.spells.map((s) => s.id), ...spells.incantations.map((s) => s.id)];
    for (const id of ids) expect(id).not.toMatch(/kill|debug/i);
    // A production build without ?debug=1 never allows it; a save cannot change that (the
    // rule only reads the address and the build).
    expect(powerCheatsAllowed(new URLSearchParams(''), false)).toBe(false);
    expect(powerCheatsAllowed(new URLSearchParams('?debug=1'), false)).toBe(true);
  });

  it('14. Push stays the spell on V, untouched', () => {
    expect(controls.actions.find((a) => a.id === 'cast')?.keys).toContain('KeyV');
    const push = castConfig(player, spells).incantations.get('push');
    expect(push?.effect.kind).toBe('push');
    // Push still shoves a slime and does its own damage, as before.
    const w = new World();
    w.wave(0);
    const slime = w.field()[0] as Enemy;
    expect(w.enemies.push(slime, 1, 0, 2, 0.3)).toBe(true);
    expect(w.enemies.hit(slime, 1, 0)).toBe(false);
    expect(slime.hp).toBe(slime.maxHp - 1);
  });
});
