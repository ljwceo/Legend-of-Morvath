import { describe, expect, it } from 'vitest';
import { playerFileSchema } from '../data/schemas';
import type { PlayerConfig } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import {
  followLockedTarget,
  headingTo,
  lockBroken,
  lockOnConfig,
  lostSight,
  pickLockTarget,
  stepBlindSeconds,
} from './LockOn';

const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;
const cfg = lockOnConfig(player);
const DEG = Math.PI / 180;

function monster(
  x: number,
  z: number,
  hittable = true,
  lockable = hittable,
): { x: number; z: number; hittable: boolean; lockable: boolean } {
  return { x, z, hittable, lockable };
}

describe('picking a target', () => {
  it('takes the one nearest the middle of the screen', () => {
    const straight = monster(0, 10);
    const aside = monster(6, 6);
    expect(pickLockTarget(0, 0, 0, [aside, straight], cfg)).toBe(straight);
  });

  it('prefers the nearer one when both are in front of you', () => {
    const near = monster(0, 4);
    const far = monster(0, 15);
    expect(pickLockTarget(0, 0, 0, [far, near], cfg)).toBe(near);
  });

  it('skips what you cannot hit, what is too far and what is behind you', () => {
    expect(pickLockTarget(0, 0, 0, [monster(0, 10, false)], cfg)).toBeNull();
    expect(pickLockTarget(0, 0, 0, [monster(0, cfg.range + 1)], cfg)).toBeNull();
    expect(pickLockTarget(0, 0, 0, [monster(0, -10)], cfg)).toBeNull();
  });

  it('skips a training dummy: you can hit it, but it is no target to lock on to', () => {
    const dummy = monster(0, 4, true, false);
    const slime = monster(0, 12);
    expect(pickLockTarget(0, 0, 0, [dummy], cfg)).toBeNull();
    // Even though the dummy is nearer and straighter ahead, the slime wins.
    expect(pickLockTarget(0, 0, 0, [dummy, slime], cfg)).toBe(slime);
  });

  it('locks on to a guarded boss: hittable only in its openings, but a target all the time', () => {
    const boss = monster(0, 8, false, true);
    expect(pickLockTarget(0, 0, 0, [boss], cfg)).toBe(boss);
    expect(lockBroken(boss, 0, 0, 0, cfg)).toBe(false);
  });

  it('takes the enemy in view and never the one behind you', () => {
    const inView = monster(3, 9);
    const behind = monster(0, -3);
    expect(pickLockTarget(0, 0, 0, [behind, inView], cfg)).toBe(inView);
    expect(pickLockTarget(0, 0, 0, [behind], cfg)).toBeNull();
    // Turn the camera round and the other one is in view.
    expect(pickLockTarget(0, 0, Math.PI, [behind, inView], cfg)).toBe(behind);
  });

  it('follows where the camera looks, not where the player faces', () => {
    const behindRight = monster(10, 0);
    expect(pickLockTarget(0, 0, 0, [behindRight], cfg)).toBeNull();
    expect(pickLockTarget(0, 0, 90 * DEG, [behindRight], cfg)).toBe(behindRight);
  });
});

describe('breaking the lock', () => {
  it('breaks when the target is defeated or walks out of range', () => {
    expect(lockBroken(monster(0, 5, false), 0, 0, 0, cfg)).toBe(true);
    expect(lockBroken(monster(0, cfg.breakRange + 1), 0, 0, 0, cfg)).toBe(true);
    expect(lockBroken(monster(0, cfg.range), 0, 0, 0, cfg)).toBe(false);
  });

  it('breaks when you look too far away from it', () => {
    const target = monster(0, 10);
    expect(lockBroken(target, 0, 0, 0, cfg)).toBe(false);
    expect(lockBroken(target, 0, 0, cfg.maxOffView + 0.1, cfg)).toBe(true);
    expect(lockBroken(target, 0, 0, cfg.maxOffView - 0.1, cfg)).toBe(false);
  });

  it('keeps the lock while the target stands on top of you', () => {
    expect(lockBroken(monster(0, 0), 0, 0, Math.PI, cfg)).toBe(false);
  });
});

