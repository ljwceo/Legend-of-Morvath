import {
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  TorusGeometry,
} from 'three';
import type { GameContext } from '../core/GameContext';
import { Random } from '../core/Random';
import type { GameState } from '../core/StateMachine';
import { CharacterModel } from '../entities/PlaceholderFactory';
import { palette } from '../render/palette';
import { CharacterCreator } from '../ui/CharacterCreator';
import { Screen } from '../ui/Screen';
import {
  normalizeStatPoints,
  presetPoints,
  randomStatPoints,
  type StatPoints,
} from '../systems/Stats';
import {
  type Appearance,
  createCharacter,
  normalizeAppearance,
  randomAppearance,
  withBodyType,
} from './creator';
import { startNewGame } from './flow';

/** Turntable speed in radians per second. */
const SPIN_SPEED = 0.5;
/** After the player let go, wait this long before the figure turns by itself again. */
const SPIN_RESUME_SECONDS = 2;
/** Radians per pixel dragged. */
const DRAG_SPEED = 0.012;
const FOV = 32;
/** Height (m) that must fit in the stage: the figure plus a little room. */
const FRAME_HEIGHT = 2.6;
/** Width (m) that must fit in the stage. */
const FRAME_WIDTH = 1.4;
const LOOK_AT_Y = 0.85;

/**
 * Character creator (New Game only): name, body type, hairstyle, hair, skin and mantle color,
 * and a Random button. The placeholder figure turns slowly in the middle and follows every
 * choice live; drag it to turn it yourself. Finishing starts the new save and the intro;
 * Back returns to the title screen and leaves the old save untouched.
 */
