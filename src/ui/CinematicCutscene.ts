import type { AnimatedModels } from '../render/AnimatedNpcs';
import type { Object3D, PerspectiveCamera } from 'three';
import { numberToHex, resolveColorToken } from '../render/palette';
import { CinematicStage, type WeaponPoser } from '../render/cinematic/CinematicStage';
import {
  type ActorPose,
  barHeight,
  type CinematicSample,
  type CinematicSettings,
  CinematicTimeline,
  type CutsceneDef,
  newPose,
  newSample,
} from '../render/cinematic/CinematicTimeline';
import { el } from './dom';
import { SkipRing } from './SkipRing';

/** How much color a freeze-frame takes away (0–1): most, not all. */
const STILL_STRENGTH = 0.8;

/** What a cinematic needs from the scene it plays in. */
export interface CinematicHost {
  /** Where the actors are added (the world root, in world coordinates). */
  parent: Object3D;
  /** The player's own model (player.glb in Greyhaven), or null. */
  playerRoot: Object3D | null;
  /** Where the player stands now: the `player` actor starts there. */
  player: { x: number; z: number; heading: number };
  /** Height of the ground at (x, z). */
  ground(x: number, z: number): number;
  t(key: string): string;
  /** Touch screen: the skip button says "hold" instead of "hold Esc". */
  touch: boolean;
  /** The color of the player's crystal (actors with `color: "element"`). */
  element: number;
  /** Sets how the player holds the weapon (shots with a `pose`), or null. */
  poseWeapon: WeaponPoser | null;
  /** The game's canvas: a freeze-frame takes the color out of it (a CSS filter), or null. */
  canvas: HTMLElement | null;
  /** All sound falls away (`silence` shots) and comes back. A hook: there is no audio yet. */
  silence?(on: boolean): void;
  /** Real animated models for placeholders that have one (Pringle), or null. */
  animated?: AnimatedModels | null;
  /** The scene's own object for a `fight` actor (a foe of the fight, by actor id), or null. */
  objectFor?(actorId: string): Object3D | null;
  /**
   * Where an actor stands before the first shot (after a fight: where it left everyone), or
   * null for the usual start (the player where they are, everyone else unseen at the anchor).
   */
  actorStart?(actorId: string): { x: number; z: number; heading: number; visible: boolean } | null;
}

/**
 * A cutscene filmed in the 3D world, like Elden Ring (`type: "cinematic"` in cutscenes.json):
 * the camera moves through shots, actors appear, walk, leap and turn, subtitles, fades,
 * flashes, shakes and a boss name card play over it, and black bars slide in at the start
 * and out at the end. The HUD is hidden meanwhile (the caller does that).
 *
 * The timeline runs on the game's fixed step (`step`), so 60 and 120 fps play exactly the
 * same; `render` only draws the moment between the last two steps. Skipping means holding
 * Escape or the skip button for a moment (a ring fills up), so a stray tap never skips.
 */
export class CinematicCutscene {
  readonly root: HTMLElement;
  private readonly timeline: CinematicTimeline;
  private readonly stage: CinematicStage;
  private readonly sample: CinematicSample;
  private finished = false;
  private camera: PerspectiveCamera | null = null;
  private gameFov = 0;

  private readonly barTop: HTMLElement;
  private readonly barBottom: HTMLElement;
  private readonly fadeLayer: HTMLElement;
  private readonly flashLayer: HTMLElement;
  private readonly tintLayer: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly speaker: HTMLElement;
  private readonly line: HTMLElement;
  private readonly narration: HTMLElement;
  private readonly nameCard: HTMLElement;
  private readonly nameText: HTMLElement;
  private readonly nameTitle: HTMLElement;
  private readonly skip: SkipRing;

  // What the DOM shows now (only touched when it changes).
  private shownShot = -1;
  private shownBar = -1;
  private shownFade = -1;
  private shownFlash = -1;
  private shownTint = -1;
  private shownStill = -1;
  private shownSlow = false;
  private shownSilent = false;
  private shownFov = Number.NaN;

