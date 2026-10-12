import { describe, expect, it } from 'vitest';
import { playerFileSchema } from '../data/schemas';
import type { PlayerConfig } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { followLockedTarget, headingTo, lockBroken, lockOnConfig, pickLockTarget } from './LockOn';

const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;
const cfg = lockOnConfig(player);
const DEG = Math.PI / 180;

function monster(
  x: number,
  z: number,
  hittable = true,
): { x: number; z: number; hittable: boolean } {
  return { x, z, hittable };
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
