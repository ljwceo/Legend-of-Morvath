import { describe, expect, it } from 'vitest';
import { cutscenesFileSchema } from '../data/schemas';
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
    // Short enough to stay fun: about a minute without hitting anything.
    expect(seconds).toBeLessThan(75);
  });
});
