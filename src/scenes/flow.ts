import type { GameData } from '../data/types';
import type { Language } from '../i18n/I18n';
import { createNewSave, type SaveData, type SaveSettings } from '../save/SaveData';
import type { LoadResult } from '../save/SaveManager';

/** Ids of all game states (scenes). */
export type StateId = 'boot' | 'language' | 'title' | 'create' | 'intro' | 'introScene' | 'world';

/**
 * Where the game goes after loading: the language choice when there is no save, the title
 * screen when there is one, or nowhere when the save belongs to a newer version of the game
 * (so it is never overwritten by accident).
 */
export function bootRoute(load: LoadResult): 'language' | 'title' | 'blocked' {
  switch (load.status) {
    case 'ok':
      return 'title';
    case 'newer':
      return 'blocked';
    case 'none':
    case 'corrupt':
      return 'language';
  }
}

/** Continue is offered once the player has reached the world at least once. */
export function canContinue(save: SaveData | null): boolean {
  return save !== null && save.world.zone !== null;
}

/**
 * A fresh game: everything starts over except the language and settings, which belong to the
 * player rather than the playthrough.
 */
export function startNewGame(
  previous: SaveData | null,
  language: Language,
  now: Date = new Date(),
): SaveData {
  const save = createNewSave(language, now);
  if (previous) save.settings = { ...previous.settings };
  return save;
}

/** The frame cap for the game loop (0 = follow the display). A `?fps=` test value wins. */
export function frameCapFor(
  setting: SaveSettings['fpsCap'],
  testOverride = 0,
  autoTarget = 0,
): number {
  if (testOverride > 0) return testOverride;
  return setting === 'auto' ? autoTarget : Number(setting);
}

/**
 * Puts a new game at its starting point from player.json: the start zone, its spawn point
 * (waking up in the Monastery) and that zone's checkpoint. Does nothing once a zone is set.
 */
export function placeAtStart(save: SaveData, data: GameData): void {
  if (save.world.zone !== null) return;
  const start = data.player.start;
  const zone = data.zones.zones.find((entry) => entry.id === start.zone);
  const spawn = zone?.spawnPoints.find((point) => point.id === start.spawnPoint);
  if (!zone || !spawn) throw new Error(`Start point ${start.zone}/${start.spawnPoint} not found`);
  save.world.zone = zone.id;
  // The ground height is found when the world is built (from above in a Blender-built zone).
  save.world.position = { x: spawn.x, y: spawn.y ?? (zone.scene ? 10_000 : 0), z: spawn.z };
  save.world.heading = ((spawn.headingDegrees ?? 0) * Math.PI) / 180;
  save.world.checkpoint = zone.checkpoint?.id ?? null;
}

/** Steps through cutscene panels: next on tap/key, skip jumps to the end. */
export class PanelSequence {
  private current = 0;
  private done = false;

  constructor(
    readonly count: number,
    start = 0,
  ) {
    if (count < 1) throw new Error('A sequence needs at least one panel');
    this.current = Math.min(Math.max(0, start), count - 1);
  }

  get index(): number {
    return this.current;
  }

  get finished(): boolean {
    return this.done;
  }

  /** Moves to the next panel; returns true when the sequence just finished. */
  next(): boolean {
    if (this.done) return false;
    if (this.current < this.count - 1) {
      this.current++;
      return false;
    }
    this.done = true;
    return true;
  }

  /** Ends the sequence; returns true when it was not finished yet. */
  skip(): boolean {
    if (this.done) return false;
    this.done = true;
    return true;
  }
}
