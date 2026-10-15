import { describe, expect, it } from 'vitest';
import { GameLoop } from '../../core/GameLoop';
import { validateGameData } from '../../data/DataValidator';
import { readAllData } from '../../test/loadPublic';
import {
  barHeight,
  type CinematicSample,
  type CinematicSettings,
  CinematicTimeline,
  type CutsceneDef,
  ease,
  HOP_BLINK,
  HoldToSkip,
  newPose,
  newSample,
  resolveCutscene,
  shotWallSeconds,
  shouldPlayCutscene,
} from './CinematicTimeline';

const DT = 1 / 60;
const flat = (): number => 0;

const settings: CinematicSettings = {
  barsSeconds: 0.5,
  barsAspect: 2.39,
  barsMinFraction: 0.07,
  barsMaxFraction: 0.13,
  holdToSkipSeconds: 1,
  holdReleaseFactor: 2,
};

/** A small test cinematic: a cat walks, a man jumps, the camera follows. */
const scene: CutsceneDef = {
  id: 'test',
  type: 'cinematic',
  skippable: true,
  playOnce: true,
  anchor: { x: 0, z: 0 },
  actors: [
    { id: 'hero', model: 'player' },
    { id: 'cat', model: 'placeholder:cat' },
  ],
  shots: [
    {
      id: 'walk',
      seconds: 2,
      camera: {
        from: { x: 0, y: 2, z: -10 },
        to: { x: 0, y: 4, z: -6 },
        lookFrom: { x: 0, y: 1, z: 0 },
      },
      actors: [{ actor: 'cat', visible: true, from: { x: 0, z: 0 }, to: { x: 10, z: 0 } }],
      fade: { from: 1, to: 0, seconds: 1 },
    },
    {
      id: 'close',
      seconds: 1.5,
      camera: { from: { x: 0, y: 1, z: 2 }, follow: 'cat', relative: true, followHeight: 0.5 },
      actors: [{ actor: 'hero', lookAt: 'cat' }],
      flash: 0.5,
      shake: 0.2,
    },
    { id: 'hold', seconds: 0.5 },
  ],
};

function timeline(def: CutsceneDef = scene): CinematicTimeline {
  const hero = newPose();
  hero.visible = true;
  hero.x = -5;
  return new CinematicTimeline(def, settings, [hero, newPose()], flat);
}

const realData = validateGameData(readAllData()).data;

function realCutscene(id: string): CutsceneDef {
  const found = realData?.cutscenes.cutscenes.find((c) => c.id === id);
  if (!found) throw new Error(`no cutscene ${id}`);
  return found;
}

function realPringle(): CutsceneDef {
  return realCutscene('pringle');
}

/** Sultan's ending (sword or mage) with the shared part after it, as it plays. */
function realEnding(id: 'sultan_end_sword' | 'sultan_end_staff'): CutsceneDef {
  return resolveCutscene(realCutscene(id), realData?.cutscenes.cutscenes ?? []);
}

/** A cat leaps in slow motion, the picture freezes; a plank rolls, a spark fades. */
const slowScene: CutsceneDef = {
  id: 'slow',
  type: 'cinematic',
  skippable: true,
  anchor: { x: 0, z: 0 },
  actors: [
    { id: 'hero', model: 'player' },
    { id: 'plank', model: 'prop:plank' },
  ],
  shots: [
    {
      id: 'leap',
      seconds: 1,
      speed: 0.25,
      freeze: 1,
      silence: true,
      camera: { from: { x: 0, y: 2, z: -10 }, lookFrom: { x: 0, y: 1, z: 0 } },
      actors: [
        { actor: 'plank', visible: true, from: { x: 0, z: 0 }, to: { x: 4, z: 0 } },
        { actor: 'hero', pose: 'fast' },
      ],
    },
    {
      id: 'roll',
      seconds: 2,
      actors: [
        { actor: 'plank', rollFrom: 0, rollTo: 360, opacityFrom: 1, opacityTo: 0, wobble: 30 },
      ],
    },
  ],
};

