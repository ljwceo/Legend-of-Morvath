# Intro as a filmic cutscene — design and hand-off (step C.4a)

> **Status (2026-10-15): built.** Branch `claude/serene-dirac-p62s5f`, pull request
> ljwceo/Legend-of-Morvath#95. All chunks of §10 are committed: **A** (schema, validator, timeline /
> stage / cutscene-UI extensions), **B** (`CinematicSet` + `IntroSceneState` + flow wiring +
> `scripts/intro-check.mjs`), **C** (the four abilities, dodge / zero), **D** (both films, the
> brothers' argument, EN and NL texts) and **E** (headless check with draw calls per preset,
> PLAN.md / docs/PROGRESS.md / docs/ARCHITECTURE.md, this hand-off). Three reviews of the branch were
> worked in ("Filmic intro: audit fixes"). The measurements are in docs/PROGRESS.md (block "Extra:
> filmische cutscenes, stap C.4a"). §0–§10 below are the design as approved, left as written; §11
> lists where the build departs from them.
>
> Playable preview of the branch (private artifact, republished per chunk; check it carries the
> last commits before passing it on): https://claude.ai/artifact/1mAKd7Aw77MgozW7iSGsND — the
> preview build renames `.glb` files to `.glb.wasm` and injects a small fetch shim in
> `game/index.html`, because the artifact host does not serve `.glb`; the game itself is unchanged.
>
> **Left for Bo and Lucas:** play the new intro on a pc and an iPhone (new game, or the preview) and
> measure the fps on Low and High (headless Chromium has no graphics card, so only draw calls,
> triangles and memory were measured); answer open questions 20–22 in PLAN.md → Notities (Brother
> Ansel's "found you by the road" line now that the cat finds you first; is the castle The Black
> Citadel; thunder on the drink key and the icicle on the lock-on key during the intro: keep, or own
> keys?); review or merge the pull request. Later steps: C.4 (the three remaining strips), C.5
> (Blender cameras and real models), 6.3 (audio).

Status: implemented (see the block above). Repo: /home/user/Legend-of-Morvath, branch
`claude/serene-dirac-p62s5f`. All code, comments, commits in English. Hard requirements from
CLAUDE.md apply (fixed step, no allocations in the loop, data in JSON, text in en/nl, palette
tokens only, skippable, identical on Low/Mid/High and on 60/120 Hz).

## 0. The story Bo asked for (this overrides the old 6-panel strip)

1. The player walks through a **mist door** in the castle of Morvath.
2. Behind it: a **room where time and reality do not matter** — floating bookshelves, chairs on
   the ceiling. **Lucael and Baelor** stand coolly at the far side.
3. A short conversation. **Lucael teleports skittishly** around the room until he is suddenly
   right in front of the player and inspects them. Then **Baelor moves as if he alone controls
   time** (everything else is slowed, he moves normally).
4. The player casts an **explosion** to blow the two away. Smoke. When it clears the two look
   **unamused**.
5. **The fight** in that room (playable, about a minute). The player has four flashy abilities:
   **thunder** over the whole room, the **explosion** (close range), a big **icicle** shot, and
   **basic attacks**. Almost everything **misses**; what does hit does **0 damage**. Meanwhile
   the brothers **argue** about what to do with the player.
6. Cutscene again: **Lucael shrinks the player** and looks at them in his hand. **Baelor lifts**
   them with magic and **Lucael bats them away with a baseball bat**, comically.
7. The player lands in the **badlands of Morvath**. **Sultan** (the big cat; in the game today
   `placeholder:cat` / Pringle's animated model — see §8) finds them and **licks their face**.
   Black. The player **wakes up in the Monastery** (unchanged: `placeAtStart` in flow.ts).

The old lore narration (en.json `intro.panel_1` … `panel_3`, `panel_5`, `panel_6`) stays, as
story text over the opening shots and over the black at the end.

## 1. Architecture

### 1.1 One scene state hosts everything: `IntroSceneState`

New file `src/scenes/IntroSceneState.ts` (replaces `src/scenes/IntroFightState.ts`, which is
deleted). State id `introScene` (was `introFight`; update `StateId` in `src/scenes/flow.ts`,
the registration in `src/main.ts`, and `IntroState`). It owns ONE standalone `THREE.Scene`
(like the old fight did) with:

- the **set** (scenery) built from data by a new `CinematicSet` (§3),
- the **two lords** built with `buildLord` from `src/entities/LordFactory.ts` (from the fight's
  `foes`), kept alive through all three segments so positions carry over,
- the **player** (`Player` with the real appearance from the save, exactly as the old fight),
- a `CameraRig` whose `camera` the cinematic drives during cutscene segments and the orbit
  drives during the fight,
- pooled effect meshes for the four abilities (§5).

Segments, in order: `cinematic(intro)` → `fight(intro_fight)` → `cinematic(intro_landing)` →
`finish()` (→ `ctx.introPanel = 0; ctx.goto('world')`, exactly as today's `IntroState.done`).
Skipping in ANY segment calls `finish()` at once (the whole intro is skipped, as today).

The cinematic segments reuse `CinematicCutscene` (src/ui/CinematicCutscene.ts) with a
`CinematicHost` whose `parent` is the scene, `playerRoot` the player's model root,
`ground = () => 0`, `touch`, `t`, `canvas`, `poseWeapon` and the two new hooks of §2.3.

`IntroState` (the panel cards) stays for a comic-type intro but routes a `type: "cinematic"`
intro straight to `introScene` in `enter()`; its panel code is otherwise untouched (the data can
switch back). `ctx.introPanel` keeps existing (unused by the cinematic path).

### 1.2 Data model (public/data/cutscenes.json)

```jsonc
{
  "cinematic": { ...unchanged... },
  "cutscenes": [
    {
      "id": "intro", "type": "cinematic", "skippable": true,
      // NEW: this cinematic plays on the set of this fight (own scene, no world), and after its
      // shots the fight itself plays; `afterFight` is the cinematic that follows the fight.
      "fight": "intro_fight",
      "afterFight": "intro_landing",
      "actors": [
        { "id": "player", "model": "player" },
        { "id": "lucael", "model": "fight" },        // NEW model kind: the fight's foe with this id
        { "id": "baelor", "model": "fight" },
        { "id": "smoke", "model": "fx:smoke" },
        { "id": "spark", "model": "fx:glow", "color": "magieblauw" },
        ...
      ],
      "shots": [ ... §6 ... ]
    },
    { "id": "intro_landing", "type": "cinematic", "skippable": true, "fight": "intro_fight",
      "actors": [ ..., { "id": "bat", "model": "prop:bat" }, { "id": "sultan", "model": "placeholder:cat", "color": "..." } ],
      "shots": [ ... §6 ... ] },
    ...the other cutscenes unchanged...
  ],
  "fights": [
    {
      "id": "intro_fight",
      "set": { ... §3 ... },                       // RENAMED from `arena`, extended
      "player": { "x": 0, "z": -6 },
      "foes": [ { "id": "lucael", ... }, { "id": "baelor", ... } ],   // unchanged shape
      "abilities": [ ... §5 ... ],                 // NEW
      "seed": 7,                                   // NEW: Random seed for dodges/bolts
      "beats": [ ... §6.3 ... ]                    // existing + new action types
    }
  ]
}
```

Validator rules (DataValidator, with tests): `fight` and `afterFight` reference an id in
`fights` / `cutscenes`; `afterFight` must be a cinematic that has the same `fight`; an actor
with `model: "fight"` must have the id of a foe in that fight; a cutscene with `fight` has no
`anchor`; each ability `action` is a `CONTROL_ACTIONS` id, used once; `hops` points lie inside
the set radius (warning only); every text key exists (already checked generically).

### 1.3 Flow and skip semantics

- `IntroState.enter()`: intro cutscene with `type: "cinematic"` → `ctx.goto('introScene')`.
- `IntroSceneState.enter()`: build scene/set/lords/player/pools, then `startCinematic('intro')`.
- cinematic done, not skipped → `syncPlayerFromModel()` (the stage moved the player's root; copy
  x/z/heading into `player.state` with `player.place`) → `startFight()`.
- fight: `FightScript` beats; the `end` action (new) → `startCinematic(afterFight)` with actor
  start poses from the live positions (§2.3). If the script finishes without an `end` action,
  the fight ends anyway (as today).
- second cinematic done → `finish()`.
- any skip (ring in cinematic segments, hold-to-skip ring in the fight segment too, see §4.4)
  → `finish()`. Escape during the fight = hold-to-skip (no instant skip any more; the old
  `intro.fight.skip` button goes). State landed in is identical to today: the save is NOT
  written by the intro; the world does `placeAtStart` as before.
- `document.hidden` → the fixed step is not advanced (as today).
- Black at the very end: `CinematicCutscene.dispose()` removes its overlay, so the state keeps
  its own persistent black overlay element (`ui-fight-overlay` + `ui-fight-black` exist) and
  shows it when the last cinematic reports done (not skipped) BEFORE `finish()`, so no frame of
  the arena flashes before the world's loading screen. On skip, no black is needed (the world's
  loading screen follows at once), but showing it is harmless; do it in both cases.
- UI during cinematic segments: the fight's own DOM (touch controls, hint, subtitle, input
  surface) is hidden (`hidden`/class) while a cinematic plays and shown for the fight; the
  cinematic's `root` is appended to `ctx.ui` like WorldState does, plus the class
  `ui-cinematic-playing` on `ctx.ui` so touch controls hide by the existing CSS.

## 2. Cinematic engine extensions (src/render/cinematic/*, src/ui/CinematicCutscene.ts, schema)

### 2.1 Actor move (schema `cinematicActorMove`)

- `hops: Point[]` (2–12 points, x/z): a teleport flicker. The shot is split into `hops.length`
  equal segments; in segment k the actor stands at `hops[k]` (no lerp), facing `lookAt` if given.
  For the last `HOP_BLINK = 0.08` of each segment (fraction of the segment) the actor is
  invisible, so it visibly blinks out before reappearing. `from/to` are ignored when `hops` is
  set. After the shot the actor stays at the last hop.
- `headingFrom`, `headingTo` (degrees): the actor turns from → to over the shot (eased). When
  set, they win over `heading` and `lookAt`. Used for the bat swing.
- `ownTime: true`: in a slow-motion shot (`speed` < 1) this actor's progress uses wall time
  (`local / shotWallSeconds`) instead of the slowed action time, so it moves at normal speed
  while everything else crawls (Baelor controls time). No effect when `speed` is 1.

### 2.2 Shot (schema `cinematicShot`)

- `narration: textKey`: story text (no speaker) shown centred near the top bar for the whole
  shot, styled like the old intro cards (`ui-cine-narration`, fades in/out with the shot like
  the subtitle does). A shot may have both a subtitle and a narration.

### 2.3 Host hooks (CinematicHost) and actor models

- `CINEMATIC_MODELS` gains `'fight'` (an object the hosting scene owns, by actor id: the lords of
  the intro) and `'prop:bat'` (a wooden baseball bat, ~0.9 m, handle at the origin, pointing +z,
  `terrainColors.zandsteen`-like wood with a dark grip; built in CinematicStage like the other
  props, disposed with the stage).
- `CinematicHost.objectFor?(actorId: string): Object3D | null` — for `model: "fight"` actors the
  stage uses this object (like `playerRoot`: never rebuilt or disposed by the stage, made
  visible again in `dispose`). The stage applies position/heading/scale/lift to it like any
  placeholder (no roll on lords; opacity ignored because their materials are not owned).
- `CinematicHost.actorStart?(actorId: string): { x: number; z: number; heading: number; visible: boolean } | null`
  — the initial pose of an actor before the first shot (used for lucael/baelor/player in
  `intro_landing`, so the second cinematic starts exactly where the fight left everyone).
  `CinematicCutscene`'s constructor consults it before the anchor fallback.
- `WeaponPoser` already covers the player's `cast` pose.
- The player actor: `CinematicStage.apply` today applies only heading + weapon pose to the
  player root. It must ALSO apply `scale` (`object.scale.setScalar(pose.scale)`) and `roll`
  (`rotation.x = pose.roll`, order YXZ) to the player, and `dispose()` resets scale to 1 and
  roll to 0 (visibility is already restored). The validator rule "the player cannot fade or roll
  over" becomes "the player cannot fade" (roll is now allowed; opacity still not).
- `fight`-model actors get position/heading/scale/lift applied; roll and opacity are ignored
  for them (their materials are not owned by the stage).
- Validator: a cinematic needs `anchor` OR `fight` (with `fight` the set is the ground, y = 0,
  and non-player actors start at (0, 0) invisible unless `actorStart` says otherwise).
- `assetUrl` (today a local in WorldState.ts:276) moves to `src/data/DataLoader.ts` as an
  export and is used by both WorldState and IntroSceneState (for `AnimatedModels` +
  `preloadAnimatedModels(data.npcs.roles, assetUrl)` so Pringle's glb can play Sultan).

### 2.4 Timeline internals

`posesAt(s, u, out, uWall)` gets the wall-time fraction too (for `ownTime`); `sample` passes
`local / shotWallSeconds(shot)`. `hops` are resolved in `posesAt`; the start pose of the next
shot is the last hop (the constructor already evaluates `posesAt(s, 1, pose)`). All of this stays
allocation-free and a pure function of time.

Tests (CinematicTimeline.test.ts): hops land on the exact points and blink before each hop;
headingFrom/To interpolates; ownTime actor reaches its `to` at wall-time end while a normal
actor in the same slow shot is at the slowed fraction; a 60 Hz and a 120 Hz stepping of a
cutscene with all new fields sample identically at the same seconds; narration appears in the
DOM for its shot (a small jsdom test in src/ui if there is one for CinematicCutscene, else skip).

## 3. The set: `src/render/cinematic/CinematicSet.ts` (new)

Builds static scenery for a self-contained cutscene/fight scene from `fights[].set`. Owned by
`IntroSceneState`; `update(time)` moves the drifting props (a pure function of time, so 60/120
identical; no allocations); `dispose()` frees everything.

```jsonc
"set": {
  "radius": 16,                 // the playable circle (ArenaMover) and the room floor
  "floorColor": "nachtinkt",    // palette tokens only
  "fogColor": "schemerviolet",
  "fogNear": 10, "fogFar": 70,  // meters (fog hides the far-away badlands patch and vice versa)
  "skyLight": "mistpaars", "groundLight": "nachtinkt", "sunColor": "spreukviolet",
  "props": [
    { "kind": "door",      "x": 0, "z": -40, "headingDegrees": 0 },             // the mist door in the corridor
    { "kind": "bookshelf", "x": -6, "y": 1.5, "z": 4,  "headingDegrees": 20, "drift": { "bob": 0.4, "spin": 8, "seconds": 7 } },
    { "kind": "chair",     "x": 3,  "y": 7,   "z": -2, "rollDegrees": 180, "drift": { "bob": 0.2, "spin": 0, "seconds": 5 } },
    { "kind": "floor",     "x": 0,  "z": 200, "radius": 30, "color": "verdorven" },   // the badlands patch
    { "kind": "spikes",    "x": 0,  "z": 200, "radius": 22, "count": 40, "seed": 7 },  // dead crystal spikes (old arena decoration)
    { "kind": "rock",      "x": 5,  "z": 206, "scale": 1.6 }
  ]
}
```

Kinds (placeholder geometry, palette colors, `colored()` from StructureFactory where handy):
`floor` (circle), `door` (two posts + lintel + 3 soft translucent "mist" discs in the opening
that slowly spin/bob with time), `bookshelf` (tall box with 4 shelves and a few coloured book
blocks), `chair` (seat, back, 4 legs), `spikes` (InstancedMesh of cones, deterministic from
`seed`, lifted from the old IntroFightState), `rock` (low icosahedron-ish). Optional per prop:
`y` (height above the floor), `headingDegrees`, `rollDegrees` (upside-down chairs), `scale`,
`drift: { bob (m), spin (deg/s), seconds (bob period) }`. Props of one kind share ONE geometry
and ONE material: use an `InstancedMesh` per kind (bookshelves, chairs, spikes, rocks) and update
the drifting instances' matrices each frame with preallocated `Matrix4`/`Vector3`/`Quaternion`
(allocation-free). Target: the whole set under ~25 draw calls.

The scene: `background` = fogColor, `Fog(fogColor, fogNear, fogFar)`, `HemisphereLight(skyLight,
groundLight, 1.6)`, `DirectionalLight(sunColor, 1.6)` — the old fight's lighting, from data now.

## 4. The fight segment (inside IntroSceneState, logic in src/systems/*)

### 4.1 Movement and camera: as the old IntroFightState (ArenaMover inside `set.radius`,
`stepMovement`, `CameraRig.orbit`, push out of foes, `FLAT` ground). Keep that code, moved over.

### 4.2 Script: `FightScript` (src/systems/FightScript.ts) unchanged in mechanics. New action
types in the schema enum: `blink` (the foe teleports to a random free spot in the room, with the
purple puff — Lucael dodging/skittering), `end` (the fight ends now: on to `afterFight`). Keep the
existing `say`, `hint`, `teleportBehind`, `teleportHome`, `freezeTime`, `levitate`, `spell`.

### 4.3 Abilities: `src/systems/IntroArsenal.ts` (pure logic, tested) + pooled visuals

```jsonc
"abilities": [
  { "id": "strike",    "action": "attack", "kind": "melee" },
  { "id": "explosion", "action": "heavy",  "kind": "burst",      "radius": 4.5, "cooldownSeconds": 2.5, "color": "magieblauw",  "label": "intro.ability.explosion" },
  { "id": "thunder",   "action": "potion", "kind": "storm",      "bolts": 7, "boltRadius": 1.3, "cooldownSeconds": 7, "strikeSeconds": 1.1, "color": "zonlicht", "label": "intro.ability.thunder" },
  { "id": "icicle",    "action": "lock",   "kind": "projectile", "speed": 22, "radius": 0.5, "length": 2.4, "cooldownSeconds": 1.6, "color": "<an ice/blue token>", "label": "intro.ability.icicle" }
]
```

- `melee` = the existing sword `stepSword` fast/heavy… NOTE: `heavy` is taken by the explosion
  in the intro, so melee is the fast hit only (`attack`), exactly like today's hits: in arc → the
  foe shimmers and a `0` damage number appears (unless the foe dodged, §4.5).
- `burst`: on press (cooldown ready, energy not needed): an expanding ring + the smoke puff at
  the player's feet, a short flash and shake; every foe within `radius` → `0` (or dodge).
- `storm`: on press: `bolts` lightning bolts strike over `strikeSeconds` at seeded-random points
  in the room; the whole screen flashes white briefly per bolt (reuse the fight overlay flash
  class, short); a foe within `boltRadius` of a bolt → `0` (or dodge). Points are chosen so that
  most bolts miss (first pick a point; if it is within `boltRadius * 2` of a foe, keep it only
  with probability `hitChance`, else re-roll once).
- `projectile`: on press: an icicle (a long cone) flies from the player's chest along the
  player's heading (snap to the nearest foe within ±25° using `assistedHeading` from Combat if
  that helper fits; otherwise straight), `speed` m/s, until it hits a foe (sphere test with
  `radius` + foe radius) or leaves the room (then it shatters at the edge). At most 3 in flight
  (pool); a fourth press while full does nothing.
