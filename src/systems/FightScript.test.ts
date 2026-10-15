import { describe, expect, it } from 'vitest';
import { cutscenesFileSchema } from '../data/schemas';
import { flattenStrings } from '../i18n/I18n';
import { readPublicJson } from '../test/loadPublic';
import { beatSeconds, type FightAction, type FightBeat, FightScript } from './FightScript';

const DT = 1 / 60;

function play(beats: FightBeat[]) {
  const log: string[] = [];
  const script = new FightScript(beats, (action, beat) => log.push(`${beat.id}:${action.type}`));
  return { script, log };
}

const say = (seconds: number, delay = 0): FightAction => ({
  type: 'say',
  foe: 'a',
  text: 'x',
  seconds,
  delay,
});

describe('FightScript', () => {
  it('plays a beat at once, then waits for hits or seconds, whichever comes first', () => {
    const { script, log } = play([
      { id: 'one', actions: [say(1)] },
      { id: 'two', startAfterHits: 2, startAfterSeconds: 5, actions: [say(1)] },
      { id: 'three', startAfterSeconds: 2, actions: [say(1)] },
    ]);
    script.step(DT);
    expect(log).toEqual(['one:say']);
    for (let i = 0; i < 60; i++) script.step(DT);
    // Beat two waits: hits during a playing beat do not count, hits while waiting do.
    script.registerHit();
    script.registerHit();
    script.step(DT);
    expect(log).toEqual(['one:say', 'two:say']);
    for (let i = 0; i < 60 * 3.2; i++) script.step(DT);
    expect(log).toEqual(['one:say', 'two:say', 'three:say']);
    for (let i = 0; i < 60 * 1.2; i++) script.step(DT);
    expect(script.finished).toBe(true);
  });

  it('starts by time when the player does not hit', () => {
    const { script, log } = play([
      { id: 'wait', startAfterHits: 3, startAfterSeconds: 4, actions: [say(1)] },
    ]);
    for (let i = 0; i < 60 * 3.9; i++) script.step(DT);
    expect(log).toEqual([]);
    for (let i = 0; i < 12; i++) script.step(DT);
    expect(log).toEqual(['wait:say']);
  });

  it('fires each action at its delay and lasts until the last one ends', () => {
    const beat: FightBeat = { id: 'b', actions: [say(3), say(4.5, 3)] };
    expect(beatSeconds(beat)).toBe(7.5);
    const { script, log } = play([beat]);
    for (let i = 0; i < 60 * 2.9; i++) script.step(DT);
    expect(log).toEqual(['b:say']);
    for (let i = 0; i < 12; i++) script.step(DT);
    expect(log).toEqual(['b:say', 'b:say']);
  });

  it('the intro fight in cutscenes.json ends with `end`, even if the player does nothing', () => {
    const file = cutscenesFileSchema.parse(readPublicJson('data/cutscenes.json'));
    const fight = file.fights.find((f) => f.id === 'intro_fight');
    expect(fight).toBeDefined();
    if (!fight) return;
    const { script, log } = play(fight.beats);
    let seconds = 0;
    while (!script.finished && seconds < 120) {
      script.step(DT);
      seconds += DT;
    }
    expect(script.finished).toBe(true);
    // The fight hands over to the film after it; nothing else ends it.
    expect(log.at(-1)).toBe('finish:end');
    expect(log.filter((entry) => entry.endsWith(':end'))).toHaveLength(1);
    // About a minute without hitting anything: room for the whole argument, short enough to
    // stay fun (hits only bring beats forward).
    expect(seconds).toBeGreaterThanOrEqual(55);
    expect(seconds).toBeLessThan(75);
  });

  it('the intro fight is the brothers arguing: the hint first, then lines turn and turn about', () => {
    const file = cutscenesFileSchema.parse(readPublicJson('data/cutscenes.json'));
    const textKeys = new Set(flattenStrings(readPublicJson('lang/en.json')).keys());
    const fight = file.fights.find((f) => f.id === 'intro_fight');
    if (!fight) throw new Error('no intro fight');
    const actions = fight.beats.flatMap((beat) => beat.actions);
    const first = fight.beats[0]?.actions ?? [];
    expect(first.some((a) => a.type === 'hint' && a.text === 'intro.fight.hint')).toBe(true);
    // At least eight lines, never two in a row by the same brother, Baelor's verdict among them.
    const lines = actions.filter((a) => a.type === 'say');
    expect(lines.length).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < lines.length; i++) expect(lines[i]?.foe).not.toBe(lines[i - 1]?.foe);
    expect(lines.map((a) => a.text)).toContain('intro.baelor');
    for (const action of actions) {
      if (action.text) expect(textKeys.has(action.text), action.text).toBe(true);
    }
    // Lucael blinks about and pops up behind the player; Baelor stops time; then `end`.
    const types = new Set<FightAction['type']>(actions.map((a) => a.type));
    for (const type of ['blink', 'teleportBehind', 'teleportHome', 'freezeTime', 'end'] as const) {
      expect(types.has(type), type).toBe(true);
    }
    expect(actions.filter((a) => a.type === 'blink').every((a) => a.foe === 'lucael')).toBe(true);
    expect(actions.find((a) => a.type === 'teleportBehind')?.foe).toBe('lucael');
    expect(actions.find((a) => a.type === 'freezeTime')?.foe).toBe('baelor');
  });
});
