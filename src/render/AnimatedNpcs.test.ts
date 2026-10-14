import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NpcsFile } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { type AnimatedDef, chooseGait, type GaitClip, gaitTimeScale } from './AnimatedNpcs';

const npcs = readPublicJson('data/npcs.json') as NpcsFile;
const pringle = npcs.npcs.find((npc) => npc.id === 'pringle');
const role = npcs.roles.find((entry) => entry.id === pringle?.role);
const def = role?.animated as AnimatedDef;

/** The JSON part of a .glb (clip names, nodes), read from disk. */
function readGlbJson(path: string): { animations?: { name?: string }[] } {
  const bytes = readFileSync(resolve(import.meta.dirname, '../../public', path));
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + length).toString('utf8')) as {
    animations?: { name?: string }[];
  };
}

/** Feeds speeds one after another (like frames) and returns the clip after each. */
function run(speeds: number[], start: GaitClip = 'idle'): GaitClip[] {
  let clip = start;
  return speeds.map((speed) => (clip = chooseGait(clip, speed, def)));
}

describe('Pringle has a real animated model', () => {
  it('is set up in npcs.json', () => {
    expect(def).toBeDefined();
    expect(def.file).toBe('characters/pringle/pringle.glb');
  });

  it('the .glb holds every clip npcs.json names', () => {
    const names = (readGlbJson(def.file).animations ?? []).map((clip) => clip.name);
    for (const clip of Object.values(def.clips)) expect(names).toContain(clip);
  });

  it('strolls with the walk clip and keeps up with the run clip, feet at a natural pace', () => {
    const follow = pringle?.follow;
    expect(follow).toBeDefined();
    if (!follow) return;
    expect(chooseGait('idle', follow.strollSpeed, def)).toBe('walk');
    expect(chooseGait('walk', follow.speed, def)).toBe('run');
    // Within the limits, not clamped: the feet do not slide while strolling or trotting along.
    for (const [clip, speed] of [
      ['walk', follow.strollSpeed],
      ['run', follow.speed],
    ] as const) {
      const scale = gaitTimeScale(clip, speed, def);
      expect(scale).toBeGreaterThan(0.6);
      expect(scale).toBeLessThan(1.6);
      expect(scale).toBeCloseTo(speed / (clip === 'walk' ? def.walkSpeed : def.runSpeed), 6);
    }
  });
});

describe('chooseGait', () => {
  it('picks idle, walk or run by speed', () => {
    expect(chooseGait('idle', 0, def)).toBe('idle');
    expect(chooseGait('idle', 1, def)).toBe('walk');
    expect(chooseGait('idle', 5, def)).toBe('run');
    expect(chooseGait('run', 0, def)).toBe('idle');
  });

  it('does not flicker at the walk / run edge', () => {
    const edge = def.runAbove;
    // Hovering just around the edge keeps the clip it has.
    expect(run([edge * 0.98, edge * 1.02, edge * 0.99, edge * 1.05], 'walk')).toEqual([
      'walk',
      'walk',
      'walk',
      'walk',
    ]);
    expect(run([edge * 1.02, edge * 0.98, edge * 0.9], 'run')).toEqual(['run', 'run', 'run']);
    // Clearly past it: switches.
    expect(run([edge * 1.3], 'walk')).toEqual(['run']);
    expect(run([edge * 0.7], 'run')).toEqual(['walk']);
  });

  it('does not flicker between idle and walk while barely moving', () => {
    const edge = def.idleBelow;
    expect(run([edge * 1.2, edge * 1.4, edge * 1.1], 'idle')).toEqual(['idle', 'idle', 'idle']);
    expect(run([edge * 1.2, edge * 1.05], 'walk')).toEqual(['walk', 'walk']);
    expect(run([edge * 0.5], 'walk')).toEqual(['idle']);
  });
});

describe('gaitTimeScale', () => {
  it('plays the clip at its own speed at the reference speed', () => {
    expect(gaitTimeScale('walk', def.walkSpeed, def)).toBe(1);
    expect(gaitTimeScale('run', def.runSpeed, def)).toBe(1);
    expect(gaitTimeScale('idle', 3, def)).toBe(1);
  });

  it('stays within limits far from the reference speed', () => {
    expect(gaitTimeScale('walk', 0.01, def)).toBe(0.6);
    expect(gaitTimeScale('run', 50, def)).toBe(1.6);
  });
});