describe('CinematicTimeline', () => {
  it('plays the shots one after the other', () => {
    const t = timeline();
    expect(t.total).toBe(4);
    expect(t.shotStart(0)).toBe(0);
    expect(t.shotStart(1)).toBe(2);
    expect(t.shotStart(2)).toBe(3.5);
    expect(t.shotIndexAt(0)).toBe(0);
    expect(t.shotIndexAt(1.999)).toBe(0);
    expect(t.shotIndexAt(2)).toBe(1);
    expect(t.shotIndexAt(3.6)).toBe(2);
    expect(t.shotIndexAt(99)).toBe(2);
  });

  it('ends after exactly its length in fixed steps', () => {
    const t = timeline();
    let steps = 0;
    while (!t.finished) {
      t.step(DT);
      steps++;
    }
    expect(steps).toBe(240);
    expect(t.time).toBeCloseTo(t.total, 9);
  });

  it('moves camera and actors with the shot, and keeps them for the next shot', () => {
    const t = timeline();
    const s = newSample(2);
    t.sample(1, s);
    expect(s.actors[1]?.visible).toBe(true);
    expect(s.actors[1]?.x).toBeCloseTo(5);
    expect(s.actors[1]?.heading).toBeCloseTo(Math.PI / 2); // walking to +x
    expect(s.camY).toBeCloseTo(3);
    expect(s.camZ).toBeCloseTo(-8);
    expect(s.fade).toBeCloseTo(0);
    t.sample(0.5, s);
    expect(s.fade).toBeCloseTo(0.5);
    // Next shot: the cat stays where it stopped, the hero turns to it.
    t.sample(2.5, s);
    expect(s.actors[1]?.x).toBeCloseTo(10);
    expect(s.actors[1]?.visible).toBe(true);
    expect(s.actors[0]?.heading).toBeCloseTo(Math.PI / 2);
    // A shot without a camera keeps the last one.
    const last = newSample(2);
    t.sample(3.49, s);
    t.sample(3.8, last);
    expect(last.lookX).toBeCloseTo(s.lookX);
  });

  it('places a relative camera around the actor it follows', () => {
    const t = timeline();
    const s = newSample(2);
    t.sample(3.4, s);
    const cat = s.actors[1];
    // The cat faces +x; 2 m in front of it and 1 m up (shake off by then is tiny).
    expect(s.camX - s.shakeX).toBeCloseTo((cat?.x ?? 0) + 2);
    expect(s.camZ - s.shakeZ).toBeCloseTo(cat?.z ?? 0);
    expect(s.camY - s.shakeY).toBeCloseTo(1);
    expect(s.lookY).toBeCloseTo(0.5);
  });

  it('flashes at the start of a shot and calms the shake down', () => {
    const t = timeline();
    const s = newSample(2);
    t.sample(2, s);
    expect(s.flash).toBeCloseTo(1);
    t.sample(2.25, s);
    expect(s.flash).toBeCloseTo(0.5);
    t.sample(2.6, s);
    expect(s.flash).toBe(0);
    t.sample(3.4999, s);
    expect(Math.abs(s.shakeX)).toBeLessThan(0.001);
  });

  it('slides the bars in at the start and out at the end', () => {
    const t = timeline();
    const s = newSample(2);
    t.sample(0, s);
    expect(s.bars).toBe(0);
    t.sample(2, s);
    expect(s.bars).toBe(1);
    t.sample(4, s);
    expect(s.bars).toBe(0);
  });

  it('plays exactly the same on 60 and 120 fps', () => {
    const run = (fps: number): number[][] => {
      const t = timeline(realPringle());
      const s: CinematicSample = newSample(4);
      const frames: number[][] = [];
      const loop = new GameLoop({
        update: (dt) => t.step(dt),
        render: (alpha) => {
          t.sample(t.renderTime(alpha), s);
          const a = s.actors;
          frames.push([s.camX, s.camY, s.camZ, s.lookX, a[3]?.x ?? 0, a[3]?.lift ?? 0, s.flash]);
        },
      });
      const frameMs = 1000 / fps;
      for (let i = 0; i <= fps * 18; i++) loop.tick(i * frameMs);
      return frames;
    };
    const at60 = run(60);
    const at120 = run(120);
    // Every 60 fps frame is shown at the same moment as every other 120 fps frame.
    for (let i = 0; i < at60.length; i++) {
      const a = at60[i] as number[];
      const b = at120[i * 2] as number[];
      for (let k = 0; k < a.length; k++) expect(b[k]).toBeCloseTo(a[k] as number, 6);
    }
  });
});

