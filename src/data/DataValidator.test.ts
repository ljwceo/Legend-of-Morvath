import { describe, expect, it } from 'vitest';
import { flattenStrings } from '../i18n/I18n';
import { colorTokens } from '../render/palette';
import { computeStatEffects, emptyStatEffects, presetPoints } from '../systems/Stats';
import { readAllData, readPublicJson } from '../test/loadPublic';
import { formatIssue, validateGameData } from './DataValidator';
import { WEAPON_GRIPS, type DataFileName } from './schemas';

const textKeys = new Set(flattenStrings(readPublicJson('lang/en.json')).keys());
const options = { textKeys, colorTokens };

/** Fresh deep copy of the real data, as loose JSON so tests can break it on purpose. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function freshData(): Record<DataFileName, any> {
  return structuredClone(readAllData());
}

function messages(raw: Record<DataFileName, unknown>): string[] {
  return validateGameData(raw, options).issues.map(formatIssue);
}

describe('validateGameData on the real data in public/data', () => {
  it('finds no problems', () => {
    const { data, issues } = validateGameData(readAllData(), options);
    expect(issues.map(formatIssue)).toEqual([]);
    expect(data).not.toBeNull();
  });

  it('contains the player numbers from the concept', () => {
    const { data } = validateGameData(readAllData(), options);
    // Since fase 3.7 `base` is what you have with nothing spent; the suggested spreads in
    // stats.json bring a level-1 character back to the concept numbers (100 HP, 50 mana).
    expect(data?.player.base.energy).toBe(100);
    const stats = data?.stats;
    const effects = emptyStatEffects();
    if (stats && data) {
      computeStatEffects(stats, presetPoints(stats, 'sword_fighter'), 'sword', effects);
      expect(data.player.base.hp + effects.maxHp).toBe(100);
      computeStatEffects(stats, presetPoints(stats, 'light_mage'), 'light', effects);
      expect(data.player.base.mana + effects.maxMana).toBe(50);
    }
    expect(data?.player.xpToNextLevel).toEqual([100, 150, 220, 300, 400, 520, 660]);
    expect(data?.player.movement.walkSpeed).toBe(4);
    expect(data?.player.dash.energyCost).toBe(25);
    expect(data?.player.dash.cooldownSeconds).toBe(1);
    expect(data?.player.regen.energyPerSecond).toBe(20);
  });

  it('has the appearance option counts from the concept', () => {
    const { data } = validateGameData(readAllData(), options);
    const a = data?.appearance;
    expect(a?.bodyTypes).toHaveLength(2);
    for (const body of a?.bodyTypes ?? []) {
      expect(a?.hairstyles.filter((style) => style.bodyType === body.id)).toHaveLength(5);
    }
    expect(a?.hairColors).toHaveLength(19);
    expect(a?.skinTones).toHaveLength(6);
    expect(a?.mantleColors).toHaveLength(6);
    expect(a?.name.maxLength).toBe(16);
  });

  it('never uses pure black as a hair or skin color (style rule K1)', () => {
    const { data } = validateGameData(readAllData(), options);
    const hexes = [...(data?.appearance.hairColors ?? []), ...(data?.appearance.skinTones ?? [])];
    for (const entry of hexes) expect(entry.hex.toUpperCase()).not.toBe('#000000');
  });
});

describe('merchants are only data', () => {
  it('a second merchant with a shop validates', () => {
    const raw = freshData();
    const marco = raw.npcs.npcs.find((n: { id: string }) => n.id === 'marco');
    const second = structuredClone(marco);
    second.id = 'test_merchant';
    second.shop = {
      sellRatio: 0.4,
      items: [{ item: 'health_potion', price: 11, stock: { max: 3, restockSeconds: 60 } }],
    };
    raw.npcs.npcs.push(second);
    const found = messages(raw);
    expect(found.filter((m) => m.includes('test_merchant'))).toEqual([]);
    second.shop.items[0].item = 'no_such_item';
    expect(messages(raw).some((m) => m.includes('shop.items[0].item'))).toBe(true);
  });
});

describe('validateGameData catches broken data', () => {
  it('reports structural problems with file and path', () => {
    const raw = freshData();
    delete raw.npcs.npcs[0].zone;
    raw.player.movement.walkSpeed = -4;
    const found = messages(raw);
    expect(found.some((m) => m.startsWith('npcs.json → npcs[0].zone'))).toBe(true);
    expect(found.some((m) => m.startsWith('player.json → movement.walkSpeed'))).toBe(true);
  });

  it('reports a missing clip role and weapons that pick each other’s meshes', () => {
    const raw = freshData();
    delete raw.animations.player.clips.dash;
    raw.animations.player.clips.slashOne = 'Slash_1';
    let found = messages(raw);
    expect(found.some((m) => m.startsWith('animations.json → player.clips.dash'))).toBe(true);
    expect(found.some((m) => m.startsWith('animations.json → player.clips'))).toBe(true);

    const overlap = freshData();
    overlap.animations.player.weapons.staff = 'S';
    overlap.animations.player.handBone = 'Sword_Hand';
    found = messages(overlap);
    expect(found).toContainEqual(
      'animations.json → player.weapons.staff: "S" also matches the sword meshes',
    );
    expect(found).toContainEqual(
      'animations.json → player.weapons.sword: "Sword_" also matches the hand bone',
    );
  });

  it('reports player gait speeds out of order and a contact before the strike starts', () => {
    const raw = freshData();
    raw.animations.player.gait.runAbove = 5;
    raw.animations.player.gait.minTimeScale = 1.2;
    raw.animations.player.strike.contactSeconds.heavyStrike = 0.01;
    const found = messages(raw);
    expect(found).toContainEqual(
      'animations.json → player.gait.runAbove: must lie between walkSpeed and runSpeed',
    );
    expect(found).toContainEqual(
      'animations.json → player.gait: minTimeScale must be at most 1 and maxTimeScale at least 1',
    );
    expect(found).toContainEqual(
      'animations.json → player.strike.contactSeconds.heavyStrike: is earlier than leadSeconds',
    );
  });

  it('reports a cape chain without numbers, a bone in two chains and a spring too stiff for its step', () => {
    const raw = freshData();
    const cape = raw.animations.player.cape;
    cape.chains[0].push('Cape_L4');
    cape.chains[1][0] = cape.chains[2][0];
    cape.substepHz = 30;
    cape.places[1].stiffness = 3000;
    let found = messages(raw);
    expect(found).toContainEqual(
      'animations.json → player.cape.chains[0]: has 4 bones but places has 3',
    );
    expect(found).toContainEqual(
      'animations.json → player.cape.chains[2]: "Cape_R1" is used twice',
    );
    expect(
      found.some((m) => m.startsWith('animations.json → player.cape.places[1].stiffness')),
    ).toBe(true);
    // And the shape of the numbers is checked by the schema (strict: a misspelled field fails).
    const typo = freshData();
    delete typo.animations.player.cape.places[0].gravity;
    typo.animations.player.cape.places[0].gravty = 9.81;
    found = messages(typo);
    expect(found.some((m) => m.startsWith('animations.json → player.cape.places[0]'))).toBe(true);
  });

  it('reports a cape collider on a cape bone and a capsule to its own bone', () => {
    const raw = freshData();
    const colliders = raw.animations.player.cape.colliders;
    colliders[0].bone = 'Cape_M2';
    colliders[2].to = colliders[2].bone;
    const found = messages(raw);
    expect(found).toContainEqual(
      'animations.json → player.cape.colliders[0]: "Cape_M2" is a cape bone',
    );
    expect(found).toContainEqual(
      'animations.json → player.cape.colliders[2].to: is the same bone (leave it out)',
    );
    // The real data passes.
    expect(messages(freshData()).filter((m) => m.includes('player.cape'))).toEqual([]);
  });

  it('reports animated NPC models whose speeds do not fit together', () => {
    const raw = freshData();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const role = raw.npcs.roles.find((entry: any) => entry.animated);
    role.animated.runAbove = role.animated.runSpeed + 1;
    role.animated.file = 'characters/pringle/pringle.fbx';
    const found = messages(raw);
    expect(found.some((m) => m.includes('.animated.file'))).toBe(true);
    const raw2 = freshData();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const role2 = raw2.npcs.roles.find((entry: any) => entry.animated);
    role2.animated.runAbove = role2.animated.runSpeed + 1;
    expect(messages(raw2).some((m) => m.includes('runAbove'))).toBe(true);
  });

  it('rejects an exhausted recovery level above the maximum energy', () => {
    const raw = freshData();
    raw.player.regen.exhaustedRecoverEnergy = raw.player.base.energy + 1;
    expect(messages(raw).join('\n')).toContain('exhaustedRecoverEnergy');
  });

  it('rejects unknown (misspelled) fields', () => {
    const raw = freshData();
    raw.npcs.npcs[0].dialouge = [];
    expect(messages(raw).some((m) => m.includes('dialouge'))).toBe(true);
  });

  it('reports duplicate ids', () => {
    const raw = freshData();
    raw.items.items.push({ ...raw.items.items[0] });
    expect(messages(raw).some((m) => m.includes('duplicate id "gold"'))).toBe(true);
  });

  it('reports references to things that do not exist', () => {
    const raw = freshData();
    raw.npcs.npcs[0].role = 'dragon_tamer';
    raw.quests.quests.find(
      (q: { rewards: { items: unknown[] } }) => q.rewards.items.length > 0,
    ).rewards.items[0].item = 'golden_spoon';
    raw.monsters.monsters.find((m: { drops: unknown[] }) => m.drops.length > 0).drops[0].item =
      'nothing';
    raw.zones.zones[1].scatter[0].prop = 'palm_tree';
    raw.zones.zones[0].spawns[0].monster = 'dragon';
    const found = messages(raw);
    expect(found).toContainEqual(expect.stringContaining('unknown monster "dragon"'));
    expect(found).toContainEqual(expect.stringContaining('unknown prop "palm_tree"'));
    expect(found).toContainEqual(expect.stringContaining('unknown role "dragon_tamer"'));
    expect(found).toContainEqual(expect.stringContaining('unknown item "golden_spoon"'));
    expect(found).toContainEqual(expect.stringContaining('unknown item "nothing"'));
  });

  it('checks the doors of a Blender-built zone: box, hinge, tip and stops', () => {
    const raw = freshData();
    const scene = raw.zones.zones.find((z: { scene?: unknown }) => z.scene).scene;
    expect(scene.doors.length).toBeGreaterThanOrEqual(3);
    const [first, second, third] = scene.doors;
    // Empty box (min above max on y), hinge outside, tip outside, tip on the hinge, no side open.
    first.box.min.y = first.box.max.y + 1;
    first.hinge.x = first.box.min.x - 5;
    second.tip.z = second.box.max.z + 1;
    second.openDegrees = { left: 0, right: 0 };
    third.tip = { ...third.hinge };
    scene.doors.push({ ...structuredClone(third), id: third.id });
    const found = messages(raw);
    expect(found).toContainEqual(expect.stringContaining('doors[0].box'));
    expect(found).toContainEqual(expect.stringContaining('hinge lies outside the box'));
    expect(found).toContainEqual(expect.stringContaining('tip lies outside the box'));
    expect(found).toContainEqual(expect.stringContaining('at least one side must open'));
    expect(found).toContainEqual(expect.stringContaining('tip must differ from the hinge'));
    expect(found).toContainEqual(expect.stringContaining(`duplicate id "${third.id}"`));
  });

  it('checks quests: places, checkpoints, shops, dialogue and upgrades', () => {
    const raw = freshData();
    const quest = (id: string) => raw.quests.quests.find((q: { id: string }) => q.id === id);
    quest('a_patch_of_earth').objectives[0].trigger = 'moon';
    quest('a_quiet_awakening').objectives[0].checkpoint = 'bed_of_nails';
    quest('just_for_you').objectives[0].item = 'slime_gel';
    delete quest('tales_by_the_fire').dialogue;
    quest('steel_and_slime').rewards.upgrades[0].to = 'excalibur';
    raw.npcs.npcs.find((n: { id: string }) => n.id === 'marco').shop.items[0].item = 'gold';
    const found = messages(raw);
    expect(found).toContainEqual(expect.stringContaining('unknown trigger "moon"'));
    expect(found).toContainEqual(expect.stringContaining('unknown checkpoint "bed_of_nails"'));
    expect(found).toContainEqual(expect.stringContaining('no shop sells "slime_gel"'));
    expect(found).toContainEqual(expect.stringContaining('needs dialogue'));
    expect(found).toContainEqual(expect.stringContaining('unknown item "excalibur"'));
    expect(found).toContainEqual(expect.stringContaining('gold is not sold'));
  });

  it('checks potions: what they restore, and the drink key order', () => {
    const raw = freshData();
    const potion = raw.items.items.find((item: { id: string }) => item.id === 'health_potion');
    delete potion.potion;
    raw.items.items.find((item: { id: string }) => item.id === 'wood').potion = { hp: 5 };
    raw.player.potions.quickOrder = ['slime_gel', 'elixir'];
    const found = messages(raw);
    expect(found).toContainEqual(expect.stringContaining('required for) potions'));
    expect(found).toContainEqual(expect.stringContaining('"slime_gel" is not a potion'));
    expect(found).toContainEqual(expect.stringContaining('unknown item "elixir"'));
  });

  it('reports NPCs placed outside their zone', () => {
    const raw = freshData();
    raw.npcs.npcs[0].position = { x: 1900, z: 0 };
    expect(messages(raw)).toContainEqual(expect.stringContaining('position lies outside zone'));
  });

  it('reports neighbors that are not mutual', () => {
    const raw = freshData();
    raw.zones.zones[1].neighbors = raw.zones.zones[1].neighbors.filter(
      (neighbor: string) => neighbor !== raw.zones.zones[0].id,
    );
    expect(messages(raw)).toContainEqual(expect.stringContaining('as a neighbor'));
  });

  it('reports missing text keys and unknown colors', () => {
    const raw = freshData();
    raw.npcs.npcs[0].dialogue = ['npc.nobody.1'];
    raw.zones.zones[0].terrainColor = 'neongroen';
    const found = messages(raw);
    expect(found).toContainEqual(expect.stringContaining('"npc.nobody.1" is missing in en.json'));
    expect(found).toContainEqual(expect.stringContaining('unknown color token "neongroen"'));
  });

  it('reports a graphics preset whose active ring is smaller than the collision ring', () => {
    const raw = freshData();
    raw.zones.world.terrain.collisionRing = 2;
    raw.quality.presets[0].chunkRings = { active: 1, preload: 3, unload: 4 };
    expect(messages(raw)).toContainEqual(expect.stringContaining('collision ring'));
  });

  it('reports chunk rings without hysteresis', () => {
    const raw = freshData();
    raw.quality.presets[0].chunkRings = { active: 2, preload: 3, unload: 3 };
    expect(messages(raw)).toContainEqual(expect.stringContaining('hysteresis'));
  });

  it('reports combos with the same element twice', () => {
    const raw = freshData();
    raw.combos.combos[0].elements = ['fire', 'fire'];
    expect(messages(raw)).toContainEqual(expect.stringContaining('same element twice'));
  });

  it('reports conditions that name an unknown quest', () => {
    const raw = freshData();
    raw.triggers.conditions.canLeaveCity = { type: 'questCompleted', quest: 'slay_moon' };
    expect(messages(raw)).toContainEqual(expect.stringContaining('unknown quest "slay_moon"'));
  });

  it('reports a boss fight with wrong references, a missing pattern or a start outside its arena', () => {
    const raw = freshData();
    const sultan = raw.monsters.monsters.find((m: { id: string }) => m.id === 'sultan');
    sultan.boss.quest = 'slay_moon';
    sultan.boss.trigger = 'nowhere';
    sultan.boss.start = { x: sultan.boss.arena.x + 100, z: sultan.boss.arena.z };
    delete sultan.attacks[0].pattern;
    delete sultan.attacks[1].travelSeconds;
    const found = messages(raw);
    expect(found).toContainEqual(expect.stringContaining('unknown quest "slay_moon"'));
    expect(found).toContainEqual(expect.stringContaining('unknown trigger "nowhere"'));
    expect(found).toContainEqual(expect.stringContaining('must lie inside the arena'));
    expect(found).toContainEqual(expect.stringContaining('a boss attack needs a pattern'));
    expect(found).toContainEqual(expect.stringContaining('a pounce attack needs travelSeconds'));
  });

  it('reports NPCs that come and go with an unknown condition', () => {
    const raw = freshData();
    raw.npcs.npcs.find((n: { id: string }) => n.id === 'sultan').presentWhen = 'moonIsBlue';
    expect(messages(raw)).toContainEqual(expect.stringContaining('unknown condition "moonIsBlue"'));
  });

  it('checks the lock-on ranges and that the Arcane Shard stays free', () => {
    const raw = freshData();
    raw.player.lockOn.breakRange = raw.player.lockOn.range - 1;
    raw.player.lockOn.range = raw.player.staff.shard.range + 5;
    raw.player.staff.shard.manaCost = 3;
    const found = messages(raw);
    expect(found).toContainEqual(expect.stringContaining('may not break inside the range'));
    expect(found).toContainEqual(expect.stringContaining('an Arcane Shard cannot reach'));
    expect(found).toContainEqual(expect.stringContaining('costs no mana'));
  });

  it('checks the lock-on mark: the ring goes around the dot, not over it', () => {
    const raw = freshData();
    raw.player.lockOn.marker.ringPixels = raw.player.lockOn.marker.dotPixels;
    raw.player.lockOn.marker.ringThicknessPixels = raw.player.lockOn.marker.ringPixels;
    const found = messages(raw);
    expect(found).toContainEqual(expect.stringContaining('wider than the dot'));
    expect(found).toContainEqual(expect.stringContaining('the ring is a disc'));
  });

  it('wants every action in controls.json, each key only once', () => {
    const raw = freshData();
    raw.controls.actions = raw.controls.actions.filter(
      (action: { id: string }) => action.id !== 'dash',
    );
    raw.controls.actions[0].keys = ['KeyE'];
    const found = messages(raw);
    expect(found).toContainEqual(expect.stringContaining('action "dash" is missing'));
    expect(found).toContainEqual(expect.stringContaining('also bound to'));
  });

  it('binds each controller button to one action only', () => {
    const raw = freshData();
    const spell = raw.controls.actions.find((action: { id: string }) => action.id === 'spellNext');
    spell.pad = ['Pad5'];
    expect(messages(raw)).toContainEqual(expect.stringContaining('"Pad5" is also bound to'));
  });

  it('reports an element without a spell (a crystal of it would be useless)', () => {
    const raw = freshData();
    raw.spells.spells = raw.spells.spells.filter(
      (spell: { element: string }) => spell.element !== 'wind',
    );
    expect(messages(raw)).toContainEqual(expect.stringContaining('no spell uses element "wind"'));
  });

  it('checks gear weight, stats and the load tiers', () => {
    const raw = freshData();
    delete raw.items.items.find((i: { id: string }) => i.id === 'iron_helm').weight;
    raw.items.items.find((i: { id: string }) => i.id === 'health_potion').stats = { hp: 5 };
    raw.player.load.tiers[1].maxRatio = 0.1;
    const found = messages(raw);
    expect(found).toContainEqual(expect.stringContaining('need a weight'));
    expect(found).toContainEqual(expect.stringContaining('only weapons and armor have stats'));
    expect(found).toContainEqual(expect.stringContaining('from light to heavy'));
  });

  it('checks cinematics: actors, shot fields, text keys and colors that exist', () => {
    const raw = freshData();
    const pringle = raw.cutscenes.cutscenes.find((c: { id: string }) => c.id === 'pringle');
    const [first, second, third] = pringle.shots;
    first.actors.push({ actor: 'ghost', lookAt: 'nobody' });
    first.subtitle.text = 'cutscene.pringle.nope';
    first.tint.color = 'neonpink';
    second.camera.follow = 'nobody';
    third.nameCard = { name: 'Sultan', title: 'cutscene.pringle.missing_title' };
    pringle.actors.push({ id: 'pringle', model: 'placeholder:cat' });
    const found = messages(raw);
    expect(found).toContainEqual(expect.stringContaining('unknown actor:pringle "ghost"'));
    expect(found).toContainEqual(expect.stringContaining('unknown actor:pringle "nobody"'));
    expect(found).toContainEqual(expect.stringContaining('"cutscene.pringle.nope" is missing'));
    expect(found).toContainEqual(expect.stringContaining('"cutscene.pringle.missing_title"'));
    expect(found).toContainEqual(expect.stringContaining('unknown color token "neonpink"'));
    expect(found).toContainEqual(expect.stringContaining('duplicate id "pringle"'));
  });

  it("checks Sultan's ending: chains, poses, the last stand and the finder", () => {
    const raw = freshData();
    const find = (id: string) => raw.cutscenes.cutscenes.find((c: { id: string }) => c.id === id);
    find('sultan_end_shared').then = 'sultan_end_sword';
    find('sultan_end_sword').actors[1].model = 'placeholder:cat';
    find('sultan_end_sword').shots[0].actors[1].pose = 'fast';
    find('sultan_end_sword').shots[0].actors[0].opacityTo = 0.5;
    const sultan = raw.monsters.monsters.find((m: { id: string }) => m.id === 'sultan');
    sultan.boss.ending.staff = 'nowhere';
    sultan.boss.prop.x = 0;
    delete sultan.boss.lastStand;
    const npc = raw.npcs.npcs.find((n: { id: string }) => n.id === 'sultan');
    npc.finder.lines.shop = 'npc.sultan.find.nope';
    npc.finder.when = 'neverEver';
    const found = messages(raw);
    expect(found).toContainEqual(expect.stringContaining('the chain comes back to'));
    expect(found).toContainEqual(expect.stringContaining('actor "sultan" is a different model'));
    expect(found).toContainEqual(expect.stringContaining('only the player holds a weapon'));
    expect(found).toContainEqual(expect.stringContaining('the player cannot fade'));
    expect(found).toContainEqual(expect.stringContaining('unknown cutscene "nowhere"'));
    expect(found).toContainEqual(expect.stringContaining('an ending needs a lastStand'));
    expect(found).toContainEqual(expect.stringContaining('boss.prop: must lie inside the arena'));
    expect(found).toContainEqual(expect.stringContaining('"npc.sultan.find.nope" is missing'));
    expect(found).toContainEqual(expect.stringContaining('unknown condition "neverEver"'));
  });

  it('only allows an item hint for an item that exists', () => {
    const keys = new Set([...textKeys, 'item.dragon_scale.hint', 'item.wood.hint']);
    const found = validateGameData(readAllData(), { textKeys: keys, colorTokens }).issues.map(
      formatIssue,
    );
    expect(found).toEqual([expect.stringContaining('"dragon_scale", which is not in items.json')]);
  });

  it('rejects unknown shot fields and models, and a first shot without a camera', () => {
    const misspelled = freshData();
    const pringle = misspelled.cutscenes.cutscenes.find((c: { id: string }) => c.id === 'pringle');
    pringle.shots[0].zoomz = true;
    expect(messages(misspelled).join('\n')).toContain('zoomz');

    const raw = freshData();
    const cine = raw.cutscenes.cutscenes.find((c: { id: string }) => c.id === 'pringle');
    delete cine.shots[0].camera;
    const found = messages(raw);
    expect(found).toContainEqual(expect.stringContaining('the first shot needs a camera'));

    const model = freshData();
    model.cutscenes.cutscenes.find((c: { id: string }) => c.id === 'pringle').actors[1].model =
      'placeholder:dragon';
    expect(messages(model).join('\n')).toContain('actors[1].model');
  });

  it('checks a cinematic on a fight: anchor or fight, foes as actors, hops, headings, narration', () => {
    const raw = freshData();
    const camera = { from: { x: 0, y: 2, z: -5 }, lookFrom: { x: 0, y: 1, z: 0 } };
    raw.cutscenes.cutscenes.push(
      {
        id: 'room',
        type: 'cinematic',
        skippable: true,
        fight: 'intro_fight',
        afterFight: 'landing',
        actors: [
          { id: 'player', model: 'player' },
          { id: 'lucael', model: 'fight' },
          { id: 'ghost', model: 'fight' },
        ],
        shots: [
          {
            id: 'one',
            seconds: 1,
            camera,
            narration: 'intro.nope',
            actors: [
              {
                actor: 'lucael',
                hops: [
                  { x: 0, z: 0 },
                  { x: 1, z: 1 },
                  // Past the set's floor (radius 16).
                  { x: 40, z: 0 },
                ],
                from: { x: 0, z: 0 },
              },
              { actor: 'player', headingFrom: 10, rollTo: 90 },
            ],
          },
        ],
      },
      // No fight of its own (an anchor instead), yet it leads back to the room.
      {
        id: 'landing',
        type: 'cinematic',
        skippable: true,
        anchor: { x: 0, z: 0 },
        afterFight: 'room',
        actors: [{ id: 'baelor', model: 'fight' }],
        shots: [{ id: 'one', seconds: 1, camera }],
      },
      // A fight nobody knows, followed by the room.
      {
        id: 'lost',
        type: 'cinematic',
        skippable: true,
        fight: 'nowhere',
        afterFight: 'room',
        shots: [{ id: 'one', seconds: 1, camera }],
      },
    );
    const pringle = raw.cutscenes.cutscenes.find((c: { id: string }) => c.id === 'pringle');
    pringle.fight = 'intro_fight';
    pringle.afterFight = 'nowhere';
    const found = messages(raw);
    expect(found).toContainEqual(
      expect.stringContaining("a cinematic on a fight's set has no anchor"),
    );
    expect(found).toContainEqual(expect.stringContaining('unknown cutscene "nowhere"'));
    expect(found).toContainEqual(expect.stringContaining('unknown fight "nowhere"'));
    expect(found).toContainEqual(expect.stringContaining('"ghost" is not a foe of "intro_fight"'));
    expect(found).toContainEqual(expect.stringContaining('hops replace from and to'));
    expect(found).toContainEqual(
      expect.stringContaining('hops[2]: lies outside the set (radius 16)'),
    );
    expect(found).not.toContainEqual(expect.stringContaining('hops[1]: lies outside'));
    expect(found).toContainEqual(expect.stringContaining('headingFrom and headingTo go together'));
    expect(found).toContainEqual(expect.stringContaining('"intro.nope" is missing'));
    expect(found).toContainEqual(expect.stringContaining('"landing" does not play on fight'));
    expect(found).toContainEqual(expect.stringContaining('the fights lead back to "room"'));
    expect(found).toContainEqual(
      expect.stringContaining('only a cinematic with a fight has an afterFight'),
    );
    // Without a fight there is no chain to check: no second, puzzling message.
    expect(found).not.toContainEqual(expect.stringContaining('on fight "undefined"'));
    expect(found).toContainEqual(
      expect.stringContaining('a "fight" actor needs a cutscene with a fight'),
    );
    // The player may roll over now (lying in the badlands); only fading is still out.
    expect(found.filter((m) => m.includes('the player cannot'))).toEqual([]);

    const bare = freshData();
    delete bare.cutscenes.cutscenes.find((c: { id: string }) => c.id === 'pringle').anchor;
    expect(messages(bare)).toContainEqual(
      expect.stringContaining('a cinematic needs an anchor or a fight'),
    );
  });

  it('refuses a cinematic intro without a fight: it plays in its own scene', () => {
    const raw = freshData();
    const intro = raw.cutscenes.cutscenes.find((c: { id: string }) => c.id === 'intro');
    // A world cutscene's anchor instead of the fight: fine anywhere else, not for the intro.
    delete intro.fight;
    delete intro.afterFight;
    intro.anchor = { x: 0, z: 0 };
    const found = messages(raw);
    expect(found).toContainEqual(
      expect.stringContaining('the intro plays in its own scene and needs a fight'),
    );
    expect(found).not.toContainEqual(
      expect.stringContaining('a cinematic needs an anchor or a fight'),
    );
    // With its fight back, the intro passes.
    expect(messages(freshData())).not.toContainEqual(expect.stringContaining('needs a fight'));
  });

  it("checks a fight's set, abilities and the new beat actions", () => {
    const raw = freshData();
    const fight = raw.cutscenes.fights[0];
    fight.set.fogNear = fight.set.fogFar;
    fight.set.skyLight = 'neonpink';
    delete fight.set.props.find((prop: { kind: string }) => prop.kind === 'spikes').seed;
    fight.set.props.push(
      { kind: 'floor', x: 0, z: 200, radius: 30 },
      { kind: 'rock', x: 5, z: 206, color: 'neonpink' },
    );
    const rock = fight.set.props.length - 1;
    fight.abilities = [
      { id: 'strike', action: 'attack', kind: 'melee' },
      {
        id: 'explosion',
        action: 'attack',
        kind: 'burst',
        radius: 4,
        cooldownSeconds: 2,
        color: 'magieblauw',
        label: 'intro.ability.nope',
      },
      // The same id again, in a color that does not exist; no `hitChance` (it has a default).
      {
        id: 'strike',
        action: 'potion',
        kind: 'storm',
        bolts: 7,
        boltRadius: 1.3,
        strikeSeconds: 1.1,
        cooldownSeconds: 7,
        color: 'neonpink',
        label: 'intro.fight.hint',
      },
      // No `range`: it flies until it leaves the set.
      {
        id: 'icicle',
        action: 'lock',
        kind: 'projectile',
        speed: 22,
        radius: 0.5,
        length: 2.4,
        cooldownSeconds: 1.6,
        color: 'magieblauw',
        label: 'intro.fight.hint',
      },
    ];
    fight.beats[0].actions.push(
      { type: 'end', foe: 'lucael' },
      { type: 'blink' },
      { type: 'blink', foe: 'lucael' },
    );
    fight.dodge = { minMeters: 4, maxMeters: 3, clearanceMeters: 3, blinkReach: 0.75 };
    const found = messages(raw);
    expect(found).toContainEqual(
      expect.stringContaining('dodge.minMeters: is larger than maxMeters'),
    );
    expect(found).toContainEqual(expect.stringContaining('fogNear: must be smaller than fogFar'));
    expect(found).toContainEqual(expect.stringContaining('unknown color token "neonpink"'));
    expect(found).toContainEqual(expect.stringContaining('spikes need count, seed and radius'));
    expect(found).toContainEqual(expect.stringContaining('a floor needs radius and color'));
    expect(found).toContainEqual(expect.stringContaining('"attack" already fires another ability'));
    expect(found).toContainEqual(expect.stringContaining('"intro.ability.nope" is missing'));
    expect(found).toContainEqual(expect.stringContaining('abilities[2].id: duplicate id "strike"'));
    expect(found).toContainEqual(
      expect.stringContaining('abilities[2].color: unknown color token "neonpink"'),
    );
    expect(found).toContainEqual(
      expect.stringContaining(`props[${rock}].color: unknown color token "neonpink"`),
    );
    // `hitChance` and `range` may be left out (the design's own example has neither).
    expect(found).not.toContainEqual(expect.stringContaining('hitChance'));
    expect(found).not.toContainEqual(expect.stringContaining('abilities[3].range'));
    expect(found).toContainEqual(expect.stringContaining('an "end" has no foe'));
    expect(found).toContainEqual(expect.stringContaining('a "blink" needs a foe'));
    // A blink with a foe is instant: no seconds needed; an end needs neither.
    expect(found).not.toContainEqual(expect.stringContaining('needs seconds'));
    expect(found).not.toContainEqual(expect.stringContaining('an "end" needs a foe'));
  });

  it('checks the victory words of a boss', () => {
    const raw = freshData();
    const sultan = raw.monsters.monsters.find((m: { id: string }) => m.id === 'sultan');
    sultan.boss.victory.title = 'boss.sultan.victory.nope';
    expect(messages(raw)).toContainEqual(expect.stringContaining('"boss.sultan.victory.nope"'));
  });
});

/**
 * Fase G, step G.1: only the data contracts for the Grimoire. Nothing in the game reads them
 * yet, so these tests also check that no content hands any of it out before G.3.
 */
