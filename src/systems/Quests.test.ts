import { describe, expect, it } from 'vitest';
import {
  itemsFileSchema,
  monstersFileSchema,
  playerFileSchema,
  questsFileSchema,
  spellsFileSchema,
  zonesFileSchema,
} from '../data/schemas';
import type { PlayerConfig, QuestDef } from '../data/types';
import type { SaveQuests } from '../save/SaveData';
import { readPublicJson } from '../test/loadPublic';
import { addItem, countItem, type ItemStack } from './Inventory';
import { addXp, type LevelState } from './Progression';
import { QuestBook } from './Quests';
import { emptyBox, pointInShape, shapeBounds } from '../world/Shapes';

const questsFile = questsFileSchema.parse(readPublicJson('data/quests.json'));
const quests = questsFile.quests;
const waveFights = questsFile.waveFights;
const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;
const monsters = monstersFileSchema.parse(readPublicJson('data/monsters.json')).monsters;
const zones = zonesFileSchema.parse(readPublicJson('data/zones.json')).zones;
const items = itemsFileSchema.parse(readPublicJson('data/items.json')).items;
const spells = spellsFileSchema.parse(readPublicJson('data/spells.json'));

function freshSave(): SaveQuests {
  return { active: [], completed: [] };
}

/** A small hand-made quest list, independent of the game data. */
const sample: QuestDef[] = [
  {
    id: 'slay',
    name: 'Slay',
    kind: 'side',
    giver: 'guard',
    description: 'quest.slay.desc',
    objectives: [
      { type: 'kill', monster: 'goblin', count: 2 },
      { type: 'deliver', item: 'slime_gel', count: 3, npc: 'guard' },
    ],
    requires: { level: 2 },
    rewards: { xp: 10, gold: 0, items: [] },
  },
  {
    id: 'after',
    name: 'After',
    kind: 'side',
    giver: 'guard',
    description: 'quest.after.desc',
    objectives: [{ type: 'buy', item: 'health_potion', count: 1, npc: 'marco' }],
    requires: { quests: ['slay'] },
    rewards: { xp: 0, gold: 0, items: [] },
  },
];

describe('QuestBook', () => {
  it('locks a quest until its level and earlier quests are reached', () => {
    const book = new QuestBook(sample, freshSave());
    expect(book.status('slay', 1, [])).toBe('locked');
    expect(book.status('slay', 2, [])).toBe('available');
    expect(book.status('after', 9, [])).toBe('locked');
    expect(book.status('nope', 9, [])).toBe('locked');
  });

  it('counts kills only after the quest started, and never past what is needed', () => {
    const book = new QuestBook(sample, freshSave());
    const out: QuestDef[] = [];
    expect(book.record('kill', 'goblin', 1, out)).toHaveLength(0);
    book.accept('slay');
    expect(book.record('kill', 'slime', 1, out)).toHaveLength(0);
    expect(book.record('kill', 'goblin', 5, out).map((q) => q.id)).toEqual(['slay']);
    const p = book.progress(book.get('slay') as QuestDef, 0, [], { have: 0, need: 0 });
    expect(p).toEqual({ have: 2, need: 2 });
    // Already complete: nothing changes any more.
    expect(book.record('kill', 'goblin', 1, out)).toHaveLength(0);
  });

  it('shows "2/3" for items in the bag and takes them when handing in', () => {
    const save = freshSave();
    const book = new QuestBook(sample, save);
    const bag: ItemStack[] = [];
    book.accept('slay');
    book.record('kill', 'goblin', 2, []);
    addItem(bag, 'slime_gel', 2);
    const def = book.get('slay') as QuestDef;
    expect(book.progress(def, 1, bag, { have: 0, need: 0 })).toEqual({ have: 2, need: 3 });
    expect(book.status('slay', 2, bag)).toBe('active');
    expect(book.complete('slay', bag)).toBe(false);
    addItem(bag, 'slime_gel', 2);
    expect(book.status('slay', 2, bag)).toBe('ready');
    expect(book.complete('slay', bag)).toBe(true);
    expect(countItem(bag, 'slime_gel')).toBe(1);
    expect(book.status('slay', 2, bag)).toBe('done');
    expect(save).toEqual({ active: [], completed: ['slay'] });
    expect(book.completed.has('slay')).toBe(true);
    // Done once: it cannot start again.
    expect(book.accept('slay')).toBe(false);
  });

  it('counts a purchase only in the right shop', () => {
    const book = new QuestBook(sample, { active: [], completed: ['slay'] });
    book.accept('after');
    expect(book.record('buy', 'health_potion', 1, [], 'hilda')).toHaveLength(0);
    expect(book.record('buy', 'health_potion', 1, [], 'marco')).toHaveLength(1);
    expect(book.status('after', 1, [])).toBe('ready');
  });

  it('lets an NPC hand in first, then offer, then talk about a running quest', () => {
    const book = new QuestBook(sample, freshSave());
    expect(book.forNpc('guard', 1, [])).toBeNull();
    expect(book.forNpc('guard', 2, [])).toMatchObject({ status: 'available' });
    book.accept('slay');
    expect(book.forNpc('guard', 2, [])).toMatchObject({ status: 'active' });
    book.record('kill', 'goblin', 2, []);
    const bag = [{ item: 'slime_gel', count: 3 }];
    expect(book.forNpc('guard', 2, bag)).toMatchObject({ status: 'ready' });
  });

  it('survives data changes: unknown quests are dropped, objective counters resized', () => {
    const save: SaveQuests = {
      active: [
        { id: 'gone', counts: [1] },
        { id: 'slay', counts: [2] },
      ],
      completed: [],
    };
    const book = new QuestBook(sample, save);
    expect(save.active).toEqual([{ id: 'slay', counts: [2, 0] }]);
    expect(book.activeDefs().map((q) => q.id)).toEqual(['slay']);
  });
});

