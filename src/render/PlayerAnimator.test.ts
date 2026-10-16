import { AnimationClip, Bone, Group, NumberKeyframeTrack, QuaternionKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';
import type { AnimationsFile, PlayerClipRole } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { CombatState, type SwordConfig } from '../systems/Combat';
import { MoverState, stepAirTime } from '../systems/Movement';
import { StaffState } from '../systems/StaffCombat';
import {
  chooseGait,
  chooseLayers,
  choosePlayerState,
  chooseRole,
  clipTime,
  createPlayerAnimInput,
  createPlayerAnimLayers,
  fadeInto,
  fillPlayerAnimInput,
  gaitTimeScale,
  leanTarget,
  namesUnder,
  type PlayerAnimInput,
  PlayerAnimator,
  type PlayerAnimSources,
  slashRole,
  splitClip,
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

  it('lets a finished swing settle while standing, and on the upper body while walking', () => {
    const after = input({ sinceSwing: 0.3, swingSeconds: 0.22, landedCombo: 2 });
    expect(choosePlayerState('attack', after, anim)).toBe('attack');
    after.sinceSwing = 0.22 + s.settleSeconds + 0.01;
    expect(choosePlayerState('attack', after, anim)).toBe('idle');
    const walking = input({ sinceSwing: 0.3, swingSeconds: 0.22, landedCombo: 2, speed: 2 });
    expect(choosePlayerState('attack', walking, anim)).toBe('attack');
    walking.sinceSwing = 0.22 + s.settleSeconds + 0.01;
    expect(choosePlayerState('attack', walking, anim)).toBe('walk');
    // A heavy strike moves the whole body: walking off breaks it off.
    const heavy = input({ sinceSwing: 0.3, swingSeconds: 0.22, landedCombo: 0, speed: 2 });
    expect(choosePlayerState('attack', heavy, anim)).toBe('walk');
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
      'cast',
    );
    const over = input({ sinceFired: lead + s.settleSeconds + 0.1, speed: 4 });
    expect(choosePlayerState('cast', over, anim)).toBe('run');
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

describe('chooseLayers (upper body while walking)', () => {
  const layers = () => createPlayerAnimLayers();

  it('plays a whole-body clip standing still', () => {
    const i = input({ sinceSwing: 0, swingSeconds: 0.22, landedCombo: 1 });
    expect(chooseLayers('attack', 'idle', i, anim, layers())).toEqual({
      lower: 'slash1',
      upper: 'slash1',
    });
    expect(chooseLayers('idle', 'idle', input(), anim, layers())).toEqual({
      lower: 'idle',
      upper: 'idle',
    });
  });

  it('keeps the legs walking under a swing, a cast or a flinch', () => {
    const swing = input({ sinceSwing: 0, swingSeconds: 0.22, landedCombo: 3, speed: 4 });
    expect(chooseLayers('attack', 'run', swing, anim, layers())).toEqual({
      lower: 'run',
      upper: 'slash3',
    });
    const cast = input({ gathering: true, speed: 1.5 });
    expect(chooseLayers('cast', 'walk', cast, anim, layers())).toEqual({
      lower: 'walk',
      upper: 'castGather',
    });
    const hurt = input({ sinceHurt: 0.1, speed: 4 });
    expect(chooseLayers('run', 'run', hurt, anim, layers())).toEqual({
      lower: 'run',
      upper: 'hit',
    });
    expect(chooseLayers('run', 'run', input({ sinceHurt: anim.hold.hit }), anim, layers())).toEqual(
      { lower: 'run', upper: 'run' },
    );
  });

  it('moves the whole body for the heavy hit, a dash and dying, also while moving', () => {
    const windup = input({ windupProgress: 0.5, speed: 2 });
    expect(chooseLayers('attack', 'walk', windup, anim, layers())).toEqual({
      lower: 'heavyWindup',
      upper: 'heavyWindup',
    });
    expect(chooseLayers('dash', 'run', input({ dashProgress: 0.5 }), anim, layers())).toEqual({
      lower: 'dash',
      upper: 'dash',
    });
    expect(chooseLayers('death', 'run', input({ deathSeconds: 1 }), anim, layers())).toEqual({
      lower: 'death',
      upper: 'death',
    });
  });

  it('only splits roles named in animations.json', () => {
    const only = { ...anim, upperBody: { rootBone: 'Spine', roles: ['castGather' as const] } };
    const swing = input({ sinceSwing: 0, swingSeconds: 0.22, landedCombo: 1, speed: 4 });
    expect(chooseLayers('attack', 'run', swing, only, layers())).toEqual({
      lower: 'slash1',
      upper: 'slash1',
    });
  });
});

describe('splitClip and namesUnder', () => {
  it('splits the tracks by bone, keeping the clip length', () => {
    const root = new Group();
    const hips = new Bone();
    hips.name = 'Hips';
    const spine = new Bone();
    spine.name = 'Spine';
    const head = new Bone();
    head.name = 'Head';
    const leg = new Bone();
    leg.name = 'LeftUpLeg';
    root.add(hips);
    hips.add(spine, leg);
    spine.add(head);
    const upper = namesUnder(root, 'Spine');
    expect([...upper].sort()).toEqual(['Head', 'Spine']);
    expect(namesUnder(root, 'Nothing').size).toBe(0);
    const clip = new AnimationClip('Run', 1.2, [
      new NumberKeyframeTrack('Hips.position[x]', [0, 1], [0, 1]),
      new NumberKeyframeTrack('Hips.quaternion[x]', [0, 1], [0, 1]),
      new NumberKeyframeTrack('LeftUpLeg.quaternion[x]', [0, 1], [0, 1]),
      new NumberKeyframeTrack('Spine.quaternion[x]', [0, 1], [0, 1]),
      new NumberKeyframeTrack('Head.quaternion[x]', [0, 1], [0, 1]),
    ]);
    const [legs, top] = splitClip(clip, upper);
    expect(legs.name).toBe('Run');
    expect(legs.duration).toBe(1.2);
    expect(top.duration).toBe(1.2);
    expect(legs.tracks.map((t) => t.name)).toEqual([
      'Hips.position[x]',
      'Hips.quaternion[x]',
      'LeftUpLeg.quaternion[x]',
    ]);
    expect(top.tracks.map((t) => t.name)).toEqual(['Spine.quaternion[x]', 'Head.quaternion[x]']);
  });
});

describe('leanTarget', () => {
  const l = anim.lean;
  const DEG = Math.PI / 180;
  const out = { x: 0, z: 0 };

  it('leans forward when setting off, back when braking', () => {
    // Heading 0 looks along +z: speeding up along +z is forward.
    expect(leanTarget(0, 4, 0, l, out).z).toBeCloseTo(
      Math.min(l.maxForwardDeg, 4 * l.forwardDegPerMps2) * DEG,
      9,
    );
    expect(out.x).toBeCloseTo(0, 9);
    expect(leanTarget(0, -40, 0, l, out).z).toBeCloseTo(-l.maxBackDeg * DEG, 9);
  });

  it('leans into a turn, in the model frame', () => {
    // Heading π/2 looks along +x, so the model's own +x points along world −z: a push along
    // world +z tips it towards its −x.
    expect(leanTarget(0, 4, Math.PI / 2, l, out).x).toBeCloseTo(
      -Math.min(l.maxSidewaysDeg, 4 * l.sidewaysDegPerMps2) * DEG,
      9,
    );
    expect(out.z).toBeCloseTo(0, 9);
    expect(leanTarget(0, -100, Math.PI / 2, l, out).x).toBeCloseTo(l.maxSidewaysDeg * DEG, 9);
  });

  it('stands straight without acceleration', () => {
    expect(leanTarget(0, 0, 1.3, l, out)).toEqual({ x: 0, z: 0 });
  });
});

describe('PlayerAnimator', () => {
  function rig(): { root: Group; clips: Map<PlayerClipRole, AnimationClip>; spine: Bone } {
    const root = new Group();
    const hips = new Bone();
    hips.name = 'Hips';
    const spine = new Bone();
    spine.name = 'Spine';
    root.add(hips);
    hips.add(spine);
    const clips = new Map<PlayerClipRole, AnimationClip>();
    for (const role of [
      'idle',
      'walk',
      'run',
      'slash1',
      'castGather',
      'death',
    ] as PlayerClipRole[]) {
      clips.set(
        role,
        new AnimationClip(role, 1, [
          new NumberKeyframeTrack('Hips.position[x]', [0, 1], [0, 1]),
          new QuaternionKeyframeTrack('Spine.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
        ]),
      );
    }
    return { root, clips, spine };
  }

  it('crossfades into the chosen clip, keeping the weights at 1 in total', () => {
    const { root, clips } = rig();
    const animator = new PlayerAnimator(root, clips, anim);
    const i = input();
    for (let f = 0; f < 60; f++) animator.update(i, 0, 4, 0, 1 / 60);
    expect(animator.state).toBe('run');
    expect(animator.role).toBe('run');
    expect(animator.upperRole).toBe('run');
    animator.update(i, 0, 0, 0, 0);
    expect(animator.clipName).toBe('run');
  });

  it('falls back to Idle when a clip is missing, and follows the strike time', () => {
    const { root, clips } = rig();
    const animator = new PlayerAnimator(root, clips, anim);
    animator.update(input({ deathSeconds: 0.5 }), 0, 0, 0, 1 / 60);
    expect(animator.role).toBe('death');
    // Slash_2 is not in this rig: Idle plays instead of nothing.
    animator.update(input({ sinceSwing: 0, swingSeconds: 0.22, landedCombo: 2 }), 0, 0, 0, 1 / 60);
    expect(animator.state).toBe('attack');
    expect(animator.role).toBe('idle');
    animator.dispose();
  });

  it('swings on the upper body while the legs run on', () => {
    const { root, clips } = rig();
    const animator = new PlayerAnimator(root, clips, anim);
    const run = input();
    for (let f = 0; f < 60; f++) animator.update(run, 0, 4, 0, 1 / 60);
    const swing = input({ sinceSwing: 0, swingSeconds: 0.22, landedCombo: 1 });
    animator.update(swing, 0, 4, 0, 1 / 60);
    expect(animator.state).toBe('attack');
    expect(animator.role).toBe('run');
    expect(animator.upperRole).toBe('slash1');
    expect(animator.debugLine()).toContain('Run + Slash_1 (upper)');
  });

  it('leans into a turn and settles straight again', () => {
    const { root, clips, spine } = rig();
    const animator = new PlayerAnimator(root, clips, anim);
    const i = input();
    // Running along +z, then pushed along +x (at heading 0 that is the model's own +x): the
    // spine tips sideways, and straightens once the velocity is steady again.
    for (let f = 0; f < 60; f++) animator.update(i, 0, 4, 0, 1 / 60);
    const straight = spine.quaternion.clone();
    for (let f = 0; f < 10; f++) animator.update(i, 4, 4, 0, 1 / 60);
    expect(spine.quaternion.angleTo(straight)).toBeGreaterThan(0.5 * (Math.PI / 180));
    expect(animator.debugLine()).toMatch(/lean -?\d+\.\d° side/);
    for (let f = 0; f < 120; f++) animator.update(i, 4, 4, 0, 1 / 60);
    expect(spine.quaternion.angleTo(straight)).toBeLessThan(0.1 * (Math.PI / 180));
  });

  it('plays a preview clip on its own and follows the game again after it', () => {
    const { root, clips } = rig();
    const animator = new PlayerAnimator(root, clips, anim);
    animator.preview = 'castGather';
    animator.update(input(), 0, 4, 0, 1 / 60);
    expect(animator.role).toBe('castGather');
    expect(animator.upperRole).toBe('castGather');
    expect(animator.debugLine()).toContain('F6 preview');
    animator.preview = null;
    for (let f = 0; f < 30; f++) animator.update(input(), 0, 4, 0, 1 / 60);
    expect(animator.role).toBe('run');
    expect(animator.roles).toContain('slash1');
  });
});