- Cooldowns per ability, stepped in seconds. Touch and keys: `action` maps to existing input
  actions; `TouchControls` labels are set from `label` for `potion` → thunder, `lock` → icicle,
  `heavy` → explosion (`setLabels`), `setLockVisible(true)`, potion count hidden/irrelevant
  (check `setPotions` semantics). Hint text names keys via `{keyAttack}`, `{keyHeavy}`,
  `{keyPotion}`, `{keyLock}` (the i18n default params fill them; confirm these names exist in
  main.ts; if `keyPotion`/`keyLock` are missing add them there).

`IntroArsenal` API (pure, allocation-free after construction):
`constructor(def: FightDef['abilities'], radius: number, seed: number)`,
`step(dt, input: {strikePressed, burstPressed, stormPressed, boltPressed}, player: {x,z,heading}, foes: readonly {x,z,radius}[], out: ArsenalEvents)` where `ArsenalEvents` has preallocated
arrays/counters: `bursts`, `bolts[] {x,z,t}`, `projectiles[] {x,z,heading,alive}`, `hits[] {foe, kind}`, `dodges[] {foe}`, `shatters[] {x,z}`. Deterministic: same input sequence → same events on 60 and 120 Hz (test). Dodge rolls use the fight `seed` (`Random`).

### 4.4 Skip in the fight: the same hold-to-skip ring as the cinematic. Extract the ring + button
into `src/ui/SkipRing.ts` (DOM + `HoldToSkip`) used by both `CinematicCutscene` and the fight
segment; Escape held / button held fills it. Label `cutscene.holdToSkip(Touch)`.

