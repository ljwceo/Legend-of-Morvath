import { Group, Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { AnimationsFile } from '../data/types';
import { animationsFileSchema } from '../data/schemas';
import { readPublicJson } from '../test/loadPublic';
import { SpringBones, type CapeDef } from './SpringBones';

const animations = readPublicJson('data/animations.json') as AnimationsFile;
const def: CapeDef = animations.player.cape;
const DEG = Math.PI / 180;
const BONE = 0.355;

/** The cape as player.glb has it, simplified: three chains of three bones hanging straight down. */
interface Rig {
  world: Group;
  anchor: Object3D;
  bones: SpringBones;
}

function makeRig(options: { lean?: number; def?: CapeDef } = {}): Rig {
  const cape = options.def ?? def;
  const world = new Group();
  const root = new Group();
  const anchor = new Object3D();
  anchor.name = 'Spine2';
  world.add(root);
  root.add(anchor);
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
  return { world, anchor, bones };
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
      // Jerks of tens of m/s², a spin, a tumble.
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
    expect(bone.quaternion.angleTo(quat)).toBeLessThan(1e-12);
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
    expect(collections).toBeLessThanOrEqual(2);
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