  constructor(
    private readonly cutscene: CutsceneDef,
    private readonly settings: CinematicSettings,
    private readonly host: CinematicHost,
    private readonly onDone: (skipped: boolean) => void,
  ) {
    const actors = cutscene.actors ?? [];
    const initial: ActorPose[] = actors.map((actor) => {
      const pose = newPose();
      const start = host.actorStart?.(actor.id) ?? null;
      if (start) {
        // The scene knows where it stands (after the fight: where that left everyone).
        pose.visible = start.visible;
        pose.x = start.x;
        pose.z = start.z;
        pose.heading = start.heading;
      } else if (actor.model === 'player') {
        pose.visible = true;
        pose.x = host.player.x;
        pose.z = host.player.z;
        pose.heading = host.player.heading;
      } else if (cutscene.anchor) {
        pose.x = cutscene.anchor.x;
        pose.z = cutscene.anchor.z;
      }
      return pose;
    });
    this.timeline = new CinematicTimeline(cutscene, settings, initial, host.ground);
    this.sample = newSample(actors.length);
    this.stage = new CinematicStage(
      actors,
      host.parent,
      host.playerRoot,
      host.element,
      host.poseWeapon,
      host.animated ?? null,
      host.objectFor ? (actorId) => host.objectFor?.(actorId) ?? null : null,
    );
    const label = host.t(host.touch ? 'cutscene.holdToSkipTouch' : 'cutscene.holdToSkip');
    this.skip = new SkipRing(settings, label, cutscene.skippable);

    this.tintLayer = el('div', { className: 'ui-cine-layer ui-cine-tint' });
    this.fadeLayer = el('div', { className: 'ui-cine-layer ui-cine-fade' });
    this.flashLayer = el('div', { className: 'ui-cine-layer ui-cine-flash' });
    this.barTop = el('div', { className: 'ui-cine-bar ui-cine-bar-top' });
    this.barBottom = el('div', { className: 'ui-cine-bar ui-cine-bar-bottom' });
    this.speaker = el('span', { className: 'ui-cine-speaker' });
    this.line = el('span', { className: 'ui-cine-line' });
    this.subtitle = el('p', { className: 'ui-cine-subtitle' }, this.speaker, this.line);
    this.narration = el('p', { className: 'ui-cine-narration' });
    this.nameText = el('p', { className: 'ui-cine-name' });
    this.nameTitle = el('p', { className: 'ui-cine-name-title' });
    this.nameCard = el('div', { className: 'ui-cine-namecard' }, this.nameText, this.nameTitle);

    this.root = el(
      'div',
      { className: 'ui-cine' },
      this.tintLayer,
      this.fadeLayer,
      this.barTop,
      this.barBottom,
      this.subtitle,
      this.narration,
      this.nameCard,
      this.flashLayer,
      this.skip.root,
    );
  }

  get id(): string {
    return this.cutscene.id;
  }

  /** One fixed step: the timeline moves on, holding skip fills the ring. */
  step(dt: number): void {
    if (this.finished) return;
    if (this.skip.step(dt)) {
      this.end(true);
      return;
    }
    this.timeline.step(dt);
    if (this.timeline.finished) this.end(false);
  }

