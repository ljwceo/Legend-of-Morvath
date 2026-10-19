import { describe, expect, it } from 'vitest';
import { playerFileSchema, spellsFileSchema } from '../data/schemas';
import type { PlayerConfig, SpellsFile } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { castConfig, type IncantationConfig, pushTargets } from './Casting';
import type { SwordTarget } from './Combat';

const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;
const spells = spellsFileSchema.parse(readPublicJson('data/spells.json')) as SpellsFile;
const push = castConfig(player, spells).incantations.get('push') as IncantationConfig;

interface Dummy extends SwordTarget {
  id: string;
}
const at = (id: string, x: number, z: number, hittable = true, radius = 0.45): Dummy => ({
  id,
  x,
  z,
  radius,
  hittable,
});

describe("Push's cone (G.3)", () => {
  const effect = push.effect;

  it('takes everything in its short frontal cone, each exactly once, and nothing behind', () => {
    const r = effect.range;
    const targets = [
      at('ahead', 0, r * 0.5),
      at('edge', 0, r + 0.3),
      at('far', 0, r + 1),
      at('behind', 0, -1),
      at(
        'side',
        r * 0.5 * Math.sin(effect.halfArc + 0.5),
        r * 0.5 * Math.cos(effect.halfArc + 0.5),
        true,
        0.1,
      ),
      at('guarded', 0.3, r * 0.6, false),
    ];
    const out: Dummy[] = [at('stale', 0, 0)];
    const hits = pushTargets(0, 0, 0, effect, targets, out);
    expect(hits).toBe(out);
    expect(hits.map((t) => t.id)).toEqual(['ahead', 'edge', 'guarded']);
    // Calling it again gives the same list, not twice the targets.
    expect(pushTargets(0, 0, 0, effect, targets, out).map((t) => t.id)).toEqual([
      'ahead',
      'edge',
      'guarded',
    ]);
  });

  it('turns with the heading, like a swing', () => {
    const targets = [at('east', 1.5, 0), at('north', 0, 1.5)];
    expect(pushTargets(0, 0, Math.PI / 2, effect, targets, []).map((t) => t.id)).toEqual(['east']);
    expect(pushTargets(0, 0, 0, effect, targets, []).map((t) => t.id)).toEqual(['north']);
  });

  it('is short: a sword swing reaches further than Push does not cover the sword', () => {
    expect(effect.range).toBeLessThanOrEqual(player.sword.range + 1);
    expect(effect.halfArc).toBeGreaterThan(0);
  });
});