### 4.5 Miss / zero rules (data-driven, deterministic)

Per foe in `fights[].foes`: `dodgeChance` (0–1, e.g. Lucael 0.75, Baelor 0.35). When an ability
would hit a foe, roll: dodged → the foe `blink`s 2–3 m sideways with the puff and a floating
`boss.dodged`-style text ("Dodged!"; use DamageNumbers' text support if it has one, else spawn
a `0`); not dodged → `0` damage number + shimmer. So most hits are dodged (= miss), the rest
show 0. `FightScript.registerHit()` counts both (so hit-triggered beats still fire).

### 4.6 Duration: the beats' `startAfterSeconds` add up to ~60 s, then `end`.

## 5. Rendering of the abilities (in IntroSceneState, pooled, built once in `enter`)

- Thunder: 8 thin tall cylinders (`fx` glow material, additive) placed at bolt points, visible
  for 0.12 s each, plus a ground ring; screen flash via the existing `ui-fight-flash` class
  (make it short, 0.15 s).
- Explosion: one `RingGeometry` scaled 0.5 → radius over 0.35 s + the smoke puff (6 spheres,
  copy of CinematicStage's smoke look) scaled up and fading.
- Icicle: 3 `ConeGeometry` meshes (ice colour, slightly translucent), oriented along heading; a
  shatter = 6 tiny cones bursting (positions a pure function of time since shatter).
- Shimmer on foes and damage numbers as today. All visuals read `ArsenalEvents` and times; no
  allocations per step/frame.

## 6. Content

### 6.1 `intro` shots (about 65 s). Coordinates: the room is centred at (0,0); the corridor
runs along -z from the door at z = -40 toward z = -20; the badlands patch is at (0, 200).
Lucael stands at (-1.8, 5), Baelor at (1.8, 5.6) at the end of the opening; the player at (0,-6).

| id | s | what happens | text |
|---|---|---|---|
| corridor | 6 | fade from black (1→0 over 1.5 s); camera low behind the player who walks from (0,-58) to (0,-48) toward the mist door; tint nachtinkt 0.2 | narration `intro.panel_1` |
| legend | 6 | camera side-tracking; player walks (0,-48)→(0,-42); the door's mist swirls | narration `intro.panel_2` |
| door | 4 | close on the door; player steps through (0,-42)→(0,-39.4); flash 0.8 at the end (use `fade` to white? no: use `flash` on the NEXT shot) | narration `intro.panel_3` |
| room | 7 | flash 1.2; wide reveal from above-behind the player at (0,-6): floating shelves, chairs on the ceiling, the lords at the far side (visible: true, lookAt player); slow push-in; tint spreukviolet 0.25 | Lucael: `intro.fight.arrive` |
| greeting | 4 | over Lucael's shoulder on the player | Baelor: new line |
| reply | 4 | two-shot of the lords | Lucael: new line |
| skitter | 5 | Lucael `hops` through 6 points around the room, camera static wide; the player turns (lookAt lucael) | Baelor: new line ("Brother. Focus.") |
| inspect | 4.5 | Lucael hop ends at (0,-4.4) right in front of the player; camera close on the player's face from Lucael's side; Lucael `wobble` 10 | Lucael: `intro.lucael` |
| time | 6 | `speed` 0.2 (slow motion 6 s of action = 30 s?? NO: keep `seconds` 1.2 with speed 0.2 = 6 s on screen); Baelor `ownTime: true` walks a half circle (1.8,5.6)→(2.2,-5) around the frozen pair, player and Lucael stand; tint nachtinkt 0.3 | Baelor: `intro.fight.freeze` |
| gather | 2.5 | the player `pose: cast`; `spark` (fx:glow) at (0,-5.1) scale 0.2→1.8; camera low in front; Lucael hops back to (-1.8,5) | — |
| boom | 1.2 | flash 0.9, shake 0.6; smoke at (0,2) scale 0.4→4; lords `visible: false`; tint zonlicht 0.4 | — |
| smoke | 4 | camera slow push through thinning smoke (`opacityTo` 0); the lords `visible: true` where they were, lookAt player; player pose rest | — |
| unamused | 4 | close two-shot, Lucael small `wobble`; Baelor still | Baelor: new line ("…Was that it?") then the bars slide out → fight |

### 6.2 `intro_landing` shots (about 35 s), actors start where the fight left them (host hook)

| id | s | what happens | text |
|---|---|---|---|
| enough | 3 | Lucael lookAt player; camera over his shoulder; small flash 0.3 at the end | Lucael: new ("Enough. Let me see it properly.") |
| shrink | 2.5 | player `scaleTo` 0.08, `liftTo` 2.3, `from` its spot `to` 0.5 m in front of Lucael; camera follows player (`follow`, relative) | — |
| palm | 5 | tiny player at Lucael's palm; camera close on Lucael's head and hand; Lucael `wobble` 6 | Lucael: new (comic inspection) |
| grab | 3 | Baelor: `spark` glow at the player, player `liftTo` 4 and drifts to between them (0,4) | Baelor: new ("Give it here.") |
| bat | 3 | `speed` 0.3 (`seconds` 0.9 → 3 s on screen): the `bat` (prop:bat) appears in Lucael's hand position, `headingFrom` -110 → `headingTo` 60; camera low dramatic; tint zonlicht 0.2 | Lucael: new ("Batter up.") |
| whack | 1.6 | flash 1, shake 0.8; the player flies `to` (0, 190) with `liftTo` 40 (still tiny); camera stays, fov widens | — |
| sky | 2 | camera looks up at the dot vanishing; fade 0→1 over the last 0.8 s | — |
| badlands | 6 | cut: fade 1→0 over 1 s; camera low on the badlands patch (0,200): the player (scale 1 again, `rollTo` 90 lying, lift 0.25) at (0,200); dead spikes, rocks, violet fog; `sultan` (placeholder:cat / Pringle) walks in from (10,212) to (0.9,200.9), lookAt player | narration `intro.panel_5` |
| sniff | 2 | camera at ground level past the player's face at Sultan | — |
| lick1/2/3 | 0.5 each | Sultan `liftFrom` 0.12 `liftTo` 0, ease out (three little licks; the cat's head dips) | Sultan: "Mrrp." (new, no name card) |
| black | 5 | fade 0→1 over 1.2 s, hold; `silence` | narration `intro.panel_6` |

### 6.3 Fight beats (~60 s, the brothers argue about what to do with the player)

Hint at the start: `intro.fight.hint` rewritten to name all four abilities with key placeholders;
`intro.fight.hintTouch` for touch. Beats (say/blink/freezeTime/teleportBehind/end), e.g.:
arrive(0 s) hint; 6 s Baelor "What do we do with it?"; 12 s Lucael "Keep it! Look at it go."; Lucael
`blink`; 18 s Baelor "We are not keeping it."; 24 s (after 3 hits or 6 s) Lucael `teleportBehind`
"Psst. Over here." (`intro.fight.behind`) then `teleportHome`; 30 s Baelor `freezeTime` 3 s "Hold
still." ; 36 s Lucael "It's trying so hard. Can we at least name it?"; 42 s Baelor "Brother."; 48 s
Lucael "Fine. Fine!"; 54 s Baelor "Then let us be done with it." → `end`. Write the real lines in
character (Lucael playful/skittish, Baelor dry/serious), in English and Dutch (Dutch: natural,
not a literal translation; names stay English).

### 6.4 Language keys

Keep and reuse: `intro.panel_1..3`, `intro.panel_5`, `intro.panel_6`, `intro.lucael`,
`intro.fight.arrive`, `intro.fight.behind`, `intro.fight.freeze`, `intro.fight.hint(Touch)`
(rewritten), `cutscene.holdToSkip(Touch)`. Remove keys that nothing uses any more only if the
key-check test demands it; otherwise leave them. New keys under `intro.*` (cinematic lines:
`intro.cine.<shotId>`), `intro.fight.*` (argument), `intro.ability.*` (touch labels), all in
BOTH en.json and nl.json.

## 7. Tests (Vitest), docs, checks

- Timeline: §2.4 tests. IntroArsenal: cooldowns, 60 vs 120 Hz determinism for a scripted input
  sequence, projectile leaves the room and shatters, dodge roll reproducible from the seed,
  storm bolt count. FightScript: `blink`/`end` are plain actions (existing tests still pass).
  DataValidator: new cross-reference rules + a negative case each. flow.test: `introScene` id.
  I18n key check passes (en and nl in sync).
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` (bundle check) all green.
- Headless: a new `scripts/intro-check.mjs` modelled on `scripts/mem-check.mjs`: fresh profile,
  through language/title/creator to the intro, waits for each segment (`data-shot` attribute of
  the `.ui-cine`, then the fight UI, then the second cinematic, then the world), asserts no
  console errors, and reports draw calls from the debug overlay during each segment.
- Docs: PLAN.md — add step **C.4a Intro filmisch (nieuw verhaal)** as `[x]` with a short
  result, reword C.4 to the three remaining strips (Brink, Sam, Crystal Ceremony); PROGRESS.md
  — one line for the step + a **Besluit** (2026-10-15): the intro follows Bo's new story; Sultan
  finds the player in the badlands; the old intro fight scene is replaced. ARCHITECTURE.md —
  cutscene section: `fight`/`afterFight`, set, `model: "fight"`, hops/headingFrom/ownTime/
  narration, IntroSceneState, IntroArsenal.

## 8. Open points settled by the architect (mention in the PR)

- Sultan in the badlands = the cat model (`placeholder:cat`, Pringle's glb when `AnimatedModels`
  is available in the intro; otherwise the placeholder). No name card, no spoiler.
- Thunder on `potion` (Q) and icicle on `lock` (Tab / middle mouse) during the intro only; the
  real bindings are untouched. Hints name the real keys through placeholders.
- The player keeps the sword for basic attacks whatever path they take later (the path is
  chosen after the intro).
- Temporary names used: none new. Lucael and Baelor are canonical.

## 9. Decisions after the research reports (binding for chunks B–E)

- **Sultan in the badlands is the cat.** In the lore Sultan is Pringle's true form ("Pringle was only a
  disguise", npcs.json `sultan.transformsFrom: pringle`), so the cat that finds the player IS Sultan in
  disguise. Actor: `{ "id": "sultan", "model": "placeholder:cat", "color": "zonsondergang" }` at scale 1
  (Pringle's size, 0.55 m); the real glb plays when `AnimatedModels` has it loaded (`preloadAnimatedModels`
  at `IntroSceneState.enter`), else the placeholder cat. No name card, no spoken line that names him
  (a subtitle with speaker "???" is not allowed: speakers are English names; use NO subtitle, the
  narration carries the beat). The lick = three short shots with `liftFrom 0.12 → liftTo 0` (head dips);
  `pringle.glb` has no lick clip (only Idle/Walk/Run/Pet_*), and the stage cannot trigger pet clips.
- **Brother Ansel's lines stay as they are** (`quest.a_quiet_awakening.*`, `quest.tales_by_the_fire.offer.1`:
  "found you unconscious by the road"). The journey from Morvath to Greyhaven is an ellipsis (black).
  Record as open question 20 for Bo in PLAN.md Notities: does Ansel's line need rewording now that the
  cat finds you first?
- **The castle stays unnamed** in narration ("the castle of Morvath"); whether it is The Black Citadel
  is open question 21 for Bo.
- **Touch labels:** `TouchControls.setLabels` only sets an aria-label on the potion button. Chunk C adds
  a small `setPotionLabel(text: string | null)` (shows a text label instead of the flask + count while
  set) and calls `setPotions(1)` so the button is visible; `setLockVisible(true)`; lock label = icicle,
  heavy label = explosion, potion label = thunder, all from `intro.ability.*` keys (en + nl).
- **Aim:** the icicle uses `assistedHeading` from src/systems/Combat.ts (foes as `SwordTarget`s with
  `hittable: true`) within `aimRange`/`aimHalfArc` of player.json's sword config; the `Shots` pool
  (src/systems/Shots.ts) with a static `ShotConfig` built from the ability data (id 'intro_icicle',
  element '', damage 0, manaCost 0, windup 0, homingRadians 0, charge null) and a `ShotWorld` of
  `{ heightAt: () => 0, blocked: (x, z) => outside the set radius }`; foes implement `ShotTarget`
  (`hittable: true`, `dodging: false`). Visual: a dedicated icicle InstancedMesh (cone along heading),
  not the sphere ShotRenderer.
- **Dodge text:** `DamageNumbers.spawnText(x, top, z, t('boss.dodged'), 'dodged')`; a hit shows `0`.
- **FightScript.test.ts** `the intro fight … ends with the spell of Baelor` must be rewritten: the
  real `intro_fight` beats end with an `end` action within 75 s with no input.
- **Headless check:** Playwright 1.64 is installed (`npm i --no-save playwright` already done); the
  pre-installed Chromium must be used via `executablePath: '/opt/pw-browsers/chromium'` (the
  matching headless shell is not installed). The arena scene renders much faster than Greyhaven in
  swiftshader, but the fixed step catches up at most 0.25 s per frame: budget ~10 minutes for a full
  real-time run and prefer asserting shot ids (`.ui-cine[data-shot]`) and the fight UI appearing.
- **CinematicStage draw calls:** every actor part is a separate Mesh; keep the set in `CinematicSet`
  (InstancedMesh per kind) and the actor list short (player, lucael, baelor, smoke, spark, bat, sultan).

## 10. Chunk list for the hand-off

- **B. Set + scene state.** `src/render/cinematic/CinematicSet.ts` (§3), `src/scenes/IntroSceneState.ts`
  replacing `IntroFightState.ts` (§1.1, §1.3, §4.1, §4.2, §4.4, §9), state id `introScene` in
  `flow.ts`/`main.ts`, `IntroState` routes a cinematic intro, minimal `intro`/`intro_landing` data
  with `fight`/`afterFight`, `FightScript.test.ts` updated (ends with `end`), a 60/120 Hz test on the
  real intro data, `scripts/intro-check.mjs` (Playwright, `executablePath: '/opt/pw-browsers/chromium'`
  in the cloud container; `npm i --no-save playwright` first).
- **C. Abilities.** `src/systems/IntroArsenal.ts` (§4.3, §4.5, §5, §9), pooled visuals in the scene
  state, `TouchControls.setPotionLabel`, hints with `{keyAttack}`/`{keyHeavy}`/`{keyPotion}`/`{keyLock}`,
  `abilities` + `dodgeChance` + `seed` data, tests (determinism, cooldowns, dodge rolls).
- **D. Content.** All shots of §6.1/§6.2, beats of §6.3, set props layout, `intro.*` keys in en + nl.
- **E. Finish.** Full checks, headless run, draw calls on Low/Mid/High in the debug overlay,
  PLAN.md (new step C.4a `[x]`, C.4 reworded, open questions 20/21 in Notities), PROGRESS.md
  (one line + Besluit), ARCHITECTURE.md (cutscene section), PR text in Dutch, preview republished.

## 11. As built: where the code departs from the design (chunks A–E)

Everything not listed here is as designed. Checked against the branch on 2026-10-15.

### Chunk A — engine, schema, validator

- **`ownTime` semantics.** §2.1 wrote `local / shotWallSeconds`; that fraction is the slowed one.
  The timeline uses `uWall = local / shot.seconds`: an `ownTime` actor finishes its move after the
  shot's action `seconds` of *wall* time and then stands, while the others take the whole slowed
  shot. In `time` (2.4 s at `speed` 0.4 = 6 s on screen) Baelor glides for 2.4 real seconds and
  waits; the player and Lucael crawl for 6 s. `wobble` and `headingFrom`/`headingTo` follow the
  same clock. Test: an `ownTime` actor and a plain actor sample identically in speed-1 shots.
- **`headingFrom`/`headingTo`** must come together (validator). `hops` as designed (`HOP_BLINK`
  0.08); `from`/`to` next to `hops` is an error, and a hop outside the set's radius is an **error**,
  not the warning §1.2 suggested.
- **Optional with defaults:** `hitChance` (`STORM_HIT_CHANCE` 0.25) and `range` (across the set,
  twice its radius) on the abilities, plus `strikeReach` (audit; `STORM_STRIKE_REACH` 0.9) and
  `aimRange`/`aimArcDegrees` (chunk C). `fights[].dodge` is optional too (`FIGHT_DODGE`).
- **`actorStart` is consulted in both films.** In `intro` the lords stand on their fight spots but
  start *invisible* until a shot shows them, so nothing of the room shows through the mist door
  (§2.3 had them at (0, 0)); the player starts where they are. The shipped `intro_landing` cuts to
  fixed marks in its first shot (a film cut), so there the hook only decides who is seen.
- **`CinematicStage`** keeps a `fight` actor upright (rotation x/z zeroed next to the heading),
  remembers `baseScale` and `baseOrder` of scene-owned objects and restores them in `dispose`; the
  player's root is put on `YXZ` for the roll and back afterwards.
- **`CinematicCutscene.end`** settles every actor at the film's *last moment* before `onDone`
  (not at the frame drawn last, which lags the fixed step by a frame-rate dependent amount), so
  the fight starts from the same pose at 60 and 120 Hz.
- `CONTROL_ACTIONS` moved up in `schemas.ts` (controls.json and the abilities share it). Extra
  validator rules: a cinematic with id `intro` needs a `fight` (it plays in its own scene); a
  comic may not carry `fight`/`afterFight`; an `afterFight` chain may not loop or leave the fight.

### Chunk B — set, scene state, flow

- **`CinematicSet`:** bookshelves, chairs, rocks and spikes are one `InstancedMesh` per kind; the
  door (posts, lintel, three off-centre mist discs that spin and bob) and the floors are plain
  meshes. Drifting InstancedMeshes use a dynamic buffer and are not frustum culled (their bounding
  sphere never follows the drift). The room floor reaches 3 × `radius` so its edge is lost in the
  fog. Tested: built from the real intro set, drifts with time, `dispose` leaves nothing behind.
- **`spell` no longer ends the fight:** it is a white flash and nothing more; only `end` ends the
  fight (`FightScript.test.ts`: the real beats end with one `end`, 55–75 s with no input).
- **Pringle in the intro:** `assetUrl` moved to `DataLoader` as designed; the scene builds its own
  `AnimatedModels(roles, assetUrl, null)` (no toon lights here), so `materialFor` gives the cat a
  `MeshLambertMaterial` with `map` and `normalMap`. The glTF file cache keeps that normal map
  after the intro (2048² RGBA8, ≈ 21 MB of GPU memory with mips; the world's toon material only
  uses `map`). One texture, constant across cycles, by design; the bone texture is disposed and
  the base color is reused by the world's Pringle. Dropping `normalMap` for the intro's cat is a
  possible saving, not done.
- **Leaving cleanly:** the state's own black (`ui-intro-black`) is shown at the end of the last
  film and on any skip; `exit()` clears the renderer so no frame of the set survives into the
  world's loading screen; `Input` ignores a pointer-lock loss it never held (the lock the intro
  lets go of ends in the world's new `Input`, which used to open the pause menu on arrival).

### Chunk C — abilities

- **Icicle aim from data, the staff's assist as default.** The intro sets `aimRange` 20 m and
  `aimArcDegrees` 50; without them the *staff's* aim assist from `player.json` applies (§9 said the
  sword's config, whose 4 m assist never reached a brother 9 m away). Icicle pool 3; a storm press
  during a running storm is ignored instead of restarting it; a fight without a `melee` ability
  never swings the sword.
- **Dodge numbers are data** (audit): `fights[].dodge` (`minMeters` 2, `maxMeters` 3,
  `clearanceMeters` 3, `blinkReach` 0.75) and `floats` per foe (Lucael hovers), not constants in
  the code; a dodging brother gives way to the other side when the first side is within the
  clearance of another foe. `ArsenalEvents` is sized by `IntroArsenal.maxContacts` so a storm whose
  bolts all land in one step drops nothing.
- **Dodge text** via `DamageNumbers.spawnText` with `boss.dodged` ("Dodged!"), looked up once per
  fight. Touch labels through `TouchControls.setPotionLabel` as decided in §9. Extra on a pc: a
  hint `intro.fight.clickToLook` ("Click to look around · hold Esc to skip") under the ability
  hint, because the first click only captures the mouse and the explosion is on the right button.

### Chunk D — content

- **Timings differ from §6.1/§6.2** (reading time and the reviews): corridor 7 s, legend 9 s, door
  6.5 s; `time` is 2.4 s at `speed` 0.4 (6 s on screen, not 1.2 s at 0.2); `bat` is 0.75 s at 0.3
  (2.5 s) with the swing 260 → 104 and a follow-through 104 → 60 in `whack` (1.6 s); `sky` 1.4 s
  plus a new `fall` shot (0.8 s, fade to black); badlands 7 s. Film 1 is about 67 s on screen,
  film 2 about 35 s.
- **The licks** are three 0.5 s shots (`liftFrom` 0.12 → `liftTo` 0, ease out) with **no**
  "Mrrp." subtitle (speakers must be English names, §9); the narration carries the beat. Sultan's
  actor is `placeholder:cat` in `zonsondergang`, walking in on the line he faces.
- **Staging:** Lucael's six hops end at (0, −4.4); he keeps his heading in `grab` and `bat` so the
  bat's knob sits in his raised hand; the player and the spark float at 2.7 m and the spark rides
  on the player as a trail at `whack`. The lords' arm is raised forward (`LordFactory`), so `palm`
  and `bat` sit at the hand. The four toppled chairs and the shelf inside the playable circle hang
  in the air or lie past the wall (there is no prop collision); the corridor floor disc is 34 m.
- **Lines:** `intro.cine.<shotId>` for the films, `intro.fight.<beatId>` for the argument; Lucael's
  first line reuses `intro.fight.arrive`; Baelor's verdict stays the canon `intro.baelor` and his
  greeting stays (reviewers' taste, left to Bo). Beats use `startAfterHits` so hits bring lines
  forward; `end` comes after about a minute with no input.

### Chunk E — checks and documentation

- `scripts/intro-check.mjs` grew `--quality low|mid|high` (the save is patched after the language
  choice, as `mem-check.mjs` does) and reports draw calls, triangles, geo/tex and heap per segment
  and for the settled world; fps is deliberately not reported. Results per preset and the
  before/after memory comparison: docs/PROGRESS.md, block "Extra: filmische cutscenes, stap C.4a".
- PLAN.md: step C.4a `[x]`, C.4 reworded to the three remaining strips, open questions 20–22, the
  intro on Bo's and Lucas's list. docs/ARCHITECTURE.md: *Gescripte gevechten* and *Film op een eigen
  set* checked against the code.
