import { Color } from 'three';
import { hashSeed, Random } from '../core/Random';
import type { Condition, NpcDef, NpcsFile } from '../data/types';
import { angleDelta } from '../systems/Movement';
import { Wander, type WalkerState } from '../systems/NpcBehavior';
import { type ConditionContext, evaluateCondition } from '../world/Conditions';
import { Companion } from './Companion';

const DEG = Math.PI / 180;
/** Followers and wanderers keep at least this radius against walls while walking. */
const MIN_BODY_RADIUS = 0.25;

export type NpcRole = NpcsFile['roles'][number];
export type NpcSettings = NpcsFile['settings'];

/**
 * One NPC from npcs.json: its data, simulation state (fixed step) and the previous step for
 * smooth drawing. Behavior comes from data: `static` NPCs stand still and turn towards a player
 * who comes close, `wander` NPCs roam around their spot, `follow` NPCs (Pringle) roam around
 * the player. A new NPC is only data.
 */
export type QuestMarker = 'none' | 'offer' | 'handIn';

export class Npc {
  readonly state: WalkerState & { y: number };
  readonly color: Color;
  /** Collision radius against the player (0 = walk through). */
  readonly solidRadius: number;
  readonly homeHeading: number;
  readonly wander: Wander | null;
  readonly companion: Companion | null;
  /** Drawn and simulated right now (near the player, see Npcs). */
  shown = false;
  /** In the world at all (`presentWhen` / `absentWhen`, or hidden during a boss fight). */
  present = true;
  /**
   * A companion told to wait (Biscuit at a dungeon entrance): it stands where it was put and
   * shows / hides like any NPC until it is called back (Npcs.stopWaiting).
   */
  waiting = false;
  /** Seconds left of the little hop after petting (drawing only). */
  hop = 0;
  /** Seconds left that a petted companion stays put, facing the player (`petHoldSeconds`). */
  petHold = 0;
  /** Marker above the head: a quest to offer, a quest to hand in, or none. */
  questMarker: QuestMarker = 'none';
  private prevX = 0;
  private prevY = 0;
  private prevZ = 0;
  private prevHeading = 0;

  constructor(
    readonly def: NpcDef,
    readonly role: NpcRole,
    settings: NpcSettings,
    color: number,
  ) {
    this.color = new Color(color);
    this.solidRadius = role.radius;
    this.homeHeading = (def.heading ?? 0) * DEG;
    this.state = { x: def.position.x, y: 0, z: def.position.z, heading: this.homeHeading };
    const turnSpeed = settings.turnDegreesPerSecond * DEG;
    const bodyRadius = Math.max(MIN_BODY_RADIUS, role.radius);
    const [pauseMin, pauseMax] = settings.wanderPauseSeconds;
    const rng = new Random(hashSeed(...Array.from(def.id, (c) => c.charCodeAt(0))));
    this.wander =
      def.behavior === 'wander' && def.wander
        ? new Wander(
            {
              homeX: def.position.x,
              homeZ: def.position.z,
              radius: def.wander.radius,
              speed: def.wander.speed,
              pauseMin,
              pauseMax,
              turnSpeed,
              bodyRadius,
            },
            rng,
          )
        : null;
    this.companion =
      def.behavior === 'follow' && def.follow
        ? new Companion(
            {
              minDistance: def.follow.minDistance,
              maxDistance: def.follow.maxDistance,
              speed: def.follow.speed,
              strollSpeed: def.follow.strollSpeed,
              idlePauseMin: def.follow.idlePauseSeconds[0],
              idlePauseMax: def.follow.idlePauseSeconds[1],
              teleportDistance: settings.followTeleportDistance,
              turnSpeed,
              bodyRadius,
            },
            rng,
          )
        : null;
    this.place(this.state.x, this.state.y, this.state.z, this.state.heading);
  }

  get id(): string {
    return this.def.id;
  }

  get canInteract(): boolean {
    return this.def.interaction !== 'none';
  }

  /** Puts the NPC somewhere without interpolating from the old spot. */
  place(x: number, y: number, z: number, heading: number): void {
    const s = this.state;
    s.x = this.prevX = x;
    s.y = this.prevY = y;
    s.z = this.prevZ = z;
    s.heading = this.prevHeading = heading;
  }

  /** Call before each simulation step. */
  beginStep(): void {
    this.prevX = this.state.x;
    this.prevY = this.state.y;
    this.prevZ = this.state.z;
    this.prevHeading = this.state.heading;
  }

  /** How far (m, along the ground) it moved in the last simulation step. */
  stepDistance(): number {
    return Math.hypot(this.state.x - this.prevX, this.state.z - this.prevZ);
  }

  drawX(alpha: number): number {
    return this.prevX + (this.state.x - this.prevX) * alpha;
  }

  drawY(alpha: number): number {
    return this.prevY + (this.state.y - this.prevY) * alpha;
  }

  drawZ(alpha: number): number {
    return this.prevZ + (this.state.z - this.prevZ) * alpha;
  }

  drawHeading(alpha: number): number {
    return this.prevHeading + angleDelta(this.prevHeading, this.state.heading) * alpha;
  }
}

/**
 * The lines an NPC says now: the first `dialogueWhen` entry whose named condition holds,
 * otherwise its normal `dialogue`. Quests hook in here later through conditions.
 */
export function dialogueLines(
  def: NpcDef,
  conditions: Readonly<Record<string, Condition>>,
  ctx: ConditionContext,
): readonly string[] {
  for (const entry of def.dialogueWhen ?? []) {
    const condition = conditions[entry.condition];
    if (condition && evaluateCondition(condition, ctx)) return entry.lines;
  }
  return def.dialogue;
}
