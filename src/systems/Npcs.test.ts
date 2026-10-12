import { describe, expect, it } from 'vitest';
import { npcsFileSchema, triggersFileSchema } from '../data/schemas';
import type { NpcsFile } from '../data/types';
import { Companion, type FollowConfig, type FollowTarget } from '../entities/Companion';
import { dialogueLines } from '../entities/Npc';
import { hasNpcModel } from '../entities/NpcFactory';
import { readPublicJson } from '../test/loadPublic';
import type { PointXZ } from '../world/Colliders';
import { Random } from '../core/Random';
import type { Mover } from './Movement';
import { turnTowards, Wander, walkTowards } from './NpcBehavior';
import { type NpcWorld, Npcs } from './Npcs';

const DT = 1 / 60;

/** Moves freely (no walls). */
const free: Mover = {
  moveCircle(p: PointXZ, _radius: number, dx: number, dz: number) {
    p.x += dx;
    p.z += dz;
  },
};

/** A wall at x = 5: nothing gets past it. */
const wall: Mover = {
  moveCircle(p: PointXZ, _radius: number, dx: number, dz: number) {
    p.x = Math.min(5, p.x + dx);
    p.z += dz;
  },
};

const flatWorld: NpcWorld = { mover: free, heightAt: () => 2, resolve: () => {} };

/** The player at (x, z), standing (or walking with `moving`), the camera behind them. */
function at(x: number, z: number, heading: number, moving = false): FollowTarget {
  return { x, z, heading, moving, viewYaw: heading };
}

function npcsFile(): NpcsFile {
  return npcsFileSchema.parse(readPublicJson('data/npcs.json'));
}

describe('walkTowards / turnTowards', () => {
  it('walks at speed per second, the same at 60 and 120 Hz, without overshooting', () => {
    const a = { x: 0, z: 0, heading: 0 };
    const b = { x: 0, z: 0, heading: 0 };
    for (let i = 0; i < 60; i++) walkTowards(a, 10, 0, 2, DT, free, 0.3, 10);
    for (let i = 0; i < 120; i++) walkTowards(b, 10, 0, 2, DT / 2, free, 0.3, 10);
    expect(a.x).toBeCloseTo(2, 6);
    expect(b.x).toBeCloseTo(2, 6);
    for (let i = 0; i < 1000; i++) walkTowards(a, 10, 0, 2, DT, free, 0.3, 10);
    expect(a.x).toBeCloseTo(10, 6);
    // Faces the walking direction (+x = heading 90°).
    expect(a.heading).toBeCloseTo(Math.PI / 2, 3);
  });

  it('turns the short way and never further than allowed', () => {
    expect(turnTowards(0, 0.1, 1)).toBeCloseTo(0.1);
    expect(turnTowards(0, 2, 0.5)).toBeCloseTo(0.5);
    // From 170° to -170°: the short way is +20°, across ±180°.
    const h = turnTowards((170 * Math.PI) / 180, (-170 * Math.PI) / 180, 0.1);
    expect(Math.abs(h)).toBeGreaterThan((170 * Math.PI) / 180);
  });
});

describe('Wander', () => {
  const cfg = {
    homeX: 0,
    homeZ: 0,
    radius: 20,
    speed: 1,
    pauseMin: 0.5,
    pauseMax: 1,
    turnSpeed: 5,
    bodyRadius: 1,
  };

  it('stays within its radius and walks the same way every time (seeded)', () => {
    const run = () => {
      const wander = new Wander(cfg, new Random(42));
      const s = { x: 0, z: 0, heading: 0 };
      let maxDistance = 0;
      for (let i = 0; i < 60 * 120; i++) {
        wander.step(s, DT, free);
        maxDistance = Math.max(maxDistance, Math.hypot(s.x, s.z));
      }
      return { s, maxDistance };
    };
    const first = run();
    const second = run();
    expect(first.maxDistance).toBeLessThanOrEqual(cfg.radius + 1e-6);
    expect(first.maxDistance).toBeGreaterThan(1);
    expect(second.s).toEqual(first.s);
  });

  it('gives up a walk that is blocked', () => {
    const wander = new Wander({ ...cfg, homeX: 5 }, new Random(7));
    const s = { x: 5, z: 0, heading: 0 };
    let walkTime = 0;
    let longest = 0;
    for (let i = 0; i < 60 * 120; i++) {
      wander.step(s, DT, wall);
      walkTime = wander.walking ? walkTime + DT : 0;
      longest = Math.max(longest, walkTime);
    }
    expect(s.x).toBeLessThanOrEqual(5);
    // The longest possible free walk is 40 m at 1 m/s; blocked walks end much sooner.
    expect(longest).toBeLessThan(41);
  });
});