  /**
   * Draws the moment between the last two steps: actors, the camera (world coordinates
   * shifted by the floating origin) and the overlay.
   */
  render(alpha: number, camera: PerspectiveCamera, originX: number, originZ: number): void {
    if (this.finished) return;
    if (this.camera !== camera) {
      this.camera = camera;
      this.gameFov = camera.fov;
      this.shownFov = camera.fov;
    }
    const t = this.timeline.renderTime(alpha);
    const s = this.sample;
    this.timeline.sample(t, s);
    this.stage.apply(s.actors, t);
    camera.position.set(s.camX - originX, s.camY, s.camZ - originZ);
    camera.lookAt(s.lookX - originX, s.lookY, s.lookZ - originZ);
    const fov = Number.isNaN(s.fov) ? this.gameFov : s.fov;
    if (Math.abs(fov - this.shownFov) > 1e-3) {
      this.shownFov = fov;
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    this.drawOverlay(s);
  }

  dispose(): void {
    this.skip.dispose();
    const camera = this.camera;
    if (camera && camera.fov !== this.gameFov) {
      camera.fov = this.gameFov;
      camera.updateProjectionMatrix();
    }
    this.stage.dispose();
    if (this.shownSilent) this.host.silence?.(false);
    if (this.host.canvas) this.host.canvas.style.filter = '';
    this.root.remove();
  }

  private drawOverlay(s: CinematicSample): void {
    if (s.shot !== this.shownShot) this.showShot(s.shot);
    const cfg = this.settings;
    const bar = Math.round(
      barHeight(
        this.root.clientWidth,
        this.root.clientHeight,
        cfg.barsAspect,
        cfg.barsMinFraction,
        cfg.barsMaxFraction,
      ) * s.bars,
    );
    if (bar !== this.shownBar) {
      this.shownBar = bar;
      this.barTop.style.height = `${bar}px`;
      this.barBottom.style.height = `${bar}px`;
      this.root.style.setProperty('--cine-bar', `${bar}px`);
    }
    this.shownFade = setOpacity(this.fadeLayer, s.fade, this.shownFade);
    this.shownFlash = setOpacity(this.flashLayer, s.flash, this.shownFlash);
    this.shownTint = setOpacity(this.tintLayer, s.tint, this.shownTint);
    // A freeze-frame: the 3D picture itself loses most of its color (the overlay sits in its
    // own layer, so a blend mode there would not reach the canvas).
    const still = Math.round(s.still * 20) / 20;
    if (still !== this.shownStill && this.host.canvas) {
      this.shownStill = still;
      this.host.canvas.style.filter =
        still > 0 ? `saturate(${1 - STILL_STRENGTH * still}) contrast(${1 + 0.12 * still})` : '';
    }
    if (s.slow !== this.shownSlow) {
      this.shownSlow = s.slow;
      this.root.classList.toggle('ui-cine-slow', s.slow);
    }
    if (s.silent !== this.shownSilent) {
      this.shownSilent = s.silent;
      this.host.silence?.(s.silent);
    }
    this.skip.draw();
  }

  /** A new shot: its subtitle, name card and tint color. */
  private showShot(index: number): void {
    this.shownShot = index;
    const shot = this.timeline.shotDef(index);
    // Which shot is on screen (handy for tests and for looking at it in the browser).
    this.root.dataset.shot = shot?.id ?? '';
    const sub = shot?.subtitle;
    if (sub) {
      this.speaker.textContent = sub.speaker;
      this.line.textContent = this.host.t(sub.text);
    }
    this.subtitle.classList.toggle('ui-cine-on', sub !== undefined);
    const narration = shot?.narration;
    if (narration) this.narration.textContent = this.host.t(narration);
    this.narration.classList.toggle('ui-cine-on', narration !== undefined);
    const card = shot?.nameCard;
    if (card) {
      this.nameText.textContent = card.name;
      this.nameTitle.textContent = card.title ? this.host.t(card.title) : '';
      this.nameTitle.hidden = !card.title;
    }
    this.nameCard.classList.toggle('ui-cine-on', card !== undefined);
    if (shot?.tint) {
      this.tintLayer.style.background = numberToHex(resolveColorToken(shot.tint.color));
    }
  }

  private end(skipped: boolean): void {
    if (this.finished) return;
    this.finished = true;
    this.dispose();
    this.onDone(skipped);
  }
}

/** Sets an element's opacity when it changed enough; returns what is shown now. */
function setOpacity(element: HTMLElement, value: number, shown: number): number {
  const v = Math.round(value * 100) / 100;
  if (v === shown) return shown;
  element.style.opacity = String(v);
  return v;
}