export class CharacterCreateState implements GameState {
  private readonly screen: Screen;
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.1, 50);
  private scene: Scene | null = null;
  private model: CharacterModel | null = null;
  private ui: CharacterCreator | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private appearance: Appearance | null = null;
  private points: StatPoints = {};
  private name = '';

  // Turntable (simulation state + previous step for interpolation).
  private yaw = 0;
  private prevYaw = 0;
  private idleSeconds = SPIN_RESUME_SECONDS;
  private dragPointer: number | null = null;
  private dragX = 0;

  constructor(private readonly ctx: GameContext) {
    this.screen = new Screen(ctx, 'ui-creator', () => this.ui?.build() ?? []);
  }

  enter(): void {
    const { ctx } = this;
    const data = ctx.data;
    if (!data) {
      ctx.goto('title');
      return;
    }
    this.appearance = normalizeAppearance(data.appearance.defaults, data.appearance);
    // A new character starts with nothing spent: every point is yours to place.
    this.points = normalizeStatPoints(data.stats, null, 1);
    this.name = '';
    this.yaw = this.prevYaw = 0;
    this.idleSeconds = SPIN_RESUME_SECONDS;

    const itemName = (id: string | undefined) =>
      data.items.items.find((item) => item.id === id)?.name ?? id ?? '';
    this.ui = new CharacterCreator(
      ctx,
      data.appearance,
      {
        weapon: itemName(data.player.start.equipment.weapon),
        mantle: itemName(data.player.start.equipment.mantle),
      },
      {
        change: (appearance) => this.apply(appearance),
        random: () => this.apply(randomAppearance(data.appearance, new Random(Date.now()))),
        changeStats: (points) => this.applyPoints(points),
        randomStats: () => {
          const random = new Random(Date.now());
          this.applyPoints(randomStatPoints(data.stats, 1, () => random.next()));
        },
        preset: (presetId) => this.applyPoints(presetPoints(data.stats, presetId, 1)),
        clearStats: () => this.applyPoints(normalizeStatPoints(data.stats, null, 1)),
        begin: (name) => this.begin(name),
        back: () => ctx.goto('title'),
      },
      this.appearance,
      this.points,
      this.name,
    );
    this.ui.onRebuild = () => this.screen.refresh();

    this.buildScene();
    this.model?.setAppearance(this.appearance);
    ctx.renderer.setCamera(this.camera);

    this.screen.mount();
    const root = this.screen.root;
    if (root) this.ui.attach(root);
    const stage = this.ui.stage;
    stage.addEventListener('pointerdown', this.onPointerDown);
    stage.addEventListener('pointermove', this.onPointerMove);
    stage.addEventListener('pointerup', this.onPointerUp);
    stage.addEventListener('pointercancel', this.onPointerUp);
    this.resizeObserver = new ResizeObserver(() => this.frameCamera());
    this.resizeObserver.observe(stage);
    window.addEventListener('resize', this.frameCamera);
    window.addEventListener('keydown', this.onKeyDown);
    this.frameCamera();
  }

  exit(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.frameCamera);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.ui?.detach();
    this.ui = null;
    this.screen.unmount();
    this.dragPointer = null;
    this.ctx.renderer.setCamera(null);
    this.camera.clearViewOffset();
    this.model?.dispose();
    this.model = null;
    this.scene?.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        (object.material as MeshLambertMaterial).dispose();
      }
    });
    this.scene?.clear();
    this.scene = null;
  }

  update(dt: number): void {
    this.prevYaw = this.yaw;
    if (this.dragPointer !== null) return;
    this.idleSeconds += dt;
    if (this.idleSeconds >= SPIN_RESUME_SECONDS) this.yaw += SPIN_SPEED * dt;
  }

  render(alpha: number): void {
    if (!this.scene || !this.model) return;
    this.model.root.rotation.y = this.prevYaw + (this.yaw - this.prevYaw) * alpha;
    this.ctx.renderer.render(this.scene, this.camera);
  }

  private apply(appearance: Appearance): void {
    const data = this.ctx.data;
    if (!data || !this.appearance) return;
    // A body type change also picks a fitting hairstyle.
    const next =
      appearance.bodyType !== this.appearance.bodyType
        ? withBodyType(this.appearance, data.appearance, appearance.bodyType)
        : appearance;
    this.appearance = normalizeAppearance(next, data.appearance);
    this.model?.setAppearance(this.appearance);
    this.ui?.setAppearance(this.appearance);
  }

  private applyPoints(points: StatPoints): void {
    const data = this.ctx.data;
    if (!data) return;
    this.points = normalizeStatPoints(data.stats, points, 1);
    this.ui?.setPoints(this.points);
  }

  private begin(name: string): void {
    const { ctx } = this;
    if (!ctx.data || !this.appearance) return;
    // Only now is an old save replaced: Back leaves it as it was.
    const save = startNewGame(ctx.session, ctx.i18n.language);
    save.character = createCharacter(name, this.appearance, ctx.data.player, this.points);
    ctx.session = save;
    ctx.persist();
    ctx.goto('intro');
  }

  private buildScene(): void {
    const data = this.ctx.data;
    if (!data) return;
    const scene = new Scene();
    scene.background = new Color(palette.nachtinkt);
    scene.fog = new Fog(palette.nachtinkt, 6, 14);
    // Warm light from the front, cool twilight from above and behind (style guide L2/L3).
    scene.add(new HemisphereLight(palette.mistpaars, palette.schemerviolet, 1.6));
    const key = new DirectionalLight(palette.zonsondergang, 2.2);
    key.position.set(2, 3, 4);
    scene.add(key);
    const rim = new DirectionalLight(palette.spreukviolet, 1.2);
    rim.position.set(-3, 2, -3);
    scene.add(rim);

    const ground = new Mesh(
      new CylinderGeometry(12, 12, 0.02, 48),
      new MeshLambertMaterial({ color: palette.schemerviolet }),
    );
    ground.position.y = -0.11;
    const pedestal = new Mesh(
      new CylinderGeometry(0.6, 0.66, 0.1, 40),
      new MeshLambertMaterial({ color: palette.steengrijs }),
    );
    pedestal.position.y = -0.05;
    const ring = new Mesh(
      new TorusGeometry(0.62, 0.015, 6, 48),
      new MeshLambertMaterial({ color: palette.ornamentgoud }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.002;
    scene.add(ground, pedestal, ring);

    this.model = new CharacterModel(data.appearance);
    scene.add(this.model.root);
    this.scene = scene;
  }

  /**
   * Puts the figure in the middle of the stage area (left on wide screens, top on a portrait
   * phone) at a size that fits it: the camera moves back far enough for both the height and
   * the width, and a view offset shifts the picture to the stage center.
   */
  private readonly frameCamera = (): void => {
    const stage = this.ui?.stage;
    const canvas = this.ctx.renderer.three.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!stage || width === 0 || height === 0) return;
    const canvasRect = canvas.getBoundingClientRect();
    const rect = stage.getBoundingClientRect();
    const stageW = Math.max(rect.width, 1);
    const stageH = Math.max(rect.height, 1);

    const aspect = width / height;
    const tanHalf = Math.tan(MathUtils.degToRad(FOV / 2));
    // Distance at which FRAME_HEIGHT fills the stage height, and FRAME_WIDTH the stage width.
    const byHeight = FRAME_HEIGHT / (2 * tanHalf * (stageH / height));
    const byWidth = FRAME_WIDTH / (2 * tanHalf * aspect * (stageW / width));
    const distance = Math.max(byHeight, byWidth);
    this.camera.position.set(0, LOOK_AT_Y + distance * 0.12, distance);
    this.camera.lookAt(0, LOOK_AT_Y, 0);
    // Mist starts just behind the figure, wherever the camera ends up.
    const fog = this.scene?.fog;
    if (fog instanceof Fog) {
      fog.near = distance + 1;
      fog.far = distance + 9;
    }

    const centerX = rect.left - canvasRect.left + stageW / 2;
    const centerY = rect.top - canvasRect.top + stageH / 2;
    this.camera.aspect = aspect;
    this.camera.setViewOffset(
      width,
      height,
      width / 2 - centerX,
      height / 2 - centerY,
      width,
      height,
    );
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.dragPointer !== null) return;
    this.dragPointer = event.pointerId;
    this.dragX = event.clientX;
    this.ui?.stage.setPointerCapture(event.pointerId);
    this.ui?.stage.classList.add('ui-creator-stage-dragging');
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.dragPointer) return;
    this.yaw += (event.clientX - this.dragX) * DRAG_SPEED;
    // Turned by hand: no interpolation between the old and new angle.
    this.prevYaw = this.yaw;
    this.dragX = event.clientX;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.dragPointer) return;
    this.dragPointer = null;
    this.idleSeconds = 0;
    this.ui?.stage.classList.remove('ui-creator-stage-dragging');
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // Escape in the name field only closes the keyboard (handled there).
    if (event.code === 'Escape' && !this.ctx.overlays.isOpen) {
      event.preventDefault();
      this.ctx.goto('title');
    }
  };
}
