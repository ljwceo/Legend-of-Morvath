import { describe, expect, it } from 'vitest';
import { validateGameData } from '../data/DataValidator';
import { createNewSave } from '../save/SaveData';
import { readAllData } from '../test/loadPublic';
import {
  bootRoute,
  canContinue,
  frameCapFor,
  placeAtStart,
  type StateId,
  startNewGame,
} from './flow';

describe('StateId', () => {
  it('knows every scene, the filmed intro (introScene) among them', () => {
    // A compile-time check as much as a runtime one: a renamed state breaks this list.
    const ids: StateId[] = ['boot', 'language', 'title', 'create', 'introScene', 'world'];
    expect(ids).toContain('introScene');
    expect(ids).not.toContain('introFight');
  });
});

describe('bootRoute', () => {
  it('asks for the language without a usable save and shows the title with one', () => {
    expect(bootRoute({ status: 'none' })).toBe('language');
    expect(bootRoute({ status: 'corrupt' })).toBe('language');
    expect(bootRoute({ status: 'ok', save: createNewSave('nl') })).toBe('title');
  });

  it('stops on a save from a newer version so it is never overwritten', () => {
    expect(bootRoute({ status: 'newer', version: 9 })).toBe('blocked');
  });
});

describe('canContinue', () => {
  it('needs a save that has reached the world', () => {
    expect(canContinue(null)).toBe(false);
    const save = createNewSave('en');
    expect(canContinue(save)).toBe(false);
    save.world.zone = 'somewhere';
    expect(canContinue(save)).toBe(true);
  });
});

describe('startNewGame', () => {
  it('starts over but keeps language and settings', () => {
    const old = createNewSave('nl');
    old.settings.volume = 0.3;
    old.settings.debug = true;
    old.world.zone = 'somewhere';
    old.visitedPlaces.push('forge');
    old.playTimeSeconds = 500;
    const fresh = startNewGame(old, 'nl');
    expect(fresh.settings).toEqual(old.settings);
    expect(fresh.settings).not.toBe(old.settings);
    expect(fresh.world.zone).toBeNull();
    expect(fresh.visitedPlaces).toEqual([]);
    expect(fresh.playTimeSeconds).toBe(0);
    expect(fresh.language).toBe('nl');
  });
});

describe('frameCapFor', () => {
  it('maps the setting to a frame cap, with the test override first', () => {
    expect(frameCapFor('auto')).toBe(0);
    expect(frameCapFor('60')).toBe(60);
    expect(frameCapFor('120')).toBe(120);
    expect(frameCapFor('120', 30)).toBe(30);
    // "Auto" follows the preset's fps target; a chosen cap wins over it.
    expect(frameCapFor('auto', 0, 60)).toBe(60);
    expect(frameCapFor('120', 0, 60)).toBe(120);
  });
});

describe('placeAtStart', () => {
  const { data } = validateGameData(readAllData());

  it('puts a new game at the start zone spawn point and checkpoint', () => {
    if (!data) throw new Error('data invalid');
    const save = createNewSave('en');
    placeAtStart(save, data);
    const zone = data.zones.zones.find((entry) => entry.id === data.player.start.zone);
    const spawn = zone?.spawnPoints.find((point) => point.id === data.player.start.spawnPoint);
    expect(save.world.zone).toBe(data.player.start.zone);
    // A spawn with a floor height (the bed under the Monastery roof) arrives on that floor; else
    // a Blender-built zone finds the ground from far above when the world is built.
    expect(save.world.position).toEqual({
      x: spawn?.x,
      y: spawn?.y ?? (zone?.scene ? 10_000 : 0),
      z: spawn?.z,
    });
    // Facing the spawn point's direction.
    expect(save.world.heading).toBeCloseTo(((spawn?.headingDegrees ?? 0) * Math.PI) / 180);
    expect(save.world.checkpoint).toBe(zone?.checkpoint?.id);
  });

  it('leaves an existing position alone (Continue)', () => {
    if (!data) throw new Error('data invalid');
    const save = createNewSave('en');
    save.world = {
      zone: 'other',
      instance: null,
      position: { x: 1, y: 2, z: 3 },
      heading: 1,
      checkpoint: null,
    };
    placeAtStart(save, data);
    expect(save.world.zone).toBe('other');
    expect(save.world.position).toEqual({ x: 1, y: 2, z: 3 });
  });
});