describe('Companion (Pringle)', () => {
  const cfg: FollowConfig = {
    minDistance: 1.8,
    maxDistance: 4.5,
    speed: 4.8,
    strollSpeed: 1.1,
    idlePauseMin: 1.5,
    idlePauseMax: 5,
    teleportDistance: 30,
    turnSpeed: 6,
    bodyRadius: 0.25,
  };
  const cat = (seed = 7): Companion => new Companion(cfg, new Random(seed));

  /** Where the cat is relative to a player at (px, pz) facing `heading`: ahead and sideways. */
  function relative(s: { x: number; z: number }, px: number, pz: number, heading: number) {
    const dx = s.x - px;
    const dz = s.z - pz;
    return {
      ahead: dx * Math.sin(heading) + dz * Math.cos(heading),
      side: dx * Math.cos(heading) - dz * Math.sin(heading),
      distance: Math.hypot(dx, dz),
    };
  }

  it('trots along beside a travelling player: never in front, never far behind', () => {
    const c = cat();
    const s = { x: 0, z: 0, heading: 0 };
    c.placeBehind(s, 0, 0, 0);
    let inTheWay = 0;
    let farAway = 0;
    // The player walks 4 m/s along +z for 20 s.
    for (let i = 0; i < 60 * 20; i++) {
      const pz = (i + 1) * 4 * DT;
      c.step(s, at(0, pz, 0, true), DT, free);
      if (i < 120) continue;
      const r = relative(s, 0, pz, 0);
      // "In the way": in front of the player, close to the line they walk.
      if (r.ahead > 0.3 && Math.abs(r.side) < 1) inTheWay++;
      if (r.distance > cfg.maxDistance * 2) farAway++;
    }
    expect(inTheWay).toBe(0);
    // Sniffing now and then lets it fall back a bit, but it always catches up.
    expect(farAway).toBeLessThan(60);
  });

  it('does not keep one fixed distance', () => {
    const c = cat(3);
    const s = { x: 0, z: 0, heading: 0 };
    c.placeBehind(s, 0, 0, 0);
    const distances: number[] = [];
    for (let i = 0; i < 60 * 30; i++) {
      // 15 s walking, then 15 s standing still.
      const pz = Math.min(i, 900) * 4 * DT;
      c.step(s, at(0, pz, 0, i < 900), DT, free);
      if (i % 30 === 0 && i > 120) distances.push(Math.hypot(s.x, s.z - pz));
    }
    const mean = distances.reduce((a, b) => a + b, 0) / distances.length;
    const spread = Math.sqrt(distances.reduce((a, b) => a + (b - mean) ** 2, 0) / distances.length);
    expect(spread).toBeGreaterThan(0.3);
  });

  it('strolls around a player who stands still: close, but never through their feet', () => {
    const c = cat(11);
    const s = { x: 0, z: 0, heading: 0 };
    c.placeBehind(s, 0, 0, 0);
    let walks = 0;
    let wasWalking = false;
    let furthest = 0;
    let closest = Infinity;
    for (let i = 0; i < 60 * 40; i++) {
      c.step(s, at(0, 0, 0), DT, free);
      if (c.walking && !wasWalking) walks++;
      wasWalking = c.walking;
      furthest = Math.max(furthest, Math.hypot(s.x, s.z));
      closest = Math.min(closest, Math.hypot(s.x, s.z));
    }
    expect(walks).toBeGreaterThanOrEqual(3);
    expect(furthest).toBeLessThan(cfg.maxDistance + 0.5);
    expect(closest).toBeGreaterThan(1.1);
  });

  it('lets you walk up to it to pet it', () => {
    const c = cat(5);
    const s = { x: 0, z: 0, heading: 0 };
    c.placeBehind(s, 0, 0, 0);
    for (let i = 0; i < 60 * 3; i++) c.step(s, at(0, 0, 0), DT, free);
    // Walk straight at the cat at 4 m/s until within the pet range (1.5 m).
    let px = 0;
    let pz = 0;
    let reached = false;
    for (let i = 0; i < 60 * 2 && !reached; i++) {
      const dx = s.x - px;
      const dz = s.z - pz;
      const d = Math.hypot(dx, dz);
      if (d <= 1.5) {
        reached = true;
        break;
      }
      px += (dx / d) * 4 * DT;
      pz += (dz / d) * 4 * DT;
      c.step(s, at(px, pz, Math.atan2(dx, dz), true), DT, free);
    }
    expect(reached).toBe(true);
  });

  it('jumps beside the player after a teleport', () => {
    const c = cat();
    const s = { x: 0, z: 0, heading: 0 };
    expect(c.step(s, at(500, 500, Math.PI / 2), DT, free)).toBe('teleport');
    // Heading 90° faces +x: the cat lands behind (x < 500), off to the side.
    const d = Math.hypot(s.x - 500, s.z - 500);
    expect(d).toBeGreaterThanOrEqual(cfg.minDistance);
    expect(d).toBeLessThanOrEqual(cfg.maxDistance);
    expect(s.x).toBeLessThan(500);
    expect(Math.abs(s.z - 500)).toBeGreaterThan(0.5);
  });

  it('jumps to the player when stuck behind a wall far away', () => {
    const c = cat();
    const s = { x: 0, z: 0, heading: 0 };
    let result = 'walk';
    for (let i = 0; i < 60 * 8 && result !== 'teleport'; i++) {
      result = c.step(s, at(20, 0, Math.PI / 2, true), DT, wall);
    }
    expect(result).toBe('teleport');
  });
});

