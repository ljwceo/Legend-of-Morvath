import type { GameData } from '../data/types';
import type { I18n } from '../i18n/I18n';
import type { DebugOverlay } from '../render/DebugOverlay';
import type { PerfProbe } from '../render/PerfProbe';
import type { QualityManager } from '../render/QualityManager';
import type { Renderer } from '../render/Renderer';
import type { SaveData } from '../save/SaveData';
import type { SaveManager } from '../save/SaveManager';
import type { StateId } from '../scenes/flow';
import type { DayNightService } from '../services/DayNightService';
import type { SeasonService } from '../services/SeasonService';
import type { Overlays } from '../ui/Overlays';
import type { Bindings } from './Bindings';
import type { GameEventBus } from './events';
import type { PadHub } from './gamepad';
import type { GameLoop } from './GameLoop';

/**
 * Everything the scenes share. Created once in main.ts; `data`, `seasons` and `session` are
 * filled in by the Boot scene and the language choice.
 */
export interface GameContext {
  readonly renderer: Renderer;
  readonly events: GameEventBus;
  readonly loop: GameLoop;
  readonly i18n: I18n;
  readonly saves: SaveManager;
  /** Which key or mouse button does what (Settings -> Controls); filled by the Boot scene. */
  readonly bindings: Bindings;
  /** Gamepads, read once per frame; Input, Overlays and the controls panel listen to it. */
  readonly pads: PadHub;
  readonly debug: DebugOverlay;
  /** Graphics preset (Low / Mid / High): benchmark, auto-downgrade, renderer settings. */
  readonly quality: QualityManager;
  /** Debug fps measurement (cheat menu), for filling in the fps table per device. */
  readonly perf: PerfProbe;
  /** Text of the last fps measurement (or its progress), for the debug overlay and cheat menu. */
  perfText(): string;
  /** Layer for HTML screens and panels, above the canvas. */
  readonly ui: HTMLElement;
  readonly overlays: Overlays;
  readonly params: URLSearchParams;

  data: GameData | null;
  seasons: SeasonService | null;
  /** Time of day from the real clock (40 min days); the test mode can jump or speed it up. */
  dayNight: DayNightService | null;
  /** The current save; null before the language choice and after deleting the save. */
  session: SaveData | null;

  /** Switches to another scene (applied before the next update). */
  goto(state: StateId): void;
  /** Writes the session to storage now. Returns false when nothing could be saved. */
  persist(): boolean;
  /** Logs a problem; in debug mode it also appears in the red error list. */
  reportProblem(message: string): void;
}
