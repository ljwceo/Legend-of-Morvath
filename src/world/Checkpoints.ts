import type { GameEventBus } from '../core/events';
import type { Zone } from '../data/types';

export interface CheckpointDef {
  id: string;
  kind: string;
  zoneId: string;
  x: number;
  /** Floor height to wake up on (under a roof), if set. */
  y?: number | undefined;
  z: number;
  radius: number;
}

/** All checkpoints from zones.json (one per zone that has one). */
export function checkpointsOf(zones: readonly Zone[]): CheckpointDef[] {
  const list: CheckpointDef[] = [];
  for (const zone of zones) {
    const c = zone.checkpoint;
    if (c) {
      list.push({
        id: c.id,
        kind: c.kind,
        zoneId: zone.id,
        x: c.x,
        y: c.y,
        z: c.z,
        radius: c.radius,
      });
    }
  }
  return list;
}

/**
 * Checkpoints (Monastery, elven shrine, stilt monastery, ...): walking past one makes it your
 * checkpoint, which emits `checkpointSet` (autosave + a message). Standing at one, you can rest
 * there (full HP and mana; WorldState handles it).
 */
export class Checkpoints {
  /** The checkpoint the player stands at, or null. */
  near: CheckpointDef | null = null;

  constructor(
    readonly list: readonly CheckpointDef[],
    private readonly events: GameEventBus,
  ) {}

  /**
   * Call after the player moved. `world` is the save's world block; its `checkpoint` changes
   * when the player reaches a different checkpoint.
   */
  update(x: number, z: number, world: { checkpoint: string | null }): void {
    this.near = null;
    for (let i = 0; i < this.list.length; i++) {
      const c = this.list[i] as CheckpointDef;
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz > c.radius * c.radius) continue;
      this.near = c;
      if (world.checkpoint !== c.id) {
        world.checkpoint = c.id;
        this.events.emit('checkpointSet', { checkpointId: c.id });
      }
      return;
    }
  }

  byId(id: string | null): CheckpointDef | null {
    return this.list.find((c) => c.id === id) ?? null;
  }
}