describe('the first day in Greyhaven (quests.json)', () => {
  const firstDay = quests.filter((q) => q.giver && q.requires.quests === undefined);

  it('has a small quest for each basic NPC', () => {
    expect(firstDay.map((q) => q.giver).sort()).toEqual(
      ['bertha', 'brother_ansel', 'hilda', 'marco', 'rose'].sort(),
    );
  });

  it('can all be played at level 1, in any order', () => {
    const book = new QuestBook(quests, freshSave());
    for (const q of firstDay) expect(book.status(q.id, 1, [])).toBe('available');
  });

  it('brings you to about level 3, with the slimes for Hilda', () => {
    const state: LevelState = { level: 1, xp: 0 };
    const questXp = firstDay.reduce((sum, q) => sum + q.rewards.xp, 0);
    // Three Green Slimes give the Slime Gel most of the time (50 % each, so often a few more).
    const slime = monsters.find((m) => m.id === 'green_slime');
    addXp(player, state, questXp + 3 * (slime?.xp ?? 0));
    expect(state.level).toBe(3);
  });

  it('Sultan waits until all of the first day is done', () => {
    const sultan = quests.find((q) => q.id === 'defeat_sultan');
    expect(sultan?.requires.quests?.sort()).toEqual(firstDay.map((q) => q.id).sort());
  });

  it("Hilda's quest really upgrades the sword (more damage)", () => {
    const hilda = quests.find((q) => q.giver === 'hilda');
    const upgrade = hilda?.rewards.upgrades?.[0];
    const from = items.find((i) => i.id === upgrade?.from);
    const to = items.find((i) => i.id === upgrade?.to);
    expect(to?.weapon?.damageBonus ?? 0).toBeGreaterThan(from?.weapon?.damageBonus ?? 0);
  });

  it('Slime Gel for Hilda can be found inside the city walls (the gate stays shut until later)', () => {
    const greyhaven = zones.find((z) => z.id === 'greyhaven');
    const city = greyhaven?.areas.find((a) => a.id === 'greyhaven_city')?.shape;
    const slimeIds = monsters
      .filter((m) => m.drops.some((d) => d.item === 'slime_gel'))
      .map((m) => m.id);
    const inside = (greyhaven?.spawnAreas ?? []).filter(
      (a) =>
        slimeIds.includes(a.monster) &&
        city?.type === 'rect' &&
        a.x - a.radius > city.minX &&
        a.x + a.radius < city.maxX &&
        a.z - a.radius > city.minZ &&
        a.z + a.radius < city.maxZ,
    );
    const hilda = quests.find((q) => q.giver === 'hilda');
    const need = hilda?.objectives.find((o) => o.type === 'deliver');
    const total = inside.reduce((sum, a) => sum + a.count, 0);
    expect(need && 'count' in need && total >= need.count).toBe(true);
  });

  it("Old Bertha's tale is done as soon as you listened (talk to the giver)", () => {
    const save = freshSave();
    const book = new QuestBook(quests, save);
    const tale = firstDay.find((q) => q.giver === 'bertha') as QuestDef;
    book.accept(tale.id);
    book.record('talk', 'bertha', 1, []);
    expect(book.status(tale.id, 1, [])).toBe('ready');
  });
});

