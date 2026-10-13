import type { GameContext } from '../core/GameContext';
import type { Enemy } from '../entities/Enemy';
import type { Arena, BossAttack, BossEventKind } from '../systems/BossAI';
import type { Enemies } from '../systems/Enemies';
import type { QuestBook } from '../systems/Quests';
import { type CutsceneDef, shouldPlayCutscene } from '../render/cinematic/CinematicTimeline';
import type { HUD } from '../ui/HUD';

/** Seconds a spoken line stays on screen. */
const LINE_SECONDS = 3.5;
/** Seconds a fight tip stays on screen. */
const HINT_SECONDS = 3;
/** After winning, the boss bar stays a moment (empty) before it fades. */
const WIN_BAR_SECONDS = 2.5;
/** Seconds the big victory words ("BOND FORGED") stay on screen. */
const VICTORY_SECONDS = 5;

/** What the boss fight needs from the world scene. */
export interface EncounterHost {
  readonly ctx: GameContext;
  enemies(): Enemies | null;
  quests(): QuestBook | null;
  hud(): HUD | null;
  /** NPCs taken out of the world for now (Pringle while he is Sultan). */
  setHiddenNpcs(ids: ReadonlySet<string>): void;
  /** Puts the player at (x, z) facing `heading`, the camera behind them. */
  placePlayer(x: number, z: number, heading: number): void;
  /**
   * Plays a cutscene (cinematic or comic; the world waits, the mouse is released), marks it
   * seen and then calls `onDone`. False when it could not start.
   */
  playCutscene(cutscene: CutsceneDef, onDone: () => void): boolean;
  /** True while the player can start a fight (not dying, not talking, not paused). */
  canStart(): boolean;
  /** A short text floating above a point in the world ("Dodged!"). */
  floatText(x: number, y: number, z: number, text: string): void;
  /** Touch controls in use (tips mention buttons instead of mouse buttons). */
  usesTouch(): boolean;
  /** A quest from the data started now (message, markers, save). */
  questStarted(questId: string): void;
}

/**
 * A boss fight in the open world (Sultan at the city gate). Walking into the boss's trigger
 * while its quest can start (or runs) plays the cutscene once (`seenCutscenes` in the save; a
 * rematch after losing skips it), then the fight: the player and the boss are placed in the
 * arena ring, the boss bar shows, Pringle is gone (he is Sultan now). Fight tips show once each
 * (`seenHints`). Winning: the boss falls, says its line, and the quest completes (the world
 * scene hands out the rewards); Sultan then stands outside the gate as an NPC. Losing is dying
 * as usual: you wake up at the Monastery and can walk back to the gate for a rematch.
 */
export class BossEncounter {
  /** The boss being fought, or null. */
  boss: Enemy | null = null;
  /** The ring nobody can leave during the fight, or null. */
  arena: Arena | null = null;
  private playing = false;
  private readonly hidden = new Set<string>();
  /** Seconds the boss bar stays after a win (counts down to hiding it). */
  private winTimer = 0;
  private won = false;

  constructor(private readonly host: EncounterHost) {}

  get cutscenePlaying(): boolean {
    return this.playing;
  }

  get fighting(): boolean {
    return this.boss !== null && !this.won;
  }

  /** The player walked into a trigger: maybe a boss fight starts here. */
  onTrigger(triggerId: string): void {
    const enemies = this.host.enemies();
    if (!enemies || this.boss || this.playing) return;
    for (const e of enemies.bosses) {
      if (e.boss?.def.trigger !== triggerId) continue;
      if (this.canFight(e)) this.begin(e);
      return;
    }
  }

  /** Debug: fights `monsterId` right away (no quest needed; the cutscene plays if unseen). */
  forceStart(monsterId: string): boolean {
    const e = this.host.enemies()?.bossOf(monsterId);
    if (!e || this.boss || this.playing) return false;
    this.begin(e);
    return true;
  }

  /** Called every fixed step: the boss bar, and the end of a won fight. */
  step(dt: number): void {
    const boss = this.boss;
    const hud = this.host.hud();
    if (!boss || !hud) return;
    hud.setBossHp(boss.maxHp > 0 ? boss.hp / boss.maxHp : 0);
    if (!this.won && !boss.alive) this.win(boss);
    if (!this.won) return;
    this.winTimer -= dt;
    if (this.winTimer <= 0 && !boss.active) this.finish();
  }

  /** The boss warns, opens up or gets angry: tips (once each) and its lines. */
  onBossEvent(e: Enemy, kind: BossEventKind, attack: BossAttack | null): void {
    const def = e.boss?.def;
    if (!def || e !== this.boss) return;
    if (kind === 'telegraph' && attack?.hint) this.hintOnce(attack.hint);
    else if (kind === 'opening' && def.strikeHint) this.hintOnce(def.strikeHint);
    else if (kind === 'enraged' && def.enrageLine) this.say(e, def.enrageLine);
  }

