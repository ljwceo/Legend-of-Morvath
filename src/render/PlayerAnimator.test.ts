import { AnimationClip, Bone, Group, NumberKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';
import type { AnimationsFile, PlayerClipRole } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { CombatState, type SwordConfig } from '../systems/Combat';
import { MoverState, stepAirTime } from '../systems/Movement';
import { StaffState } from '../systems/StaffCombat';
import {
  chooseGait,
  choosePlayerState,
  chooseRole,
  clipTime,
  createPlayerAnimInput,
  fadeInto,
  fillPlayerAnimInput,
  gaitTimeScale,
  type PlayerAnimInput,
  PlayerAnimator,
  type PlayerAnimSources,
  slashRole,
  strikeTime,
} from './PlayerAnimator';

const anim = (readPublicJson('data/animations.json') as AnimationsFile).player;
const g = anim.gait;
const s = anim.strike;

function input(change: Partial<PlayerAnimInput> = {}): PlayerAnimInput {
  return Object.assign(createPlayerAnimInput(), change);
}

describe('choosePlayerState', () => {
  it('stands, walks and runs by speed, with a margin at the borders', () => {
    expect(choosePlayerState('idle', input({ speed: 0 }), anim)).toBe('idle');
    expect(choosePlayerState('idle', input({ speed: 1.5 }), anim)).toBe('walk');
    expect(choosePlayerState('walk', input({ speed: 4 }), anim)).toBe('run');
    // Just under the border keeps running, just over it keeps walking.
    expect(choosePlayerState('run', input({ speed: g.runAbove * 0.97 }), anim)).toBe('run');
    expect(choosePlayerState('walk', input({ speed: g.runAbove * 1.03 }), anim)).toBe('walk');
    expect(choosePlayerState('idle', input({ speed: g.idleBelow * 1.2 }), anim)).toBe('idle');
    expect(choosePlayerState('walk', input({ speed: g.idleBelow * 0.9 }), anim)).toBe('idle');
  });

  it('sprints only when the simulation says so', () => {
    expect(chooseGait('run', 5, false, anim)).toBe('run');
    expect(chooseGait('run', 5, true, anim)).toBe('sprint');
  });

  it('dying wins over everything, then the dash, then attacking', () => {
    const busy = input({
      deathSeconds: 0.2,
      dashProgress: 0.5,
      windupProgress: 0.3,
      gathering: true,
      sinceHurt: 0,
      speed: 4,
    });
    expect(choosePlayerState('run', busy, anim)).toBe('death');
    busy.deathSeconds = -1;
    expect(choosePlayerState('run', busy, anim)).toBe('dash');
    busy.dashProgress = -1;
    expect(choosePlayerState('run', busy, anim)).toBe('attack');
    busy.windupProgress = -1;
    expect(choosePlayerState('run', busy, anim)).toBe('cast');
    busy.gathering = false;
    expect(choosePlayerState('cast', busy, anim)).toBe('run');
  });

  it('gets up after a heavy-load dash', () => {
    expect(choosePlayerState('dash', input({ recoverProgress: 0.1 }), anim)).toBe('dashRecover');
  });

  it('attacks during the swing, also while running', () => {
    const swing = input({ sinceSwing: 0.1, swingSeconds: 0.22, landedCombo: 1, speed: 4 });
    expect(choosePlayerState('run', swing, anim)).toBe('attack');
  });

  it('lets a finished swing settle while standing, but not after walking off', () => {
    const after = input({ sinceSwing: 0.3, swingSeconds: 0.22, landedCombo: 2 });
    expect(choosePlayerState('attack', after, anim)).toBe('attack');
    after.sinceSwing = 0.22 + s.settleSeconds + 0.01;
    expect(choosePlayerState('attack', after, anim)).toBe('idle');
    const walking = input({ sinceSwing: 0.3, swingSeconds: 0.22, landedCombo: 2, speed: 2 });
    expect(choosePlayerState('attack', walking, anim)).toBe('walk');
    // Settling never starts from another state (the swing was long over).
    expect(choosePlayerState('idle', input({ sinceSwing: 0.3, swingSeconds: 0.22 }), anim)).toBe(
      'idle',
    );
  });

  it('draws the release of a shot, then settles like a swing', () => {
    expect(choosePlayerState('cast', input({ sinceFired: 0.1, speed: 4 }), anim)).toBe('cast');
    const lead = s.leadSeconds + s.followSeconds;
    expect(choosePlayerState('cast', input({ sinceFired: lead + 0.1 }), anim)).toBe('cast');
    expect(choosePlayerState('cast', input({ sinceFired: lead + 0.1, speed: 4 }), anim)).toBe(
      'run',
    );
  });

  it('flinches and interacts only while standing', () => {
    expect(choosePlayerState('idle', input({ sinceHurt: 0.1 }), anim)).toBe('hit');
    expect(choosePlayerState('run', input({ sinceHurt: 0.1, speed: 4 }), anim)).toBe('run');
    expect(choosePlayerState('hit', input({ sinceHurt: anim.hold.hit }), anim)).toBe('idle');
    expect(choosePlayerState('idle', input({ sinceInteract: 0.5 }), anim)).toBe('interact');
  });

  it('falls after a real drop and lands, but a step down is no fall', () => {
    expect(choosePlayerState('run', input({ airTime: anim.fallAfterSeconds / 2 }), anim)).toBe(
      'idle',
    );
    expect(choosePlayerState('run', input({ airTime: anim.fallAfterSeconds }), anim)).toBe('fall');
    expect(choosePlayerState('fall', input({ airTime: 0.3, rising: true }), anim)).toBe('jump');
    const landed = input({ sinceLanded: 0.1, lastAirTime: 0.5 });
    expect(choosePlayerState('fall', landed, anim)).toBe('land');
    landed.lastAirTime = anim.fallAfterSeconds / 2;
    expect(choosePlayerState('fall', landed, anim)).toBe('idle');
  });
});

describe('chooseRole', () => {
  it('runs the combo Slash_1 → 2 → 3 and starts over', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(slashRole)).toEqual([
      'slash1',
      'slash2',
      'slash3',
      'slash1',
      'slash2',
      'slash3',
      'slash1',
    ]);
    expect(chooseRole('attack', input({ landedCombo: 2 }))).toBe('slash2');
  });

  it('winds up and strikes for a heavy hit, gathers and releases with the staff', () => {
    expect(chooseRole('attack', input({ windupProgress: 0.4 }))).toBe('heavyWindup');
    expect(chooseRole('attack', input({ landedCombo: 0 }))).toBe('heavyStrike');
    expect(chooseRole('cast', input({ gathering: true }))).toBe('castGather');
    expect(chooseRole('cast', input())).toBe('castRelease');
    expect(chooseRole('fall', input())).toBe('jumpAir');
    expect(chooseRole('jump', input())).toBe('jumpStart');
    expect(chooseRole('dashRecover', input())).toBe('dashRecover');
  });
});

