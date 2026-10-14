import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AnimationClip,
  Bone,
  BufferAttribute,
  BufferGeometry,
  Group,
  MeshStandardMaterial,
  NumberKeyframeTrack,
  Skeleton,
  SkinnedMesh,
} from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import type { NpcsFile } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import {
  type AnimatedDef,
  AnimatedRig,
  chooseGait,
  type GaitClip,
  gaitTimeScale,
  nextPet,
} from './AnimatedNpcs';

const npcs = readPublicJson('data/npcs.json') as NpcsFile;
const pringle = npcs.npcs.find((npc) => npc.id === 'pringle');
const role = npcs.roles.find((entry) => entry.id === pringle?.role);
const def = role?.animated as AnimatedDef;

/** The parts of a .glb's JSON that the tests read (clips and their key times). */
interface GlbJson {
  animations?: { name?: string; samplers: { input: number }[] }[];
  accessors: { max?: number[] }[];
}

/** The JSON part of a .glb (clip names, nodes), read from disk. */
function readGlbJson(path: string): GlbJson {
  const bytes = readFileSync(resolve(import.meta.dirname, '../../public', path));
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + length).toString('utf8')) as GlbJson;
}

/** How long a clip in the .glb lasts (s): the last key time of its first sampler. */
function clipSeconds(glb: GlbJson, name: string): number {
  const clip = glb.animations?.find((a) => a.name === name);
  const input = clip?.samplers[0]?.input;
  return input === undefined ? Number.NaN : (glb.accessors[input]?.max?.[0] ?? Number.NaN);
}

/** Feeds speeds one after another (like frames) and returns the clip after each. */
function run(speeds: number[], start: GaitClip = 'idle'): GaitClip[] {
  let clip = start;
  return speeds.map((speed) => (clip = chooseGait(clip, speed, def)));
}

describe('Pringle has a real animated model', () => {
  it('is set up in npcs.json', () => {
    expect(def).toBeDefined();
    expect(def.file).toBe('characters/pringle/pringle.glb');
  });

  it('the .glb holds every clip npcs.json names, pets included', () => {
    const names = (readGlbJson(def.file).animations ?? []).map((clip) => clip.name);
    for (const clip of Object.values(def.clips)) expect(names).toContain(clip);
    expect(def.pets?.length).toBe(3);
    for (const clip of def.pets ?? []) expect(names).toContain(clip);
  });

  it('stays put long enough for every pet clip to play out', () => {
    const glb = readGlbJson(def.file);
    for (const clip of def.pets ?? []) {
      const seconds = clipSeconds(glb, clip);
      expect(seconds).toBeGreaterThan(1);
      expect(seconds).toBeLessThanOrEqual(npcs.settings.petHoldSeconds + 1e-6);
    }
  });

  it('strolls with the walk clip and keeps up with the run clip, feet at a natural pace', () => {
    const follow = pringle?.follow;
    expect(follow).toBeDefined();
    if (!follow) return;
    expect(chooseGait('idle', follow.strollSpeed, def)).toBe('walk');
    expect(chooseGait('walk', follow.speed, def)).toBe('run');
    // Within the limits, not clamped: the feet do not slide while strolling or trotting along.
    for (const [clip, speed] of [
      ['walk', follow.strollSpeed],
      ['run', follow.speed],
    ] as const) {
      const scale = gaitTimeScale(clip, speed, def);
      expect(scale).toBeGreaterThan(0.6);
      expect(scale).toBeLessThan(1.6);
      expect(scale).toBeCloseTo(speed / (clip === 'walk' ? def.walkSpeed : def.runSpeed), 6);
    }
  });
});

/** A stand-in for a loaded .glb: one skinned triangle on one bone, with every clip of `def`. */
function fakeModel(): GLTF {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(12), 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array(12).fill(1), 4));
  const bone = new Bone();
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial());
  mesh.add(bone);
  mesh.bind(new Skeleton([bone]));
  const scene = new Group();
  scene.add(mesh);
  const names = [...Object.values(def.clips), ...(def.pets ?? [])];
  const animations = names.map(
    (name) => new AnimationClip(name, 1, [new NumberKeyframeTrack('.visible', [0, 1], [1, 1])]),
  );
  return { scene, animations } as unknown as GLTF;
}

describe('AnimatedRig', () => {
  it('frees the bone texture of its own skeleton when disposed', () => {
    const gltf = fakeModel();
    const rig = new AnimatedRig(gltf, def, (source) => source, 'test');
    const skinned: SkinnedMesh[] = [];
    rig.root.traverse((object) => {
      if (object instanceof SkinnedMesh) skinned.push(object);
    });
    expect(skinned.length).toBe(1);
    const skeleton = (skinned[0] as SkinnedMesh).skeleton;
    // Every copy has a skeleton of its own: the cached file's skeleton is left alone.
    const original = (gltf.scene.children[0] as SkinnedMesh).skeleton;
    expect(skeleton).not.toBe(original);
    // The renderer makes this texture on the first frame; here we make it ourselves.
    skeleton.computeBoneTexture();
    expect(skeleton.boneTexture).not.toBeNull();
    rig.dispose();
    expect(skeleton.boneTexture).toBeNull();
  });
});

describe('chooseGait', () => {
  it('picks idle, walk or run by speed', () => {
    expect(chooseGait('idle', 0, def)).toBe('idle');
    expect(chooseGait('idle', 1, def)).toBe('walk');
    expect(chooseGait('idle', 5, def)).toBe('run');
    expect(chooseGait('run', 0, def)).toBe('idle');
  });

  it('does not flicker at the walk / run edge', () => {
    const edge = def.runAbove;
    // Hovering just around the edge keeps the clip it has.
    expect(run([edge * 0.98, edge * 1.02, edge * 0.99, edge * 1.05], 'walk')).toEqual([
      'walk',
      'walk',
      'walk',
      'walk',
    ]);
    expect(run([edge * 1.02, edge * 0.98, edge * 0.9], 'run')).toEqual(['run', 'run', 'run']);
    // Clearly past it: switches.
    expect(run([edge * 1.3], 'walk')).toEqual(['run']);
    expect(run([edge * 0.7], 'run')).toEqual(['walk']);
  });

  it('does not flicker between idle and walk while barely moving', () => {
    const edge = def.idleBelow;
    expect(run([edge * 1.2, edge * 1.4, edge * 1.1], 'idle')).toEqual(['idle', 'idle', 'idle']);
    expect(run([edge * 1.2, edge * 1.05], 'walk')).toEqual(['walk', 'walk']);
    expect(run([edge * 0.5], 'walk')).toEqual(['idle']);
  });
});

describe('nextPet', () => {
  it('plays every pet clip in turn', () => {
    let i = -1;
    const seen = [];
    for (let k = 0; k < 6; k++) seen.push((i = nextPet(3, i)));
    expect(seen).toEqual([0, 1, 2, 0, 1, 2]);
    expect(nextPet(0, -1)).toBe(-1);
  });
});

describe('gaitTimeScale', () => {
  it('plays the clip at its own speed at the reference speed', () => {
    expect(gaitTimeScale('walk', def.walkSpeed, def)).toBe(1);
    expect(gaitTimeScale('run', def.runSpeed, def)).toBe(1);
    expect(gaitTimeScale('idle', 3, def)).toBe(1);
  });

  it('stays within limits far from the reference speed', () => {
    expect(gaitTimeScale('walk', 0.01, def)).toBe(0.6);
    expect(gaitTimeScale('run', 50, def)).toBe(1.6);
  });
});
