import { Group, Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AnimationsFile } from '../data/types';
import { animationsFileSchema } from '../data/schemas';
import { readPublicJson } from '../test/loadPublic';
import { SpringBones, type CapeDef } from './SpringBones';

const animations = readPublicJson('data/animations.json') as AnimationsFile;
/** The real numbers, without the colliders (their bones are not in the test rig). */
const def: CapeDef = { ...animations.player.cape, colliders: [] };
const DEG = Math.PI / 180;
const BONE = 0.355;
/** A leg (step A.4b): a capsule from the hip to the foot, right in front of the right chain. */
const LEG_RADIUS = 0.09;
const LEG_LENGTH = 0.85;
const withLeg: CapeDef = {
  ...def,
  colliders: [{ bone: 'LegTop', to: 'LegBottom', radius: LEG_RADIUS }],
};

/** The cape as player.glb has it, simplified: three chains of three bones hanging straight down. */
interface Rig {
  world: Group;
  anchor: Object3D;
  bones: SpringBones;
  /** The leg's hip joint: turning it about x swings the leg back (+) or forward (-). */
  leg: Object3D;
  legEnd: Object3D;
}

function makeRig(options: { lean?: number; def?: CapeDef } = {}): Rig {
  const cape = options.def ?? def;
  const world = new Group();
  const root = new Group();
  const anchor = new Object3D();
  anchor.name = 'Spine2';
  world.add(root);
  root.add(anchor);
  // The leg hangs from the anchor (in the real rig from Hips): at the right chain's x, 0.3 m
  // lower, straight down.
  const leg = new Object3D();
  leg.name = 'LegTop';
  leg.position.set(0.15, -0.3, 0);
  const legEnd = new Object3D();
  legEnd.name = 'LegBottom';
  legEnd.position.set(0, -LEG_LENGTH, 0);
  leg.add(legEnd);
  anchor.add(leg);
  cape.chains.forEach((names, c) => {
    let parent: Object3D = anchor;
    names.forEach((name, j) => {
      const bone = new Object3D();
      bone.name = name;
      if (j === 0) {
        // Y points down (and a little back with `lean`), like the real top bones.
        bone.position.set((c - 1) * 0.15, 0.13, -0.15);
        bone.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI + (options.lean ?? 0));
      } else {
        bone.position.set(0, BONE, 0);
      }
      parent.add(bone);
      parent = bone;
    });
  });
  world.updateMatrixWorld(true);
  const bones = SpringBones.create(root, cape);
  if (!bones) throw new Error('no cape bones');
  return { world, anchor, bones, leg, legEnd };
}

/** The anchor's pose over time: position and heading. */
type Motion = (t: number, pos: Vector3, yaw: { value: number }) => void;

/** Walks, stops, turns in an arc, stops. Every corner lies on a multiple of 1/6 s. */
const walkStopTurn: Motion = (t, pos, yaw) => {
  const distanceAt = (s: number): number => {
    if (s <= 1) return 2 * s;
    if (s <= 1.5) return 2;
    return 2 + 2 * Math.min(s - 1.5, 1);
  };
  pos.set(0, 1.3, distanceAt(t));
  yaw.value = 0;
  if (t > 2.5) {
    // An arc of 2.5 m/s at 45 degrees per second (radius 3.2 m) for one second.
    const s = Math.min(t - 2.5, 1);
    const w = 45 * DEG;
    const r = 2.5 / w;
    pos.set(r * (1 - Math.cos(w * s)), 1.3, 4 + r * Math.sin(w * s));
    yaw.value = w * s;
    if (t > 3.5) {
      const extra = Math.min(t - 3.5, 1);
      pos.x += 2.5 * Math.sin(w) * extra;
      pos.z += 2.5 * Math.cos(w) * extra;
    }
  }
};

interface Run {
  /** Tails (x y z of every bone) at each multiple of 1/6 s. */
  samples: number[][];
  substeps: number[];
  ticks: number;
}