describe('slow motion, freeze-frames and props', () => {
  it('stretches a slow shot and holds the freeze on top of it', () => {
    const t = timeline(slowScene);
    const leap = slowScene.shots?.[0];
    if (!leap) throw new Error('no shot');
    expect(shotWallSeconds(leap)).toBe(5);
    expect(t.total).toBe(7);
    expect(t.shotStart(1)).toBe(5);
  });

  it('moves at a quarter speed, then stands still and loses its color', () => {
    const t = timeline(slowScene);
    const s = newSample(2);
    t.sample(2, s);
    expect(s.actors[1]?.x).toBeCloseTo(2);
    expect(s.slow).toBe(true);
    expect(s.silent).toBe(true);
    expect(s.still).toBe(0);
    expect(s.actors[0]?.pose).toBe('fast');
    expect(s.actors[0]?.poseT).toBeCloseTo(0.5);
    t.sample(4.5, s);
    expect(s.actors[1]?.x).toBeCloseTo(4);
    expect(s.still).toBe(1);
    t.sample(5.5, s);
    expect(s.slow).toBe(false);
    expect(s.silent).toBe(false);
    expect(s.still).toBe(0);
  });

  it('rolls and fades a prop, and a head shake ends facing straight', () => {
    const t = timeline(slowScene);
    const s = newSample(2);
    t.sample(6, s);
    expect(s.actors[1]?.roll).toBeCloseTo(Math.PI);
    expect(s.actors[1]?.opacity).toBeCloseTo(0.5);
    t.sample(7, s);
    expect(s.actors[1]?.roll).toBeCloseTo(2 * Math.PI);
    expect(s.actors[1]?.opacity).toBeCloseTo(0);
    // Walking to +x left it facing +x; the shake calms down to exactly that.
    expect(s.actors[1]?.heading).toBeCloseTo(Math.PI / 2);
  });

  it('chains cutscenes into one timeline, sharing actors by id', () => {
    const first: CutsceneDef = { ...slowScene, id: 'a', then: 'b' };
    const second: CutsceneDef = {
      ...scene,
      id: 'b',
      then: 'a',
      actors: [
        { id: 'hero', model: 'player' },
        { id: 'cat', model: 'placeholder:cat' },
      ],
    };
    const joined = resolveCutscene(first, [first, second]);
    expect(joined.actors?.map((a) => a.id)).toEqual(['hero', 'plank', 'cat']);
    // a, then b; the loop back to a stops there.
    expect(joined.shots?.length).toBe(5);
    expect(joined.then).toBeUndefined();
    // The plank is not in b: it leaves when b starts; the hero (in both) stays.
    const firstOfB = joined.shots?.[2]?.actors ?? [];
    expect(firstOfB).toContainEqual({ actor: 'plank', visible: false });
    expect(firstOfB.some((m) => m.actor === 'hero' && m.visible === false)).toBe(false);
    expect(resolveCutscene(scene, [scene])).toBe(scene);
  });
});