describe('aiming and the camera', () => {
  it('aims at the target, and keeps the old heading for a target on top of you', () => {
    expect(headingTo(0, 0, 0, 5, 1.23)).toBeCloseTo(0, 6);
    expect(headingTo(0, 0, 5, 0, 1.23)).toBeCloseTo(Math.PI / 2, 6);
    expect(headingTo(0, 0, 0, 0, 1.23)).toBe(1.23);
  });

  it('turns the camera towards the target, but no faster than its rate', () => {
    const target = monster(10, 0);
    const after = followLockedTarget(0, 0, 0, target, cfg, 0.1);
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThanOrEqual(cfg.cameraFollowRadians * 0.1 + 1e-9);
  });

  it('turns equally far in the same time at 60 and 120 fps', () => {
    const target = monster(10, 0);
    let slow = 0;
    for (let i = 0; i < 6; i++) slow = followLockedTarget(slow, 0, 0, target, cfg, 1 / 60);
    let fast = 0;
    for (let i = 0; i < 12; i++) fast = followLockedTarget(fast, 0, 0, target, cfg, 1 / 120);
    expect(fast).toBeCloseTo(slow, 6);
  });

  it('stops turning once the camera looks at the target', () => {
    const target = monster(0, 10);
    expect(followLockedTarget(0, 0, 0, target, cfg, 1)).toBeCloseTo(0, 6);
  });
});

describe('only what you can see (fase 3.6)', () => {
  const targets = [monster(0, 5), monster(3, 6)];

  it('never locks on to an enemy the camera cannot see', () => {
    const blind = (): boolean => false;
    expect(pickLockTarget(0, 0, 0, targets, cfg, blind)).toBe(null);
  });

  it('takes the next best one when the nearest is behind something', () => {
    const hidden = targets[0];
    const canSee = (t: (typeof targets)[number]): boolean => t !== hidden;
    expect(pickLockTarget(0, 0, 0, targets, cfg, canSee)).toBe(targets[1]);
  });

  it('leaves out the target you are switching away from', () => {
    expect(pickLockTarget(0, 0, 0, targets, cfg, undefined, targets[0])).toBe(targets[1]);
    // Nothing else in sight: switching finds nothing and the lock simply stays.
    expect(
      pickLockTarget(0, 0, 0, [targets[0] as (typeof targets)[number]], cfg, undefined, targets[0]),
    ).toBe(null);
  });

  it('counts the seconds out of sight and breaks past the tolerance', () => {
    const tolerant = { ...cfg, loseSightSeconds: 0.2 };
    let blind = 0;
    blind = stepBlindSeconds(blind, false, 1 / 60);
    expect(lostSight(blind, tolerant)).toBe(false);
    for (let i = 0; i < 12; i++) blind = stepBlindSeconds(blind, false, 1 / 60);
    expect(lostSight(blind, tolerant)).toBe(true);
    // Seeing it again forgets everything.
    expect(stepBlindSeconds(blind, true, 1 / 60)).toBe(0);
  });

  it('breaks at the same moment on 60 and 120 fps (seconds, not frames)', () => {
    const tolerant = { ...cfg, loseSightSeconds: 0.2 };
    const until = (step: number): number => {
      let blind = 0;
      let seconds = 0;
      while (!lostSight(blind, tolerant) && seconds < 2) {
        blind = stepBlindSeconds(blind, false, step);
        seconds += step;
      }
      return seconds;
    };
    expect(Math.abs(until(1 / 60) - until(1 / 120))).toBeLessThan(0.02);
  });

  it('breaks at once when the tolerance is 0 (cheat menu)', () => {
    const sharp = { ...cfg, loseSightSeconds: 0 };
    expect(lostSight(stepBlindSeconds(0, false, 1 / 60), sharp)).toBe(true);
  });
});
