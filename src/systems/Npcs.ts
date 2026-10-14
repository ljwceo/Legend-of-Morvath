import type { FollowTarget } from '../entities/Companion';
import { Npc, type NpcSettings } from '../entities/Npc';
import type { Condition, NpcDef, NpcsFile } from '../data/types';
import { type ConditionContext, evaluateCondition } from '../world/Conditions';
import type { PointXZ } from '../world/Colliders';
import type { Mover } from './Movement';
import { turnTowards } from './NpcBehavior';

const DEG = Math.PI / 180;
const NONE: ReadonlySet<string> = new Set();

/** What NPCs need from the world: walking with collision, ground height, pushing out. */
export interface NpcWorld {
  mover: Mover;
  heightAt(x: number, z: number): number;
  /** Pushes a circle out of walls (after a companion jumped to the player). */
  resolve(p: PointXZ, radius: number): void;
}

/**
 * All NPCs of the open world (npcs.json), on the fixed step:
 * - NPCs appear within `showRadius` of the player and disappear beyond showRadius + hideMargin
 *   (the same on every graphics preset; companions are always there),
 * - static NPCs turn towards a player who comes close (or talks to them), then back,
 * - wanderers roam only near the player, where collision is loaded,
 * - companions roam around the player (Pringle, Biscuit), unless told to wait (`waitAt`),
 * - solid NPCs push the player out (you cannot walk through Brother Ansel),
 * - the nearest NPC you can talk to (within `interactRange`) or pet (within `petRange`).
 * NPCs bound to a season (`season`) only exist in that season; `presentWhen` / `absentWhen`
 * bring NPCs in or take them out when a condition changes (Pringle becomes Sultan).
 */
export class Npcs {
  readonly list: Npc[];
  readonly settings: NpcSettings;
  private readonly turnSpeed: number;

  /**
   * @param include which NPCs belong to the world being played (a Blender-built zone has only
   *   its own NPCs; the open world leaves those out). Companions always come along.
   */
  constructor(
    file: NpcsFile,
    season: string,
    color: (token: string) => number,
    include: (def: NpcDef) => boolean = () => true,
  ) {
    this.settings = file.settings;
    this.turnSpeed = file.settings.turnDegreesPerSecond * DEG;
    const roles = new Map(file.roles.map((role) => [role.id, role]));
    this.list = [];
    for (const def of file.npcs) {
      const role = roles.get(def.role);
      if (!role) continue;
      if (def.season && def.season !== season) continue;
      if (def.behavior !== 'follow' && !include(def)) continue;
      this.list.push(new Npc(def, role, file.settings, color(role.color)));
    }
  }

  /**
   * Which NPCs are in the world now: their `presentWhen` / `absentWhen` conditions, and
   * `hidden` (ids taken out for a moment, e.g. Pringle during the Sultan fight). Call when
   * quests, level or the hidden list change.
   */
  refreshPresence(
    conditions: Readonly<Record<string, Condition>>,
    ctx: ConditionContext,
    hidden: ReadonlySet<string> = NONE,
  ): void {
    const holds = (name: string): boolean => {
      const condition = conditions[name];
      return condition ? evaluateCondition(condition, ctx) : false;
    };
    for (const npc of this.list) {
      const def = npc.def;
      const present =
        !hidden.has(npc.id) &&
        (def.presentWhen === undefined || holds(def.presentWhen)) &&
        (def.absentWhen === undefined || !holds(def.absentWhen));
      npc.present = present;
      if (!present) npc.shown = false;
    }
  }

  get shownCount(): number {
    let count = 0;
    for (let i = 0; i < this.list.length; i++) if ((this.list[i] as Npc).shown) count++;
    return count;
  }