/** Plays `motion` for `seconds` at `fps` and takes a sample every 1/6 s. */
function play(fps: number, seconds: number, motion: Motion, rig: Rig = makeRig()): Run {
  const pos = new Vector3();
  const yaw = { value: 0 };
  const tail = new Vector3();
  const place = (t: number): void => {
    motion(t, pos, yaw);
    rig.anchor.position.copy(pos);
    rig.anchor.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), yaw.value);
  };
  place(0);
  rig.bones.update(0, rig.world);
  const run: Run = { samples: [], substeps: [], ticks: 0 };
  const frames = Math.round(seconds * fps);
  const every = fps / 6;
  for (let i = 1; i <= frames; i++) {
    place(i / fps);
    rig.bones.update(1 / fps, rig.world);
    run.substeps.push(rig.bones.lastSubsteps);
    if (i % every === 0) {
      const sample: number[] = [];
      for (let c = 0; c < def.chains.length; c++) {
        for (let j = 0; j < def.places.length; j++) {
          rig.bones.tail(c, j, tail);
          sample.push(tail.x, tail.y, tail.z);
        }
      }
      run.samples.push(sample);
    }
  }
  run.ticks = rig.bones.ticks;
  return run;
}

function worstDifference(a: Run, b: Run): number {
  let worst = 0;
  expect(a.samples.length).toBe(b.samples.length);
  a.samples.forEach((sample, i) => {
    sample.forEach((value, k) => {
      worst = Math.max(worst, Math.abs(value - (b.samples[i]?.[k] ?? NaN)));
    });
  });
  return worst;
}

describe('SpringBones at different frame rates', () => {
  const straight: Motion = (t, pos, yaw) => {
    walkStopTurn(Math.min(t, 2.5), pos, yaw);
  };

  it('moves the same on a straight walk and stop at 30, 60, 120 and 144 fps (below 1e-6 m)', () => {
    const reference = play(120, 2.5, straight);
    for (const fps of [30, 60, 144]) {
      expect(worstDifference(play(fps, 2.5, straight), reference), `${fps} fps`).toBeLessThan(1e-6);
    }
    // The cape really moved: this is not a comparison of two hanging capes.
    expect(Math.abs(reference.samples[8]?.[2] ?? 0)).toBeGreaterThan(0);
    const first = reference.samples[0] ?? [];
    const moved = reference.samples.some((s) =>
      s.some((v, k) => Math.abs(v - (first[k] ?? 0)) > 0.1),
    );
    expect(moved).toBe(true);
  });

  it('moves the same through a turn at 30, 60, 120 and 144 fps (below 1 mm)', () => {
    const reference = play(120, 4.5, walkStopTurn);
    for (const fps of [30, 60, 144]) {
      expect(worstDifference(play(fps, 4.5, walkStopTurn), reference), `${fps} fps`).toBeLessThan(
        1e-3,
      );
    }
  });

  it('counts the substeps in whole steps', () => {
    for (const [fps, perFrame] of [
      [30, 4],
      [60, 2],
      [120, 1],
    ] as const) {
      const run = play(fps, 10, straight);
      expect(new Set(run.substeps), `${fps} fps`).toEqual(new Set([perFrame]));
      expect(run.ticks).toBe(10 * 120);
    }
    // 144 fps: 120 steps in 144 frames, never more than one per frame.
    const fast = play(144, 10, straight);
    expect(Math.max(...fast.substeps)).toBe(1);
    expect(fast.ticks).toBe(1200);
    // 240 fps: every other frame.
    expect(play(240, 1, straight).substeps.slice(0, 4)).toEqual([0, 1, 0, 1]);
  });

  it('runs at most maxSubsteps for a stalled frame, and goes on after it', () => {
    const rig = makeRig();
    rig.bones.update(0, rig.world);
    rig.bones.update(5, rig.world);
    expect(rig.bones.lastSubsteps).toBe(def.maxSubsteps);
    rig.bones.update(1 / 60, rig.world);
    expect(rig.bones.lastSubsteps).toBe(2);
  });
});

