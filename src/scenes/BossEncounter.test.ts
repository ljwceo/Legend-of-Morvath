import { describe, expect, it } from 'vitest';
import { validateGameData } from '../data/DataValidator';
import { readAllData } from '../test/loadPublic';
import { endingCutscene } from './BossEncounter';

const data = validateGameData(readAllData()).data;
const sultan = data?.monsters.monsters.find((m) => m.id === 'sultan')?.boss;

describe("the boss's ending", () => {
  it('picks the ending by the killing blow', () => {
    expect(endingCutscene(sultan, 'sword')).toBe('sultan_end_sword');
    expect(endingCutscene(sultan, 'staff')).toBe('sultan_end_staff');
  });

  it('has none for a boss without an ending (the old way: words and rewards at once)', () => {
    expect(endingCutscene(undefined, 'sword')).toBeNull();
    expect(endingCutscene({ ending: undefined }, 'staff')).toBeNull();
  });
});
