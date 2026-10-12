import { describe, expect, it } from 'vitest';
import { npcsFileSchema, questsFileSchema, triggersFileSchema } from '../data/schemas';
import type { PlayerPath } from '../data/types';
import type { SaveQuests } from '../save/SaveData';
import { readPublicJson } from '../test/loadPublic';
import { type ConditionContext, evaluateCondition } from '../world/Conditions';
import { choosePath, teacherOffer } from './PathChoice';
import { QuestBook } from './Quests';

const conditions = triggersFileSchema.parse(readPublicJson('data/triggers.json')).conditions;
const npcs = npcsFileSchema.parse(readPublicJson('data/npcs.json')).npcs;
const quests = questsFileSchema.parse(readPublicJson('data/quests.json')).quests;
const teachers = npcs.filter((npc) => npc.teaches);

function ctx(completed: string[], path: PlayerPath | null = null): ConditionContext {
  return { level: 3, completedQuests: new Set(completed), path };
}

describe('path conditions', () => {
  it('checks none, any and one path', () => {
    const none = ctx([]);
    const dark = ctx([], 'dark');
    expect(evaluateCondition({ type: 'path', is: 'none' }, none)).toBe(true);
    expect(evaluateCondition({ type: 'path', is: 'none' }, dark)).toBe(false);
    expect(evaluateCondition({ type: 'path', is: 'any' }, none)).toBe(false);
    expect(evaluateCondition({ type: 'path', is: 'any' }, dark)).toBe(true);
    expect(evaluateCondition({ type: 'path', is: 'dark' }, dark)).toBe(true);
    expect(evaluateCondition({ type: 'path', is: 'light' }, dark)).toBe(false);
    // An older context without a path counts as "none chosen".
    const old = { level: 1, completedQuests: new Set<string>() };
    expect(evaluateCondition({ type: 'path', is: 'none' }, old)).toBe(true);
  });
});

describe('Your Resolve teachers', () => {
  it('has one teacher per path: Sir Garrick, Master Brink and Wizard Sam', () => {
    const byPath = Object.fromEntries(teachers.map((npc) => [npc.teaches?.path, npc.id]));
    expect(byPath).toEqual({ sword: 'sir_garrick', light: 'master_brink', dark: 'wizard_sam' });
  });

  it('asks only after Sultan and until a path is chosen', () => {
    for (const npc of teachers) {
      expect(teacherOffer(npc, conditions, ctx([])), npc.id).toBeNull();
      expect(teacherOffer(npc, conditions, ctx(['defeat_sultan'])), npc.id).toBe(npc.teaches);
      expect(teacherOffer(npc, conditions, ctx(['defeat_sultan'], 'sword')), npc.id).toBeNull();
    }
  });

  it('never offers a path from an NPC that does not teach', () => {
    const marco = npcs.find((npc) => npc.id === 'marco');
    if (!marco) throw new Error('missing Marco');
    expect(teacherOffer(marco, conditions, ctx(['defeat_sultan']))).toBeNull();
  });

  it('sets the path only once (yes is for the rest of the game)', () => {
    const save: { path: PlayerPath | null } = { path: null };
    expect(choosePath(save, 'light')).toBe(true);
    expect(save.path).toBe('light');
    expect(choosePath(save, 'dark')).toBe(false);
    expect(save.path).toBe('light');
  });
});

describe('quest Your Resolve', () => {
  it('starts after Sultan and is done as soon as a path is chosen', () => {
    const save: SaveQuests = { active: [], completed: ['defeat_sultan'] };
    const book = new QuestBook(quests, save);
    const def = book.get('your_resolve');
    if (!def) throw new Error('missing your_resolve');
    expect(def.giver).toBeUndefined();
    expect(book.status('your_resolve', 3, [])).toBe('available');
    book.accept('your_resolve');
    // Talking to a teacher (and saying no) does not count.
    book.record('talk', 'master_brink', 1, []);
    expect(book.status('your_resolve', 3, [])).toBe('active');
    const changed = book.record('path', 'dark', 1, []);
    expect(changed.map((quest) => quest.id)).toEqual(['your_resolve']);
    expect(book.status('your_resolve', 3, [])).toBe('ready');
  });

  it('is locked before Sultan', () => {
    const book = new QuestBook(quests, { active: [], completed: [] });
    expect(book.status('your_resolve', 5, [])).toBe('locked');
  });
});
