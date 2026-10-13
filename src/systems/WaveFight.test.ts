import { describe, expect, it } from 'vitest';
import { monstersFileSchema, questsFileSchema, zonesFileSchema } from '../data/schemas';
import type { MonstersFile, Shape, WaveFightDef, Zone } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import type { PointXZ } from '../world/Colliders';
import { emptyBox, pointInShape, shapeBounds } from '../world/Shapes';
import { Enemies, type EnemiesWorld } from './Enemies';
import type { EnemyTarget } from './EnemyAI';
import { WaveFight, type WaveFightWorld, type WaveResetReason } from './WaveFight';

/**
 * The second Entrance Exam (fase 3.8): three waves of slimes on the Academy training field,
 * inside the city, so you can finish your exam before the gate opens.
 */

const DT = 1 / 60;
const monsters = monstersFileSchema.parse(readPublicJson('data/monsters.json')) as MonstersFile;
const zones = zonesFileSchema.parse(readPublicJson('data/zones.json'));
const quests = questsFileSchema.parse(readPublicJson('data/quests.json'));
const RANGES = { showRadius: 160, hideMargin: 20 };
const FIELD = 'academy_training_field';

const free = {
  moveCircle(p: PointXZ, _radius: number, dx: number, dz: number) {
    p.x += dx;
    p.z += dz;
  },
};

function fightDef(id: string): WaveFightDef {
  const def = quests.waveFights.find((entry) => entry.id === id);
  if (!def) throw new Error(`missing wave fight ${id}`);
  return def;
}

function fieldShape(): Shape {
  const greyhaven = zones.zones.find((zone) => zone.id === 'greyhaven');
  const area = greyhaven?.areas.find((entry) => entry.id === FIELD);
  if (!area) throw new Error('missing training field');
  return area.shape;
}

/** How many monsters wave `index` of a fight puts on the field. */
function waveSize(def: WaveFightDef, index: number): number {
  const wave = def.waves[index];
  if (!wave) throw new Error(`no wave ${index}`);
  return wave.monsters.reduce((sum, entry) => sum + entry.count, 0);
}

function fieldCenter(): { x: number; z: number } {
  const box = shapeBounds(fieldShape(), emptyBox());
  return { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 };
}

/** Greyhaven with nothing in it but the field, so only the drill puts monsters down. */
function greyhavenOnly(): Zone[] {
  const base = zones.zones.find((zone) => zone.id === 'greyhaven');
  if (!base) throw new Error('missing greyhaven');
  return [{ ...base, spawns: [], spawnAreas: [], nightSpawns: [] }];
}

/** What the drill did, with the real Enemies pool behind it. */
class Drill {
  readonly enemies: Enemies;
  readonly fight: WaveFight;
  readonly lines: string[] = [];
  readonly cleared: number[] = [];
  readonly resets: WaveResetReason[] = [];
  finishedCount = 0;
  onField = true;
  readonly target: EnemyTarget = { x: 0, z: 0, radius: 0.4, hostile: true };
  private readonly enemiesWorld: EnemiesWorld;

  constructor(readonly def: WaveFightDef) {
    this.enemies = new Enemies(
      greyhavenOnly(),
      monsters,
      RANGES,
      new Map([[FIELD, fieldShape()]]),
      null,
      0,
      [def],
    );
    const center = fieldCenter();
    this.target.x = center.x;
    this.target.z = center.z;
    this.enemiesWorld = {
      mover: free,
      heightAt: () => 0,
      // The player is a wall in these tests: the drill is what is being checked, not the fight.
      hitPlayer: () => {},
      shoot: () => {},
      alert: (e) => this.enemies.alert(e),
      bossEvent: () => {},
    };
    const world: WaveFightWorld = {
      alive: () => this.enemies.waveAlive(def.id),
      spawnWave: (index) =>
        void this.enemies.spawnWave(def.id, index, center.x, center.z, def.spawnRadius),
      clear: () => this.enemies.clearWave(def.id),
      inArea: () => this.onField,
      say: (key) => this.lines.push(key),
      waveCleared: (index) => this.cleared.push(index),
      finished: () => this.finishedCount++,
      reset: (reason) => this.resets.push(reason),
    };
    this.fight = new WaveFight(def, world);
    this.enemies.step(DT, this.target, this.enemiesWorld);
  }