  /** One fixed step. `talkingTo` stands still and faces the player. */
  update(dt: number, player: FollowTarget, world: NpcWorld, talkingTo: Npc | null): void {
    const px = player.x;
    const pz = player.z;
    const cfg = this.settings;
    const show2 = cfg.showRadius * cfg.showRadius;
    const hide = cfg.showRadius + cfg.hideMargin;
    const hide2 = hide * hide;
    const sim2 = cfg.simulateRadius * cfg.simulateRadius;
    const notice2 = cfg.noticeRadius * cfg.noticeRadius;
    const maxTurn = this.turnSpeed * dt;

    for (let i = 0; i < this.list.length; i++) {
      const npc = this.list[i] as Npc;
      const s = npc.state;
      // A waiting companion stays put, like any other NPC.
      const companion = npc.waiting ? null : npc.companion;
      if (!npc.present) continue;

      if (companion) {
        if (!npc.shown) {
          npc.shown = true;
          companion.placeBehind(s, px, pz, player.heading);
          this.settle(npc, world);
        }
      } else {
        const dx = s.x - px;
        const dz = s.z - pz;
        const d2 = dx * dx + dz * dz;
        if (!npc.shown && d2 <= show2) {
          npc.shown = true;
          npc.place(s.x, world.heightAt(s.x, s.z), s.z, s.heading);
        } else if (npc.shown && d2 > hide2) {
          npc.shown = false;
        }
      }
      if (!npc.shown) continue;

      npc.beginStep();
      if (npc.hop > 0) npc.hop = Math.max(0, npc.hop - dt);
      const dx = px - s.x;
      const dz = pz - s.z;
      const d2 = dx * dx + dz * dz;

      if (npc.petHold > 0) {
        // Just petted: it stays where it is and looks at you (its pet animation plays).
        npc.petHold = Math.max(0, npc.petHold - dt);
        s.heading = turnTowards(s.heading, Math.atan2(dx, dz), maxTurn);
      } else if (companion) {
        if (companion.step(s, player, dt, world.mover) === 'teleport') {
          this.settle(npc, world);
          continue;
        }
        s.y = world.heightAt(s.x, s.z);
      } else if (npc === talkingTo || (npc.def.behavior === 'static' && d2 <= notice2)) {
        // Face the player while talking (or when they come close).
        s.heading = turnTowards(s.heading, Math.atan2(dx, dz), maxTurn);
      } else if (npc.wander) {
        if (d2 <= sim2) {
          npc.wander.step(s, dt, world.mover);
          s.y = world.heightAt(s.x, s.z);
        }
      } else if (!npc.waiting) {
        s.heading = turnTowards(s.heading, npc.homeHeading, maxTurn);
      }
    }
  }

  /**
   * Pushes the player (circle at p) out of every solid NPC nearby. Returns true when it moved.
   * Allocation-free.
   */
  pushOut(p: PointXZ, radius: number): boolean {
    let moved = false;
    for (let i = 0; i < this.list.length; i++) {
      const npc = this.list[i] as Npc;
      if (!npc.shown || npc.solidRadius <= 0) continue;
      const min = radius + npc.solidRadius;
      const dx = p.x - npc.state.x;
      const dz = p.z - npc.state.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-6) {
        p.x = npc.state.x + min;
      } else {
        p.x = npc.state.x + (dx / d) * min;
        p.z = npc.state.z + (dz / d) * min;
      }
      moved = true;
    }
    return moved;
  }

  /** The nearest NPC you can talk to or pet from (x, z), or null. */
  nearestInteractable(x: number, z: number): Npc | null {
    let best: Npc | null = null;
    let bestD2 = Infinity;
    for (let i = 0; i < this.list.length; i++) {
      const npc = this.list[i] as Npc;
      if (!npc.shown || !npc.canInteract) continue;
      // Measured from the NPC's edge, so a big NPC is as easy to reach as a small one.
      const range =
        npc.def.interaction === 'pet' ? this.settings.petRange : this.settings.interactRange;
      const reach = range + npc.solidRadius;
      const dx = x - npc.state.x;
      const dz = z - npc.state.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > reach * reach || d2 >= bestD2) continue;
      best = npc;
      bestD2 = d2;
    }
    return best;
  }

  /** Companions jump to the player (after a teleport); waiting ones stay where they are. */
  snapCompanions(px: number, pz: number, heading: number, world: NpcWorld): void {
    for (const npc of this.list) {
      if (!npc.companion || !npc.present || npc.waiting) continue;
      npc.companion.placeBehind(npc.state, px, pz, heading);
      npc.shown = true;
      this.settle(npc, world);
    }
  }

  /**
   * Hook for dungeons (phase 3 plan): a companion waits at (x, z), e.g. Biscuit at the entrance
   * while you go in. Returns false when there is no such companion.
   */
  waitAt(id: string, x: number, z: number, heading: number, world: NpcWorld): boolean {
    const npc = this.byId(id);
    if (!npc?.companion) return false;
    npc.waiting = true;
    npc.place(x, world.heightAt(x, z), z, heading);
    world.resolve(npc.state, Math.max(0.25, npc.solidRadius));
    return true;
  }

  /** The companion follows you again; it appears beside you. */
  stopWaiting(id: string, px: number, pz: number, heading: number, world: NpcWorld): void {
    const npc = this.byId(id);
    if (!npc?.companion || !npc.waiting) return;
    npc.waiting = false;
    if (!npc.present) return;
    npc.companion.placeBehind(npc.state, px, pz, heading);
    npc.shown = true;
    this.settle(npc, world);
  }

  byId(id: string): Npc | undefined {
    return this.list.find((npc) => npc.id === id);
  }

  /** Out of walls, onto the ground, no interpolation from the old spot. */
  private settle(npc: Npc, world: NpcWorld): void {
    const s = npc.state;
    world.resolve(s, Math.max(0.25, npc.solidRadius));
    npc.place(s.x, world.heightAt(s.x, s.z), s.z, s.heading);
  }
}
