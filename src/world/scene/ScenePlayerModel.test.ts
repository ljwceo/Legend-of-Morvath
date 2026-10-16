import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AnimationClip, Color } from 'three';
import { describe, expect, it } from 'vitest';
import { PLAYER_CLIP_ROLES } from '../../data/schemas';
import type { AnimationsFile, PlayerClipRole, ZonesFile } from '../../data/types';
import { readPublicJson } from '../../test/loadPublic';
import { resolveClips, textureTint, weaponOf } from './ScenePlayerModel';

const anim = (readPublicJson('data/animations.json') as AnimationsFile).player;

/** The parts of player.glb's JSON the tests read (node tree and clip names). */
interface GlbJson {
  nodes: { name?: string; children?: number[] }[];
  animations?: { name?: string }[];
}

/** The JSON part of the player.glb that the Blender zone (Greyhaven) loads, read from disk. */
function readPlayerGlb(): GlbJson {
  const zones = readPublicJson('data/zones.json') as ZonesFile;
  const path = zones.zones.find((zone) => zone.scene)?.scene?.player;
  if (!path) throw new Error('no zone with a player.glb');
  const bytes = readFileSync(resolve(import.meta.dirname, '../../../public', path));
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + length).toString('utf8')) as GlbJson;
}

describe('player clips and weapons (animations.json)', () => {
  const glb = readPlayerGlb();

  it('every clip role finds its clip in player.glb', () => {
    const clips = (glb.animations ?? []).map((entry) => new AnimationClip(entry.name, 1, []));
    const out = new Map<PlayerClipRole, AnimationClip>();
    expect(resolveClips(anim.clips, clips, out)).toEqual([]);
    expect(out.size).toBe(PLAYER_CLIP_ROLES.length);
    expect(out.get('slash2')?.name).toBe('Slash_2');
  });

  it('reports the roles whose clip is missing and leaves them out', () => {
    const out = new Map<PlayerClipRole, AnimationClip>();
    const missing = resolveClips(anim.clips, [new AnimationClip('Idle', 1, [])], out);
    expect(missing).toHaveLength(PLAYER_CLIP_ROLES.length - 1);
    expect(missing).not.toContain('idle');
    expect([...out.keys()]).toEqual(['idle']);
  });

  it('the sword and the staff hang from the hand bone', () => {
    const hand = glb.nodes.find((node) => node.name === anim.handBone);
    const under = (hand?.children ?? []).map((i) => glb.nodes[i]?.name ?? '');
    expect(under.filter((name) => weaponOf(name, anim.weapons) === 'sword')).not.toEqual([]);
    expect(under.filter((name) => weaponOf(name, anim.weapons) === 'staff')).not.toEqual([]);
    // No weapon part anywhere else in the model.
    const parts = glb.nodes.filter((node) => weaponOf(node.name ?? '', anim.weapons) !== null);
    expect(parts.map((node) => node.name).sort()).toEqual(
      under.filter((name) => weaponOf(name, anim.weapons) !== null).sort(),
    );
  });

  it('weaponOf picks the weapon by the start of the name', () => {
    expect(weaponOf('Sword_Blade', anim.weapons)).toBe('sword');
    expect(weaponOf('Staff_Crystal_1', anim.weapons)).toBe('staff');
    expect(weaponOf('Body', anim.weapons)).toBeNull();
    expect(weaponOf('Swordfish', anim.weapons)).toBeNull();
  });
});

// The average of Hero_BaseColor.jpg under the Skin faces (materials.json, linear).
const SKIN_AVERAGE: [number, number, number] = [0.7976, 0.4093, 0.2406];

describe('textureTint', () => {
  it('makes the texture average exactly the chosen color', () => {
    const chosen = new Color(0.6, 0.3, 0.2);
    const tint = textureTint(chosen, SKIN_AVERAGE, new Color());
    expect(tint.r * SKIN_AVERAGE[0]).toBeCloseTo(0.6, 6);
    expect(tint.g * SKIN_AVERAGE[1]).toBeCloseTo(0.3, 6);
    expect(tint.b * SKIN_AVERAGE[2]).toBeCloseTo(0.2, 6);
  });

  it('is 1 when the chosen color is the average (the texture as painted)', () => {
    const chosen = new Color(SKIN_AVERAGE[0], SKIN_AVERAGE[1], SKIN_AVERAGE[2]);
    const tint = textureTint(chosen, SKIN_AVERAGE, new Color());
    expect(tint.r).toBeCloseTo(1, 6);
    expect(tint.g).toBeCloseTo(1, 6);
    expect(tint.b).toBeCloseTo(1, 6);
  });

  it('leaves a channel alone when the average has none, and never explodes', () => {
    const tint = textureTint(new Color(1, 1, 1), [0, 0.001, 0.5], new Color());
    expect(tint.r).toBe(1);
    expect(tint.g).toBe(4);
    expect(tint.b).toBe(2);
  });

  it('writes into the given color and returns it (no allocation)', () => {
    const out = new Color();
    expect(textureTint(new Color(0.5, 0.5, 0.5), SKIN_AVERAGE, out)).toBe(out);
  });
});