describe('strike timing (the blow lands with the damage)', () => {
  const contact = s.contactSeconds.slash1;

  it('stands just before contact when the damage lands', () => {
    expect(strikeTime(contact, 0, 0.22, anim)).toBeCloseTo(contact - s.leadSeconds, 9);
  });

  it('reaches contact within the first fifth of the swing', () => {
    const atContact = (s.leadSeconds / (s.leadSeconds + s.followSeconds)) * 0.22;
    expect(strikeTime(contact, atContact, 0.22, anim)).toBeCloseTo(contact, 9);
    expect(atContact).toBeLessThan(0.22 / 5);
  });

  it('ends the swing just after contact and then plays on at its own speed', () => {
    expect(strikeTime(contact, 0.22, 0.22, anim)).toBeCloseTo(contact + s.followSeconds, 9);
    expect(strikeTime(contact, 0.32, 0.22, anim)).toBeCloseTo(contact + s.followSeconds + 0.1, 9);
  });

  it('follows a faster swing (Dexterity) just as well', () => {
    expect(strikeTime(contact, 0.055, 0.11, anim)).toBeCloseTo(
      strikeTime(contact, 0.11, 0.22, anim),
      9,
    );
  });

  it('never starts before the clip', () => {
    expect(strikeTime(0.02, 0, 0.22, anim)).toBe(0);
  });
});

describe('clipTime', () => {
  it('puts progress-driven clips at progress × duration', () => {
    expect(clipTime('dash', input({ dashProgress: 0.5 }), anim, 0.2)).toBeCloseTo(0.1, 9);
    expect(clipTime('heavyWindup', input({ windupProgress: 1 }), anim, 1.233)).toBeCloseTo(
      1.233,
      9,
    );
  });

  it('strikes by the time since the damage, releases by the time since the shot', () => {
    const i = input({ sinceSwing: 0, swingSeconds: 0.22, sinceFired: 0 });
    expect(clipTime('slash2', i, anim, 2.2)).toBeCloseTo(s.contactSeconds.slash2 - s.leadSeconds);
    expect(clipTime('castRelease', i, anim, 2.03)).toBeCloseTo(
      s.contactSeconds.castRelease - s.leadSeconds,
    );
  });

  it('starts Land where its feet touch the ground and clamps to the clip', () => {
    expect(clipTime('land', input({ sinceLanded: 0 }), anim, 1.2)).toBe(anim.landFromSeconds);
    expect(clipTime('death', input({ deathSeconds: 99 }), anim, 3.4)).toBe(3.4);
  });

  it('lets the loops play on their own', () => {
    for (const role of ['idle', 'walk', 'run', 'castGather', 'jumpAir'] as PlayerClipRole[]) {
      expect(clipTime(role, input(), anim, 1)).toBe(-1);
    }
  });
});