  /** The player hit the boss while it was guarded: "Dodged!", and the first time a tip. */
  onGuardedHit(e: Enemy, top: number): void {
    const def = e.boss?.def;
    if (!def) return;
    this.host.floatText(e.x, top, e.z, this.host.ctx.i18n.t(def.guardText));
    if (def.guardHint) this.hintOnce(def.guardHint);
  }

  /** The fight ends without a winner (the player died, or teleported away): the boss leaves. */
  abort(): void {
    if (!this.boss || this.won) return;
    this.host.enemies()?.endBoss(this.boss);
    this.finish();
  }

  dispose(): void {
    this.playing = false;
    this.boss = null;
    this.arena = null;
    this.hidden.clear();
  }

  private canFight(e: Enemy): boolean {
    const def = e.boss?.def;
    const book = this.host.quests();
    const session = this.host.ctx.session;
    if (!def || !book || !session?.character || !this.host.canStart()) return false;
    const status = book.status(def.quest, session.progress.level, session.character.inventory);
    return status === 'available' || status === 'active';
  }

  private begin(e: Enemy): void {
    const def = e.boss?.def;
    const session = this.host.ctx.session;
    if (!def || !session) return;
    const book = this.host.quests();
    if (book?.accept(def.quest)) this.host.questStarted(def.quest);
    const cutscene = this.host.ctx.data?.cutscenes.cutscenes.find((c) => c.id === def.cutscene);
    if (!cutscene || !shouldPlayCutscene(cutscene, session.seenCutscenes)) {
      this.startFight(e, true);
      return;
    }
    // The stage for the cutscene: you stand where the fight starts, and Pringle is out of
    // the world (the cutscene shows its own Pringle, who becomes Sultan).
    this.stageFor(e);
    this.playing = this.host.playCutscene(cutscene, () => {
      this.playing = false;
      this.startFight(e, false);
    });
    if (!this.playing) this.startFight(e, false);
  }

  /** Player at the start of the fight facing the boss; who the boss was is hidden. */
  private stageFor(e: Enemy): void {
    const def = e.boss?.def;
    if (!def) return;
    this.hidden.clear();
    if (e.def.transformsFrom) this.hidden.add(e.def.transformsFrom);
    this.host.setHiddenNpcs(this.hidden);
    const p = def.playerStart;
    this.host.placePlayer(p.x, p.z, Math.atan2(def.start.x - p.x, def.start.z - p.z));
  }

  private startFight(e: Enemy, rematch: boolean): void {
    const def = e.boss?.def;
    const enemies = this.host.enemies();
    const hud = this.host.hud();
    if (!def || !enemies || !hud) return;
    this.boss = e;
    this.won = false;
    this.arena = def.arena;
    this.hidden.clear();
    if (e.def.transformsFrom) this.hidden.add(e.def.transformsFrom);
    this.host.setHiddenNpcs(this.hidden);
    const p = def.playerStart;
    const toBoss = Math.atan2(def.start.x - p.x, def.start.z - p.z);
    this.host.placePlayer(p.x, p.z, toBoss);
    enemies.startBoss(e, toBoss + Math.PI);
    hud.setBoss(e.def.name);
    if (rematch && def.retryLine) this.say(e, def.retryLine);
  }

  private win(e: Enemy): void {
    const def = e.boss?.def;
    const hud = this.host.hud();
    if (!def || !hud) return;
    this.won = true;
    this.winTimer = WIN_BAR_SECONDS;
    this.arena = null;
    this.say(e, def.winLine);
    const t = this.host.ctx.i18n;
    if (def.victory) {
      const sub = def.victory.subtitle;
      hud.showVictory(t.t(def.victory.title), sub ? t.t(sub) : null, VICTORY_SECONDS);
    } else {
      hud.showMessage(t.t('boss.defeated', { name: e.def.name }));
    }
  }

  /** The fight is over (won or lost): bar gone, ring gone, hidden NPCs back (if present). */
  private finish(): void {
    this.boss = null;
    this.arena = null;
    this.won = false;
    this.hidden.clear();
    this.host.setHiddenNpcs(this.hidden);
    this.host.hud()?.setBoss(null);
  }

  private say(e: Enemy, key: string): void {
    this.host.hud()?.say(e.def.name, this.host.ctx.i18n.t(key), LINE_SECONDS);
  }

  /** Shows a tip the first time only (remembered in the save). */
  private hintOnce(key: string): void {
    const session = this.host.ctx.session;
    if (!session || session.seenHints.includes(key)) return;
    session.seenHints.push(key);
    const i18n = this.host.ctx.i18n;
    const touchKey = `${key}Touch`;
    const text = this.host.usesTouch() && i18n.has(touchKey) ? i18n.t(touchKey) : i18n.t(key);
    this.host.hud()?.showHint(text, HINT_SECONDS);
  }
}