  run(seconds: number, dt = DT): void {
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) {
      this.fight.step(dt);
      this.enemies.step(dt, this.target, this.enemiesWorld);
    }
  }

  /** Kills everything of the fight that is on the field right now. */
  killField(): number {
    let killed = 0;
    for (const e of this.enemies.list) {
      if (!e.alive || !e.id.startsWith(this.def.id)) continue;
      this.enemies.hit(e, e.maxHp);
      killed++;
    }
    return killed;
  }

  /** Beats one whole wave (splits included) and lets the corpses disappear. */
  clearWholeWave(): void {
    for (let round = 0; round < 6; round++) {
      this.killField();
      // Corpses lie down for a moment, and a Big Slime leaves two children behind.
      this.run(monsters.settings.corpseSeconds + 0.1);
      if (this.enemies.waveAlive(this.def.id) === 0) return;
    }
  }
}

describe('wave fights (data)', () => {
  it('gives every teacher one drill on the Academy training field', () => {
    expect(quests.waveFights).toHaveLength(3);
    for (const fight of quests.waveFights) {
      expect(fight.area).toBe(FIELD);
      expect(fight.waves).toHaveLength(3);
      expect(fight.lines.wave).toHaveLength(2);
    }
    expect(quests.waveFights.map((fight) => fight.teacher)).toEqual([
      'sir_garrick',
      'master_brink',
      'wizard_sam',
    ]);
  });

  it('puts the field, and everything that spawns in it, inside the city walls', () => {
    const greyhaven = zones.zones.find((zone) => zone.id === 'greyhaven');
    const walls = greyhaven?.safeZones?.[0]?.shape;
    const box = shapeBounds(fieldShape(), emptyBox());
    expect(walls).toBeDefined();
    if (!walls) return;
    for (const [x, z] of [
      [box.minX, box.minZ],
      [box.minX, box.maxZ],
      [box.maxX, box.minZ],
      [box.maxX, box.maxZ],
    ] as const) {
      expect(pointInShape(walls, x, z), `${x}, ${z}`).toBe(true);
    }
    // And the ring the monsters appear in stays on the field itself.
    const center = fieldCenter();
    for (const fight of quests.waveFights) {
      expect(center.x - fight.spawnRadius).toBeGreaterThan(box.minX);
      expect(center.x + fight.spawnRadius).toBeLessThan(box.maxX);
      expect(center.z - fight.spawnRadius).toBeGreaterThan(box.minZ);
      expect(center.z + fight.spawnRadius).toBeLessThan(box.maxZ);
    }
  });

  it('gives every path the same XP, so the exam is worth the same on all three', () => {
    const xpOf = (id: string): number => {
      const def = monsters.monsters.find((entry) => entry.id === id);
      if (!def) throw new Error(`missing monster ${id}`);
      const split = def.splitsInto;
      const child = split
        ? (monsters.monsters.find((entry) => entry.id === split.monster)?.xp ?? 0) * split.count
        : 0;
      return def.xp + child;
    };
    const totals = quests.waveFights.map((fight) =>
      fight.waves.reduce(
        (sum, wave) =>
          sum +
          wave.monsters.reduce(
            (inner, entry) => inner + xpOf(entry.monsters[0] as string) * entry.count,
            0,
          ),
        0,
      ),
    );
    expect(new Set(totals).size).toBe(1);
    expect(totals[0]).toBe(250);
  });
});

