import type { z } from 'zod/mini';
import { boxContains, emptyBox, pointInShape, shapeBounds } from '../world/Shapes';
import { DEFAULT_CAMERA_SENSITIVITY } from '../save/SaveData';
import { dataFileNames, dataSchemas, type DataFileName } from './schemas';
import type { GameData, Shape, Zone } from './types';

export interface ValidationIssue {
  /** Data file name without extension, e.g. "npcs". */
  file: string;
  /** Location inside the file, e.g. "npcs[3].zone". */
  path: string;
  message: string;
}

export interface ValidationOptions {
  /** All keys from en.json; text keys in data are checked against this set when given. */
  textKeys?: ReadonlySet<string>;
  /** All color token names from the style guide; color fields are checked when given. */
  colorTokens?: ReadonlySet<string> | ReadonlyMap<string, unknown>;
}

export interface ValidationResult {
  /** Parsed data, or null when a file failed its structural check. */
  data: GameData | null;
  issues: ValidationIssue[];
}

export function formatIssue(issue: ValidationIssue): string {
  return `${issue.file}.json${issue.path ? ` → ${issue.path}` : ''}: ${issue.message}`;
}

/**
 * Checks every data file at boot: structure (via schemas), unique ids, references between files,
 * positions inside their zones, sensible number ranges, and text keys that exist in en.json.
 */
export function validateGameData(
  raw: Readonly<Record<DataFileName, unknown>>,
  options: ValidationOptions = {},
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const parsed: Partial<Record<DataFileName, unknown>> = {};

  for (const name of dataFileNames) {
    const schema: z.ZodMiniType = dataSchemas[name];
    const result = schema.safeParse(raw[name]);
    if (result.success) {
      parsed[name] = result.data;
    } else {
      for (const zodIssue of result.error.issues) {
        issues.push({ file: name, path: formatPath(zodIssue.path), message: zodIssue.message });
      }
    }
  }
  if (issues.length > 0) return { data: null, issues };

  const data = parsed as GameData;
  new CrossChecker(data, options, issues).run();
  return { data, issues };
}

function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += out ? `.${String(part)}` : String(part);
  }
  return out;
}

const scratchOuter = emptyBox();
const scratchInner = emptyBox();

function shapeInside(outer: Shape, inner: Shape): boolean {
  return boxContains(shapeBounds(outer, scratchOuter), shapeBounds(inner, scratchInner));
}

