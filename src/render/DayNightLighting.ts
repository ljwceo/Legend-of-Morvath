import { Color } from 'three';
import type { DayLook, DayNightFile } from '../data/types';
import type { DayNightService, LookBlend } from '../services/DayNightService';
import { createSharedLightUniforms, type SharedLightUniforms } from './toon/ToonMaterial';

const DEG = Math.PI / 180;
/** Id of the look used by zones with `"lighting": "goldenHour"`. */
export const GOLDEN_HOUR_LOOK = 'golden_hour';

/** Deep water color (style guide); darker when the light is weak (night). */
const WATER_TOKEN = 'zeewater';

/**
 * How a zone is lit: following day and night, always the golden hour, or always one fixed look
 * from daynight.json (`look` in zones.json; Morvath's magical darkness).
 */
export type ZoneLighting = 'cycle' | 'goldenHour' | 'fixed';

/** Seconds over which the light fades into or out of a fixed look when you cross a zone border. */
const LOOK_FADE_SECONDS = 3;

/** A look from daynight.json with its colors resolved (linear, ready for shaders). */
interface ResolvedLook {
  skyTop: Color;
  skyHorizon: Color;
  sun: Color;
  shadow: Color;
  fog: Color;
  def: DayLook;
}

/**
 * Turns the time of day into light: every frame it mixes the two looks of the current blend
 * (DayNightService) and writes the result into the shared uniforms (toon materials, sky) and into
 * plain colors for the open world's Three.js lights and fog. A zone on `goldenHour` always gets
 * the golden hour look. Allocation-free per frame.
 */
export class DayNightLighting {
  readonly uniforms: SharedLightUniforms = createSharedLightUniforms();
  /** Mixed values of this frame (also in the uniforms), for Three.js lights. */
  readonly sun = new Color();
  readonly shadow = new Color();
  readonly fog = new Color();
  sunStrength = 1;
  shadowStrength = 1;
  worldFogMix = 0;
  glow = 1;
  /**
   * Strengths of the golden hour look: the open world's Three.js lights have their old
   * intensity at the golden hour and scale from there.
   */
  readonly refSunStrength: number;
  readonly refShadowStrength: number;
  private readonly byPhase: ResolvedLook[];
  private readonly golden: ResolvedLook;
  private readonly looks: Map<string, ResolvedLook>;
  private readonly blend: LookBlend = { a: 0, b: 0, t: 0 };
  private readonly waterBase: Color;
  private mode: ZoneLighting = 'cycle';
  /** The fixed look of the zone (mode `fixed`), and how far the light has faded into it (0–1). */
  private fixed: ResolvedLook | null = null;
  private fixedWeight = 0;
  // Mixed values of the cycle before the fixed look is blended in (reused every frame).
  private readonly cycleSky = new Color();
  private readonly cycleHorizon = new Color();

  constructor(
    readonly config: DayNightFile,
    color: (token: string) => number,
  ) {
    const resolve = (def: DayLook): ResolvedLook => ({
      skyTop: new Color(color(def.skyTop)),
      skyHorizon: new Color(color(def.skyHorizon)),
      sun: new Color(color(def.sun)),
      shadow: new Color(color(def.shadow)),
      fog: new Color(color(def.fog)),
      def,
    });
    const looks = new Map(config.looks.map((def) => [def.id, resolve(def)]));
    this.looks = looks;
    this.byPhase = config.phases.map((phase) => {
      const look = looks.get(phase.id);
      if (!look) throw new Error(`daynight.json: no look for phase "${phase.id}"`);
      return look;
    });
    const golden = looks.get(GOLDEN_HOUR_LOOK);
    if (!golden) throw new Error(`daynight.json: no look "${GOLDEN_HOUR_LOOK}"`);
    this.golden = golden;
    this.refSunStrength = golden.def.sunStrength || 1;
    this.refShadowStrength = golden.def.shadowStrength || 1;
    const u = this.uniforms;
    u.windowCol.value.setHex(color(config.lanternLights.color));
    u.lampCol.value.setHex(color(config.lanternLights.color));
    u.lampRange.value = config.lanternLights.rangeMeters;
    this.waterBase = new Color(color(WATER_TOKEN));
  }

  /**
   * The zone's lighting. A fixed look fades in over LOOK_FADE_SECONDS (crossing a border on
   * foot); `immediate` applies it at once (building the world, a teleport). An unknown look is
   * ignored (the DataValidator reports it at boot).
   */
  setMode(mode: ZoneLighting, look: string | null, immediate: boolean): void {
    this.mode = mode;
    const fixed = mode === 'fixed' && look ? (this.looks.get(look) ?? null) : null;
    if (fixed) this.fixed = fixed;
    if (immediate) this.fixedWeight = fixed ? 1 : 0;
  }