describe('WaveFight', () => {
  it('sends the waves in order, with a pause in between, and says a line each time', () => {
    const drill = new Drill(fightDef('garrick_field_drill'));
    drill.fight.start();
    expect(drill.lines).toEqual([drill.def.lines.start]);
    // Nothing is on the field until the pause is over.
    drill.run(drill.def.pauseSeconds - 0.1);
    expect(drill.enemies.waveAlive(drill.def.id)).toBe(0);
    drill.run(0.2);
    expect(drill.enemies.waveAlive(drill.def.id)).toBe(waveSize(drill.def, 0));
    expect(drill.fight.wave).toBe(1);

    drill.clearWholeWave();
    drill.run(DT);
    expect(drill.cleared).toEqual([0]);
    expect(drill.lines.at(-1)).toBe(drill.def.lines.wave[0]);
    expect(drill.fight.wave).toBe(2);
    // Wave 2 is bigger than wave 1.
    drill.run(drill.def.pauseSeconds + 0.1);
    expect(drill.enemies.waveAlive(drill.def.id)).toBe(waveSize(drill.def, 1));
    expect(waveSize(drill.def, 1)).toBeGreaterThan(waveSize(drill.def, 0));

    drill.clearWholeWave();
    drill.run(DT);
    expect(drill.lines.at(-1)).toBe(drill.def.lines.wave[1]);
    drill.run(drill.def.pauseSeconds + 0.1);
    // Wave 3: the Big Slimes plus the small ones around them.
    expect(drill.enemies.waveAlive(drill.def.id)).toBe(waveSize(drill.def, 2));

    drill.clearWholeWave();
    drill.run(DT);
    expect(drill.cleared).toEqual([0, 1, 2]);
    expect(drill.finishedCount).toBe(1);
    expect(drill.lines.at(-1)).toBe(drill.def.lines.end);
    expect(drill.fight.state).toBe('won');
    expect(drill.fight.running).toBe(false);
  });

  it('only puts monsters down while the exam runs: nothing happens before it starts', () => {
    const drill = new Drill(fightDef('garrick_field_drill'));
    drill.run(30);
    expect(drill.enemies.waveAlive(drill.def.id)).toBe(0);
    expect(drill.lines).toEqual([]);
    expect(drill.fight.running).toBe(false);
  });

  it('clears the field and starts again at wave 1 when you walk off it', () => {
    const drill = new Drill(fightDef('garrick_field_drill'));
    drill.fight.start();
    drill.run(drill.def.pauseSeconds + 0.1);
    drill.clearWholeWave();
    drill.run(DT);
    expect(drill.fight.wave).toBe(2);
    // Off the field: a short step over the line is forgiven, a longer one is not.
    drill.onField = false;
    drill.run(drill.def.leaveSeconds - 0.1);
    expect(drill.resets).toEqual([]);
    drill.onField = true;
    drill.run(0.2);
    expect(drill.resets).toEqual([]);
    drill.onField = false;
    drill.run(drill.def.leaveSeconds + 0.1);
    expect(drill.resets).toEqual(['left']);
    expect(drill.lines.at(-1)).toBe(drill.def.lines.reset);
    expect(drill.enemies.waveAlive(drill.def.id)).toBe(0);
    expect(drill.fight.running).toBe(false);
    // Back on the field it begins at wave 1 again.
    drill.onField = true;
    drill.fight.start();
    drill.run(drill.def.pauseSeconds + 0.1);
    expect(drill.fight.wave).toBe(1);
    expect(drill.enemies.waveAlive(drill.def.id)).toBe(waveSize(drill.def, 0));
  });

  it('clears the field and starts again when you go down', () => {
    const drill = new Drill(fightDef('garrick_field_drill'));
    drill.fight.start();
    drill.run(drill.def.pauseSeconds + 0.1);
    expect(drill.enemies.waveAlive(drill.def.id)).toBeGreaterThan(0);
    drill.fight.knockedOut();
    expect(drill.resets).toEqual(['down']);
    expect(drill.enemies.waveAlive(drill.def.id)).toBe(0);
    expect(drill.fight.clearedWaves).toBe(0);
  });

  it('stops without a word when the world is left (a teleport, another zone)', () => {
    const drill = new Drill(fightDef('garrick_field_drill'));
    drill.fight.start();
    drill.run(drill.def.pauseSeconds + 0.1);
    const said = drill.lines.length;
    drill.fight.abort();
    expect(drill.lines).toHaveLength(said);
    expect(drill.resets).toEqual([]);
    expect(drill.enemies.waveAlive(drill.def.id)).toBe(0);
    expect(drill.fight.state).toBe('idle');
  });

  it('says whether the player is on the field, so a reset never restarts off it', () => {
    const drill = new Drill(fightDef('garrick_field_drill'));
    expect(drill.fight.onField).toBe(true);
    drill.onField = false;
    expect(drill.fight.onField).toBe(false);
    // After giving up it is idle again, but the world only starts it while you stand there.
    drill.fight.start();
    drill.run(drill.def.leaveSeconds + drill.def.pauseSeconds + 0.2);
    expect(drill.resets).toEqual(['left']);
    expect(drill.fight.state).toBe('idle');
    expect(drill.fight.onField).toBe(false);
  });

  it('can carry on at the wave you had already beaten (a reload)', () => {
    const drill = new Drill(fightDef('garrick_field_drill'));
    drill.fight.start(2);
    drill.run(drill.def.pauseSeconds + 0.1);
    expect(drill.fight.wave).toBe(3);
    expect(drill.enemies.waveAlive(drill.def.id)).toBe(waveSize(drill.def, 2));
  });

  it('rolls one of the four elements per slime for Master Brink', () => {
    const drill = new Drill(fightDef('brink_field_drill'));
    const seen = new Set<string>();
    for (let round = 0; round < 12; round++) {
      drill.enemies.spawnWave(drill.def.id, 1, fieldCenter().x, fieldCenter().z, 8);
      for (const e of drill.enemies.list) {
        if (e.active && e.id.startsWith(drill.def.id)) seen.add(e.def.element ?? '?');
      }
      drill.enemies.clearWave(drill.def.id);
    }
    expect(seen).toEqual(new Set(['water', 'fire', 'nature', 'wind']));
  });

  it('spawns Wizard Sam his dark slimes and nothing else', () => {
    const drill = new Drill(fightDef('sam_field_drill'));
    drill.enemies.spawnWave(drill.def.id, 2, fieldCenter().x, fieldCenter().z, 8);
    const elements = new Set(
      drill.enemies.list
        .filter((e) => e.active && e.id.startsWith(drill.def.id))
        .map((e) => e.def.element),
    );
    expect(elements).toEqual(new Set(['dark']));
  });

  it('puts the monsters of a wave on the field, around the middle of it', () => {
    const drill = new Drill(fightDef('garrick_field_drill'));
    const center = fieldCenter();
    expect(
      drill.enemies.spawnWave(drill.def.id, 2, center.x, center.z, drill.def.spawnRadius),
    ).toBe(waveSize(drill.def, 2));
    const field = fieldShape();
    for (const e of drill.enemies.list) {
      if (!e.active || !e.id.startsWith(drill.def.id)) continue;
      expect(pointInShape(field, e.x, e.z), e.id).toBe(true);
      const distance = Math.hypot(e.x - center.x, e.z - center.z);
      expect(distance).toBeLessThanOrEqual(drill.def.spawnRadius + 0.001);
      // They come for you straight away: no sneaking up from the fence.
      expect(e.engaged || e.mode === 'chase').toBe(true);
    }
  });

  it('never respawns a wave by itself, and a knock-out takes it off the field', () => {
    const drill = new Drill(fightDef('garrick_field_drill'));
    drill.enemies.spawnWave(drill.def.id, 0, fieldCenter().x, fieldCenter().z, 8);
    drill.killField();
    drill.run(monsters.settings.corpseSeconds + 60);
    expect(drill.enemies.waveAlive(drill.def.id)).toBe(0);
    drill.enemies.spawnWave(drill.def.id, 0, fieldCenter().x, fieldCenter().z, 8);
    expect(drill.enemies.waveAlive(drill.def.id)).toBe(waveSize(drill.def, 0));
    drill.enemies.resetAll();
    expect(drill.enemies.waveAlive(drill.def.id)).toBe(0);
  });
});