function shapeCenter(shape: Shape): [number, number] {
  const box = shapeBounds(shape, scratchInner);
  return [(box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2];
}

class CrossChecker {
  private readonly ids: Record<string, Set<string>> = {};

  constructor(
    private readonly data: GameData,
    private readonly options: ValidationOptions,
    private readonly issues: ValidationIssue[],
  ) {}

  run(): void {
    this.collectIds();
    this.checkZones();
    this.checkNpcs();
    this.checkPlayer();
    this.checkMonsters();
    this.checkItems();
    this.checkAppearance();
    this.checkQuality();
    this.checkSeasons();
    this.checkTriggers();
    this.checkQuests();
    this.checkSpells();
    this.checkSkills();
    this.checkCombos();
    this.checkCutscenes();
    this.checkDayNight();
    this.checkNightSpawns();
  }

  /** Day and night: a look per phase, the golden hour look, known colors and text keys. */
  private checkDayNight(): void {
    const d = this.data.daynight;
    const f = 'daynight';
    this.unique('phase', f, 'phases', d.phases);
    this.unique('look', f, 'looks', d.looks);
    d.phases.forEach((phase, i) => {
      this.text(f, `phases[${i}].label`, phase.label);
      if (!d.looks.some((look) => look.id === phase.id)) {
        this.issue(f, `phases[${i}]`, `no look with id "${phase.id}"`);
      }
    });
    if (!d.looks.some((look) => look.id === 'golden_hour')) {
      this.issue(f, 'looks', 'a look "golden_hour" is needed for zones with "goldenHour" lighting');
    }
    d.spawnPhases.forEach((id, i) => this.ref('phase', f, `spawnPhases[${i}]`, id));
    d.looks.forEach((look, i) => {
      const p = `looks[${i}]`;
      for (const key of ['skyTop', 'skyHorizon', 'sun', 'shadow', 'fog'] as const) {
        this.color(f, `${p}.${key}`, look[key]);
      }
    });
    this.color(f, 'lanternLights.color', d.lanternLights.color);
  }

  /** Safe zones, night spawn areas and Blender-built zones (scene). */
  private checkNightSpawns(): void {
    const f = 'zones';
    const { world, zones } = this.data.zones;
    const rules = world.nightSpawning;
    if (rules.minPlayerDistance >= rules.maxPlayerDistance) {
      this.issue(
        f,
        'world.nightSpawning',
        'minPlayerDistance must be smaller than maxPlayerDistance',
      );
    }
    zones.forEach((zone, i) => {
      const p = `zones[${i}]`;
      this.unique('safeZone', f, `${p}.safeZones`, zone.safeZones ?? []);
      this.unique('nightSpawn', f, `${p}.nightSpawns`, zone.nightSpawns ?? []);
      zone.safeZones?.forEach((safe, n) => {
        this.shape(f, `${p}.safeZones[${n}].shape`, safe.shape);
        if (!shapeInside(zone.bounds, safe.shape)) {
          this.issue(f, `${p}.safeZones[${n}]`, 'safe zone reaches outside the zone');
        }
      });
      zone.nightSpawns?.forEach((area, n) => {
        const ap = `${p}.nightSpawns[${n}]`;
        this.shape(f, `${ap}.shape`, area.shape);
        this.range(f, `${ap}.levelRange`, area.levelRange[0], area.levelRange[1]);
        if (!shapeInside(zone.bounds, area.shape)) {
          this.issue(f, ap, 'spawn area reaches outside the zone');
        }
        area.monsters.forEach((entry, m) =>
          this.ref('monster', f, `${ap}.monsters[${m}]`, entry.monster),
        );
        // An area whose corners and center all lie in one safe zone would never spawn anything.
        const box = shapeBounds(area.shape, emptyBox());
        const [cx, cz] = shapeCenter(area.shape);
        const probes: [number, number][] = [
          [cx, cz],
          [box.minX, box.minZ],
          [box.maxX, box.minZ],
          [box.minX, box.maxZ],
          [box.maxX, box.maxZ],
        ];
        const covered = zone.safeZones?.some((safe) =>
          probes.every(([x, z]) => pointInShape(safe.shape, x, z)),
        );
        if (covered) {
          this.issue(f, ap, 'spawn area lies inside a safe zone (nothing would ever appear)');
        }
      });
      const scene = zone.scene;
      if (!scene) return;
      this.color(f, `${p}.scene.windowColor`, scene.windowColor);
      for (const [material, token] of Object.entries(scene.colorOverrides)) {
        this.color(f, `${p}.scene.colorOverrides.${material}`, token);
      }
      if (scene.fogNear >= scene.fogFar) {
        this.issue(f, `${p}.scene`, 'fogNear must be smaller than fogFar');
      }
      scene.exits.forEach((exit, n) => {
        const ep = `${p}.scene.exits[${n}]`;
        this.shape(f, `${ep}.shape`, exit.shape);
        // Arriving inside the zone again would load the scene straight back.
        if (pointInShape(zone.bounds, exit.to.x, exit.to.z)) {
          this.issue(f, `${ep}.to`, 'exit leads back into the same zone');
        }
        if (!pointInShape(world.bounds, exit.to.x, exit.to.z)) {
          this.issue(f, `${ep}.to`, 'exit leads outside the world');
        }
      });
    });
  }

  // ------------------------------------------------------------ helpers

  private issue(file: string, path: string, message: string): void {
    this.issues.push({ file, path, message });
  }

  /** Registers ids under a namespace and reports duplicates. */
  private unique(namespace: string, file: string, path: string, list: readonly { id: string }[]) {
    const set = (this.ids[namespace] ??= new Set());
    list.forEach((entry, i) => {
      if (set.has(entry.id)) this.issue(file, `${path}[${i}].id`, `duplicate id "${entry.id}"`);
      set.add(entry.id);
    });
  }

  private ref(namespace: string, file: string, path: string, value: string | undefined): void {
    if (value === undefined) return;
    if (!this.ids[namespace]?.has(value)) {
      this.issue(file, path, `unknown ${namespace} "${value}"`);
    }
  }

  private text(file: string, path: string, key: string | undefined): void {
    const keys = this.options.textKeys;
    if (key === undefined || !keys) return;
    if (!keys.has(key)) this.issue(file, path, `text key "${key}" is missing in en.json`);
  }

  private color(file: string, path: string, token: string): void {
    const tokens = this.options.colorTokens;
    if (tokens && !tokens.has(token)) {
      this.issue(file, path, `unknown color token "${token}" (see docs/art-style/tokens.json)`);
    }
  }

  private range(file: string, path: string, min: number, max: number): void {
    if (min > max) this.issue(file, path, `min (${min}) is larger than max (${max})`);
  }

  private shape(file: string, path: string, shape: Shape): void {
    if (shape.type === 'rect') {
      if (shape.minX >= shape.maxX || shape.minZ >= shape.maxZ) {
        this.issue(file, path, 'rect min must be smaller than max');
      }
    }
  }

  private collectIds(): void {
    const d = this.data;
    this.unique('zone', 'zones', 'zones', d.zones.zones);
    this.unique('prop', 'zones', 'world.props', d.zones.world.props);
    this.unique('river', 'zones', 'world.rivers', d.zones.world.rivers ?? []);
    d.zones.zones.forEach((zone, i) => {
      this.unique(`spawn:${zone.id}`, 'zones', `zones[${i}].spawnPoints`, zone.spawnPoints);
      this.unique('area', 'zones', `zones[${i}].areas`, zone.areas);
      this.unique('instance', 'zones', `zones[${i}].instances`, zone.instances);
      this.unique('structure', 'zones', `zones[${i}].structures`, zone.structures ?? []);
      if (zone.checkpoint) this.unique('checkpoint', 'zones', `zones[${i}]`, [zone.checkpoint]);
    });
    // Monster spawn ids are unique across all zones (later quests and saves refer to them).
    this.unique(
      'monsterSpawn',
      'zones',
      'zones[].spawns',
      d.zones.zones.flatMap((zone) => [...(zone.spawns ?? []), ...(zone.spawnAreas ?? [])]),
    );
    this.unique('role', 'npcs', 'roles', d.npcs.roles);
    this.unique('npc', 'npcs', 'npcs', d.npcs.npcs);
    this.unique('monster', 'monsters', 'monsters', d.monsters.monsters);
    this.unique('rarity', 'items', 'rarities', d.items.rarities);
    this.unique('item', 'items', 'items', d.items.items);
    this.unique('crystalSize', 'items', 'crystalSizes', d.items.crystalSizes.map(toEntry));
    this.unique('bodyType', 'appearance', 'bodyTypes', d.appearance.bodyTypes);
    this.unique('hairstyle', 'appearance', 'hairstyles', d.appearance.hairstyles);
    this.unique('hairColor', 'appearance', 'hairColors', d.appearance.hairColors);
    this.unique('skinTone', 'appearance', 'skinTones', d.appearance.skinTones);
    this.unique('mantleColor', 'appearance', 'mantleColors', d.appearance.mantleColors);
    this.unique('quality', 'quality', 'presets', d.quality.presets);
    this.unique('season', 'seasons', 'seasons', d.seasons.seasons);
    this.unique('trigger', 'triggers', 'triggers', d.triggers.triggers);
    this.unique('quest', 'quests', 'quests', d.quests.quests);
    this.unique('element', 'spells', 'elements', d.spells.elements);
    this.unique('spell', 'spells', 'spells', d.spells.spells);
    this.unique('coreStat', 'skills', 'core.stats', d.skills.core.stats);
    this.unique('branch', 'skills', 'branches', d.skills.branches);
    this.unique('skill', 'skills', 'skills', d.skills.skills);
    this.unique('perk', 'skills', 'perks', d.skills.perks);
    this.unique('combo', 'combos', 'combos', d.combos.combos);
    this.unique('cutscene', 'cutscenes', 'cutscenes', d.cutscenes.cutscenes);
    this.unique(
      'condition',
      'triggers',
      'conditions',
      Object.keys(d.triggers.conditions).map(toEntry),
    );
  }

  // ------------------------------------------------------------ files

  private checkZones(): void {
    const { world, zones, startZone } = this.data.zones;
    const f = 'zones';
    this.shape(f, 'world.bounds', world.bounds);
    this.color(f, 'world.outsideZoneColor', world.outsideZoneColor);
    this.color(f, 'world.outsideZoneFog', world.outsideZoneFog);
    this.ref('zone', f, 'startZone', startZone);
    const terrain = world.terrain;
    this.range(f, 'world.terrain.seaFloor', terrain.seaFloor, terrain.seaLevel);
    if (terrain.lodSegments[1] > terrain.lodSegments[0]) {
      this.issue(f, 'world.terrain.lodSegments', 'far chunks need fewer segments than near ones');
    }
    const byId = new Map(zones.map((zone) => [zone.id, zone]));

    zones.forEach((zone, i) => {
      const p = `zones[${i}]`;
      this.shape(f, `${p}.bounds`, zone.bounds);
      this.range(f, `${p}.levelRange`, zone.levelRange[0], zone.levelRange[1]);
      this.color(f, `${p}.terrainColor`, zone.terrainColor);
      this.color(f, `${p}.fogColor`, zone.fogColor);
      this.ref('season', f, `${p}.season`, zone.season);
      if (!shapeInside(world.bounds, zone.bounds)) {
        this.issue(f, `${p}.bounds`, 'zone reaches outside the world bounds');
      }
      zone.neighbors.forEach((neighbor, n) => {
        const path = `${p}.neighbors[${n}]`;
        this.ref('zone', f, path, neighbor);
        if (neighbor === zone.id) this.issue(f, path, 'a zone cannot be its own neighbor');
        const other = byId.get(neighbor);
        if (other && !other.neighbors.includes(zone.id)) {
          this.issue(f, path, `"${neighbor}" does not list "${zone.id}" as a neighbor`);
        }
      });
      zone.spawnPoints.forEach((spawn, s) => {
        if (!pointInShape(zone.bounds, spawn.x, spawn.z)) {
          this.issue(f, `${p}.spawnPoints[${s}]`, 'spawn point lies outside the zone');
        }
      });
      if (zone.checkpoint && !pointInShape(zone.bounds, zone.checkpoint.x, zone.checkpoint.z)) {
        this.issue(f, `${p}.checkpoint`, 'checkpoint lies outside the zone');
      }
      zone.areas.forEach((area, a) => {
        this.shape(f, `${p}.areas[${a}].shape`, area.shape);
        if (!shapeInside(zone.bounds, area.shape)) {
          this.issue(f, `${p}.areas[${a}]`, 'area reaches outside the zone');
        }
      });
      zone.instances.forEach((instance, n) => {
        const ip = `${p}.instances[${n}]`;
        if (!pointInShape(zone.bounds, instance.entrance.x, instance.entrance.z)) {
          this.issue(f, `${ip}.entrance`, 'entrance lies outside the zone');
        }
        const scene = instance.scene;
        if (!scene) return;
        if (!zone.scene)
          this.issue(f, `${ip}.scene`, 'only a zone with a Blender scene can cut one out');
        this.shape(f, `${ip}.scene.door`, scene.door);
        this.shape(f, `${ip}.scene.exit.shape`, scene.exit.shape);
        this.ref('cutscene', f, `${ip}.scene.cutscene`, scene.cutscene);
        for (const box of [scene.region, scene.cut]) {
          if (!box) continue;
          if (box.min.x >= box.max.x || box.min.y >= box.max.y || box.min.z >= box.max.z) {
            this.issue(f, `${ip}.scene`, 'a box needs min below max on every axis');
          }
        }
        if (!inRegion(scene.region, scene.spawn.x, scene.spawn.z)) {
          this.issue(f, `${ip}.scene.spawn`, 'spawn lies outside the region');
        }
        // Arriving on the door or the exit would send you straight back.
        if (pointInShape(scene.exit.shape, scene.spawn.x, scene.spawn.z)) {
          this.issue(f, `${ip}.scene.spawn`, 'spawn lies on the exit');
        }
        if (pointInShape(scene.door, scene.exit.to.x, scene.exit.to.z)) {
          this.issue(f, `${ip}.scene.exit.to`, 'arrival outside lies on the door');
        }
      });
      zone.npcs.forEach((npcId, n) => this.ref('npc', f, `${p}.npcs[${n}]`, npcId));
      this.checkStructures(zone, p);
      zone.spawns?.forEach((spawn, n) => {
        const sp = `${p}.spawns[${n}]`;
        this.ref('monster', f, `${sp}.monster`, spawn.monster);
        this.needsAi(sp, spawn.monster);
        if (!pointInShape(zone.bounds, spawn.x, spawn.z)) {
          this.issue(f, sp, 'monster spawn lies outside the zone');
        }
      });
      zone.spawnAreas?.forEach((area, n) => {
        const sp = `${p}.spawnAreas[${n}]`;
        this.ref('monster', f, `${sp}.monster`, area.monster);
        this.needsAi(sp, area.monster);
        const circle = { type: 'circle' as const, x: area.x, z: area.z, radius: area.radius };
        if (!shapeInside(zone.bounds, circle)) {
          this.issue(f, sp, 'spawn area reaches outside the zone');
        }
      });
      zone.scatter?.forEach((rule, n) => {
        this.ref('prop', f, `${p}.scatter[${n}].prop`, rule.prop);
        this.range(f, `${p}.scatter[${n}]`, rule.minScale, rule.maxScale);
      });
    });
  }

  /** A monster placed in the world that walks and fights needs `ai` (monsters.json). */
  private needsAi(path: string, monsterId: string): void {
    const def = this.data.monsters.monsters.find((monster) => monster.id === monsterId);
    if (def && def.behavior !== 'static' && !def.ai) {
      this.issue('zones', path, `monster "${monsterId}" walks and fights but has no ai settings`);
    }
  }

  private checkStructures(zone: Zone, p: string): void {
    const f = 'zones';
    const own = new Set((zone.structures ?? []).map((structure) => structure.id));
    zone.structures?.forEach((structure, n) => {
      const sp = `${p}.structures[${n}]`;
      if (structure.color) this.color(f, `${sp}.color`, structure.color);
      const rotation = structure.rotation ?? 0;
      if (structure.collider === 'box' && rotation % 90 !== 0) {
        this.issue(f, `${sp}.rotation`, 'a box collider needs a rotation in steps of 90°');
      }
      if (structure.connects) {
        if (structure.x !== undefined || structure.z !== undefined) {
          this.issue(f, sp, 'a structure with connects takes its position from them (no x / z)');
        }
        structure.connects.forEach((other, c) => {
          if (!own.has(other)) {
            this.issue(f, `${sp}.connects[${c}]`, `no structure "${other}" in this zone`);
          } else if (other === structure.id) {
            this.issue(f, `${sp}.connects[${c}]`, 'a structure cannot connect to itself');
          }
        });
        return;
      }
      if (structure.x === undefined || structure.z === undefined) {
        this.issue(f, sp, 'needs x and z (or connects)');
      } else if (!pointInShape(zone.bounds, structure.x, structure.z)) {
        this.issue(f, sp, 'structure lies outside the zone');
      }
      if (structure.size[2] <= 0) this.issue(f, `${sp}.size`, 'depth must be larger than 0');
    });
  }

  private checkNpcs(): void {
    const f = 'npcs';
    const zones = new Map(this.data.zones.zones.map((zone) => [zone.id, zone]));
    this.data.npcs.roles.forEach((role, i) => this.color(f, `roles[${i}].color`, role.color));
    const settings = this.data.npcs.settings;
    const [pauseMin, pauseMax] = settings.wanderPauseSeconds;
    if (pauseMin > pauseMax) {
      this.issue(f, 'settings.wanderPauseSeconds', 'the first number (min) must not exceed max');
    }

    this.data.npcs.npcs.forEach((npc, i) => {
      const p = `npcs[${i}]`;
      this.ref('role', f, `${p}.role`, npc.role);
      this.ref('zone', f, `${p}.zone`, npc.zone);
      this.ref('season', f, `${p}.season`, npc.season);
      this.ref('condition', f, `${p}.presentWhen`, npc.presentWhen);
      this.ref('condition', f, `${p}.absentWhen`, npc.absentWhen);
      npc.dialogue.forEach((key, d) => this.text(f, `${p}.dialogue[${d}]`, key));
      this.text(f, `${p}.petText`, npc.petText);
      npc.dialogueWhen?.forEach((entry, w) => {
        this.ref('condition', f, `${p}.dialogueWhen[${w}].condition`, entry.condition);
        entry.lines.forEach((key, l) => this.text(f, `${p}.dialogueWhen[${w}].lines[${l}]`, key));
      });

      const teaches = npc.teaches;
      if (teaches) {
        const tp = `${p}.teaches`;
        this.ref('condition', f, `${tp}.when`, teaches.when);
        teaches.offer.forEach((key, l) => this.text(f, `${tp}.offer[${l}]`, key));
        this.text(f, `${tp}.question`, teaches.question);
        this.text(f, `${tp}.confirm`, teaches.confirm);
        teaches.accepted.forEach((key, l) => this.text(f, `${tp}.accepted[${l}]`, key));
        teaches.declined.forEach((key, l) => this.text(f, `${tp}.declined[${l}]`, key));
        if (npc.interaction !== 'talk') this.issue(f, tp, 'a teacher needs an NPC you can talk to');
        const other = this.data.npcs.npcs.findIndex((o) => o.teaches?.path === teaches.path);
        if (other !== i) {
          this.issue(f, `${tp}.path`, `"${teaches.path}" is already taught by npcs[${other}]`);
        }
      }

      npc.shop?.items.forEach((entry, e) => {
        this.ref('item', f, `${p}.shop.items[${e}].item`, entry.item);
        if (entry.item === 'gold') this.issue(f, `${p}.shop.items[${e}].item`, 'gold is not sold');
      });
      if (npc.shop && npc.interaction !== 'talk') {
        this.issue(f, `${p}.shop`, 'a shop needs an NPC you can talk to');
      }
      if (npc.interaction === 'talk' && npc.dialogue.length === 0) {
        this.issue(f, `${p}.dialogue`, 'an NPC you can talk to needs at least one line');
      }
      if (npc.interaction === 'pet' && !npc.petText) {
        this.issue(f, `${p}.petText`, 'an NPC you can pet needs petText');
      }
      if (npc.interaction === 'pack' && !npc.pack) {
        this.issue(f, `${p}.pack`, 'an NPC with interaction "pack" needs pack settings');
      }
      if (npc.pack && npc.interaction !== 'pack') {
        this.issue(f, `${p}.pack`, 'a pack animal needs interaction "pack"');
      }
      if (npc.behavior === 'follow' && !npc.follow) {
        this.issue(f, `${p}.follow`, 'behavior "follow" needs follow settings');
      }
      if (npc.follow) {
        const follow = npc.follow;
        if (npc.interaction === 'pet' && follow.minDistance <= settings.petRange) {
          this.issue(f, `${p}.follow.minDistance`, 'must be larger than settings.petRange');
        }
        // Otherwise the animal beside you takes the E key from everyone else all the time.
        if (npc.interaction === 'pack' && follow.minDistance <= settings.interactRange) {
          this.issue(f, `${p}.follow.minDistance`, 'must be larger than settings.interactRange');
        }
        this.range(f, `${p}.follow`, follow.minDistance, follow.maxDistance);
        this.range(f, `${p}.follow.idlePauseSeconds`, ...follow.idlePauseSeconds);
      }
      if (npc.behavior === 'wander' && !npc.wander) {
        this.issue(f, `${p}.wander`, 'behavior "wander" needs wander settings');
      }

      const zone = zones.get(npc.zone);
      if (zone) {
        if (!pointInShape(zone.bounds, npc.position.x, npc.position.z)) {
          this.issue(f, `${p}.position`, `position lies outside zone "${zone.id}"`);
        }
        if (!zone.npcs.includes(npc.id)) {
          this.issue(f, `${p}.zone`, `zone "${zone.id}" does not list this NPC in its npcs`);
        }
        if (npc.instance) {
          const region = zone.instances.find((entry) => entry.id === npc.instance)?.scene?.region;
          if (!region) {
            this.issue(f, `${p}.instance`, `zone "${zone.id}" has no instance "${npc.instance}"`);
          } else if (!inRegion(region, npc.position.x, npc.position.z)) {
            this.issue(f, `${p}.position`, `position lies outside instance "${npc.instance}"`);
          }
        }
      }
    });

    // The reverse direction: a zone may only list NPCs that live in that zone.
    const npcZone = new Map(this.data.npcs.npcs.map((npc) => [npc.id, npc.zone]));
    this.data.zones.zones.forEach((zone, i) => {
      zone.npcs.forEach((npcId, n) => {
        const actual = npcZone.get(npcId);
        if (actual && actual !== zone.id) {
          this.issue('zones', `zones[${i}].npcs[${n}]`, `NPC "${npcId}" belongs to "${actual}"`);
        }
      });
    });
  }

  private checkPlayer(): void {
    const f = 'player';
    const player = this.data.player;
    this.ref('zone', f, 'start.zone', player.start.zone);
    this.ref(`spawn:${player.start.zone}`, f, 'start.spawnPoint', player.start.spawnPoint);
    player.start.items.forEach((stack, i) =>
      this.ref('item', f, `start.items[${i}].item`, stack.item),
    );
    for (const [slot, itemId] of Object.entries(player.start.equipment)) {
      this.ref('item', f, `start.equipment.${slot}`, itemId);
      if (!player.start.items.some((stack) => stack.item === itemId)) {
        this.issue(f, `start.equipment.${slot}`, `"${itemId}" is equipped but not in start.items`);
      }
    }
    player.potions.quickOrder.forEach((itemId, i) => {
      this.ref('item', f, `potions.quickOrder[${i}]`, itemId);
      const item = this.data.items.items.find((entry) => entry.id === itemId);
      if (item && item.type !== 'potion') {
        this.issue(f, `potions.quickOrder[${i}]`, `"${itemId}" is not a potion`);
      }
    });
    player.load.tiers.forEach((tier, i) => {
      this.text(f, `load.tiers[${i}].label`, tier.label);
      this.text(f, `load.tiers[${i}].message`, tier.message);
      const last = i === player.load.tiers.length - 1;
      if (last !== (tier.maxRatio === undefined)) {
        this.issue(f, `load.tiers[${i}].maxRatio`, 'every tier but the last needs a maxRatio');
      }
      const before = player.load.tiers[i - 1]?.maxRatio;
      if (tier.maxRatio !== undefined && before !== undefined && tier.maxRatio <= before) {
        this.issue(f, `load.tiers[${i}].maxRatio`, 'tiers must go from light to heavy');
      }
    });
    if (player.xpToNextLevel.length > player.maxLevel - 1) {
      this.issue(f, 'xpToNextLevel', 'more XP steps than levels');
    }
    if (player.dash.energyCost > player.base.energy) {
      this.issue(f, 'dash.energyCost', 'dash costs more energy than the maximum');
    }
    const cam = player.camera;
    const between = (path: string, value: number, min: number, max: number): void => {
      if (min > max) this.issue(f, path, `min ${min} is larger than max ${max}`);
      else if (value < min || value > max) {
        this.issue(f, path, `${value} is outside ${min}–${max}`);
      }
    };
    between('camera.pitchDegrees', cam.pitchDegrees, cam.minPitchDegrees, cam.maxPitchDegrees);
    between('camera.distance', cam.distance, cam.minDistance, cam.maxDistance);
    const s = cam.sensitivity;
    between('camera.sensitivity', DEFAULT_CAMERA_SENSITIVITY, s.min, s.max);
  }

  private checkMonsters(): void {
    const f = 'monsters';
    const speedClasses = this.data.monsters.speedClasses;
    this.range(f, 'settings.wanderPauseSeconds', ...this.data.monsters.settings.wanderPauseSeconds);
    this.data.monsters.monsters.forEach((monster, i) => {
      const p = `monsters[${i}]`;
      this.range(f, `${p}.levelRange`, monster.levelRange[0], monster.levelRange[1]);
      this.range(f, `${p}.damage`, monster.damage.min, monster.damage.max);
      if (!(monster.speed in speedClasses)) {
        this.issue(f, `${p}.speed`, `unknown speed class "${monster.speed}"`);
      }
      if (monster.behavior === 'ranged' && monster.range === undefined) {
        this.issue(f, `${p}.range`, 'a ranged monster needs a range');
      }
      const ai = monster.ai;
      if (ai) {
        const attack = ai.attack;
        if (attack.style === 'lunge' && (!attack.lungeDistance || !attack.strikeSeconds)) {
          this.issue(f, `${p}.ai.attack`, 'a lunge needs lungeDistance and strikeSeconds');
        }
        if (attack.style === 'shoot' && !attack.projectileSpeed) {
          this.issue(f, `${p}.ai.attack.projectileSpeed`, 'a shooting attack needs a speed');
        }
        if (ai.keepDistance !== undefined && ai.keepDistance >= attack.range) {
          this.issue(f, `${p}.ai.keepDistance`, 'must be smaller than the attack range');
        }
        if (!monster.neutral && ai.aggroRadius <= 0) {
          this.issue(f, `${p}.ai.aggroRadius`, 'only a neutral monster may have 0');
        }
      }
      monster.safeAreas?.forEach((area, a) => this.ref('area', f, `${p}.safeAreas[${a}]`, area));
      if (monster.groupSize)
        this.range(f, `${p}.groupSize`, monster.groupSize.min, monster.groupSize.max);
      this.ref('monster', f, `${p}.splitsInto.monster`, monster.splitsInto?.monster);
      this.ref('npc', f, `${p}.transformsFrom`, monster.transformsFrom);
      monster.drops.forEach((drop, d) => {
        this.ref('item', f, `${p}.drops[${d}].item`, drop.item);
        this.range(f, `${p}.drops[${d}]`, drop.min, drop.max);
      });
      monster.attacks?.forEach((attack, a) => {
        const ap = `${p}.attacks[${a}]`;
        if (attack.minHits !== undefined) this.range(f, ap, attack.minHits, attack.hits);
        if (attack.minGap !== undefined && attack.maxGap !== undefined) {
          this.range(f, `${ap}.minGap`, attack.minGap, attack.maxGap);
        }
        this.text(f, `${ap}.hint`, attack.hint);
        if (monster.boss && !attack.pattern) {
          this.issue(f, `${ap}.pattern`, 'a boss attack needs a pattern');
        }
        const needs: Record<string, (keyof typeof attack)[]> = {
          combo: ['hitIntervalSeconds', 'reach'],
          pounce: ['travelSeconds', 'reach'],
          charge: ['travelSeconds', 'length', 'width'],
        };
        for (const field of attack.pattern ? (needs[attack.pattern] ?? []) : []) {
          if (attack[field] === undefined) {
            this.issue(f, `${ap}.${field}`, `a ${attack.pattern} attack needs ${field}`);
          }
        }
      });
      const boss = monster.boss;
      if (boss) {
        this.ref('quest', f, `${p}.boss.quest`, boss.quest);
        this.ref('trigger', f, `${p}.boss.trigger`, boss.trigger);
        this.ref('cutscene', f, `${p}.boss.cutscene`, boss.cutscene);
        this.range(f, `${p}.boss.pauseSeconds`, ...boss.pauseSeconds);
        for (const key of [
          'retryLine',
          'enrageLine',
          'winLine',
          'strikeHint',
          'guardHint',
        ] as const)
          this.text(f, `${p}.boss.${key}`, boss[key]);
        this.text(f, `${p}.boss.guardText`, boss.guardText);
        const a = boss.arena;
        for (const point of ['start', 'playerStart'] as const) {
          const q = boss[point];
          if (Math.hypot(q.x - a.x, q.z - a.z) > a.radius - 1) {
            this.issue(f, `${p}.boss.${point}`, 'must lie inside the arena');
          }
        }
        if (!monster.attacks?.length) this.issue(f, `${p}.attacks`, 'a boss needs attacks');
      }
    });
  }

  private checkItems(): void {
    const f = 'items';
    this.data.items.rarities.forEach((rarity, i) => {
      this.color(f, `rarities[${i}].color`, rarity.color);
      if (rarity.glowColor) this.color(f, `rarities[${i}].glowColor`, rarity.glowColor);
    });
    this.data.items.items.forEach((item, i) => {
      const p = `items[${i}]`;
      this.ref('rarity', f, `${p}.rarity`, item.rarity);
      this.ref('item', f, `${p}.dryTo`, item.dryTo);
      this.ref('season', f, `${p}.season`, item.season);
      this.text(f, `${p}.description`, item.description);
      if ((item.dryTo === undefined) !== (item.dryHours === undefined)) {
        this.issue(f, p, 'dryTo and dryHours go together');
      }
      if ((item.type === 'weapon') !== (item.weapon !== undefined)) {
        this.issue(f, `${p}.weapon`, 'weapon settings belong to (and are required for) weapons');
      }
      if ((item.type === 'crystal') !== (item.crystal !== undefined)) {
        this.issue(f, `${p}.crystal`, 'crystal settings belong to (and are required for) crystals');
      }
      if ((item.type === 'potion') !== (item.potion !== undefined)) {
        this.issue(f, `${p}.potion`, 'potion settings belong to (and are required for) potions');
      }
      if (item.slot !== undefined && item.type !== 'armor') {
        this.issue(f, `${p}.slot`, 'only armor has a slot');
      }
      if (item.type === 'armor' && item.slot === undefined) {
        this.issue(f, `${p}.slot`, 'armor needs a slot');
      }
      const gear = item.type === 'weapon' || item.type === 'armor';
      if (gear && item.weight === undefined) {
        this.issue(f, `${p}.weight`, 'weapons and armor need a weight (equip load)');
      }
      if (!gear && item.stats !== undefined) {
        this.issue(f, `${p}.stats`, 'only weapons and armor have stats');
      }
      this.ref('crystalSize', f, `${p}.weapon.maxCrystalSize`, item.weapon?.maxCrystalSize);
      this.ref('crystalSize', f, `${p}.crystal.size`, item.crystal?.size);
      item.crystal?.elements.forEach((element, e) =>
        this.ref('element', f, `${p}.crystal.elements[${e}]`, element),
      );
    });
  }

  private checkAppearance(): void {
    const f = 'appearance';
    const a = this.data.appearance;
    try {
      new RegExp(a.name.pattern, 'u');
    } catch {
      this.issue(f, 'name.pattern', 'not a valid regular expression');
    }
    const lists = ['bodyTypes', 'hairstyles', 'hairColors', 'skinTones', 'mantleColors'] as const;
    for (const list of lists) {
      a[list].forEach((entry, i) => this.text(f, `${list}[${i}].label`, entry.label));
    }
    a.mantleColors.forEach((mantle, i) => {
      this.color(f, `mantleColors[${i}].color`, mantle.color);
      this.color(f, `mantleColors[${i}].embroidery`, mantle.embroidery);
    });
    a.hairstyles.forEach((style, i) =>
      this.ref('bodyType', f, `hairstyles[${i}].bodyType`, style.bodyType),
    );
    a.bodyTypes.forEach((body, i) => {
      if (!a.hairstyles.some((style) => style.bodyType === body.id)) {
        this.issue(f, `bodyTypes[${i}]`, `no hairstyles for body type "${body.id}"`);
      }
    });
    const d = a.defaults;
    this.ref('bodyType', f, 'defaults.bodyType', d.bodyType);
    this.ref('hairstyle', f, 'defaults.hairstyle', d.hairstyle);
    this.ref('hairColor', f, 'defaults.hairColor', d.hairColor);
    this.ref('skinTone', f, 'defaults.skinTone', d.skinTone);
    this.ref('mantleColor', f, 'defaults.mantleColor', d.mantleColor);
    const style = a.hairstyles.find((entry) => entry.id === d.hairstyle);
    if (style && style.bodyType !== d.bodyType) {
      this.issue(f, 'defaults.hairstyle', 'default hairstyle does not fit the default body type');
    }
  }

  private checkQuality(): void {
    const f = 'quality';
    const q = this.data.quality;
    for (const level of ['low', 'mid', 'high']) {
      if (!q.presets.some((preset) => preset.id === level)) {
        this.issue(f, 'presets', `missing preset "${level}"`);
      }
    }
    q.presets.forEach((preset, i) => {
      const p = `presets[${i}]`;
      this.range(f, `${p}.pixelRatio`, preset.pixelRatio.min, preset.pixelRatio.max);
      const rings = preset.chunkRings;
      if (!(rings.active <= rings.preload && rings.preload < rings.unload)) {
        this.issue(f, `${p}.chunkRings`, 'rings must grow: active ≤ preload < unload (hysteresis)');
      }
      const collisionRing = this.data.zones.world.terrain.collisionRing;
      if (rings.active < collisionRing) {
        this.issue(
          f,
          `${p}.chunkRings.active`,
          `must be at least the collision ring (${collisionRing}, zones.json), so collision is the same on every preset`,
        );
      }
      if ((preset.shadows === 'off') !== (preset.shadowDistance === 0)) {
        this.issue(
          f,
          `${p}.shadowDistance`,
          'shadow distance must be 0 exactly when shadows are off',
        );
      }
      if (preset.shadowDistance > preset.fogFar) {
        this.issue(f, `${p}.shadowDistance`, 'shadows reach further than the fog (fogFar)');
      }
      if ((preset.shadows === 'off') !== (preset.shadowMapSize === 0)) {
        this.issue(
          f,
          `${p}.shadowMapSize`,
          'shadow map size must be 0 exactly when shadows are off',
        );
      }
    });
    if (q.benchmark.highMaxFrameMs >= q.benchmark.midMaxFrameMs) {
      this.issue(f, 'benchmark', 'highMaxFrameMs must be smaller than midMaxFrameMs');
    }
  }

  private checkSeasons(): void {
    const f = 'seasons';
    const s = this.data.seasons;
    this.unique('seasonOrder', f, 'order', s.order.map(toEntry));
    s.order.forEach((season, i) => this.ref('season', f, `order[${i}]`, season));
    s.seasons.forEach((season, i) => {
      const p = `seasons[${i}]`;
      if (!s.order.includes(season.id)) this.issue(f, p, `season "${season.id}" is not in order`);
      this.ref('element', f, `${p}.bonus.element`, season.bonus.element);
      season.resources.forEach((item, r) => this.ref('item', f, `${p}.resources[${r}]`, item));
      this.text(f, `${p}.label`, season.label);
      this.text(f, `${p}.extra`, season.extra);
    });
    if (!s.order.includes(s.firstWeekSeason)) {
      this.issue(f, 'firstWeekSeason', `"${s.firstWeekSeason}" is not in order`);
    }
    s.alwaysAvailable.forEach((item, i) => this.ref('item', f, `alwaysAvailable[${i}]`, item));
  }

  private checkTriggers(): void {
    const f = 'triggers';
    const zones = new Map(this.data.zones.zones.map((zone) => [zone.id, zone]));
    for (const [name, condition] of Object.entries(this.data.triggers.conditions)) {
      this.checkCondition(f, `conditions.${name}`, condition);
    }
    this.data.triggers.triggers.forEach((trigger, i) => {
      const p = `triggers[${i}]`;
      this.shape(f, `${p}.shape`, trigger.shape);
      this.ref('zone', f, `${p}.zone`, trigger.zone);
      this.ref('condition', f, `${p}.condition`, trigger.condition);
      this.text(f, `${p}.firstVisitText`, trigger.firstVisitText);
      this.text(f, `${p}.blockedText`, trigger.blockedText);
      if (trigger.kind === 'gate' && !trigger.condition) {
        this.issue(f, `${p}.condition`, 'a gate needs a condition');
      }
      const zone = zones.get(trigger.zone);
      const [cx, cz] = shapeCenter(trigger.shape);
      if (zone && !pointInShape(zone.bounds, cx, cz)) {
        this.issue(f, `${p}.shape`, `trigger lies outside zone "${zone.id}"`);
      }
    });
  }

  private checkCondition(
    file: string,
    path: string,
    condition: GameData['triggers']['conditions'][string],
  ): void {
    if (condition.type === 'questCompleted')
      this.ref('quest', file, `${path}.quest`, condition.quest);
    if (condition.type === 'all' || condition.type === 'any') {
      condition.of.forEach((child, i) => this.checkCondition(file, `${path}.of[${i}]`, child));
    }
  }

  private checkQuests(): void {
    const f = 'quests';
    this.data.quests.quests.forEach((quest, i) => {
      const p = `quests[${i}]`;
      this.ref('npc', f, `${p}.giver`, quest.giver);
      this.text(f, `${p}.description`, quest.description);
      quest.objectives.forEach((objective, o) => {
        const op = `${p}.objectives[${o}]`;
        if ('npc' in objective) this.ref('npc', f, `${op}.npc`, objective.npc);
        if ('item' in objective) this.ref('item', f, `${op}.item`, objective.item);
        if ('monster' in objective) this.ref('monster', f, `${op}.monster`, objective.monster);
        if ('text' in objective) this.text(f, `${op}.text`, objective.text);
        if (objective.type === 'visit') this.ref('trigger', f, `${op}.trigger`, objective.trigger);
        if (objective.type === 'rest')
          this.ref('checkpoint', f, `${op}.checkpoint`, objective.checkpoint);
        if (objective.type === 'buy') {
          const shops = this.data.npcs.npcs.filter(
            (npc) =>
              (objective.npc === undefined || npc.id === objective.npc) &&
              npc.shop?.items.some((entry) => entry.item === objective.item),
          );
          if (shops.length === 0) {
            this.issue(f, `${op}.item`, `no shop sells "${objective.item}"`);
          }
        }
      });
      if (quest.giver && !quest.dialogue) {
        this.issue(
          f,
          `${p}.dialogue`,
          'a quest with a giver needs dialogue (offer, progress, complete)',
        );
      }
      if (quest.dialogue) {
        for (const part of ['offer', 'progress', 'complete'] as const) {
          quest.dialogue[part].forEach((key, l) =>
            this.text(f, `${p}.dialogue.${part}[${l}]`, key),
          );
        }
      }
      quest.rewards.upgrades?.forEach((upgrade, u) => {
        this.ref('item', f, `${p}.rewards.upgrades[${u}].from`, upgrade.from);
        this.ref('item', f, `${p}.rewards.upgrades[${u}].to`, upgrade.to);
      });
      quest.requires.quests?.forEach((required, r) => {
        this.ref('quest', f, `${p}.requires.quests[${r}]`, required);
        if (required === quest.id)
          this.issue(f, `${p}.requires.quests[${r}]`, 'quest requires itself');
      });
      quest.requires.items?.forEach((stack, r) =>
        this.ref('item', f, `${p}.requires.items[${r}].item`, stack.item),
      );
      quest.rewards.items.forEach((stack, r) =>
        this.ref('item', f, `${p}.rewards.items[${r}].item`, stack.item),
      );
    });
  }

  private checkSpells(): void {
    const f = 'spells';
    this.data.spells.elements.forEach((element, i) =>
      this.color(f, `elements[${i}].color`, element.color),
    );
    for (const [name, curve] of Object.entries(this.data.spells.powerCurves)) {
      curve.forEach((step, i) => {
        this.range(f, `powerCurves.${name}[${i}]`, step.fromLevel, step.toLevel);
        const previous = curve[i - 1];
        if (previous && step.fromLevel !== previous.toLevel + 1) {
          this.issue(
            f,
            `powerCurves.${name}[${i}]`,
            'level ranges must follow each other without gaps',
          );
        }
      });
    }
    this.data.spells.spells.forEach((spell, i) =>
      this.ref('element', f, `spells[${i}].element`, spell.element),
    );
  }

  private checkSkills(): void {
    const f = 'skills';
    const s = this.data.skills;
    s.core.opposites.forEach((pair, i) => {
      this.ref('coreStat', f, `core.opposites[${i}].a`, pair.a);
      this.ref('coreStat', f, `core.opposites[${i}].b`, pair.b);
    });
    s.branches.forEach((branch, i) => {
      this.ref('element', f, `branches[${i}].element`, branch.element);
      if ((branch.requires === 'element') !== (branch.element !== undefined)) {
        this.issue(
          f,
          `branches[${i}].element`,
          'element branches (and only those) name an element',
        );
      }
      for (const tier of [1, 2, 3]) {
        if (!s.skills.some((skill) => skill.branch === branch.id && skill.tier === tier)) {
          this.issue(f, `branches[${i}]`, `branch "${branch.id}" has no tier ${tier} skill`);
        }
      }
    });
    s.skills.forEach((skill, i) => this.ref('branch', f, `skills[${i}].branch`, skill.branch));
  }

  private checkCombos(): void {
    const f = 'combos';
    const pairs = new Set<string>();
    this.data.combos.combos.forEach((combo, i) => {
      const p = `combos[${i}]`;
      const [a, b] = combo.elements;
      this.ref('element', f, `${p}.elements[0]`, a);
      this.ref('element', f, `${p}.elements[1]`, b);
      if (a === b) this.issue(f, `${p}.elements`, 'the same element twice never makes a combo');
      const key = [a, b].sort().join('+');
      if (pairs.has(key)) this.issue(f, `${p}.elements`, `another combo already uses ${key}`);
      pairs.add(key);
    });
  }

  private checkCutscenes(): void {
    const f = 'cutscenes';
    const { cutscenes, fights } = this.data.cutscenes;
    this.unique('fight', f, 'fights', fights);
    cutscenes.forEach((cutscene, i) => {
      this.unique(`panel:${cutscene.id}`, f, `cutscenes[${i}].panels`, cutscene.panels);
      cutscene.panels.forEach((panel, n) => {
        const p = `cutscenes[${i}].panels[${n}]`;
        this.text(f, `${p}.narration`, panel.narration);
        this.text(f, `${p}.caption`, panel.caption);
        if (panel.background) this.color(f, `${p}.background`, panel.background);
        panel.lines?.forEach((line, l) => this.text(f, `${p}.lines[${l}].text`, line.text));
        this.ref('fight', f, `${p}.fight`, panel.fight);
      });
    });
    fights.forEach((fight, i) => {
      const p = `fights[${i}]`;
      this.color(f, `${p}.arena.groundColor`, fight.arena.groundColor);
      this.color(f, `${p}.arena.fogColor`, fight.arena.fogColor);
      this.unique(`foe:${fight.id}`, f, `${p}.foes`, fight.foes);
      fight.foes.forEach((foe, n) => {
        this.color(f, `${p}.foes[${n}].color`, foe.color);
        this.color(f, `${p}.foes[${n}].accent`, foe.accent);
      });
      this.unique(`beat:${fight.id}`, f, `${p}.beats`, fight.beats);
      fight.beats.forEach((beat, b) => {
        beat.actions.forEach((action, a) => {
          const ap = `${p}.beats[${b}].actions[${a}]`;
          this.text(f, `${ap}.text`, action.text);
          this.ref(`foe:${fight.id}`, f, `${ap}.foe`, action.foe);
          if (action.type === 'hint' || action.type === 'say') {
            if (!action.text) this.issue(f, ap, `a "${action.type}" needs a text`);
          }
          if (action.type !== 'hint' && !action.foe) {
            this.issue(f, ap, `a "${action.type}" needs a foe`);
          }
          const instant = action.type === 'teleportBehind' || action.type === 'teleportHome';
          if (!instant && action.seconds === undefined) {
            this.issue(f, ap, `a "${action.type}" needs seconds`);
          }
        });
      });
    });
  }
}

function toEntry(id: string): { id: string } {
  return { id };
}

/** Is (x, z) inside a box's ground plan? */
function inRegion(
  box: { min: { x: number; z: number }; max: { x: number; z: number } },
  x: number,
  z: number,
): boolean {
  return x >= box.min.x && x <= box.max.x && z >= box.min.z && z <= box.max.z;
}
