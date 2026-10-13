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

const quests = questsFileSchema.parse(readPublicJson('data/quests.json')).quests;
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
    return quests.filter((quest) => quest.requires.path === path);
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
        (quest) => quest.requires.path === path && book.status(quest.id, 5, bag) === 'available',
      );
      if (!next) break;
      book.accept(next.id);
      for (const objective of next.objectives) {
        if (objective.type === 'train') {
          book.record('train', objective.monster, objective.count, [], undefined, charge);
        } else if (objective.type === 'kill') {
          book.record('kill', objective.monster, objective.count, []);
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

  it('walks a path from level 3 to level 5 (520 XP), kills included', () => {
    for (const path of ['sword', 'light', 'dark'] as const) {
      const done = runExams(path, 1);
      expect(done).toHaveLength(3);
      let xp = done.reduce((sum, quest) => sum + quest.rewards.xp, 0);
      for (const quest of done) {
        for (const objective of quest.objectives) {
          if (objective.type !== 'kill') continue;
          const monster = monsters.find((entry) => entry.id === objective.monster);
          xp += (monster?.xp ?? 0) * objective.count;
        }
      }
      // From level 3 with nothing to spare: 220 + 300 XP brings you to level 5.
      const state: LevelState = { level: 3, xp: 0 };
      addXp(player, state, xp);
      expect(state.level).toBeGreaterThanOrEqual(5);
    }
  });
});