describe('Npcs', () => {
  it('shows NPCs near the player only, with a margin before hiding', () => {
    const npcs = new Npcs(npcsFile(), 'summer', () => 0xffffff);
    const ansel = npcs.byId('brother_ansel');
    if (!ansel) throw new Error('missing NPCs');
    const { x, z } = ansel.def.position;
    const { showRadius, hideMargin } = npcs.settings;
    // An NPC well out of sight from Brother Ansel (positions change with the map).
    const far = npcs.list.find(
      (npc) =>
        npc.def.behavior !== 'follow' &&
        Math.hypot(npc.def.position.x - x - 5, npc.def.position.z - z) > showRadius + hideMargin,
    );
    if (!far) throw new Error('no NPC far from Brother Ansel');
    npcs.update(DT, at(x + 5, z, 0), flatWorld, null);
    expect(ansel.shown).toBe(true);
    expect(ansel.state.y).toBe(2);
    expect(far.shown).toBe(false);
    npcs.update(DT, at(x + showRadius + hideMargin / 2, z, 0), flatWorld, null);
    expect(ansel.shown).toBe(true);
    npcs.update(DT, at(x + showRadius + hideMargin + 1, z, 0), flatWorld, null);
    expect(ansel.shown).toBe(false);
  });

  it('keeps the companion with the player everywhere', () => {
    const npcs = new Npcs(npcsFile(), 'summer', () => 0xffffff);
    const pringle = npcs.byId('pringle');
    npcs.update(DT, at(-1000, -600, 0), flatWorld, null);
    expect(pringle?.shown).toBe(true);
    const maxDistance = pringle?.def.follow?.maxDistance ?? 0;
    expect(
      Math.hypot((pringle?.state.x ?? 0) + 1000, (pringle?.state.z ?? 0) + 600),
    ).toBeLessThanOrEqual(maxDistance);
  });

  it('turns a static NPC towards a player who comes close', () => {
    const npcs = new Npcs(npcsFile(), 'summer', () => 0xffffff);
    const marco = npcs.byId('marco');
    if (!marco) throw new Error('missing Marco');
    const { x, z } = marco.def.position;
    // Player 2 m east of Marco: Marco should end up facing +x (90°).
    for (let i = 0; i < 120; i++) npcs.update(DT, at(x + 2, z, 0), flatWorld, null);
    expect(marco.state.heading).toBeCloseTo(Math.PI / 2, 3);
    // Player gone: back to the home heading.
    for (let i = 0; i < 120; i++) npcs.update(DT, at(x + 50, z, 0), flatWorld, null);
    expect(marco.state.heading).toBeCloseTo(marco.homeHeading, 3);
  });

  it('pushes the player out of solid NPCs but not out of Pringle', () => {
    const npcs = new Npcs(npcsFile(), 'summer', () => 0xffffff);
    const ansel = npcs.byId('brother_ansel');
    const pringle = npcs.byId('pringle');
    if (!ansel || !pringle) throw new Error('missing NPCs');
    const { x, z } = ansel.def.position;
    npcs.update(DT, at(x + 1, z, 0), flatWorld, null);
    const p = { x: x + 0.3, z };
    expect(npcs.pushOut(p, 0.4)).toBe(true);
    expect(p.x - x).toBeCloseTo(0.4 + ansel.solidRadius);
    const q = { x: pringle.state.x, z: pringle.state.z };
    expect(npcs.pushOut(q, 0.4)).toBe(false);
  });

  it('finds the nearest NPC you can talk to, and Pringle only up close', () => {
    const npcs = new Npcs(npcsFile(), 'summer', () => 0xffffff);
    const hilda = npcs.byId('hilda');
    if (!hilda) throw new Error('missing Hilda');
    const { x, z } = hilda.def.position;
    npcs.update(DT, at(x + 1, z, 0), flatWorld, null);
    expect(npcs.nearestInteractable(x + 1, z)?.id).toBe('hilda');
    expect(npcs.nearestInteractable(x + 20, z)?.id).not.toBe('hilda');

    // Out in the forest, nobody to talk to; Pringle roams outside the (smaller) pet range.
    const w = { x: -1100, z: -400 };
    npcs.update(DT, at(w.x, w.z, 0), flatWorld, null);
    expect(npcs.nearestInteractable(w.x, w.z)).toBeNull();
    const pringle = npcs.byId('pringle');
    if (!pringle) throw new Error('missing Pringle');
    expect(npcs.nearestInteractable(pringle.state.x + 0.8, pringle.state.z)?.id).toBe('pringle');
  });

  it('leaves out NPCs of another season', () => {
    const file = npcsFile();
    const base = file.npcs[0];
    if (!base) throw new Error('no NPCs');
    file.npcs.push({ ...base, id: 'spring_only', season: 'spring' });
    expect(new Npcs(file, 'summer', () => 0).byId('spring_only')).toBeUndefined();
    expect(new Npcs(file, 'spring', () => 0).byId('spring_only')).toBeDefined();
  });
});

