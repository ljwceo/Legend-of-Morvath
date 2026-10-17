import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Bone, Group, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FixedStep, SIM_DT, SIM_HZ } from '../core/Time';
import type { AnimationsFile, CapeDef, ZonesFile } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import {
  type CapeDrive,
  type CapeMotion,
  SpringBones,
  capeDrive,
  capeStepDrive,
} from './SpringBones';

const cape = (readPublicJson('data/animations.json') as AnimationsFile).cape;

/** A model with one chain of three bones hanging 0.3 m apart from `Spine2`, looking along +z. */
function rig(def: CapeDef = cape): { root: Group; bones: Bone[] } {
  const root = new Group();
  const spine = new Bone();
  spine.name = 'Spine2';
  spine.position.set(0, 1.4, 0);
  root.add(spine);
  const bones: Bone[] = [];
  let parent: Bone = spine;
  for (const name of def.chains[0] ?? []) {
    const bone = new Bone();
    bone.name = name;
    bone.position.set(0, bones.length === 0 ? 0 : -0.3, 0);
    parent.add(bone);
    bones.push(bone);
    parent = bone;
  }
  return { root, bones };
}

const oneChain: CapeDef = { ...cape, chains: [cape.chains[0] ?? []] };

describe('capeDrive', () => {
  const out: CapeDrive = { x: 0, z: 0 };

  it('blows the cape back behind a runner and swings it against a push', () => {
    // Heading 0: the model looks along +z. Running forward: the cape streams out behind.
    capeDrive(0, 0, 0, 4, 0, cape, out);
    expect(out.z).toBeCloseTo(-cape.drag * 4, 10);
    expect(out.x).toBeCloseTo(0, 10);
    // Speeding up forward: the tip lags behind the body.
    capeDrive(0, 10, 0, 0, 0, cape, out);
    expect(out.z).toBeCloseTo(-cape.inertia * 10, 10);
  });

  it('follows the heading: running along world +x with heading pi/2 is running forward', () => {
    capeDrive(0, 0, 4, 0, Math.PI / 2, cape, out);
    expect(out.z).toBeCloseTo(-cape.drag * 4, 10);
    expect(out.x).toBeCloseTo(0, 10);
  });
});

describe('capeStepDrive', () => {
  it('takes the acceleration from the previous step and ignores a teleport', () => {
    const motion: CapeMotion = { vx: 0, vz: 0 };
    const out: CapeDrive = { x: 0, z: 0 };
    capeStepDrive(motion, 0, 4, 0, SIM_DT, cape, out);
    expect(out.z).toBeCloseTo(-(cape.inertia * (4 / SIM_DT) + cape.drag * 4), 8);
    expect(motion.vz).toBe(4);
    // Steady: only the drag is left.
    capeStepDrive(motion, 0, 4, 0, SIM_DT, cape, out);
    expect(out.z).toBeCloseTo(-cape.drag * 4, 8);
    // A teleport (3000 m in one step) pushes nothing and is not remembered as a velocity.
    capeStepDrive(motion, 0, 3000 * SIM_HZ, 0, SIM_DT, cape, out);
    expect(out).toEqual({ x: 0, z: 0 });
    expect(motion.vz).toBe(4);
  });
});

describe('SpringBones', () => {
  const still: CapeDrive = { x: 0, z: 0 };

  it('hangs still without a push, and stops at a maximum angle', () => {
    const { root, bones } = rig(oneChain);
    const springs = new SpringBones(root, oneChain);
    expect(springs.jointCount).toBe(3);
    for (let i = 0; i < 120; i++) springs.step(SIM_DT, still);
    springs.apply(1);
    for (const bone of bones)
      expect(bone.quaternion.angleTo(new Group().quaternion)).toBeCloseTo(0, 6);
    const max = (cape.maxAngleDeg * Math.PI) / 180;
    const hard: CapeDrive = { x: 0, z: -1e4 };
    for (let i = 0; i < 120; i++) springs.step(SIM_DT, hard);
    for (let j = 0; j < 3; j++) {
      expect(Math.hypot(springs.tilt(j, 0), springs.tilt(j, 1))).toBeLessThanOrEqual(max + 1e-9);
    }
  });

  it('swings the tip of a hanging chain behind a runner (towards -z), not forward', () => {
    const { root, bones } = rig(oneChain);
    const springs = new SpringBones(root, oneChain);
    const push: CapeDrive = { x: 0, z: -cape.drag * 4 };
    for (let i = 0; i < 180; i++) springs.step(SIM_DT, push);
    springs.apply(1);
    root.updateMatrixWorld(true);
    const top = new Vector3().setFromMatrixPosition((bones[0] as Bone).matrixWorld);
    const tip = new Vector3().setFromMatrixPosition((bones[2] as Bone).matrixWorld);
    expect(tip.z - top.z).toBeLessThan(-0.05);
    expect(Math.abs(tip.x - top.x)).toBeLessThan(1e-6);
    expect(tip.y).toBeLessThan(top.y);
  });

  it('a stiffer cape swings less (cheat factor)', () => {
    const swing = (scale: number): number => {
      const { root } = rig(oneChain);
      const springs = new SpringBones(root, oneChain);
      springs.stiffnessScale = scale;
      const push: CapeDrive = { x: 0, z: -12 };
      for (let i = 0; i < 180; i++) springs.step(SIM_DT, push);
      return Math.abs(springs.tilt(2, 1));
    };
    expect(swing(4)).toBeLessThan(swing(1));
    expect(swing(1)).toBeLessThan(swing(0.25));
  });

  it('blends the previous and the current step with alpha', () => {
    const { root, bones } = rig(oneChain);
    const springs = new SpringBones(root, oneChain);
    springs.step(SIM_DT, { x: 0, z: -30 });
    const angle = (alpha: number): number => {
      springs.apply(alpha);
      return (bones[0] as Bone).quaternion.angleTo(new Group().quaternion);
    };
    expect(angle(0)).toBeCloseTo(0, 8);
    const full = angle(1);
    expect(full).toBeGreaterThan(1e-4);
    expect(angle(0.5)).toBeCloseTo(full / 2, 6);
    expect(angle(0.25)).toBeCloseTo(full / 4, 6);
    springs.reset();
    expect(angle(1)).toBeCloseTo(0, 8);
  });

  it('ignores chains whose bones the model lacks', () => {
    const springs = new SpringBones(new Group(), cape);
    expect(springs.jointCount).toBe(0);
    springs.step(SIM_DT, still);
    springs.apply(0.5);
  });
});