describe('gaitTimeScale and fades', () => {
  it('plays a walking clip at speed / its own foot speed, within limits', () => {
    expect(gaitTimeScale('run', g.runSpeed, anim)).toBeCloseTo(1, 9);
    expect(gaitTimeScale('walk', g.walkSpeed * 1.2, anim)).toBeCloseTo(1.2, 9);
    expect(gaitTimeScale('run', 0.1, anim)).toBe(g.minTimeScale);
    expect(gaitTimeScale('walk', 50, anim)).toBe(g.maxTimeScale);
    expect(gaitTimeScale('idle', 3, anim)).toBe(1);
  });

  it('fades short into a strike and longer between walking clips', () => {
    expect(fadeInto('slash1', anim)).toBe(anim.fadeSeconds.strike);
    expect(fadeInto('run', anim)).toBe(anim.fadeSeconds.move);
    expect(fadeInto('hit', anim)).toBe(anim.fadeSeconds.action);
  });
});

describe('fillPlayerAnimInput', () => {
  const sword = { heavyWindupSeconds: 0.9, fastSwingSeconds: 0.22 } as SwordConfig;

  function sources(): PlayerAnimSources {
    return {
      mover: new MoverState(),
      combat: new CombatState(),
      staff: null,
      sword,
      dashSeconds: 0.18,
      recoverSeconds: 0,
      deathSeconds: -1,
      sinceInteract: Infinity,
    };
  }

  it('reads progress and times at the drawn moment (lag behind the last step)', () => {
    const src = sources();
    src.mover.dashTime = 0.09;
    src.combat.sinceSwing = 0.05;
    src.combat.landedCombo = 3;
    const out = fillPlayerAnimInput(createPlayerAnimInput(), src, 0.01);
    expect(out.dashProgress).toBeCloseTo(1 - 0.1 / 0.18, 9);
    expect(out.sinceSwing).toBeCloseTo(0.04, 9);
    expect(out.landedCombo).toBe(3);
    expect(out.windupProgress).toBe(-1);
    expect(out.recoverProgress).toBe(-1);
  });

  it('scales the swing and the wind-up with attack speed, never reads below zero', () => {
    const src = sources();
    src.combat.attackSpeedFactor = 2;
    src.combat.heavyWindup = 0.45;
    src.combat.sinceHurt = 0.005;
    const out = fillPlayerAnimInput(createPlayerAnimInput(), src, 0.01);
    expect(out.swingSeconds).toBeCloseTo(0.11, 9);
    expect(out.windupProgress).toBe(0);
    expect(out.sinceHurt).toBe(0);
  });

  it('reads the staff only when one is held', () => {
    const src = sources();
    const staff = new StaffState();
    staff.pending = 'shard';
    staff.sinceFired = 0.3;
    expect(fillPlayerAnimInput(createPlayerAnimInput(), src, 0).gathering).toBe(false);
    src.staff = staff;
    const out = fillPlayerAnimInput(createPlayerAnimInput(), src, 0);
    expect(out.gathering).toBe(true);
    expect(out.sinceFired).toBeCloseTo(0.3, 9);
  });
});

describe('stepAirTime', () => {
  it('counts the air time and remembers it at the landing', () => {
    const m = new MoverState();
    for (let i = 0; i < 30; i++) stepAirTime(m, true, 1 / 60);
    expect(m.airTime).toBeCloseTo(0.5, 9);
    stepAirTime(m, false, 1 / 60);
    expect(m.airTime).toBe(0);
    expect(m.lastAirTime).toBeCloseTo(0.5, 9);
    expect(m.sinceLanded).toBe(0);
    stepAirTime(m, false, 1 / 60);
    expect(m.sinceLanded).toBeCloseTo(1 / 60, 9);
  });
});

describe('PlayerAnimator', () => {
  function rig(): { root: Group; clips: Map<PlayerClipRole, AnimationClip> } {
    const root = new Group();
    const bone = new Bone();
    bone.name = 'Hips';
    root.add(bone);
    const clips = new Map<PlayerClipRole, AnimationClip>();
    for (const role of ['idle', 'run', 'slash1', 'death'] as PlayerClipRole[]) {
      const track = new NumberKeyframeTrack('Hips.position[x]', [0, 1], [0, 1]);
      clips.set(role, new AnimationClip(role, 1, [track]));
    }
    return { root, clips };
  }

  it('crossfades into the chosen clip, keeping the weights at 1 in total', () => {
    const { root, clips } = rig();
    const animator = new PlayerAnimator(root, clips, anim);
    const i = input();
    for (let f = 0; f < 60; f++) animator.update(i, 4, 1 / 60);
    expect(animator.state).toBe('run');
    expect(animator.role).toBe('run');
    animator.update(i, 0, 0);
    expect(animator.clipName).toBe('run');
  });

  it('falls back to Idle when a clip is missing, and follows the strike time', () => {
    const { root, clips } = rig();
    const animator = new PlayerAnimator(root, clips, anim);
    animator.update(input({ deathSeconds: 0.5 }), 0, 1 / 60);
    expect(animator.role).toBe('death');
    // Slash_2 is not in this rig: Idle plays instead of nothing.
    animator.update(input({ sinceSwing: 0, swingSeconds: 0.22, landedCombo: 2 }), 0, 1 / 60);
    expect(animator.state).toBe('attack');
    expect(animator.role).toBe('idle');
    animator.dispose();
  });
});
