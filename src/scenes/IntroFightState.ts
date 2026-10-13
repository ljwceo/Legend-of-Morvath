import {
  CircleGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  Fog,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type { GameContext } from '../core/GameContext';
import { Input, type LookDelta } from '../core/Input';
import { Random } from '../core/Random';
import type { GameState } from '../core/StateMachine';
import type { GameData } from '../data/types';
import { buildLord, type LordModel } from '../entities/LordFactory';
import { Player } from '../entities/Player';
import { CameraRig } from '../render/CameraRig';
import { palette, resolveColorToken } from '../render/palette';
import {
  applyStats,
  inSwingArc,
  type SwordConfig,
  type SwordInput,
  type SwordResult,
  stepSword,
  swordConfig,
} from '../systems/Combat';
import { type FightAction, type FightDef, FightScript } from '../systems/FightScript';
import {
  type Mover,
  type MoveCommand,
  type MovementConfig,
  movementConfig,
  screenToWorld,
  stepMovement,
} from '../systems/Movement';
import { DamageNumbers } from '../ui/DamageNumbers';
import { button, el } from '../ui/dom';
import { TouchControls } from '../ui/TouchControls';
import { readTouchSettings } from '../ui/TouchLayout';
import type { PointXZ } from '../world/Colliders';
import { normalizeAppearance } from './creator';

/** How far behind the player (m) a teleporting foe appears. */
const BEHIND_DISTANCE = 1.8;
/** Levitation: height (m) and spin (radians per second). */
const LEVITATE_HEIGHT = 2.4;
const LEVITATE_SPIN = 9;
/** Size (m) the spell orb grows to, and how long the white flash and the black fade take. */
const ORB_SIZE = 1.4;
const FLASH_SECONDS = 0.35;
const FADE_SECONDS = 1.4;
/** Seconds the purple teleport puff stays. */
const PUFF_SECONDS = 0.5;
/** The camera never goes higher than this above the arena floor. */
const FLAT = { heightAt: () => 0 };

interface Foe {
  readonly id: string;
  readonly homeX: number;
  readonly homeZ: number;
  readonly name: string;
  readonly model: LordModel;
  readonly radius: number;
  x: number;
  z: number;
  heading: number;
  /** Seconds of the "unimpressed" shimmer after being hit. */
  shimmer: number;
}

/** Keeps a walking circle inside the round arena. */
class ArenaMover implements Mover {
  constructor(private readonly radius: number) {}

  moveCircle(p: PointXZ, radius: number, dx: number, dz: number): void {
    p.x += dx;
    p.z += dz;
    const max = this.radius - radius;
    const d = Math.hypot(p.x, p.z);
    if (d > max) {
      p.x *= max / d;
      p.z *= max / d;
    }
  }
}

/**
 * The playable panel of the intro: you stand at the border of Morvath, facing Lucael and
 * Baelor. You can walk, dash and swing your sword, but every hit does 0 damage. The script
 * from cutscenes.json (`fights`) plays their jokes: speech, teleporting behind you, freezing
 * time, lifting you up and spinning you, and finally one spell that blows you away. Then the
 * intro continues with the next panel. Skip (or Escape) ends the fight at once.
 *
 * Everything runs on the fixed step like the world; effects are only drawn.
 */
export class IntroFightState implements GameState {
  private scene: Scene | null = null;
  private rig: CameraRig | null = null;
  private player: Player | null = null;
  private foes: Foe[] = [];
  private script: FightScript | null = null;
  private fight: FightDef | null = null;
  private input: Input | null = null;
  private touch: TouchControls | null = null;
  private damageNumbers: DamageNumbers | null = null;
  private mover: ArenaMover | null = null;
  private movement: MovementConfig | null = null;
  private sword: SwordConfig | null = null;
  private orb: Mesh | null = null;
  private puff: Mesh | null = null;
  private spikes: InstancedMesh | null = null;

  private root: HTMLElement | null = null;
  private surface: HTMLElement | null = null;
  private subtitle: HTMLElement | null = null;
  private subtitleName: HTMLElement | null = null;
  private subtitleText: HTMLElement | null = null;
  private hint: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;

  private subtitleLeft = 0;
  private hintLeft = 0;
  private freezeLeft = 0;
  private levitateLeft = 0;
  private levitateTotal = 1;
  private spellLeft = 0;
  private spellTotal = 1;
  private spellFoe: Foe | null = null;
  private puffLeft = 0;
  /** After the spell: seconds of white flash and fade to black before the intro continues. */
  private endLeft = -1;
  private time = 0;
  private panelIndex = 0;

  private readonly moveInput = { x: 0, y: 0 };
  private readonly moveWorld = { x: 0, z: 0 };
  private readonly command: MoveCommand = { x: 0, z: 0, dash: false };
  private readonly swordInput: SwordInput = { fast: false, heavy: false, critRoll: 1 };
  private readonly swordResult: SwordResult = {
    landed: 'none',
    damage: 0,
    combo: false,
    crit: false,
  };
  private readonly look: LookDelta = { yaw: 0, pitch: 0, zoom: 1 };
  private readonly handPoint = new Vector3();

  constructor(private readonly ctx: GameContext) {}

  enter(): void {
    const { ctx } = this;
    const data = ctx.data;
    const intro = data?.cutscenes.cutscenes.find((entry) => entry.id === 'intro');
    this.panelIndex = ctx.introPanel;
    const fightId = intro?.panels?.[this.panelIndex]?.fight;
    const fight = data?.cutscenes.fights.find((entry) => entry.id === fightId);
    if (!data || !fight) {
      ctx.reportProblem(`intro fight for panel ${this.panelIndex} missing`);
      this.finish();
      return;
    }
    this.fight = fight;
    this.time = 0;
    this.endLeft = -1;
    this.subtitleLeft = this.hintLeft = this.freezeLeft = this.levitateLeft = 0;
    this.spellLeft = this.puffLeft = 0;
    this.spellFoe = null;
    this.buildUi(data);
    this.buildScene(data, fight);
    this.script = new FightScript(fight.beats, (action) => this.onAction(action));
    window.addEventListener('keydown', this.onKeyDown);
  }

  exit(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.input?.detach();
    this.input = null;
    this.touch?.dispose();
    this.touch = null;
    this.damageNumbers?.dispose();
    this.damageNumbers = null;
    this.root?.remove();
    this.root = this.surface = this.subtitle = this.subtitleName = this.subtitleText = null;
    this.hint = this.overlay = null;
    this.ctx.renderer.setCamera(null);
    this.player?.dispose();
    this.player = null;
    for (const foe of this.foes) foe.model.dispose();
    this.foes = [];
    this.spikes?.dispose();
    this.spikes = null;
    this.scene?.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        (object.material as MeshLambertMaterial).dispose();
      }
    });
    this.scene?.clear();
    this.scene = null;
    this.rig = null;
    this.orb = this.puff = null;
    this.script = null;
    this.fight = null;
  }

  update(dt: number): void {
    const { player, input, mover, movement, sword, script, rig } = this;
    if (!player || !input || !mover || !movement || !sword || !script || !rig) return;
    if (document.hidden) return;
    this.time += dt;
    const s = player.state;
    player.beginStep();

    const helpless = this.freezeLeft > 0 || this.levitateLeft > 0 || this.endLeft >= 0;
    input.getMoveVector(this.moveInput);
    screenToWorld(this.moveInput.x, this.moveInput.y, rig.orbit.yaw, this.moveWorld);
    this.command.x = helpless ? 0 : this.moveWorld.x;
    this.command.z = helpless ? 0 : this.moveWorld.z;
    this.command.dash = input.consumePressed('dash') && !helpless;
    input.consumePressed('confirm');
    const fast = input.consumePressed('attack') || input.isPressed('attack');
    const heavy = input.consumePressed('heavy');
    this.swordInput.fast = fast && !helpless;
    this.swordInput.heavy = heavy && !helpless;

    if (this.levitateLeft <= 0) {
      // Frozen in time: nothing about you moves, not even your sword.
      if (this.freezeLeft <= 0) {
        const result = stepSword(player.combat, s, this.swordInput, sword, dt, this.swordResult);
        if (result.landed !== 'none') this.landHit();
      }
      stepMovement(s, this.command, movement, dt, mover);
      this.pushOutOfFoes();
    } else {
      s.heading += LEVITATE_SPIN * dt;
    }

    script.step(dt);
    this.stepEffects(dt);
    for (const foe of this.foes) {
      foe.heading = Math.atan2(s.x - foe.x, s.z - foe.z);
      if (foe.shimmer > 0) foe.shimmer = Math.max(0, foe.shimmer - dt);
    }
    // A script without a final spell still ends.
    if (script.finished && this.spellLeft <= 0 && this.endLeft < 0) this.endLeft = FADE_SECONDS;
  }

  render(alpha: number, frameSeconds: number): void {
    const { scene, rig, player, input } = this;
    if (!scene || !rig || !player || !input) return;
    const s = player.state;
    player.syncModel(alpha);
    if (this.sword) player.showSword(this.sword);
    const root = player.model.root;
    if (this.levitateLeft > 0) {
      const t = 1 - this.levitateLeft / this.levitateTotal;
      root.position.y = Math.sin(Math.min(1, t * 1.2) * Math.PI) * LEVITATE_HEIGHT;
    }

    for (const foe of this.foes) {
      const r = foe.model.root;
      // Lucael floats playfully; Baelor stands still and serious.
      const bob = foe.id === 'lucael' ? Math.sin(this.time * 2.2) * 0.12 + 0.1 : 0;
      r.position.set(foe.x, bob, foe.z);
      r.rotation.y = foe.heading;
      r.rotation.z = foe.shimmer > 0 ? Math.sin(foe.shimmer * 40) * 0.03 : 0;
    }
    this.drawSpell();
    this.drawPuff();

    input.consumeLook(this.look);
    const turning = input.turningCamera || this.look.yaw !== 0 || this.look.pitch !== 0;
    rig.orbit.update(
      frameSeconds,
      root.position.x,
      root.position.y,
      root.position.z,
      s.heading,
      s.moving,
      this.look,
      turning,
      this.ctx.session?.settings.cameraSensitivity ?? 1,
    );
    rig.apply(0, 0, FLAT);
    this.touch?.update();
    this.damageNumbers?.update(
      frameSeconds,
      rig.camera,
      0,
      0,
      window.innerWidth,
      window.innerHeight,
    );
    this.ctx.renderer.render(scene, rig.camera);
  }

  // ------------------------------------------------------------ script actions

  private onAction(action: FightAction): void {
    const t = this.ctx.i18n.t.bind(this.ctx.i18n);
    const foe = this.foes.find((entry) => entry.id === action.foe) ?? null;
    const seconds = action.seconds ?? 0;
    switch (action.type) {
      case 'say':
        if (!foe || !action.text) return;
        this.say(foe.name, t(action.text), seconds);
        return;
      case 'hint': {
        if (!action.text || !this.hint) return;
        const touchKey = `${action.text}Touch`;
        const touch = this.input?.usedTouch || window.matchMedia('(pointer: coarse)').matches;
        this.hint.textContent = touch && this.ctx.i18n.has(touchKey) ? t(touchKey) : t(action.text);
        this.hint.classList.add('ui-fight-show');
        this.hintLeft = seconds;
        return;
      }
      case 'teleportBehind':
        if (foe) this.teleportBehind(foe);
        return;
      case 'teleportHome':
        if (foe) {
          this.showPuff(foe.x, foe.z);
          foe.x = foe.homeX;
          foe.z = foe.homeZ;
        }
        return;
      case 'freezeTime':
        this.freezeLeft = seconds;
        this.overlay?.classList.add('ui-fight-frozen');
        return;
      case 'levitate':
        this.levitateLeft = this.levitateTotal = seconds;
        return;
      case 'spell':
        this.spellLeft = this.spellTotal = seconds;
        this.spellFoe = foe;
        this.faceFoe(foe);
        return;
    }
  }

  /** Turns the player and the camera towards a foe (for the big moments). */
  private faceFoe(foe: Foe | null): void {
    const s = this.player?.state;
    const orbit = this.rig?.orbit;
    if (!foe || !s || !orbit) return;
    s.heading = Math.atan2(foe.x - s.x, foe.z - s.z);
    orbit.yaw = s.heading;
    orbit.pitch = (this.ctx.data?.player.camera.pitchDegrees ?? 12) * (Math.PI / 180);
  }

  private say(name: string, text: string, seconds: number): void {
    if (!this.subtitle || !this.subtitleName || !this.subtitleText) return;
    this.subtitleName.textContent = name;
    this.subtitleText.textContent = text;
    this.subtitle.classList.add('ui-fight-show');
    this.subtitleLeft = seconds;
  }

  private teleportBehind(foe: Foe): void {
    const s = this.player?.state;
    if (!s) return;
    this.showPuff(foe.x, foe.z);
    foe.x = s.x - Math.sin(s.heading) * BEHIND_DISTANCE;
    foe.z = s.z - Math.cos(s.heading) * BEHIND_DISTANCE;
  }

  private stepEffects(dt: number): void {
    if (this.subtitleLeft > 0) {
      this.subtitleLeft -= dt;
      if (this.subtitleLeft <= 0) this.subtitle?.classList.remove('ui-fight-show');
    }
    if (this.hintLeft > 0) {
      this.hintLeft -= dt;
      if (this.hintLeft <= 0) this.hint?.classList.remove('ui-fight-show');
    }
    if (this.freezeLeft > 0) {
      this.freezeLeft -= dt;
      if (this.freezeLeft <= 0) this.overlay?.classList.remove('ui-fight-frozen');
    }
    if (this.levitateLeft > 0) {
      this.levitateLeft -= dt;
      if (this.levitateLeft <= 0) {
        // Dropped back on the ground, a little dizzy, facing the brothers again.
        const s = this.player?.state;
        if (s) s.heading = Math.atan2(-s.x, -s.z);
      }
    }
    if (this.puffLeft > 0) this.puffLeft = Math.max(0, this.puffLeft - dt);
    if (this.spellLeft > 0) {
      this.spellLeft -= dt;
      if (this.spellLeft <= 0) {
        this.endLeft = FLASH_SECONDS + FADE_SECONDS;
        this.overlay?.classList.add('ui-fight-flash');
      }
    }
    if (this.endLeft >= 0) {
      this.endLeft -= dt;
      if (this.endLeft < FADE_SECONDS) this.overlay?.classList.add('ui-fight-black');
      if (this.endLeft <= 0) this.finish();
    }
  }

  // ------------------------------------------------------------ fighting

  /** Every swing that reaches a brother "hits" for 0 damage. The script counts the hits. */
  private landHit(): void {
    const { player, sword, script } = this;
    if (!player || !sword || !script) return;
    const s = player.state;
    for (const foe of this.foes) {
      if (!inSwingArc(s.x, s.z, s.heading, foe.x, foe.z, foe.radius, sword.range, sword.halfArc)) {
        continue;
      }
      foe.shimmer = 0.3;
      const top = this.fight?.foes.find((f) => f.id === foe.id)?.height ?? 3.5;
      this.damageNumbers?.spawn(foe.x, top, foe.z, 0, 'normal');
      script.registerHit();
    }
  }

  private pushOutOfFoes(): void {
    const s = this.player?.state;
    const radius = this.movement?.radius ?? 0.4;
    if (!s) return;
    for (const foe of this.foes) {
      const min = radius + foe.radius;
      const dx = s.x - foe.x;
      const dz = s.z - foe.z;
      const d = Math.hypot(dx, dz);
      if (d >= min || d < 1e-6) continue;
      s.x = foe.x + (dx / d) * min;
      s.z = foe.z + (dz / d) * min;
    }
  }

  // ------------------------------------------------------------ drawing effects

  private drawSpell(): void {
    const orb = this.orb;
    if (!orb) return;
    const foe = this.spellFoe;
    if (!foe || (this.spellLeft <= 0 && this.endLeft < 0)) {
      orb.visible = false;
      return;
    }
    foe.model.hand.getWorldPosition(this.handPoint);
    const t = this.spellLeft > 0 ? 1 - this.spellLeft / this.spellTotal : 1;
    orb.visible = true;
    orb.position.copy(this.handPoint);
    orb.position.y += t * 0.6;
    orb.scale.setScalar(0.1 + t * t * ORB_SIZE + Math.sin(this.time * 30) * 0.03);
  }

  private showPuff(x: number, z: number): void {
    if (!this.puff) return;
    this.puff.position.set(x, 1.6, z);
    this.puffLeft = PUFF_SECONDS;
  }

  private drawPuff(): void {
    const puff = this.puff;
    if (!puff) return;
    puff.visible = this.puffLeft > 0;
    if (!puff.visible) return;
    const t = 1 - this.puffLeft / PUFF_SECONDS;
    puff.scale.setScalar(0.4 + t * 2.2);
    (puff.material as MeshBasicMaterial).opacity = 0.8 * (1 - t);
  }

  // ------------------------------------------------------------ building

  private buildUi(data: GameData): void {
    const { ctx } = this;
    const t = ctx.i18n.t.bind(ctx.i18n);
    this.surface = el('div', { className: 'ui-world-input' });
    this.subtitleName = el('div', { className: 'ui-dialog-name' });
    this.subtitleText = el('p', { className: 'ui-dialog-text' });
    this.subtitle = el(
      'div',
      { className: 'ui-fight-subtitle', attrs: { 'aria-live': 'polite' } },
      this.subtitleName,
      this.subtitleText,
    );
    this.hint = el('div', { className: 'ui-fight-hint' });
    this.overlay = el('div', { className: 'ui-fight-overlay' });
    const skip = button(t('intro.fight.skip'), () => this.finish());
    skip.classList.add('ui-skip');
    this.root = el(
      'div',
      { className: 'ui-fight' },
      this.surface,
      this.subtitle,
      this.hint,
      skip,
      this.overlay,
    );
    ctx.ui.append(this.root);

    const camera = data.player.camera;
    const controls = data.player.controls;
    this.input = new Input(
      this.surface,
      {
        joystickRadiusPx: controls.joystickRadiusPx,
        joystickDeadZone: controls.joystickDeadZone,
        joystickZoneWidth: controls.touch.dividerFraction,
        joystickZoneTop: controls.touch.joystickZoneTopFraction,
        rotateRadiansPerPixelMouse: camera.rotateRadiansPerPixelMouse,
        rotateRadiansPerPixelTouch: camera.rotateRadiansPerPixelTouch,
        zoomStepPerWheelNotch: camera.zoomStepPerWheelNotch,
      },
      this.ctx.bindings,
    );
    this.input.attach();
    this.touch = new TouchControls(
      this.input,
      {
        attack: t('controls.attack'),
        heavy: t('controls.heavy'),
        dash: t('controls.dash'),
        potion: t('controls.potion'),
        lock: t('controls.lock'),
      },
      controls.joystickRadiusPx,
      controls.touch,
    );
    this.touch.setSettings(readTouchSettings(this.ctx.session?.settings, controls.touch));
    // Nothing to lock on to in the intro fight (you cannot win it anyway).
    this.touch.setLockVisible(false);
    this.root.insertBefore(this.touch.root, skip);
    this.damageNumbers = new DamageNumbers();
    this.root.insertBefore(this.damageNumbers.root, this.subtitle);
  }

  private buildScene(data: GameData, fight: FightDef): void {
    const arena = fight.arena;
    const fogColor = resolveColorToken(arena.fogColor);
    const scene = new Scene();
    scene.background = new Color(fogColor);
    scene.fog = new Fog(fogColor, arena.radius * 0.6, arena.radius * 2.6);
    scene.add(new HemisphereLight(palette.mistpaars, palette.nachtinkt, 1.6));
    const sun = new DirectionalLight(palette.spreukviolet, 1.6);
    sun.position.set(-3, 5, 2);
    scene.add(sun);

    const ground = new Mesh(
      new CircleGeometry(arena.radius * 3, 48),
      new MeshLambertMaterial({ color: resolveColorToken(arena.groundColor) }),
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // Dead crystal spikes around the edge (always the same, from a fixed seed).
    if (arena.spikes > 0) {
      const spikes = new InstancedMesh(
        new ConeGeometry(0.35, 2.2, 5),
        new MeshLambertMaterial({ color: palette.schemerviolet }),
        arena.spikes,
      );
      const random = new Random(7);
      const matrix = new Matrix4();
      const rotation = new Quaternion();
      const position = new Vector3();
      const scale = new Vector3();
      const axis = new Vector3(0, 0, 1);
      for (let i = 0; i < arena.spikes; i++) {
        const angle = random.next() * Math.PI * 2;
        const distance = arena.radius * (0.95 + random.next() * 0.5);
        const size = 0.6 + random.next() * 1.4;
        rotation.setFromAxisAngle(
          axis.set(random.next() - 0.5, 0, random.next() - 0.5).normalize(),
          0.25,
        );
        position.set(Math.sin(angle) * distance, size, Math.cos(angle) * distance);
        matrix.compose(position, rotation, scale.set(size, size, size));
        spikes.setMatrixAt(i, matrix);
      }
      scene.add(spikes);
      this.spikes = spikes;
    }

    this.orb = new Mesh(
      new SphereGeometry(1, 20, 14),
      new MeshBasicMaterial({ color: palette.magieblauw }),
    );
    this.orb.visible = false;
    scene.add(this.orb);
    this.puff = new Mesh(
      new SphereGeometry(0.5, 12, 8),
      new MeshBasicMaterial({ color: palette.spreukviolet, transparent: true, depthWrite: false }),
    );
    this.puff.visible = false;
    scene.add(this.puff);

    this.foes = fight.foes.map((def) => {
      const model = buildLord(
        def.height,
        resolveColorToken(def.color),
        resolveColorToken(def.accent),
      );
      scene.add(model.root);
      return {
        id: def.id,
        homeX: def.x,
        homeZ: def.z,
        name: def.name,
        model,
        radius: def.radius,
        x: def.x,
        z: def.z,
        heading: 0,
        shimmer: 0,
      };
    });

    const session = this.ctx.session;
    const appearance = normalizeAppearance(
      session?.character?.appearance ?? data.appearance.defaults,
      data.appearance,
    );
    const player = new Player(data.appearance, appearance);
    const heading = Math.atan2(-fight.player.x, -fight.player.z);
    player.place(fight.player.x, 0, fight.player.z, heading);
    player.state.energy = data.player.base.energy;
    this.sword = swordConfig(data.player);
    player.combat.lingerSeconds = this.sword.combatLingerSeconds;
    applyStats(player.combat, data.player, 1);
    player.combat.hp = player.combat.maxHp;
    scene.add(player.model.root);
    this.player = player;
    this.movement = movementConfig(data.player);
    this.mover = new ArenaMover(arena.radius);

    this.rig = new CameraRig(data.player.camera, arena.radius * 4);
    this.rig.orbit.snap(player.state.x, 0, player.state.z, heading);
    this.rig.apply(0, 0, FLAT);
    this.ctx.renderer.setCamera(this.rig.camera);
    this.scene = scene;
  }

  /** On to the next intro panel (the fight is over or skipped). */
  private finish(): void {
    this.ctx.introPanel = this.panelIndex + 1;
    this.ctx.goto('intro');
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape' && !event.repeat) {
      event.preventDefault();
      this.finish();
    }
  };
}