  /** The fixed look fully in or out at once (after a teleport). */
  snap(): void {
    this.fixedWeight = this.mode === 'fixed' && this.fixed ? 1 : 0;
  }

  /** Current zone lighting (debug overlay). */
  get lightingMode(): ZoneLighting {
    return this.mode;
  }

  /** Mixes the looks for now (or the golden hour), fades the fixed look in or out, and updates every uniform. */
  update(clock: DayNightService, seconds: number): void {
    let a: ResolvedLook;
    let b: ResolvedLook;
    let t: number;
    if (this.mode === 'goldenHour') {
      a = b = this.golden;
      t = 0;
    } else {
      const blend = clock.blend(this.blend);
      a = this.byPhase[blend.a] ?? this.golden;
      b = this.byPhase[blend.b] ?? this.golden;
      t = blend.t;
    }
    const target = this.mode === 'fixed' && this.fixed ? 1 : 0;
    const step = seconds / LOOK_FADE_SECONDS;
    if (this.fixedWeight < target) this.fixedWeight = Math.min(target, this.fixedWeight + step);
    else if (this.fixedWeight > target)
      this.fixedWeight = Math.max(target, this.fixedWeight - step);
    const w = this.fixed ? this.fixedWeight : 0;
    const f = (this.fixed ?? this.golden).def;

    const u = this.uniforms;
    const da = a.def;
    const db = b.def;
    this.sunStrength = mix(mix(da.sunStrength, db.sunStrength, t), f.sunStrength, w);
    this.shadowStrength = mix(mix(da.shadowStrength, db.shadowStrength, t), f.shadowStrength, w);
    this.worldFogMix = mix(mix(da.worldFogMix, db.worldFogMix, t), f.worldFogMix, w);
    this.glow = mix(mix(da.glow, db.glow, t), f.glow, w);
    this.sun.copy(a.sun).lerp(b.sun, t);
    this.shadow.copy(a.shadow).lerp(b.shadow, t);
    this.fog.copy(a.fog).lerp(b.fog, t);
    this.cycleSky.copy(a.skyTop).lerp(b.skyTop, t);
    this.cycleHorizon.copy(a.skyHorizon).lerp(b.skyHorizon, t);
    if (w > 0 && this.fixed) {
      this.sun.lerp(this.fixed.sun, w);
      this.shadow.lerp(this.fixed.shadow, w);
      this.fog.lerp(this.fixed.fog, w);
      this.cycleSky.lerp(this.fixed.skyTop, w);
      this.cycleHorizon.lerp(this.fixed.skyHorizon, w);
    }
    u.sunCol.value.copy(this.sun).multiplyScalar(this.sunStrength);
    u.shadowCol.value.copy(this.shadow).multiplyScalar(this.shadowStrength);
    u.fogCol.value.copy(this.fog);
    u.waterCol.value.copy(this.waterBase).multiplyScalar(0.4 + 0.6 * Math.min(1, this.sunStrength));
    u.skyTop.value.copy(this.cycleSky);
    u.skyHorizon.value.copy(this.cycleHorizon);
    u.sunDisk.value = mix(mix(da.sunDisk, db.sunDisk, t), f.sunDisk, w);
    u.moonDisk.value = mix(mix(da.moonDisk, db.moonDisk, t), f.moonDisk, w);
    u.stars.value = mix(mix(da.stars, db.stars, t), f.stars, w);
    u.glow.value = this.glow;
    u.windowGlow.value = mix(mix(da.windowGlow, db.windowGlow, t), f.windowGlow, w);
    u.time.value += seconds;

    // Light direction: elevation and azimuth mixed separately (the shortest way round), first
    // along the cycle and then towards the fixed look.
    const elevation =
      mix(mix(da.lightElevationDegrees, db.lightElevationDegrees, t), f.lightElevationDegrees, w) *
      DEG;
    const cycleAzimuth =
      da.lightAzimuthDegrees + shortestTurn(da.lightAzimuthDegrees, db.lightAzimuthDegrees) * t;
    const azimuth = (cycleAzimuth + shortestTurn(cycleAzimuth, f.lightAzimuthDegrees) * w) * DEG;
    const flat = Math.cos(elevation);
    u.lightDir.value.set(flat * Math.sin(azimuth), Math.sin(elevation), flat * Math.cos(azimuth));
  }

  /** True when lanterns glow enough for real lights (High preset, dusk and night). */
  get lanternsOn(): boolean {
    return this.glow >= this.config.lanternLights.minGlow;
  }
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Degrees to turn from azimuth `from` to `to` the shortest way round (-180..180). */
function shortestTurn(from: number, to: number): number {
  let turn = (to - from) % 360;
  if (turn > 180) turn -= 360;
  else if (turn < -180) turn += 360;
  return turn;
}