describe('SpringBones behaviour', () => {
  it('never leaves the maximum angle, however wildly the anchor moves', () => {
    const rig = makeRig({ lean: 0.2 });
    const pos = new Vector3();
    const axis = new Vector3(1, 2, 3).normalize();
    rig.bones.update(0, rig.world);
    let widest = 0;
    for (let i = 1; i <= 1500; i++) {
      const t = i / 60;
      // Jerks of tens of m/sÂ², a spin, a tumble.
      pos.set(Math.sin(t * 9) * 3, 1.3 + Math.sin(t * 13), Math.cos(t * 7) * 4);
      rig.anchor.position.copy(pos);
      rig.anchor.quaternion.setFromAxisAngle(axis, t * 6);
      rig.bones.update(1 / 60, rig.world);
      for (let c = 0; c < def.chains.length; c++) {
        for (let j = 0; j < def.places.length; j++) {
          const limit = (def.places[j]?.maxAngleDeg ?? 0) * DEG;
          const angle = rig.bones.stepAngle(c, j);
          expect(angle).toBeLessThanOrEqual(limit + 1e-9);
          widest = Math.max(widest, angle / limit);
        }
      }
    }
    // The test is only worth something if the limit was actually reached.
    expect(widest).toBeGreaterThan(0.99);
  });

  it('hangs straight down in rest and comes to a stop', () => {
    const rig = makeRig();
    rig.anchor.position.set(1, 1.3, 2);
    rig.bones.update(0, rig.world);
    const tail = new Vector3();
    for (let i = 0; i < 300; i++) rig.bones.update(1 / 60, rig.world);
    const before: Vector3[] = [];
    for (let c = 0; c < 3; c++) {
      for (let j = 0; j < 3; j++) {
        rig.bones.tail(c, j, tail);
        before.push(tail.clone());
        // Straight below its place on the anchor, a bone length per bone.
        const attachX = 1 + (c - 1) * 0.15;
        expect(tail.x).toBeCloseTo(attachX, 6);
        expect(tail.z).toBeCloseTo(2 - 0.15, 6);
        expect(tail.y).toBeCloseTo(1.3 + 0.13 - (j + 1) * BONE, 6);
      }
    }
    // A moment later nothing has moved.
    for (let i = 0; i < 30; i++) rig.bones.update(1 / 60, rig.world);
    let k = 0;
    for (let c = 0; c < 3; c++) {
      for (let j = 0; j < 3; j++) {
        expect(rig.bones.tail(c, j, tail).distanceTo(before[k++] as Vector3)).toBeLessThan(1e-9);
      }
    }
  });

  it('settles a cape that leans back into a stable pose, with the bones turned to match', () => {
    const rig = makeRig({ lean: 0.15 });
    rig.bones.update(0, rig.world);
    for (let i = 0; i < 600; i++) rig.bones.update(1 / 60, rig.world);
    const a = new Vector3();
    const b = new Vector3();
    rig.bones.tail(1, 2, a);
    for (let i = 0; i < 60; i++) rig.bones.update(1 / 60, rig.world);
    expect(rig.bones.tail(1, 2, b).distanceTo(a)).toBeLessThan(1e-6);
    // Still inside the cone and not shaking.
    expect(rig.bones.maxAngle).toBeLessThan(40 * DEG);
  });

  it('draws the bones to their tails: the world direction of a bone follows its tail', () => {
    const rig = makeRig();
    rig.bones.update(0, rig.world);
    rig.anchor.position.set(0, 1.3, 0);
    for (let i = 1; i <= 120; i++) {
      rig.anchor.position.z = i * 0.05;
      rig.bones.update(1 / 60, rig.world);
    }
    rig.world.updateMatrixWorld(true);
    const middle = rig.world.getObjectByName('Cape_M1') as Object3D;
    const next = rig.world.getObjectByName('Cape_M2') as Object3D;
    const head = middle.getWorldPosition(new Vector3());
    const tail = next.getWorldPosition(new Vector3());
    const drawn = tail.clone().sub(head).normalize();
    const tails = new Vector3();
    rig.bones.tail(1, 0, tails);
    // The bone's tail is where the simulation has it (up to the one step the cape lags by).
    const towards = tails.clone().sub(head).normalize();
    expect(drawn.angleTo(towards)).toBeLessThan(5 * DEG);
    // Running forward (+z) the cape trails behind: it hangs back (-z) and does not stand up.
    expect(drawn.z).toBeLessThan(0);
    expect(drawn.y).toBeLessThan(0);
  });

  it('does nothing while the game waits', () => {
    const rig = makeRig();
    rig.bones.update(0, rig.world);
    for (let i = 1; i <= 90; i++) {
      rig.anchor.position.set(0, 1.3, i * 0.04);
      rig.bones.update(1 / 60, rig.world);
    }
    const tail = new Vector3();
    const quat = new Quaternion();
    const bone = rig.world.getObjectByName('Cape_L2') as Object3D;
    rig.bones.tail(0, 1, tail);
    const ticks = rig.bones.ticks;
    const before = tail.clone();
    quat.copy(bone.quaternion);
    for (let i = 0; i < 20; i++) rig.bones.update(0, rig.world);
    expect(rig.bones.tail(0, 1, tail).distanceTo(before)).toBe(0);
    expect(rig.bones.ticks).toBe(ticks);
    expect(rig.bones.lastSubsteps).toBe(0);
    // angleTo is only good to ~1e-8 rad for equal quaternions (acos near 1).
    expect(bone.quaternion.angleTo(quat)).toBeLessThan(1e-6);
  });

  it('starts over hanging still after a reset, and hangs as modelled when switched off', () => {
    const rig = makeRig();
    rig.bones.update(0, rig.world);
    for (let i = 1; i <= 60; i++) {
      rig.anchor.position.set(0, 1.3, i * 0.08);
      rig.bones.update(1 / 60, rig.world);
    }
    const bone = rig.world.getObjectByName('Cape_R2') as Object3D;
    const rest = new Quaternion(); // identity: the child bones have no turn of their own
    expect(bone.quaternion.angleTo(rest)).toBeGreaterThan(0.01);
    rig.bones.reset();
    rig.bones.update(1 / 60, rig.world);
    expect(bone.quaternion.angleTo(rest)).toBeLessThan(1e-6);
    expect(rig.bones.maxAngle).toBeLessThan(1e-6);
    rig.bones.enabled = false;
    rig.bones.update(1 / 60, rig.world);
    expect(bone.quaternion.angleTo(rest)).toBeLessThan(1e-12);
    expect(rig.bones.debugLine()).toBe('off');
  });

  it('does not whip when the world root shifts (floating origin)', () => {
    // The same walk twice; the second time the world root jumps about all the time while the
    // anchor stays at the same place inside it. The cape is simulated inside the root.
    const still = makeRig();
    const shifting = makeRig();
    still.bones.update(0, still.world);
    shifting.bones.update(0, shifting.world);
    const a = new Vector3();
    const b = new Vector3();
    let worst = 0;
    for (let i = 1; i <= 240; i++) {
      for (const rig of [still, shifting]) rig.anchor.position.set(0, 1.3, i * 0.05);
      if (i % 40 === 0) shifting.world.position.set(-4000 * (i / 40), 0, 2500 - i * 33);
      still.bones.update(1 / 60, still.world);
      shifting.bones.update(1 / 60, shifting.world);
      for (let c = 0; c < 3; c++) {
        still.bones.tail(c, 2, a);
        shifting.bones.tail(c, 2, b);
        worst = Math.max(worst, a.distanceTo(b));
      }
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('does not allocate: no garbage collection while it runs', async () => {
    const rig = makeRig();
    rig.bones.update(0, rig.world);
    const run = (frames: number): void => {
      for (let i = 1; i <= frames; i++) {
        rig.anchor.position.set(Math.sin(i / 30), 1.3, i * 0.05);
        rig.anchor.quaternion.setFromAxisAngle(rig.anchor.up, Math.sin(i / 20));
        rig.bones.update(1 / 60, rig.world);
      }
    };
    run(2000);
    await new Promise((resolve) => setImmediate(resolve));
    let collections = 0;
    const observer = new PerformanceObserver((list) => {
      collections += list.getEntries().length;
    });
    observer.observe({ entryTypes: ['gc'] });
    run(200_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    observer.disconnect();
    // 200,000 frames of 9 bones: a single small object per bone per frame would be some 100 MB
    // of garbage, dozens of scavenges.
    // The JIT may box a number now and then (3 scavenges measured with gravity 60); a real
    // allocation per frame gives dozens.
    expect(collections).toBeLessThanOrEqual(5);
  });
});

/** The distance from `p` to the segment a-b. */
function toSegment(p: Vector3, a: Vector3, b: Vector3): number {
  const ab = b.clone().sub(a);
  const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / ab.lengthSq()));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

/** The leg swings back and forth like in a run, the body stands still. */
const legSwing = (rig: Rig, t: number): void => {
  rig.anchor.position.set(0, 1.3, 0);
  rig.leg.rotation.x = 0.3 + 0.6 * Math.sin(2 * Math.PI * 1.2 * t);
};

describe('SpringBones collision (step A.4b)', () => {
  /**
   * The closest any bone (anywhere from its head to its tail: the cloth runs straight between
   * them) gets to the leg's core over 4 s at 120 fps (one step per frame).
   */
  function closestToLeg(cape: CapeDef): number {
    const rig = makeRig({ def: cape });
    legSwing(rig, 0);
    rig.bones.update(0, rig.world);
    const head = new Vector3();
    const tail = new Vector3();
    const point = new Vector3();
    const top = new Vector3();
    const bottom = new Vector3();
    let closest = Infinity;
    for (let i = 1; i <= 480; i++) {
      legSwing(rig, i / 120);
      rig.bones.update(1 / 120, rig.world);
      rig.leg.getWorldPosition(top);
      rig.legEnd.getWorldPosition(bottom);
      for (let c = 0; c < 3; c++) {
        // The top bone hangs from the anchor; the leg never comes up there.
        rig.bones.stepTail(c, 0, head);
        for (let j = 1; j < 3; j++) {
          rig.bones.stepTail(c, j, tail);
          for (let s = 0; s <= 20; s++) {
            point.lerpVectors(head, tail, s / 20);
            closest = Math.min(closest, toSegment(point, top, bottom));
          }
          head.copy(tail);
        }
      }
    }
    return closest;
  }

  it('keeps every bone out of a leg that swings back through the cape', () => {
    // Without the collider the leg goes right through the cape...
    expect(closestToLeg(def)).toBeLessThan(LEG_RADIUS / 2);
    // ...with it no part of the cape goes into the leg (2 mm for the rounds onto the length).
    expect(closestToLeg(withLeg)).toBeGreaterThan(LEG_RADIUS - 2e-3);
  });

  it('pushes the same at 30, 60, 120 and 144 fps (within 2.5 mm at 30, 1 mm above)', () => {
    const run = (fps: number): number[] => {
      const rig = makeRig({ def: withLeg });
      legSwing(rig, 0);
      rig.bones.update(0, rig.world);
      const tail = new Vector3();
      const out: number[] = [];
      for (let i = 1; i <= fps * 3; i++) {
        legSwing(rig, i / fps);
        rig.bones.update(1 / fps, rig.world);
        if (i % (fps / 6) === 0) {
          for (let j = 0; j < 3; j++) out.push(...rig.bones.tail(2, j, tail).toArray());
        }
      }
      return out;
    };
    const reference = run(120);
    // Between two frames a collider moves in a straight line, the swinging leg in an arc: the
    // difference grows with the frame time (measured 1.8 mm at 30 fps, 0.6 at 60, 0.07 at 144).
    for (const [fps, limit] of [
      [30, 2.5e-3],
      [60, 1e-3],
      [144, 1e-3],
    ] as const) {
      const other = run(fps);
      const worst = Math.max(...other.map((v, k) => Math.abs(v - (reference[k] ?? NaN))));
      expect(worst, `${fps} fps`).toBeLessThan(limit);
    }
  });

  it('draws its colliders where the bones are, and skips one whose bone is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const missing: CapeDef = {
      ...withLeg,
      colliders: [...withLeg.colliders, { bone: 'NoSuchBone', radius: 0.1 }],
    };
    const rig = makeRig({ def: missing });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
    expect(rig.bones.colliderCount).toBe(1);
    rig.leg.rotation.x = 0.5;
    rig.bones.update(0, rig.world);
    const a = new Vector3();
    const b = new Vector3();
    expect(rig.bones.collider(0, a, b)).toBe(LEG_RADIUS);
    expect(a.distanceTo(rig.leg.getWorldPosition(new Vector3()))).toBeLessThan(1e-9);
    expect(b.distanceTo(rig.legEnd.getWorldPosition(new Vector3()))).toBeLessThan(1e-9);
  });

  it('moves a capsule as a whole by its offset', () => {
    const shifted: CapeDef = {
      ...def,
      colliders: [{ bone: 'LegTop', to: 'LegBottom', offset: [0, 0, -0.05], radius: 0.1 }],
    };
    const rig = makeRig({ def: shifted });
    rig.bones.update(0, rig.world);
    const a = new Vector3();
    const b = new Vector3();
    rig.bones.collider(0, a, b);
    expect(a.z).toBeCloseTo(-0.05, 9);
    expect(b.z).toBeCloseTo(-0.05, 9);
    expect(a.y - b.y).toBeCloseTo(LEG_LENGTH, 9);
  });

  it('does not allocate with colliders either', async () => {
    const rig = makeRig({ def: withLeg });
    rig.bones.update(0, rig.world);
    const run = (frames: number): void => {
      for (let i = 1; i <= frames; i++) {
        legSwing(rig, i / 60);
        rig.bones.update(1 / 60, rig.world);
      }
    };
    run(2000);
    await new Promise((resolve) => setImmediate(resolve));
    let collections = 0;
    const observer = new PerformanceObserver((list) => {
      collections += list.getEntries().length;
    });
    observer.observe({ entryTypes: ['gc'] });
    run(200_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    observer.disconnect();
    expect(collections).toBeLessThanOrEqual(5);
  });
});

describe('SpringBones after a teleport (step A.4b)', () => {
  it('starts over hanging still when the anchor jumps further than resetDistance', () => {
    const rig = makeRig();
    rig.bones.update(0, rig.world);
    for (let i = 1; i <= 60; i++) {
      rig.anchor.position.set(0, 1.3, i * 0.08);
      rig.bones.update(1 / 60, rig.world);
    }
    expect(rig.bones.maxAngle).toBeGreaterThan(5 * DEG);
    // 100 m away in one frame.
    rig.anchor.position.set(100, 1.3, 50);
    rig.bones.update(1 / 60, rig.world);
    expect(rig.bones.jumpResets).toBe(1);
    const tail = new Vector3();
    for (let c = 0; c < 3; c++) {
      for (let j = 0; j < 3; j++) {
        rig.bones.tail(c, j, tail);
        // Straight below its place on the anchor: no swing, no streak back to where it was.
        expect(tail.x).toBeCloseTo(100 + (c - 1) * 0.15, 4);
        expect(tail.z).toBeCloseTo(50 - 0.15, 4);
        expect(tail.y).toBeCloseTo(1.3 + 0.13 - (j + 1) * BONE, 4);
      }
    }
    expect(rig.bones.maxAngle).toBeLessThan(0.01 * DEG);
  });

  it('swings after a fast move below resetDistance (a dash at 20 fps is no teleport)', () => {
    const rig = makeRig();
    rig.bones.update(0, rig.world);
    // A dash: 4 m in 0.18 s (player.json), drawn at 20 fps = 1.1 m per frame.
    for (let i = 1; i <= 4; i++) {
      rig.anchor.position.set(0, 1.3, i * 1.1);
      rig.bones.update(1 / 20, rig.world);
    }
    expect(def.resetDistance).toBeGreaterThan(1.1);
    expect(rig.bones.jumpResets).toBe(0);
    expect(rig.bones.maxAngle).toBeGreaterThan(5 * DEG);
  });
});

describe('player.cape in animations.json', () => {
  it('passes the schema and has numbers for every place of every chain', () => {
    const parsed = animationsFileSchema.safeParse(animations);
    expect(parsed.success).toBe(true);
    for (const chain of def.chains) expect(chain).toHaveLength(def.places.length);
    expect(def.chains.flat()).toEqual([
      'Cape_L1',
      'Cape_L2',
      'Cape_L3',
      'Cape_M1',
      'Cape_M2',
      'Cape_M3',
      'Cape_R1',
      'Cape_R2',
      'Cape_R3',
    ]);
  });

  it('rejects a misspelled field, a missing number and a chain-less cape', () => {
    const broken = structuredClone(animations) as unknown as {
      player: { cape: { places: Record<string, unknown>[]; chains: unknown[] } };
    };
    broken.player.cape.places[0] = { stiffnes: 1, damping: 1, gravity: 1, maxAngleDeg: 1 };
    expect(animationsFileSchema.safeParse(broken).success).toBe(false);
    const empty = structuredClone(animations) as unknown as typeof broken;
    empty.player.cape.chains = [];
    expect(animationsFileSchema.safeParse(empty).success).toBe(false);
  });

  it('finds no cape bones in a rig without them (the placeholder)', () => {
    expect(SpringBones.create(new Group(), def)).toBeNull();
  });
});
