import type { WaveFightDef } from '../data/types';

/**
 * A fight in waves on a marked piece of ground: the second Entrance Exam, where your teacher
 * calls monsters onto the Academy training field (quests.json `waveFights`). The field lies
 * inside the safe zone of Greyhaven; these monsters are a deliberate exception to it, only
 * while the exam runs and only on the field.
 *
 * It runs on the fixed step and owns nothing but its own timers: spawning, counting and the
 * lines all go through `WaveFightWorld`, so the simulation stays testable and the same at 60
 * and 120 fps. Every wave is heavier than the one before; after the last one the exam objective
 * is done. Walking off the field (for longer than `leaveSeconds`) or going down clears the
 * field and the drill starts again at wave 1, like a rematch with a boss.
 */

export type WavePhase = 'idle' | 'waiting' | 'fighting' | 'won';

/** Why a running drill stopped. */
export type WaveResetReason = 'left' | 'down';

/** What the drill needs from the world. */
export interface WaveFightWorld {
  /** Monsters of this fight still in the world. */
  alive(): number;
  /** Puts wave `index` (0-based) on the field. */
  spawnWave(index: number): void;
  /** Takes every monster of this fight off the field. */
  clear(): void;
  /** Is the player on the field? */
  inArea(): boolean;
  /** The teacher says a line (a text key). */
  say(key: string): void;
  /** Wave `index` (0-based) is down: the quest counts one more. */
  waveCleared(index: number): void;
  /** Every wave is down: the exam objective is finished. */
  finished(): void;
  /** The drill gave up and will start again at wave 1. */
  reset(reason: WaveResetReason): void;
}

export class WaveFight {
  /** Waves already beaten this run. */
  private cleared = 0;
  private phase: WavePhase = 'idle';
  /** Seconds until the next wave arrives (`waiting`). */
  private timer = 0;
  /** Seconds the player has been off the field. */
  private outside = 0;
  /** Monsters of the running wave were really put down (so "nothing alive" means cleared). */
  private spawned = false;

  constructor(
    readonly def: WaveFightDef,
    private readonly world: WaveFightWorld,
  ) {}

  /** The drill is on (a wave is coming or being fought). */
  get running(): boolean {
    return this.phase === 'waiting' || this.phase === 'fighting';
  }

  get state(): WavePhase {
    return this.phase;
  }

  /** Is the player on the field right now? (The caller only starts a drill when they are.) */
  get onField(): boolean {
    return this.world.inArea();
  }

  /** The wave you are on, 1-based (0 before the first one, waves.length when you are done). */
  get wave(): number {
    return this.phase === 'won'
      ? this.def.waves.length
      : Math.min(this.cleared + 1, this.def.waves.length);
  }

  /** Waves beaten this run. */
  get clearedWaves(): number {
    return this.cleared;
  }

  /**
   * Starts the drill at wave 1: the teacher says his line and the first wave arrives after the
   * pause. `fromWave` lets a save or a test start further along (0 = the beginning).
   */
  start(fromWave = 0): void {
    this.world.clear();
    this.cleared = Math.min(fromWave, this.def.waves.length);
    this.outside = 0;
    this.spawned = false;
    if (this.cleared >= this.def.waves.length) {
      this.phase = 'won';
      return;
    }
    this.phase = 'waiting';
    this.timer = this.def.pauseSeconds;
    this.world.say(this.def.lines.start);
  }

  /** The player went down: the field is cleared and the drill starts again at wave 1. */
  knockedOut(): void {
    if (!this.running) return;
    this.giveUp('down');
  }

  /** The drill stops without a word (leaving the zone, a teleport, the scene closing). */
  abort(): void {
    if (this.phase === 'idle') return;
    this.world.clear();
    this.phase = 'idle';
    this.cleared = 0;
    this.outside = 0;
    this.spawned = false;
  }

  /** One fixed step. */
  step(dt: number): void {
    if (!this.running) return;
    // Off the field for too long: the drill gives up (slimes gone, back to wave 1).
    if (this.world.inArea()) {
      this.outside = 0;
    } else {
      this.outside += dt;
      if (this.outside >= this.def.leaveSeconds) {
        this.giveUp('left');
        return;
      }
    }
    if (this.phase === 'waiting') {
      this.timer -= dt;
      if (this.timer > 0) return;
      this.phase = 'fighting';
      this.spawned = true;
      this.world.spawnWave(this.cleared);
      return;
    }
    if (!this.spawned || this.world.alive() > 0) return;
    // The wave is down.
    this.spawned = false;
    this.cleared++;
    this.world.waveCleared(this.cleared - 1);
    if (this.cleared >= this.def.waves.length) {
      this.phase = 'won';
      this.world.say(this.def.lines.end);
      this.world.finished();
      return;
    }
    this.phase = 'waiting';
    this.timer = this.def.pauseSeconds;
    // One line per wave after the first; the last one is repeated if the list is shorter.
    const lines = this.def.lines.wave;
    const line = lines[Math.min(this.cleared - 1, lines.length - 1)];
    if (line) this.world.say(line);
  }

  private giveUp(reason: WaveResetReason): void {
    this.world.clear();
    this.phase = 'idle';
    this.cleared = 0;
    this.outside = 0;
    this.spawned = false;
    this.world.say(this.def.lines.reset);
    this.world.reset(reason);
  }
}
