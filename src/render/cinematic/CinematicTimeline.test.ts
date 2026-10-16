import { describe, expect, it } from 'vitest';
import { GameLoop } from '../../core/GameLoop';
import { validateGameData } from '../../data/DataValidator';
import { flattenStrings } from '../../i18n/I18n';
import { readAllData, readPublicJson } from '../../test/loadPublic';
import {
  barHeight,
  type CinematicSample,
  type CinematicSettings,
  type CinematicShot,
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
 * The real intro on the fight's set: the film before the fight and the one after it. Before the
 * opening the scene has the player on their spot and the lords on theirs, unseen (the
 * `actorStart` hook: a shot shows them); after the fight everyone is seen where the fight left
 * them. The floor is the ground; the real `cinematic` settings are used.
 */
describe('the intro cinematics on the fight set', () => {
  const fight = realData?.cutscenes.fights.find((f) => f.id === 'intro_fight');
  const realSettings = realData?.cutscenes.cinematic ?? settings;
  const textKeys = new Set(flattenStrings(readPublicJson('lang/en.json')).keys());
  const DEG = Math.PI / 180;

  function introTimeline(id: 'intro' | 'intro_landing'): {
    def: CutsceneDef;
    t: CinematicTimeline;
    actor: (id: string) => number;
    shot: (id: string) => number;
  } {
    const def = realCutscene(id);
    if (!fight) throw new Error('no intro fight');
    const actors = def.actors ?? [];
    const initial = actors.map((actor) => {
      const pose = newPose();
      const foe = fight.foes.find((f) => f.id === actor.id);
      if (foe) {
        pose.visible = id === 'intro_landing';
        pose.x = foe.x;
        pose.z = foe.z;
        pose.heading = Math.atan2(fight.player.x - foe.x, fight.player.z - foe.z);
      } else if (actor.model === 'player') {
        pose.visible = true;
        pose.x = fight.player.x;
        pose.z = fight.player.z;
      }
      return pose;
    });
    const t = new CinematicTimeline(def, realSettings, initial, flat);
    const shots = def.shots ?? [];
    return {
      def,
      t,
      actor: (actorId) => actors.findIndex((a) => a.id === actorId),
      shot: (shotId) => t.shotStart(shots.findIndex((s) => s.id === shotId)),
    };
  }

  function texts(def: CutsceneDef): string[] {
    return (def.shots ?? [])
      .flatMap((shot) => [shot.narration, shot.subtitle?.text])
      .filter((key): key is string => key !== undefined);
  }

  it('plays on the intro fight, the landing after it, with the lords as fight actors', () => {
    const intro = realCutscene('intro');
    const landing = realCutscene('intro_landing');
    expect(intro.type).toBe('cinematic');
    expect(intro.fight).toBe('intro_fight');
    expect(intro.afterFight).toBe('intro_landing');
    expect(landing.fight).toBe('intro_fight');
    for (const def of [intro, landing]) {
      const models = new Map((def.actors ?? []).map((a) => [a.id, a.model]));
      expect(models.get('player')).toBe('player');
      expect(models.get('lucael')).toBe('fight');
      expect(models.get('baelor')).toBe('fight');
      expect(def.shots?.[0]?.camera).toBeDefined();
      // Every line and every piece of story text exists (the Dutch file is checked by I18n).
      for (const key of texts(def)) expect(textKeys.has(key), key).toBe(true);
    }
    expect(landing.actors?.find((a) => a.id === 'sultan')?.model).toBe('placeholder:cat');
    expect(landing.actors?.find((a) => a.id === 'bat')?.model).toBe('prop:bat');
  });

  it('tells the opening in thirteen shots: corridor, room, skitter, time, boom, unamused', () => {
    const { def, t } = introTimeline('intro');
    expect(def.shots?.map((shot) => shot.id)).toEqual([
      'corridor',
      'legend',
      'door',
      'room',
      'greeting',
      'reply',
      'skitter',
      'inspect',
      'time',
      'gather',
      'boom',
      'smoke',
      'unamused',
    ]);
    // The old lore narration over the corridor, the concept's lines where they belong.
    expect(texts(def)).toEqual([
      'intro.panel_1',
      'intro.panel_2',
      'intro.panel_3',
      'intro.fight.arrive',
      'intro.cine.greeting',
      'intro.cine.reply',
      'intro.cine.skitter',
      'intro.lucael',
      'intro.fight.freeze',
      'intro.cine.unamused',
    ]);
    expect(t.total).toBeGreaterThanOrEqual(55);
    expect(t.total).toBeLessThanOrEqual(80);
    // Nobody but the player says "it" is here before the room: no cat, no name card.
    expect(def.shots?.some((shot) => shot.nameCard)).toBe(false);
  });

  it('reveals the lords in the room and leaves them on their spots for the fight', () => {
    const { def, t, actor, shot } = introTimeline('intro');
    if (!fight) throw new Error('no intro fight');
    const count = def.actors?.length ?? 0;
    const s = newSample(count);
    const player = actor('player');
    const lucael = actor('lucael');
    const baelor = actor('baelor');
    // In the corridor the player walks towards the door (+z) and the lords are unseen.
    t.sample(shot('corridor') + 3, s);
    expect(s.actors[player]?.visible).toBe(true);
    expect(s.actors[player]?.z).toBeLessThan(-40);
    expect(s.actors[player]?.heading).toBeCloseTo(0);
    expect(s.actors[lucael]?.visible).toBe(false);
    expect(s.actors[baelor]?.visible).toBe(false);
    expect(s.fade).toBe(0);
    // The room: both lords stand on their fight spots, facing the player, from the first frame.
    t.sample(shot('room') + 0.1, s);
    for (const [index, foe] of [
      [lucael, fight.foes[0]],
      [baelor, fight.foes[1]],
    ] as const) {
      const p = s.actors[index];
      expect(p?.visible).toBe(true);
      expect(p?.x).toBeCloseTo(foe?.x ?? 0);
      expect(p?.z).toBeCloseTo(foe?.z ?? 0);
      expect(p?.y).toBe(0);
      const me = s.actors[player];
      expect(p?.heading).toBeCloseTo(
        Math.atan2((me?.x ?? 0) - (p?.x ?? 0), (me?.z ?? 0) - (p?.z ?? 0)),
      );
    }
    expect(s.flash).toBeGreaterThan(0.9);
    // The skitter: Lucael stands on each of his six points in turn, the player turning after
    // him, and ends right in front of the player.
    const skitter = def.shots?.find((entry) => entry.id === 'skitter');
    const hops = skitter?.actors?.find((m) => m.actor === 'lucael')?.hops ?? [];
    expect(hops).toHaveLength(6);
    const part = (skitter?.seconds ?? 0) / hops.length;
    hops.forEach((hop, k) => {
      t.sample(shot('skitter') + (k + 0.5) * part, s);
      expect(s.actors[lucael]).toMatchObject({ x: hop.x, z: hop.z, visible: true });
      const me = s.actors[player];
      expect(me?.heading).toBeCloseTo(Math.atan2(hop.x - (me?.x ?? 0), hop.z - (me?.z ?? 0)));
      expect(Math.hypot(hop.x, hop.z)).toBeLessThan(fight.set.radius);
    });
    expect(hops.at(-1)).toEqual({ x: 0, z: -4.4 });
    // Baelor keeps his own time: he is at the end of his glide after the shot's own seconds,
    // while the slowed camera still has most of the shot to travel.
    const time = def.shots?.find((entry) => entry.id === 'time');
    const glide = time?.actors?.find((m) => m.actor === 'baelor');
    expect(time?.speed).toBeLessThan(1);
    expect(glide?.ownTime).toBe(true);
    const wall = shotWallSeconds(time as CinematicShot);
    expect(wall).toBeCloseTo((time?.seconds ?? 0) / (time?.speed ?? 1));
    t.sample(shot('time') + (time?.seconds ?? 0), s);
    expect(s.actors[baelor]?.x).toBeCloseTo(glide?.to?.x ?? 0);
    expect(s.actors[baelor]?.z).toBeCloseTo(glide?.to?.z ?? 0);
    const midwayCamera = s.camX;
    t.sample(shot('time') + wall - 1e-6, s);
    expect(s.camX).not.toBeCloseTo(midwayCamera, 3);
    expect(s.slow).toBe(true);
    // The boom hides the lords; the smoke clears on them standing where they were.
    t.sample(shot('boom') + 0.5, s);
    expect(s.actors[lucael]?.visible).toBe(false);
    expect(s.actors[baelor]?.visible).toBe(false);
    expect(s.actors[actor('smoke')]?.visible).toBe(true);
    t.sample(shot('smoke') + 3.9, s);
    expect(s.actors[actor('smoke')]?.opacity).toBeLessThan(0.05);
    // The end: everyone exactly where the fight picks them up.
    t.sample(t.total, s);
    expect(s.actors[lucael]).toMatchObject({
      visible: true,
      x: fight.foes[0]?.x,
      z: fight.foes[0]?.z,
      scale: 1,
    });
    expect(s.actors[baelor]).toMatchObject({
      visible: true,
      x: fight.foes[1]?.x,
      z: fight.foes[1]?.z,
      scale: 1,
    });
    expect(s.actors[player]).toMatchObject({
      visible: true,
      x: fight.player.x,
      z: fight.player.z,
      lift: 0,
      scale: 1,
      pose: 'rest',
    });
    expect(s.actors[actor('smoke')]?.visible).toBe(false);
    expect(s.actors[actor('spark')]?.visible).toBe(false);
    expect(s.fade).toBe(0);
  });

  it('tells the landing in fourteen shots and ends black over the last narration', () => {
    const { def, t } = introTimeline('intro_landing');
    expect(def.shots?.map((shot) => shot.id)).toEqual([
      'enough',
      'shrink',
      'palm',
      'grab',
      'bat',
      'whack',
      'sky',
      'fall',
      'badlands',
      'sniff',
      'lick1',
      'lick2',
      'lick3',
      'black',
    ]);
    expect(texts(def)).toEqual([
      'intro.cine.enough',
      'intro.cine.palm',
      'intro.cine.grab',
      'intro.cine.bat',
      'intro.panel_5',
      'intro.panel_6',
    ]);
    expect(t.total).toBeGreaterThanOrEqual(30);
    expect(t.total).toBeLessThanOrEqual(45);
    // The cat is never named: no name card, no subtitle after the badlands.
    expect(def.shots?.some((shot) => shot.nameCard)).toBe(false);
    const badlands = def.shots?.findIndex((shot) => shot.id === 'badlands') ?? -1;
    expect(def.shots?.slice(badlands).some((shot) => shot.subtitle)).toBe(false);
    expect(def.shots?.at(-1)?.silence).toBe(true);
  });

  it('shrinks the player into a hand, bats it into the badlands, where the cat licks it', () => {
    const { def, t, actor, shot } = introTimeline('intro_landing');
    if (!fight) throw new Error('no intro fight');
    const count = def.actors?.length ?? 0;
    const s = newSample(count);
    const player = actor('player');
    const lucael = actor('lucael');
    const bat = actor('bat');
    const sultan = actor('sultan');
    // Everyone is seen from the first frame (the fight left them so).
    t.sample(0.1, s);
    expect(s.actors[lucael]?.visible).toBe(true);
    expect(s.actors[actor('baelor')]?.visible).toBe(true);
    expect(s.actors[sultan]?.visible).toBe(false);
    // Shrunk to a twelfth, floating at the height of Lucael's raised hand, close in front of him.
    t.sample(shot('palm'), s);
    const tiny = s.actors[player];
    const lord = s.actors[lucael];
    expect(tiny?.scale).toBeCloseTo(0.08);
    expect(tiny?.lift).toBeGreaterThan(2.3);
    expect(tiny?.lift).toBeLessThan(2.8);
    const reach = Math.hypot((tiny?.x ?? 0) - (lord?.x ?? 0), (tiny?.z ?? 0) - (lord?.z ?? 0));
    expect(reach).toBeGreaterThan(0.5);
    expect(reach).toBeLessThan(1.5);
    // The bat swings in slow motion from over Lucael's shoulder round to the far side, its
    // tip passing through the floating player on the way.
    const swing = def.shots?.find((entry) => entry.id === 'bat');
    const move = swing?.actors?.find((m) => m.actor === 'bat');
    expect(swing?.speed).toBeLessThan(1);
    t.sample(shot('bat'), s);
    expect(s.actors[bat]?.visible).toBe(true);
    expect(s.actors[bat]?.heading).toBeCloseTo((move?.headingFrom ?? 0) * DEG);
    const pivot = s.actors[bat];
    const held = s.actors[player];
    const towards = Math.atan2((held?.x ?? 0) - (pivot?.x ?? 0), (held?.z ?? 0) - (pivot?.z ?? 0));
    expect(
      Math.hypot((held?.x ?? 0) - (pivot?.x ?? 0), (held?.z ?? 0) - (pivot?.z ?? 0)),
    ).toBeLessThan(0.95);
    expect(Math.abs((held?.lift ?? 0) - (pivot?.lift ?? 0))).toBeLessThan(0.15);
    const from = (move?.headingFrom ?? 0) * DEG;
    const to = (move?.headingTo ?? 0) * DEG;
    expect(Math.min(from, to)).toBeLessThan(towards);
    expect(Math.max(from, to)).toBeGreaterThan(towards);
    t.sample(shot('whack') - 1e-6, s);
    expect(s.actors[bat]?.heading).toBeCloseTo(to, 3);
    // The whack: forty metres up and far away, out of the room.
    t.sample(shot('sky'), s);
    expect(s.actors[player]?.z).toBeCloseTo(190);
    expect(s.actors[player]?.lift).toBeCloseTo(40);
    t.sample(shot('badlands') - 1e-6, s);
    expect(s.fade).toBeCloseTo(1, 2);
    // The badlands: full size again, lying on their back on the patch; the cat walks up and
    // stands by their head, then dips three times.
    t.sample(shot('badlands') + 0.1, s);
    expect(s.actors[player]).toMatchObject({ x: 0, z: 200, scale: 1 });
    expect(s.actors[player]?.roll).toBeCloseTo(-90 * DEG);
    expect(s.actors[player]?.lift).toBeCloseTo(0.25);
    expect(s.actors[sultan]?.visible).toBe(true);
    expect(s.fade).toBeGreaterThan(0.8);
    t.sample(shot('sniff'), s);
    const cat = s.actors[sultan];
    const body = s.actors[player];
    const h = body?.heading ?? 0;
    const head = { x: (body?.x ?? 0) - Math.sin(h) * 1.75, z: (body?.z ?? 0) - Math.cos(h) * 1.75 };
    expect(Math.hypot((cat?.x ?? 0) - head.x, (cat?.z ?? 0) - head.z)).toBeLessThan(1);
    expect(cat?.heading).toBeCloseTo(
      Math.atan2((body?.x ?? 0) - (cat?.x ?? 0), (body?.z ?? 0) - (cat?.z ?? 0)),
    );
    for (const lick of ['lick1', 'lick2', 'lick3']) {
      t.sample(shot(lick), s);
      expect(s.actors[sultan]?.lift).toBeCloseTo(0.12);
      t.sample(shot(lick) + 0.5 - 1e-6, s);
      expect(s.actors[sultan]?.lift).toBeCloseTo(0, 3);
    }
    // Black at the end, and nothing from the room in the picture.
    t.sample(t.total, s);
    expect(s.fade).toBeCloseTo(1);
    expect(s.actors[bat]?.visible).toBe(false);
    expect(s.actors[actor('spark')]?.visible).toBe(false);
  });

  for (const id of ['intro', 'intro_landing'] as const) {
    it(`${id} plays exactly the same on 60 and 120 fps, hops and own time included`, () => {
      const run = (fps: number): number[][] => {
        const { def, t, actor } = introTimeline(id);
        const count = def.actors?.length ?? 0;
        const watched = ['player', 'lucael', 'baelor', 'spark', 'bat', 'sultan']
          .map((a) => actor(a))
          .filter((i) => i >= 0);
        const s: CinematicSample = newSample(count);
        const frames: number[][] = [];
        const loop = new GameLoop({
          update: (dt) => t.step(dt),
          render: (alpha) => {
            t.sample(t.renderTime(alpha), s);
            const frame = [
              s.camX,
              s.camY,
              s.camZ,
              s.lookX,
              s.lookY,
              s.lookZ,
              s.fade,
              s.flash,
              s.fov,
            ];
            for (const i of watched) {
              const a = s.actors[i];
              frame.push(
                a?.x ?? 0,
                a?.z ?? 0,
                a?.lift ?? 0,
                a?.heading ?? 0,
                a?.scale ?? 0,
                a?.roll ?? 0,
                a?.opacity ?? 0,
                a?.visible ? 1 : 0,
              );
            }
            frames.push(frame);
          },
        });
        const frameMs = 1000 / fps;
        const total = Math.ceil(t.total) + 1;
        for (let i = 0; i <= fps * total; i++) loop.tick(i * frameMs);
        return frames;
      };
      const at60 = run(60);
      const at120 = run(120);
      expect(at60.length).toBeGreaterThan(60 * 30);
      for (let i = 0; i < at60.length; i++) {
        const a = at60[i] as number[];
        const b = at120[i * 2] as number[];
        for (let k = 0; k < a.length; k++) {
          const want = a[k] as number;
          if (Number.isNaN(want)) expect(b[k]).toBeNaN();
          else expect(b[k]).toBeCloseTo(want, 6);
        }
      }
    });
  }
});

describe('the pose handed over when a film ends', () => {
  /** One shot: the player walks in, 0 → 12 m, straight through to the film's last moment. */
  const walkIn: CutsceneDef = {
    id: 'walk',
    type: 'cinematic',
    skippable: true,
    fight: 'intro_fight',
    actors: [{ id: 'player', model: 'player' }],
    shots: [
      {
        id: 'in',
        seconds: 3,
        camera: { from: { x: 0, y: 2, z: -5 }, lookFrom: { x: 0, y: 1, z: 0 } },
        actors: [{ actor: 'player', from: { x: 0, z: 0 }, to: { x: 12, z: 0 } }],
      },
    ],
  };

  it("is the film's last moment on 60 and 120 Hz alike, not the frame drawn last", () => {
    const run = (fps: number): { drawn: number; end: number } => {
      const start = newPose();
      start.visible = true;
      const t = new CinematicTimeline(walkIn, settings, [start], flat);
      const drawn = newSample(1);
      const end = newSample(1);
      let handed = Number.NaN;
      const loop = new GameLoop({
        update: (dt) => {
          if (t.finished) return;
          t.step(dt);
          // CinematicCutscene.end runs here, inside the step that reaches the end, before that
          // step is ever drawn: the models still hold the frame drawn last.
          if (t.finished) {
            handed = drawn.actors[0]?.x ?? Number.NaN;
            t.sample(t.total, end);
          }
        },
        render: (alpha) => {
          if (!t.finished) t.sample(t.renderTime(alpha), drawn);
        },
      });
      const frameMs = 1000 / fps;
      for (let i = 0; i <= fps * 4; i++) loop.tick(i * frameMs);
      return { drawn: handed, end: end.actors[0]?.x ?? Number.NaN };
    };
    const at60 = run(60);
    const at120 = run(120);
    // The frame drawn last is short of the end, and by a different amount per frame rate...
    expect(at60.drawn).toBeLessThan(12 - 1e-3);
    expect(at120.drawn).toBeLessThan(12 - 1e-3);
    expect(Math.abs(at60.drawn - at120.drawn)).toBeGreaterThan(1e-3);
    // ...so the cutscene settles everyone at `total` first: the same pose on every screen.
    expect(at60.end).toBeCloseTo(12, 9);
    expect(at120.end).toBeCloseTo(12, 9);
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