describe('Grimoire data foundation (G.1)', () => {
  const { data } = validateGameData(readAllData(), options);
  const item = (id: string) => data?.items.items.find((entry) => entry.id === id);

  it('has the Rookie Grimoire with exactly one prepared incantation slot', () => {
    expect(item('rookie_grimoire')?.type).toBe('grimoire');
    expect(item('rookie_grimoire')?.grimoire?.incantationSlots).toBe(1);
  });

  it('starts the prepared main weapons at two', () => {
    expect(data?.player.prepared.mainWeapons).toBe(2);
  });

  it('has Push as a Neutral incantation that costs no mana', () => {
    const push = data?.spells.incantations.find((entry) => entry.id === 'push');
    expect(push?.element).toBe('neutral');
    expect(push?.manaCost).toBe(0);
  });

  it('makes only Neutral an element every character has from the start', () => {
    const always = data?.spells.elements.filter((element) => element.alwaysUnlocked);
    expect(always?.map((element) => element.id)).toEqual(['neutral']);
  });

  it('keeps every legacy id: the old sword, the staves, the crystals and the eggs', () => {
    expect(item('old_sword')?.weapon?.kind).toBe('sword');
    expect(item('old_sword')?.legacy).toBeUndefined();
    for (const id of ['mage_staff', 'adept_staff']) {
      expect(item(id)?.weapon?.kind).toBe('staff');
      expect(item(id)?.legacy).toBe(true);
    }
    for (const id of ['wizard_crystal', 'dark_crystal']) expect(item(id)?.type).toBe('crystal');
    // New eggs may be added; the existing ones may never be renamed or removed.
    const eggs = data?.items.items.filter((entry) => entry.type === 'egg').map((e) => e.id);
    const existingEggs = [
      'mossback_egg',
      'rootgnarl_egg',
      'fenstalker_egg',
      'bogmaw_egg',
      'hoarfrost_egg',
      'whisperer_egg',
      'sentinel_egg',
      'stonejaw_egg',
      'windlash_egg',
      'blightborn_egg',
      'sultan_egg',
    ];
    expect(eggs).toEqual(expect.arrayContaining(existingEggs));
  });

  // Grips are provisional (G.6 decides the hand usage): only check that they are valid.
  it('gives every active weapon a valid grip', () => {
    for (const entry of data?.items.items ?? []) {
      if (!entry.weapon || entry.legacy) continue;
      const grip = entry.weapon.grip;
      expect({ id: entry.id, valid: grip !== undefined && WEAPON_GRIPS.includes(grip) }).toEqual({
        id: entry.id,
        valid: true,
      });
    }
    const raw = freshData();
    raw.items.items.find((i: { id: string }) => i.id === 'goblin_cleaver').weapon.grip =
      'threeHanded';
    expect(messages(raw)).toContainEqual(expect.stringContaining('weapon.grip'));
  });

  it('changes nothing in play yet: no Neutral spell, start kit as before, nothing hands it out', () => {
    expect(data?.spells.spells.some((spell) => spell.element === 'neutral')).toBe(false);
    expect(data?.player.start.items).toEqual([
      { item: 'old_sword', count: 1 },
      { item: 'travel_mantle', count: 1 },
    ]);
    expect(data?.player.start.equipment).toEqual({ weapon: 'old_sword', mantle: 'travel_mantle' });
    const raw = readAllData();
    for (const file of ['npcs', 'quests', 'monsters', 'zones', 'cutscenes', 'triggers'] as const) {
      const text = JSON.stringify(raw[file]);
      expect({ file, grimoire: text.includes('"rookie_grimoire"') }).toEqual({
        file,
        grimoire: false,
      });
      expect({ file, push: text.includes('"push"') }).toEqual({ file, push: false });
    }
  });

  it('accepts a two-handed weapon', () => {
    const raw = freshData();
    raw.items.items.find((i: { id: string }) => i.id === 'chiefs_greatblade').weapon.grip =
      'twoHanded';
    expect(messages(raw)).toEqual([]);
  });

  it('catches broken Grimoire data', () => {
    const raw = freshData();
    const grimoire = raw.items.items.find((i: { id: string }) => i.id === 'rookie_grimoire');
    delete grimoire.grimoire;
    delete raw.items.items.find((i: { id: string }) => i.id === 'mage_staff').legacy;
    delete raw.items.items.find((i: { id: string }) => i.id === 'goblin_cleaver').weapon.grip;
    raw.spells.incantations.push(
      { id: 'fireball', name: 'Fireball Too', element: 'fire', manaCost: 1 },
      { id: 'spark', name: 'Spark', element: 'lightning', manaCost: 1 },
    );
    const found = messages(raw);
    expect(found).toContainEqual(expect.stringContaining('required for) grimoires'));
    expect(found).toContainEqual(expect.stringContaining('a staff is legacy'));
    expect(found).toContainEqual(expect.stringContaining('a weapon needs a grip'));
    expect(found).toContainEqual(expect.stringContaining('"fireball" is also a spell id'));
    expect(found).toContainEqual(expect.stringContaining('unknown element "lightning"'));
  });

  it('rejects a mana cost below zero and a Grimoire without slots', () => {
    const raw = freshData();
    raw.spells.incantations[0].manaCost = -1;
    raw.items.items.find((i: { id: string }) => i.id === 'rookie_grimoire').grimoire = {
      incantationSlots: 0,
    };
    raw.player.prepared.mainWeapons = 0;
    const found = messages(raw);
    expect(found).toContainEqual(expect.stringContaining('incantations[0].manaCost'));
    expect(found).toContainEqual(expect.stringContaining('grimoire.incantationSlots'));
    expect(found).toContainEqual(expect.stringContaining('prepared.mainWeapons'));
  });

  it('reports an element that only an incantation would need once that incantation is gone', () => {
    const raw = freshData();
    raw.spells.incantations = [];
    expect(messages(raw)).toContainEqual(
      expect.stringContaining('no spell uses element "neutral" (no incantation either)'),
    );
  });
});