describe("Sultan's ending", () => {
  it('starts with the killing blow, then goes on with the shared part', () => {
    for (const id of ['sultan_end_sword', 'sultan_end_staff'] as const) {
      const ending = realEnding(id);
      const ids = ending.shots?.map((shot) => shot.id) ?? [];
      expect(ids.slice(-4)).toEqual(['cats', 'egg', 'leave', 'turn']);
      expect(ids).toContain('silence');
      expect(ending.shots?.some((shot) => shot.freeze)).toBe(true);
      expect(ending.shots?.some((shot) => (shot.speed ?? 1) < 1)).toBe(true);
    }
  });

  it('says the lines in order, ending with the egg', () => {
    const keys = realEnding('sultan_end_sword')
      .shots?.map((shot) => shot.subtitle?.text)
      .filter(Boolean);
    expect(keys).toEqual([
      'cutscene.pringle.1',
      'cutscene.sultanEnd.claws',
      'cutscene.sultanEnd.watch',
      'cutscene.sultanEnd.ask',
      'cutscene.sultanEnd.cats',
      'cutscene.sultanEnd.egg',
    ]);
  });

  it('leaves Sultan standing on his own spot by the gate, facing west', () => {
    const ending = realEnding('sultan_end_staff');
    const npc = realData?.npcs.npcs.find((n) => n.id === 'sultan');
    const actors = ending.actors ?? [];
    const t = new CinematicTimeline(
      ending,
      settings,
      actors.map(() => newPose()),
      flat,
    );
    const s = newSample(actors.length);
    t.sample(t.total, s);
    const sultan = s.actors[actors.findIndex((a) => a.id === 'sultan')];
    expect(sultan?.visible).toBe(true);
    expect(sultan?.x).toBeCloseTo(npc?.position.x ?? 0);
    expect(sultan?.z).toBeCloseTo(npc?.position.z ?? 0);
    expect(sultan?.heading).toBeCloseTo((npc?.heading ?? 0) * (Math.PI / 180));
  });

  it('plays exactly the same on 60 and 120 fps, slow motion and freeze included', () => {
    const ending = realEnding('sultan_end_sword');
    const count = ending.actors?.length ?? 0;
    const run = (fps: number): number[][] => {
      const t = new CinematicTimeline(
        ending,
        settings,
        Array.from({ length: count }, () => newPose()),
        flat,
      );
      const s: CinematicSample = newSample(count);
      const frames: number[][] = [];
      const loop = new GameLoop({
        update: (dt) => t.step(dt),
        render: (alpha) => {
          t.sample(t.renderTime(alpha), s);
          const a = s.actors;
          frames.push([s.camX, s.camZ, s.lookX, s.still, a[1]?.x ?? 0, a[1]?.lift ?? 0]);
        },
      });
      const frameMs = 1000 / fps;
      for (let i = 0; i <= fps * 12; i++) loop.tick(i * frameMs);
      return frames;
    };
    const at60 = run(60);
    const at120 = run(120);
    for (let i = 0; i < at60.length; i++) {
      const a = at60[i] as number[];
      const b = at120[i * 2] as number[];
      for (let k = 0; k < a.length; k++) expect(b[k]).toBeCloseTo(a[k] as number, 6);
    }
  });
});

describe('the Pringle cinematic', () => {
  it('follows the five beats, then the name card', () => {
    const pringle = realPringle();
    const ids = pringle.shots?.map((shot) => shot.id);
    expect(ids).toEqual(['gate', 'eyes', 'smoke', 'sultan', 'leap', 'name']);
    const keys = pringle.shots?.map((shot) => shot.subtitle?.text).filter(Boolean);
    expect(keys).toEqual([
      'cutscene.pringle.1',
      'cutscene.pringle.2',
      'cutscene.pringle.4',
      'cutscene.pringle.5',
    ]);
    expect(pringle.shots?.at(-1)?.nameCard?.name).toBe('Sultan');
    expect(pringle.playOnce).toBe(true);
  });

  it('swaps Pringle for Sultan behind the smoke', () => {
    const pringle = realPringle();
    const t = timeline(pringle);
    const s = newSample(4);
    t.sample(t.shotStart(1) + 0.1, s);
    expect(s.actors[1]?.visible).toBe(true);
    expect(s.actors[3]?.visible).toBe(false);
    t.sample(t.shotStart(3) + 0.1, s);
    expect(s.actors[1]?.visible).toBe(false);
    expect(s.actors[3]?.visible).toBe(true);
  });
});

