import {
  Color,
  type IUniform,
  ShaderMaterial,
  type Side,
  FrontSide,
  type Texture,
  Vector3,
  Vector4,
} from 'three';

/** Most real lights (High preset, nearest lanterns) the toon shader handles. */
export const MAX_LAMPS = 6;

/**
 * Uniforms every toon material and the sky share. The day-night cycle (DayNightLighting) writes
 * them once per frame; all materials see the change without touching each material.
 */
export interface SharedLightUniforms {
  /** Direction towards the key light (the sun, or the moon at night). */
  lightDir: IUniform<Vector3>;
  sunCol: IUniform<Color>;
  shadowCol: IUniform<Color>;
  fogCol: IUniform<Color>;
  fogNear: IUniform<number>;
  fogFar: IUniform<number>;
  skyTop: IUniform<Color>;
  skyHorizon: IUniform<Color>;
  sunDisk: IUniform<number>;
  moonDisk: IUniform<number>;
  stars: IUniform<number>;
  /** Multiplier for glowing materials (lanterns shine brighter at night). */
  glow: IUniform<number>;
  /** How much window materials light up (0 by day). */
  windowGlow: IUniform<number>;
  windowCol: IUniform<Color>;
  waterCol: IUniform<Color>;
  time: IUniform<number>;
  /**
   * Render position of the Blender origin. Textures and the terrain map use positions relative
   * to it, so they stay put when the floating origin moves the world.
   */
  localOffset: IUniform<Vector3>;
  lampPos: IUniform<Vector3[]>;
  lampCount: IUniform<number>;
  lampCol: IUniform<Color>;
  lampRange: IUniform<number>;
}

export function createSharedLightUniforms(): SharedLightUniforms {
  const lamps: Vector3[] = [];
  for (let i = 0; i < MAX_LAMPS; i++) lamps.push(new Vector3());
  return {
    lightDir: { value: new Vector3(0, 1, 0) },
    sunCol: { value: new Color() },
    shadowCol: { value: new Color() },
    fogCol: { value: new Color() },
    fogNear: { value: 90 },
    fogFar: { value: 750 },
    skyTop: { value: new Color() },
    skyHorizon: { value: new Color() },
    sunDisk: { value: 1 },
    moonDisk: { value: 0 },
    stars: { value: 0 },
    glow: { value: 1 },
    windowGlow: { value: 0 },
    windowCol: { value: new Color() },
    waterCol: { value: new Color() },
    time: { value: 0 },
    localOffset: { value: new Vector3() },
    lampPos: { value: lamps },
    lampCount: { value: 0 },
    lampCol: { value: new Color() },
    lampRange: { value: 14 },
  };
}

/** What a toon material draws. */
export type ToonMode = 'lit' | 'triplanar' | 'terrain' | 'glow' | 'water' | 'foliage';

const MODE_NUMBER: Record<ToonMode, number> = {
  lit: 0,
  triplanar: 1,
  terrain: 2,
  glow: 3,
  water: 4,
  foliage: 5,
};

export interface ToonOptions {
  mode: ToonMode;
  /** Base color (linear), for `lit` and `glow`. */
  color?: Color | undefined;
  map?: Texture | null | undefined;
  /** Triplanar: texture repeats per meter. Foliage: the cut-out card texture (with alpha). */
  scale?: number | undefined;
  /** Triplanar: gamma applied to the texture (as Blender's GH_TriCoord material does). */
  gamma?: number | undefined;
  tint?: Color | undefined;
  /** Terrain: [minX, maxX, minY, maxY] of the baked map in Blender coordinates. */
  terrainBounds?: Vector4 | undefined;
  /** Glow: Blender's emission strength. */
  strength?: number | undefined;
  /** Little random light/dark variation per spot (leaves, bushes) so flat colors look painted. */
  vary?: number | undefined;
  /** 1 = lights up like a window at night. */
  window?: number | undefined;
  side?: Side | undefined;
}