/**
 * The real chain: a FixedStep fed by frames of different lengths and a start that does not fall
 * on a step, a player who runs, stops and turns (the input depends on the step number only),
 * and the cape stepped from the sim step like WorldState does.
 */
describe('the cape at any frame rate', () => {
  function simulate(fps: number, offsetSeconds: number, steps: number): number[][] {
    const { root } = rig(oneChain);
    const springs = new SpringBones(root, oneChain);
    const motion: CapeMotion = { vx: 0, vz: 0 };
    const push: CapeDrive = { x: 0, z: 0 };
    const time = new FixedStep();
    const history: number[][] = [];
    let step = 0;
    const update = (): void => {
      step++;
      // Run forward, turn a quarter while running, stop, run sideways.
      const heading = Math.min(Math.PI / 2, Math.max(0, (step - 60) * 0.02));
      const speed = step < 200 ? 4 : step < 260 ? 0 : 5.3;
      capeStepDrive(
        motion,
        Math.sin(heading) * speed,
        Math.cos(heading) * speed,
        heading,
        SIM_DT,
        cape,
        push,
      );
      springs.step(SIM_DT, push);
      history.push([0, 1, 2].flatMap((j) => [springs.tilt(j, 0), springs.tilt(j, 1)]));
    };
    time.advance(offsetSeconds);
    while (step < steps) {
      const n = time.advance(1 / fps);
      for (let i = 0; i < n; i++) update();
      springs.apply(time.alpha);
    }
    return history.slice(0, steps);
  }

  it('is identical at 60, 120 and 144 fps and from any starting moment', () => {
    const steps = 400;
    const base = simulate(60, 0, steps);
    for (const [fps, offset] of [
      [120, 0],
      [144, 0.0037],
      [60, 0.0123],
      [90, 0.2],
    ] as const) {
      const other = simulate(fps, offset, steps);
      expect(other.length).toBe(base.length);
      for (let i = 0; i < steps; i++) expect(other[i], `${fps} fps, step ${i}`).toEqual(base[i]);
    }
    // And it actually moved.
    expect(Math.max(...base.flat().map(Math.abs))).toBeGreaterThan(0.05);
  });
});

describe('cape bones in player.glb', () => {
  it('every chain in animations.json exists in the model, top to bottom', () => {
    const zones = readPublicJson('data/zones.json') as ZonesFile;
    const path = zones.zones.find((zone) => zone.scene)?.scene?.player;
    if (!path) throw new Error('no zone with a player.glb');
    const bytes = readFileSync(resolve(import.meta.dirname, '../../public', path));
    const length = bytes.readUInt32LE(12);
    const glb = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8')) as {
      nodes: { name?: string; children?: number[] }[];
    };
    const index = (name: string): number => glb.nodes.findIndex((node) => node.name === name);
    for (const chain of cape.chains) {
      let parent = index('Spine2');
      expect(parent).toBeGreaterThanOrEqual(0);
      for (const name of chain) {
        const i = index(name);
        expect(i, name).toBeGreaterThanOrEqual(0);
        expect(glb.nodes[parent]?.children ?? [], name).toContain(i);
        parent = i;
      }
    }
    for (const name of Object.keys(cape.bones)) expect(index(name), name).toBeGreaterThanOrEqual(0);
  });
});
