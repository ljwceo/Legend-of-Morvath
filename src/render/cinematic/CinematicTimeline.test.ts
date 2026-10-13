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
  HoldToSkip,
  newPose,
  newSample,
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

function realPringle(): CutsceneDef {
  const { data } = validateGameData(readAllData());
  const pringle = data?.cutscenes.cutscenes.find((c) => c.id === 'pringle');
  if (!pringle) throw new Error('no pringle cutscene');
  return pringle;
}

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