const VERT = /* glsl */ `
  varying vec3 vWPos;
  varying vec3 vLPos;
  varying vec3 vWNormal;
  uniform vec3 localOffset;
  #if MODE == 5
    uniform float time;
    varying vec2 vUv;
  #endif
  void main() {
    mat4 m = modelMatrix;
    #ifdef USE_INSTANCING
      m = m * instanceMatrix;
    #endif
    vec4 wp = m * vec4(position, 1.0);
    #if MODE == 5
      // glTF flips v; the textures are loaded the normal way up.
      vUv = vec2(uv.x, 1.0 - uv.y);
      // A little wind: the top of each card moves most (grass tips, the outside of a leaf tuft).
      float sway = sin(time * 1.7 + wp.x * 0.31 + wp.z * 0.23) + 0.5 * sin(time * 2.9 + wp.z * 0.7);
      wp.xz += vec2(0.035, 0.02) * sway * clamp(uv.y, 0.0, 1.0);
    #endif
    vWPos = wp.xyz;
    vLPos = wp.xyz - localOffset;
    vWNormal = normalize(mat3(m) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 color;
  uniform sampler2D map;
  uniform float scale;
  uniform float gam;
  uniform vec3 tint;
  uniform vec4 tb;
  uniform float strength;
  uniform float vary;
  uniform float window;
  uniform vec3 lightDir, sunCol, shadowCol, fogCol, windowCol, waterCol, skyHorizon;
  uniform float fogNear, fogFar, time, glow, windowGlow, sunDisk, moonDisk;
  uniform vec3 lampPos[${MAX_LAMPS}];
  uniform int lampCount;
  uniform vec3 lampCol;
  uniform float lampRange;
  varying vec3 vWPos;
  varying vec3 vLPos;
  varying vec3 vWNormal;
  #if MODE == 5
    varying vec2 vUv;
  #endif

  float hash(vec3 p) { return fract(sin(dot(floor(p), vec3(12.9898, 78.233, 37.719))) * 43758.5453); }

  void main() {
    vec3 n = normalize(vWNormal) * (gl_FrontFacing ? 1.0 : -1.0);
    vec3 base = color;
    #if MODE == 1
      // Triplanar texture with the axes of Blender's GH_TriCoord (Blender x, y, z-up).
      vec3 an = abs(n);
      vec2 uv;
      if (an.x > an.y && an.x > an.z) uv = vec2(-vLPos.z, vLPos.y);
      else if (an.z > an.x && an.z > an.y) uv = vec2(vLPos.x, vLPos.y);
      else uv = vec2(vLPos.x, -vLPos.z);
      base = pow(texture2D(map, uv * scale).rgb, vec3(gam)) * tint;
    #elif MODE == 2
      // Terrain: color baked from above, looked up by position.
      vec2 uv = vec2((vLPos.x - tb.x) / (tb.y - tb.x), (-vLPos.z - tb.z) / (tb.w - tb.z));
      base = texture2D(map, uv).rgb;
    #elif MODE == 5
      // Foliage cards (leaf tufts, grass, flowers): painted texture with a cut-out edge, × the tone.
      vec4 t = texture2D(map, vUv);
      if (t.a < 0.5) discard;
      base = t.rgb * tint;
    #endif
    if (vary > 0.0) base *= 1.0 - vary + 2.0 * vary * hash(vLPos * 0.6);

    vec3 col;
    #if MODE == 3
      // Lanterns, crystals, embers: they glow (brighter at night).
      col = base * strength * 0.55 * glow;
    #elif MODE == 4
      // Water: deep color, the sky's horizon reflected at grazing angles, a glint of the light.
      vec3 v = normalize(cameraPosition - vWPos);
      float w = sin(vLPos.x * 0.35 + time * 0.9) * sin(vLPos.z * 0.3 - time * 0.7);
      float fres = pow(1.0 - max(dot(v, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);
      col = mix(waterCol, skyHorizon, fres * 0.45 + 0.04 * w);
      vec3 h = normalize(v + lightDir);
      float glint = pow(max(dot(normalize(vec3(0.06 * w, 1.0, 0.04 * w)), h), 0.0), 120.0);
      col += sunCol * glint * 2.0 * max(sunDisk, moonDisk);
    #else
      // Two-tone toon light: a soft step between the shadow tint and the light color.
      float ndl = dot(n, lightDir);
      float lit = smoothstep(0.02, 0.22, ndl);
      float skyLight = 0.5 + 0.5 * n.y;
      vec3 light = mix(shadowCol * (0.75 + 0.25 * skyLight), sunCol * 1.15, lit);
      for (int i = 0; i < ${MAX_LAMPS}; i++) {
        if (i >= lampCount) break;
        vec3 d = lampPos[i] - vWPos;
        float dist = length(d);
        float fall = max(0.0, 1.0 - dist / lampRange);
        light += lampCol * fall * fall * (0.35 + 0.65 * max(dot(n, d / max(dist, 0.001)), 0.0));
      }
      col = base * light + windowCol * window * windowGlow * 0.9;
    #endif

    float f = smoothstep(fogNear, fogFar, length(vWPos - cameraPosition));
    col = mix(col, fogCol * 0.9, f * 0.6);
    gl_FragColor = vec4(col, ALPHA);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * The toon material of Blender-built zones (mirrors Blender's GH_Toon look): triplanar textures,
 * the baked terrain map, two-tone light, glowing lanterns, water and fog. Lights and sky colors
 * come from the shared uniforms (day-night cycle); the rest is per material. Each mode is its own
 * shader program (a define), so the GPU never branches on it.
 */
export function createToonMaterial(
  shared: SharedLightUniforms,
  options: ToonOptions,
): ShaderMaterial {
  const mode = MODE_NUMBER[options.mode];
  const uniforms: Record<string, IUniform> = {
    ...shared,
    color: { value: options.color ?? new Color(0.7, 0.7, 0.7) },
    map: { value: options.map ?? null },
    scale: { value: options.scale ?? 0.25 },
    gam: { value: options.gamma ?? 1 },
    tint: { value: options.tint ?? new Color(1, 1, 1) },
    tb: { value: options.terrainBounds ?? new Vector4() },
    strength: { value: options.strength ?? 1 },
    vary: { value: options.vary ?? 0 },
    window: { value: options.window ?? 0 },
  };
  const water = options.mode === 'water';
  return new ShaderMaterial({
    uniforms,
    // Water is slightly see-through; everything else is opaque.
    defines: { MODE: mode, ALPHA: water ? '0.88' : '1.0' },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: options.side ?? FrontSide,
    transparent: water,
    depthWrite: !water,
  });
}