describe('Npcs presence (Pringle becomes Sultan)', () => {
  const conditions = triggersFileSchema.parse(readPublicJson('data/triggers.json')).conditions;
  const npcs = () => new Npcs(npcsFile(), 'summer', () => 0xffffff);
  const shownIds = (list: Npcs) => list.list.filter((n) => n.shown).map((n) => n.id);

  it('has Pringle and no Sultan before the fight, and the other way round after it', () => {
    const list = npcs();
    const spot = list.byId('sultan')?.def.position;
    if (!spot) throw new Error('missing Sultan');
    const before = { level: 3, completedQuests: new Set<string>() };
    list.refreshPresence(conditions, before);
    list.update(DT, at(spot.x - 2, spot.z - 1, 0), flatWorld, null);
    expect(shownIds(list)).toContain('pringle');
    expect(shownIds(list)).not.toContain('sultan');

    const after = { level: 3, completedQuests: new Set(['defeat_sultan']) };
    list.refreshPresence(conditions, after);
    list.update(DT, at(spot.x - 2, spot.z - 1, 0), flatWorld, null);
    expect(shownIds(list)).toContain('sultan');
    expect(shownIds(list)).not.toContain('pringle');
    expect(list.nearestInteractable(spot.x, spot.z + 1)?.id).toBe('sultan');
  });

  it('hides NPCs for a moment (Pringle during the fight) and brings them back', () => {
    const list = npcs();
    const ctx = { level: 3, completedQuests: new Set<string>() };
    list.refreshPresence(conditions, ctx, new Set(['pringle']));
    list.update(DT, at(-1550, 0, 0), flatWorld, null);
    expect(shownIds(list)).not.toContain('pringle');
    list.refreshPresence(conditions, ctx);
    list.update(DT, at(-1550, 0, 0), flatWorld, null);
    expect(shownIds(list)).toContain('pringle');
  });
});