describe('the Entrance Exams (fase 3.8)', () => {
  /** The three exams of one teacher, in the order you do them. */
  function examsOf(path: 'sword' | 'light' | 'dark'): QuestDef[] {
    return quests.filter((quest) => quest.requires.path === path && quest.kind === 'main');
  }

  /** The side quest the same teacher gives you once the city gate is open. */
  function sideOf(path: 'sword' | 'light' | 'dark'): QuestDef {
    const found = quests.find((quest) => quest.requires.path === path && quest.kind === 'side');
    if (!found) throw new Error(`no side quest for ${path}`);
    return found;
  }

  /** Walks a path's exams the way the world does: accept, do everything, hand in. */
  function runExams(path: 'sword' | 'light' | 'dark', charge: number): QuestDef[] {
    const save = freshSave();
    save.completed.push('defeat_sultan', 'your_resolve');
    const book = new QuestBook(quests, save);
    book.path = path;
    const bag: ItemStack[] = [];
    const done: QuestDef[] = [];
    for (let round = 0; round < 5; round++) {
      const next = quests.find(
        (quest) =>
          quest.requires.path === path &&
          quest.kind === 'main' &&
          book.status(quest.id, 5, bag) === 'available',
      );
      if (!next) break;
      book.accept(next.id);
      for (const objective of next.objectives) {
        if (objective.type === 'train') {
          book.record('train', objective.monster, objective.count, [], undefined, charge);
        } else if (objective.type === 'kill') {
          book.record('kill', objective.monster, objective.count, []);
        } else if (objective.type === 'waves') {
          book.record('waves', objective.fight, objective.count, []);
        }
      }
      if (!book.isReady(next, bag)) break;
      book.complete(next.id, bag);
      done.push(next);
    }
    return done;
  }

  it('gives every path three exams, each one after the other', () => {
    for (const path of ['sword', 'light', 'dark'] as const) {
      const exams = examsOf(path);
      expect(exams).toHaveLength(3);
      expect(exams[0]?.requires.quests).toEqual(['your_resolve']);
      expect(exams[1]?.requires.quests).toEqual([exams[0]?.id]);
      expect(exams[2]?.requires.quests).toEqual([exams[1]?.id]);
    }
  });

  it('only shows you your own teacher: another path stays locked', () => {
    const save = freshSave();
    save.completed.push('defeat_sultan', 'your_resolve');
    const book = new QuestBook(quests, save);
    book.path = 'sword';
    const mine = examsOf('sword')[0] as QuestDef;
    const other = examsOf('dark')[0] as QuestDef;
    expect(book.status(mine.id, 3, [])).toBe('available');
    expect(book.status(other.id, 3, [])).toBe('locked');
    // Without a path (before Your Resolve) nobody's exam is open.
    book.path = null;
    expect(book.status(mine.id, 3, [])).toBe('locked');
  });

  it("the first exam hands you your teacher's weapon", () => {
    for (const path of ['sword', 'light', 'dark'] as const) {
      const first = examsOf(path)[0] as QuestDef;
      const granted = first.grants?.items ?? [];
      expect(granted).toHaveLength(1);
      const def = items.find((item) => item.id === granted[0]?.item);
      expect(def?.weapon?.kind).toBe(path === 'sword' ? 'sword' : 'staff');
      expect(first.grants?.equip).toBe(true);
      // Only a mage goes through the Crystal Ceremony.
      expect(first.grants?.ceremony ?? false).toBe(path !== 'sword');
    }
  });

  it('a tap does not count where a charged spell is asked for', () => {
    const save = freshSave();
    save.completed.push('defeat_sultan', 'your_resolve');
    const book = new QuestBook(quests, save);
    book.path = 'light';
    const last = examsOf('light')[2] as QuestDef;
    const objective = last.objectives[0];
    expect(objective?.type).toBe('train');
    if (objective?.type !== 'train') return;
    expect(objective.minCharge).toBeGreaterThan(0);
    book.accept(last.id);
    // An Arcane Shard or a tapped spell: nothing counts.
    book.record('train', objective.monster, 3, [], undefined, 0);
    expect(book.progress(last, 0, [], { have: 0, need: 0 }).have).toBe(0);
    // Charged enough: it counts.
    book.record('train', objective.monster, objective.count, [], undefined, 1);
    expect(book.isReady(last, [])).toBe(true);
  });

  it('a charged spell can be paid for with the mana a fresh mage has', () => {
    // The exam would be impossible if a full charge cost more mana than a mage can hold.
    for (const path of ['light', 'dark'] as const) {
      const last = examsOf(path)[2] as QuestDef;
      const objective = last.objectives[0];
      if (objective?.type !== 'train' || objective.minCharge === undefined) continue;
      for (const spell of spells.spells) {
        const factor = spell.charge?.manaFactor ?? 1;
        const cost = spell.manaCost * (1 + (factor - 1) * objective.minCharge);
        expect(cost).toBeLessThanOrEqual(player.base.mana);
      }
    }
  });

  it('walks a path from level 3 to level 5 (520 XP), the slimes of the drill included', () => {
    for (const path of ['sword', 'light', 'dark'] as const) {
      const done = runExams(path, 1);
      expect(done).toHaveLength(3);
      let xp = done.reduce((sum, quest) => sum + quest.rewards.xp, 0);
      for (const quest of done) {
        for (const objective of quest.objectives) {
          if (objective.type === 'kill') {
            xp += monsterXp(objective.monster) * objective.count;
          } else if (objective.type === 'waves') {
            xp += drillXp(objective.fight);
          }
        }
      }
      // From level 3 with nothing to spare: 220 + 300 XP brings you to level 5, exactly.
      expect(xp).toBe(520);
      const state: LevelState = { level: 3, xp: 0 };
      addXp(player, state, xp);
      expect(state.level).toBe(5);
      expect(state.xp).toBe(0);
    }
  });

  it('is all doable inside Greyhaven, so the closed gate can never trap you', () => {
    // Everything canLeaveCity needs: Sultan plus your own last exam, and so every quest that
    // comes before it. None of them may send you outside the city walls.
    const walls = greyhavenWalls();
    for (const path of ['sword', 'light', 'dark'] as const) {
      const last = examsOf(path)[2] as QuestDef;
      for (const quest of questChain(last.id)) {
        for (const objective of quest.objectives) {
          if (objective.type === 'kill') {
            // A kill objective would mean the Greenwood: nothing in the chain may ask for one.
            expect.fail(`${quest.id} asks you to hunt ${objective.monster} outside the city`);
          }
          if (objective.type === 'waves') {
            const fight = waveFights.find((entry) => entry.id === objective.fight);
            expect(fight, objective.fight).toBeDefined();
            const shape = areaShape(fight?.area ?? '');
            expect(shape, fight?.area).toBeDefined();
            if (!shape || !walls) continue;
            const box = shapeBounds(shape, emptyBox());
            for (const [x, z] of [
              [box.minX, box.minZ],
              [box.minX, box.maxZ],
              [box.maxX, box.minZ],
              [box.maxX, box.maxZ],
            ] as const) {
              expect(pointInShape(walls, x, z), `${fight?.id} at ${x}, ${z}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it('keeps the Greenwood runs, but only once the city gate is open', () => {
    for (const path of ['sword', 'light', 'dark'] as const) {
      const side = sideOf(path);
      const last = examsOf(path)[2] as QuestDef;
      // Exactly what canLeaveCity asks for (triggers.json): Sultan plus your own last exam.
      expect(side.requires.quests).toEqual(['defeat_sultan', last.id]);
      expect(side.objectives.every((objective) => objective.type === 'kill')).toBe(true);
      // And it pays in items, not in a place in the exam chain.
      expect(side.rewards.items.length).toBeGreaterThan(0);
      for (const stack of side.rewards.items) {
        expect(
          items.some((item) => item.id === stack.item),
          stack.item,
        ).toBe(true);
      }
      // Locked until the last exam is handed in; open right after.
      const save = freshSave();
      save.completed.push(
        'defeat_sultan',
        'your_resolve',
        ...examsOf(path)
          .slice(0, 2)
          .map((q) => q.id),
      );
      const book = new QuestBook(quests, save);
      book.path = path;
      expect(book.status(side.id, 5, [])).toBe('locked');
      save.completed.push(last.id);
      const after = new QuestBook(quests, save);
      after.path = path;
      expect(after.status(side.id, 5, [])).toBe('available');
    }
  });

  it("makes the second exam a drill of three waves at your own teacher's field", () => {
    for (const path of ['sword', 'light', 'dark'] as const) {
      const second = examsOf(path)[1] as QuestDef;
      const objective = second.objectives[0];
      expect(objective?.type).toBe('waves');
      if (objective?.type !== 'waves') continue;
      const fight = waveFights.find((entry) => entry.id === objective.fight);
      expect(fight?.teacher).toBe(second.giver);
      expect(fight?.waves).toHaveLength(objective.count);
      expect(objective.count).toBe(3);
    }
  });

  it('counts a cleared wave, and forgets them again when the drill resets', () => {
    const save = freshSave();
    save.completed.push('defeat_sultan', 'your_resolve', 'first_form');
    const book = new QuestBook(quests, save);
    book.path = 'sword';
    const drill = examsOf('sword')[1] as QuestDef;
    const objective = drill.objectives[0];
    if (objective?.type !== 'waves') throw new Error('expected a waves objective');
    book.accept(drill.id);
    book.record('waves', objective.fight, 1, []);
    book.record('waves', objective.fight, 1, []);
    expect(book.progress(drill, 0, [], { have: 0, need: 0 })).toEqual({ have: 2, need: 3 });
    // Another teacher's drill never counts for yours.
    book.record('waves', 'sam_field_drill', 1, []);
    expect(book.progress(drill, 0, [], { have: 0, need: 0 }).have).toBe(2);
    // Down or off the field: back to wave 1.
    expect(book.resetObjectives(drill.id, 'waves')).toBe(true);
    expect(book.progress(drill, 0, [], { have: 0, need: 0 }).have).toBe(0);
    expect(book.resetObjectives(drill.id, 'waves')).toBe(false);
    // Three waves finish it.
    book.record('waves', objective.fight, 3, []);
    expect(book.isReady(drill, [])).toBe(true);
  });
});

/** XP a monster is worth, with what it splits into (a Big Slime leaves two Green Slimes). */
function monsterXp(id: string): number {
  const def = monsters.find((entry) => entry.id === id);
  if (!def) throw new Error(`missing monster ${id}`);
  const split = def.splitsInto;
  const children = split ? monsterXp(split.monster) * split.count : 0;
  return def.xp + children;
}

/** XP all the waves of a drill are worth (every candidate of an entry is worth the same). */
function drillXp(fightId: string): number {
  const fight = waveFights.find((entry) => entry.id === fightId);
  if (!fight) throw new Error(`missing wave fight ${fightId}`);
  let xp = 0;
  for (const wave of fight.waves) {
    for (const entry of wave.monsters) xp += monsterXp(entry.monsters[0] as string) * entry.count;
  }
  return xp;
}

/** A quest and everything that has to be handed in before it (its requirements, recursively). */
function questChain(id: string, seen = new Set<string>()): QuestDef[] {
  if (seen.has(id)) return [];
  seen.add(id);
  const def = quests.find((quest) => quest.id === id);
  if (!def) return [];
  const out: QuestDef[] = [def];
  for (const required of def.requires.quests ?? []) out.push(...questChain(required, seen));
  return out;
}

function greyhavenWalls() {
  return zones.find((zone) => zone.id === 'greyhaven')?.safeZones?.[0]?.shape;
}

function areaShape(id: string) {
  for (const zone of zones) {
    const area = zone.areas.find((entry) => entry.id === id);
    if (area) return area.shape;
  }
  return undefined;
}