/**
 * On a fight's set: Lucael skitters through four points, Baelor keeps his own time in a slow
 * shot while the player crawls, and a bat swings around.
 */
const hopScene: CutsceneDef = {
  id: 'hops',
  type: 'cinematic',
  skippable: true,
  fight: 'intro_fight',
  actors: [
    { id: 'player', model: 'player' },
    { id: 'lucael', model: 'fight' },
    { id: 'baelor', model: 'fight' },
    { id: 'bat', model: 'prop:bat' },
  ],
  shots: [
    {
      id: 'skitter',
      seconds: 4,
      camera: { from: { x: 0, y: 3, z: -8 }, to: { x: 2, y: 3, z: -8 }, follow: 'lucael' },
      actors: [
        {
          actor: 'lucael',
          visible: true,
          hops: [
            { x: -4, z: 4 },
            { x: 4, z: 4 },
            { x: 4, z: -4 },
            { x: 0, z: -3 },
          ],
          lookAt: 'player',
        },
        { actor: 'player', lookAt: 'lucael' },
      ],
    },
    {
      id: 'time',
      seconds: 1,
      speed: 0.25,
      actors: [
        {
          actor: 'baelor',
          visible: true,
          from: { x: 2, z: 6 },
          to: { x: 2, z: -6 },
          ownTime: true,
        },
        { actor: 'player', from: { x: 0, z: -6 }, to: { x: 0, z: -2 } },
      ],
    },
    {
      id: 'bat',
      seconds: 2,
      actors: [
        {
          actor: 'bat',
          visible: true,
          from: { x: 1, z: 0 },
          headingFrom: -90,
          headingTo: 90,
          lookAt: 'player',
        },
      ],
    },
  ],
};

function hopTimeline(): CinematicTimeline {
  const player = newPose();
  player.visible = true;
  player.z = -6;
  return new CinematicTimeline(hopScene, settings, [player, newPose(), newPose(), newPose()], flat);
}