describe('Biscuit (pack animal)', () => {
  const conditions = triggersFileSchema.parse(readPublicJson('data/triggers.json')).conditions;
  const owned = {
    level: 3,
    completedQuests: new Set(['defeat_sultan', 'a_friend_for_the_road']),
  };
  const ids = (list: Npcs): string[] => list.list.filter((n) => n.shown).map((n) => n.id);

  it('only comes along after Marco gave him to you, and then follows', () => {
    const list = new Npcs(npcsFile(), 'summer', () => 0xffffff);
    list.refreshPresence(conditions, { level: 3, completedQuests: new Set(['defeat_sultan']) });
    list.update(DT, at(0, 0, 0), flatWorld, null);
    expect(ids(list)).not.toContain('biscuit');
    list.refreshPresence(conditions, owned);
    list.update(DT, at(0, 0, 0), flatWorld, null);
    expect(ids(list)).toContain('biscuit');
    // Walk 30 s north: Biscuit keeps up.
    let z = 0;
    for (let i = 0; i < 30 * 60; i++) {
      z += 4 * DT;
      list.update(DT, at(0, z, 0, true), flatWorld, null);
    }
    const biscuit = list.byId('biscuit');
    if (!biscuit) throw new Error('missing Biscuit');
    expect(Math.hypot(biscuit.state.x, biscuit.state.z - z)).toBeLessThan(8);
  });

  it('waits at an entrance and comes back when called', () => {
    const list = new Npcs(npcsFile(), 'summer', () => 0xffffff);
    list.refreshPresence(conditions, owned);
    list.update(DT, at(0, 0, 0), flatWorld, null);
    expect(list.waitAt('biscuit', 10, 10, 0, flatWorld)).toBe(true);
    expect(list.waitAt('marco', 10, 10, 0, flatWorld)).toBe(false);
    let z = 0;
    for (let i = 0; i < 10 * 60; i++) {
      z += 4 * DT;
      list.update(DT, at(0, z, 0, true), flatWorld, null);
    }
    list.snapCompanions(0, z, 0, flatWorld);
    const biscuit = list.byId('biscuit');
    if (!biscuit) throw new Error('missing Biscuit');
    expect(biscuit.state.x).toBe(10);
    expect(biscuit.state.z).toBe(10);
    list.stopWaiting('biscuit', 0, z, 0, flatWorld);
    expect(Math.hypot(biscuit.state.x, biscuit.state.z - z)).toBeLessThan(8);
    expect(biscuit.waiting).toBe(false);
  });

  it('is not the nearest thing to talk to while it just follows you', () => {
    const file = npcsFile();
    const biscuit = file.npcs.find((npc) => npc.id === 'biscuit');
    expect(biscuit?.follow?.minDistance).toBeGreaterThan(file.settings.interactRange);
  });
});

describe('NPC data', () => {
  it('uses only placeholder models the factory can build', () => {
    for (const role of npcsFile().roles) expect(hasNpcModel(role.model), role.model).toBe(true);
  });

  it('picks conditional dialogue (Master Brink after you chose a path)', () => {
    const conditions = triggersFileSchema.parse(readPublicJson('data/triggers.json')).conditions;
    const brink = npcsFile().npcs.find((npc) => npc.id === 'master_brink');
    if (!brink) throw new Error('missing Master Brink');
    const done = new Set(['defeat_sultan']);
    expect(dialogueLines(brink, conditions, { level: 3, completedQuests: done })).toEqual(
      brink.dialogue,
    );
    const light = { level: 3, completedQuests: done, path: 'light' as const };
    expect(dialogueLines(brink, conditions, light)).toEqual(['npc.master_brink.student']);
    const dark = { level: 3, completedQuests: done, path: 'dark' as const };
    expect(dialogueLines(brink, conditions, dark)).toEqual(['npc.master_brink.otherPath']);
  });
});
