import {
  type Camera,
  HalfFloatType,
  PerspectiveCamera,
  PCFShadowMap,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { uiColors } from './palette';

/** Pixel ratio before a graphics preset is known (the QualityManager sets the real one). */
const START_PIXEL_RATIO = 1;
/** Samples for MSAA on the High preset. */
const MSAA_SAMPLES = 4;

export type AntialiasMode = 'off' | 'fxaa' | 'msaa';

/**
 * Owns the WebGLRenderer and the canvas, and keeps the active camera's aspect ratio in sync.
 * Antialiasing is done after rendering (FXAA, or MSAA in an offscreen target), so the graphics
 * preset can change it at any time; the canvas itself never has built-in antialiasing.
 */
export class Renderer {
  readonly three: WebGLRenderer;
  private camera: PerspectiveCamera | null = null;
  private antialias: AntialiasMode = 'off';
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private readonly pixel = new Uint8Array(4);

  constructor(private readonly container: HTMLElement) {
    this.three = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.three.setPixelRatio(Math.min(window.devicePixelRatio || 1, START_PIXEL_RATIO));
    this.three.setClearColor(uiColors.bg);
    // Shadows stay enabled; a preset without shadows simply has no light that casts them.
    this.three.shadowMap.enabled = true;
    this.three.shadowMap.type = PCFShadowMap;
    // Several passes per frame (shadows, scene, antialiasing): count them all for the debug view.
    this.three.info.autoReset = false;
    container.appendChild(this.three.domElement);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  /** The camera whose aspect ratio follows the window size. */
  setCamera(camera: PerspectiveCamera | null): void {
    this.camera = camera;
    this.resize();
  }

  /** Applies the graphics preset's resolution and antialiasing. */
  setQuality(pixelRatio: number, antialias: AntialiasMode): void {
    const ratioChanged = pixelRatio !== this.three.getPixelRatio();
    if (ratioChanged) this.three.setPixelRatio(pixelRatio);
    if (antialias !== this.antialias) {
      this.antialias = antialias;
      this.disposeComposer();
    } else if (ratioChanged && this.composer) {
      this.composer.setPixelRatio(pixelRatio);
    }
    this.resize();
  }

  /** Clears the canvas to the background color (for scenes that draw only HTML). */
  clear(): void {
    this.three.info.reset();
    this.three.clear();
  }

  render(scene: Scene, camera: Camera): void {
    this.three.info.reset();
    if (this.antialias === 'off') {
      this.three.render(scene, camera);
      return;
    }
    const composer = this.composer ?? this.createComposer();
    const pass = this.renderPass;
    if (pass) {
      pass.scene = scene;
      pass.camera = camera;
    }
    composer.render();
  }

  /**
   * Waits until the GPU has finished the frame (by reading one pixel back). Only the benchmark
   * uses this, so its timing includes the GPU work and not only the CPU side.
   */
  waitForGpu(): void {
    const gl = this.three.getContext();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.pixel);
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.disposeComposer();
    this.three.dispose();
    this.three.domElement.remove();
  }

  private createComposer(): EffectComposer {
    // MSAA renders the scene into a multisampled target; FXAA smooths edges in a last pass.
    const target =
      this.antialias === 'msaa'
        ? new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: MSAA_SAMPLES })
        : undefined;
    const composer = new EffectComposer(this.three, target);
    // Scene and camera are set on every render().
    this.renderPass = new RenderPass(new Scene(), new PerspectiveCamera());
    composer.addPass(this.renderPass);
    // Color space conversion first: FXAA works best on the final (sRGB) colors.
    composer.addPass(new OutputPass());
    if (this.antialias === 'fxaa') composer.addPass(new FXAAPass());
    this.composer = composer;
    this.resize();
    return composer;
  }

  private disposeComposer(): void {
    if (!this.composer) return;
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    this.composer = null;
    this.renderPass = null;
  }

  /**
   * Height of the canvas in CSS pixels (not render pixels), so something that must be the same
   * size on screen — the lock-on mark — is the same on every graphics preset.
   */
  get viewHeight(): number {
    return this.container.clientHeight || window.innerHeight;
  }

  private readonly resize = (): void => {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.three.setSize(width, height, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.three.getPixelRatio());
      this.composer.setSize(width, height);
    }
    if (this.camera) {
      this.camera.aspect = width / Math.max(height, 1);
      this.camera.updateProjectionMatrix();
    }
  };
}