describe('hops, own time and heading turns', () => {
  it('lands on every hop exactly and blinks out just before the next one', () => {
    const t = hopTimeline();
    const s = newSample(4);
    const lucael = (): { x: number; z: number; visible: boolean; heading: number } => {
      const p = s.actors[1];
      if (!p) throw new Error('no lucael');
      return p;
    };
    t.sample(0.5, s);
    expect(lucael()).toMatchObject({ x: -4, z: 4, visible: true });
    // Facing the player at (0, -6); the player faces him.
    expect(lucael().heading).toBeCloseTo(Math.atan2(4, -10));
    expect(s.actors[0]?.heading).toBeCloseTo(Math.atan2(-4, 10));
    // Gone for the last 8 % of the first second, there again at the second hop.
    t.sample(1 - HOP_BLINK / 2, s);
    expect(lucael()).toMatchObject({ x: -4, z: 4, visible: false });
    t.sample(1, s);
    expect(lucael()).toMatchObject({ x: 4, z: 4, visible: true });
    t.sample(1.5, s);
    expect(lucael()).toMatchObject({ x: 4, z: 4, visible: true });
    t.sample(2.5, s);
    expect(lucael()).toMatchObject({ x: 4, z: -4, visible: true });
    t.sample(3.5, s);
    expect(lucael()).toMatchObject({ x: 0, z: -3, visible: true });
    t.sample(3.97, s);
    expect(lucael().visible).toBe(false);
    // Never a lerp between hops: always exactly on a point.
    for (let time = 0; time < 4; time += 0.01) {
      t.sample(time, s);
      const onHop = hopScene.shots?.[0]?.actors?.[0]?.hops?.some(
        (hop) => hop.x === lucael().x && hop.z === lucael().z,
      );
      expect(onHop).toBe(true);
    }
  });

  it('starts the next shot standing on the last hop, visible', () => {
    const t = hopTimeline();
    const s = newSample(4);
    t.sample(4, s);
    expect(s.actors[1]).toMatchObject({ x: 0, z: -3, visible: true });
    t.sample(6.5, s);
    expect(s.actors[1]).toMatchObject({ x: 0, z: -3, visible: true });
  });

  it('turns from headingFrom to headingTo, over lookAt', () => {
    const t = hopTimeline();
    const s = newSample(4);
    const start = t.shotStart(2);
    t.sample(start, s);
    expect(s.actors[3]?.heading).toBeCloseTo(-Math.PI / 2);
    t.sample(start + 1, s);
    expect(s.actors[3]?.heading).toBeCloseTo(0);
    t.sample(start + 2, s);
    expect(s.actors[3]?.heading).toBeCloseTo(Math.PI / 2);
    expect(s.actors[3]).toMatchObject({ x: 1, z: 0, visible: true });
  });

  it('lets an actor with its own time move at full speed through a slow shot', () => {
    const t = hopTimeline();
    const s = newSample(4);
    const start = t.shotStart(1);
    expect(t.shotStart(2) - start).toBe(4);
    // Half a second in: Baelor is halfway, the player a sixteenth (a quarter of a quarter).
    t.sample(start + 0.5, s);
    expect(s.actors[2]?.z).toBeCloseTo(0);
    expect(s.actors[0]?.z).toBeCloseTo(-6 + 4 * 0.125);
    // After the shot's own second Baelor is there; the player has a quarter of the way behind him.
    t.sample(start + 1, s);
    expect(s.actors[2]?.z).toBeCloseTo(-6);
    expect(s.actors[0]?.z).toBeCloseTo(-5);
    t.sample(start + 4, s);
    expect(s.actors[2]?.z).toBeCloseTo(-6);
    expect(s.actors[0]?.z).toBeCloseTo(-2);
  });

  it('changes nothing with its own time when the shot runs at full speed', () => {
    // The same walk twice, once on its own time: at speed 1 the two never differ, not even
    // in the last digit (wall time and action time are the same time then).
    const walk = {
      visible: true,
      from: { x: -3, z: 2 },
      to: { x: 5, z: -4 },
      ease: 'inOut',
    } as const;
    const back = { from: { x: 5, z: -4 }, to: { x: 0, z: 0 }, liftTo: 2, scaleTo: 0.5 } as const;
    const def: CutsceneDef = {
      id: 'fullspeed',
      type: 'cinematic',
      skippable: true,
      fight: 'intro_fight',
      actors: [
        { id: 'player', model: 'player' },
        { id: 'own', model: 'fight' },
        { id: 'plain', model: 'fight' },
      ],
      shots: [
        {
          id: 'walk',
          seconds: 3,
          camera: { from: { x: 0, y: 3, z: -8 }, lookFrom: { x: 0, y: 1, z: 0 } },
          actors: [
            { actor: 'own', ...walk, ownTime: true },
            { actor: 'plain', ...walk },
          ],
        },
        {
          id: 'back',
          seconds: 2,
          speed: 1,
          // A freeze afterwards: wall time is still the action's seconds, not the whole shot.
          freeze: 0.5,
          actors: [
            { actor: 'own', ...back, ownTime: true },
            { actor: 'plain', ...back },
          ],
        },
      ],
    };
    const t = new CinematicTimeline(def, settings, [newPose(), newPose(), newPose()], flat);
    const s = newSample(3);
    for (let time = 0; time <= 5; time += 0.07) {
      t.sample(time, s);
      const own = s.actors[1];
      const plain = s.actors[2];
      if (!own || !plain) throw new Error('no actors');
      expect(own.x).toBe(plain.x);
      expect(own.z).toBe(plain.z);
      expect(own.y).toBe(plain.y);
      expect(own.scale).toBe(plain.scale);
      expect(own.heading).toBe(plain.heading);
    }
    // And the walk did happen.
    t.sample(1.5, s);
    expect(s.actors[2]?.x).toBeCloseTo(1);
    t.sample(5, s);
    expect(s.actors[2]).toMatchObject({ x: 0, z: 0, y: 2, scale: 0.5 });
  });

  it('plays exactly the same on 60 and 120 fps, hops, own time and turns included', () => {
    const run = (fps: number): number[][] => {
      const t = hopTimeline();
      const s: CinematicSample = newSample(4);
      const frames: number[][] = [];
      const loop = new GameLoop({
        update: (dt) => t.step(dt),
        render: (alpha) => {
          t.sample(t.renderTime(alpha), s);
          const a = s.actors;
          frames.push([
            s.camX,
            s.lookX,
            a[1]?.x ?? 0,
            a[1]?.visible ? 1 : 0,
            a[2]?.z ?? 0,
            a[0]?.z ?? 0,
            a[3]?.heading ?? 0,
          ]);
        },
      });
      const frameMs = 1000 / fps;
      for (let i = 0; i <= fps * 10; i++) loop.tick(i * frameMs);
      return frames;
    };
    const at60 = run(60);
    const at120 = run(120);
    for (let i = 0; i < at60.length; i++) {
      const a = at60[i] as number[];
      const b = at120[i * 2] as number[];
      for (let k = 0; k < a.length; k++) expect(b[k]).toBeCloseTo(a[k] as number, 6);
    }
  });
});

describe('HoldToSkip', () => {
  it('skips after holding one second, not before', () => {
    const skip = new HoldToSkip(1, 2);
    for (let i = 0; i < 59; i++) expect(skip.step(DT, true)).toBe(false);
    expect(skip.step(DT, true)).toBe(true);
  });

  it('takes as long on every frame rate, because it runs on the fixed step', () => {
    const skip = new HoldToSkip(1, 2);
    let steps = 0;
    while (!skip.step(DT, true)) steps++;
    expect(steps + 1).toBe(60);
  });

  it('never skips on short taps; letting go empties the ring twice as fast', () => {
    const skip = new HoldToSkip(1, 2);
    for (let tap = 0; tap < 10; tap++) {
      for (let i = 0; i < 30; i++) expect(skip.step(DT, true)).toBe(false);
      for (let i = 0; i < 15; i++) skip.step(DT, false);
      expect(skip.progress).toBeCloseTo(0, 6);
    }
  });
});

describe('cinematic helpers', () => {
  it('eases from 0 to 1 in every style', () => {
    for (const kind of ['linear', 'in', 'out', 'inOut'] as const) {
      expect(ease(kind, 0)).toBe(0);
      expect(ease(kind, 1)).toBe(1);
      expect(ease(kind, 2)).toBe(1);
    }
    expect(ease('in', 0.5)).toBeLessThan(0.5);
    expect(ease('out', 0.5)).toBeGreaterThan(0.5);
  });

  it('fits the bars to 4:3, 16:9 and 21:9 screens', () => {
    // 16:9: the cinema picture decides.
    expect(barHeight(1600, 900, 2.39, 0.07, 0.13)).toBeCloseTo((900 - 1600 / 2.39) / 2);
    // 4:3 would lose too much picture: at most 13 %.
    expect(barHeight(1024, 768, 2.39, 0.07, 0.13)).toBeCloseTo(768 * 0.13);
    // 21:9 still gets thin bars: at least 7 %.
    expect(barHeight(2520, 1080, 2.39, 0.07, 0.13)).toBeCloseTo(1080 * 0.07);
    expect(barHeight(0, 0, 2.39, 0.07, 0.13)).toBe(0);
  });

  it('plays a playOnce cutscene only the first time (a rematch skips it)', () => {
    const def = { id: 'pringle', playOnce: true };
    expect(shouldPlayCutscene(def, [])).toBe(true);
    expect(shouldPlayCutscene(def, ['pringle'])).toBe(false);
    expect(shouldPlayCutscene({ id: 'intro' }, ['intro'])).toBe(true);
  });
});
