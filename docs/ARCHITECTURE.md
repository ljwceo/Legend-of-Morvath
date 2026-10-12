# Architectuur – Legend of Morvath

> Hoe de game in elkaar zit (stand: einde fase 1). Code en commentaar zijn Engels, deze uitleg Nederlands.

## Overzicht

```
main.ts ── GameLoop (vaste stap 60 Hz) ── StateMachine ── Boot → LanguageSelect → Title → CharacterCreate → Intro → World
   │                                                       (Pause en Settings zijn overlays boven de scène)
   ├─ GameContext: renderer, events, loop, i18n, saves, debug, quality, perf, data, seasons, session
   ├─ QualityManager (Low/Mid/High)      ├─ AutoSave (luistert naar events)
   └─ DebugOverlay (F3)                  └─ I18n (en/nl)
```

- **Alles wat de scènes delen** zit in één `GameContext` (`src/core/GameContext.ts`), gemaakt in `main.ts`. Geen globale variabelen.
- **Data buiten de code:** content en balansgetallen staan in `public/data/*.json`, teksten in `public/lang/*.json`, kleuren in de stijlgids (`docs/art-style/tokens.json`).

## Kern: tijd, events, scènes (`src/core`)

- **Vaste tijdstap** (`Time.ts`, `GameLoop.ts`): de simulatie loopt altijd in stappen van 1/60 s met een accumulator; tekenen gebeurt elke frame en interpoleert tussen de laatste twee stappen (`alpha`). Daardoor loopt het spel op 30, 60 en 120 fps precies even snel. Snelheden zijn altijd per seconde. Maximaal 8 inhaalstappen per frame; frames langer dan 0,25 s worden afgekapt. `?fps=N` beperkt de framerate om dat te testen.
- **EventBus** (`EventBus.ts`, lijst in `events.ts`): getypte events zonder allocaties bij `emit`. Systemen kennen elkaar niet, ze luisteren: `zoneEntered`, `triggerEntered`, `placeFirstVisited`, `npcTalked`, `npcMet`, `checkpointSet`, `languageChanged`, `settingsChanged`, `qualityChanged`, `qualityAutoChosen`, `stateChanged`. Quests (fase 2–3) haken hier later op in zonder bestaande code te wijzigen.
- **StateMachine** (`StateMachine.ts`): een scène heeft `enter`, `exit`, `update(dt)`, `render(alpha)`. Een wissel gebeurt pas vóór de volgende update; `exit()` ruimt alles op (DOM, listeners, GPU-geheugen). De creator en de wereld zijn aparte downloads (`LazyState.ts`).
- **Random** (`Random.ts`): sfc32 met vaste seed; `hashSeed` geeft elke chunk zijn eigen seed, zodat de wereld voor iedereen gelijk is (ook later in raids).
- **Input** (`Input.ts`): abstract (`getMoveVector`, `isPressed('dash')`), met toetsenbord, muis (pointer lock), touch-joystick en knoppen. Tekstvelden worden genegeerd. Een gamepad kan later als extra bron.

## Data en validatie (`src/data`)

1. `DataLoader` haalt alle 14 bestanden parallel op (laadbalk), met een build-nummer in de URL zodat een nieuwe versie nooit oude JSON uit de browsercache gebruikt.
2. `schemas.ts` (zod/mini) beschrijft elk bestand: verplichte velden, types, grenzen; onbekende velden zijn een fout (typfouten vallen op). De TypeScript-types (`types.ts`) komen uit dezelfde schema's.
3. `DataValidator` controleert wat een schema niet kan: unieke ids, verwijzingen tussen bestanden (NPC → zone, quest → item, trigger → voorwaarde), posities binnen hun zone, wederzijdse buren, stijlgidskleuren, tekst-keys die echt in `en.json` staan, ringen met hysterese, schaduwafstand binnen de mist, enz.
4. Fouten: in debug een rode lijst in beeld, altijd in de console. Tests draaien de validator op de echte data (`DataValidator.test.ts`).

**Iets nieuws toevoegen = alleen data:** een NPC in `npcs.json` (+ id in de zone), een item in `items.json`, een vijand in `monsters.json`, een plek in `triggers.json`, een zone of gebouw in `zones.json`, en de teksten in beide taalbestanden. De validator zegt wat er mist.

## Taal (`src/i18n`)

- `t('key', { params })` met `{placeholders}`; ontbreekt een key, dan valt hij terug op Engels en meldt hij het in debug.
- Bij de allereerste start kies je de taal; die staat in de save en is te wisselen in Settings (scènes bouwen hun tekst opnieuw op `languageChanged`).
- Namen (personages, plekken, items) blijven in beide talen Engels en staan in data, niet in de taalbestanden.
- `I18n.test.ts` controleert dat `en.json` en `nl.json` dezelfde keys en dezelfde placeholders hebben.

## Opslaan (`src/save`)

- **Eén save** in localStorage (`SaveManager.ts`), vorm en uitleg in `SaveData.ts`: taal, instellingen (incl. grafische stand en of die automatisch is), personage (naam, uiterlijk, gold, tas, uitrusting), voortgang (`progress`: level, XP, HP en mana die over zijn; `null` = vol), quests (`quests`: lopende quests met een teller per doel, en afgeronde quests), wat van jou is geworden (`unlocks`, bijv. je stukje grond), geziene cutscenes en getoonde tips (`seenCutscenes`, `seenHints`), pad (`sword`/`light`/`dark`, nog leeg), zone + positie + kijkrichting + checkpoint, bezochte plekken, ontmoete NPC's, speeltijd.
- **Versie + migraties:** `migrations[v]` zet een save van versie v om naar v+1 (nu versie 6; v2 → v3 geeft iedereen level 1 met volle HP, v3 → v4 voegt lege quests en unlocks toe, v4 → v5 lege `seenCutscenes` en `seenHints`, v5 → v6 een lege pakdier-tas `character.pack`). Bij laden worden migraties één voor één uitgevoerd en daarna wordt de save gevalideerd. Een kapotte save gaat naar een reservekopie; een save van een nieuwere versie wordt nooit aangeraakt (de game blokkeert met een melding). Getest in `SaveManager.test.ts`.
- **Automatisch** (`AutoSave.ts`): bij een nieuwe zone, een nieuw checkpoint, een eerste bezoek aan een plek, een eerste ontmoeting met een NPC, een level omhoog, doodgaan, rusten, bij elke stap in een quest en elke aankoop, bij pauze en het openen van de tas, en bij `visibilitychange`/`pagehide` (iPhone Safari vuurt `beforeunload` niet betrouwbaar).
- **Verwijderen** alleen in Settings, twee keer bevestigen, daarna begin je bij de taalkeuze. **Export/import** als tekstcode alleen in het cheatmenu (debug).
- Een veld toevoegen: `SAVE_VERSION` ophogen, het schema aanpassen, een migratie schrijven die het veld vult, en een test.

## Zones, plekken en checkpoints (`src/world`)

- **Zones** (`zones.json`): grenzen, level-bereik, terrein, mist, buren, spawnpunten, checkpoint, gebouwen (`structures`), gebieden (`areas`, bijv. de elfenstad), scatter-regels en NPC-ids. `ZoneLocator` bepaalt in welke zone je staat; een wissel geeft `zoneEntered` (naambalk, mistkleur, autosave). Buiten is alles naadloos.
- **Gebouwen** (`StructurePlacement.ts`, `StructureLayer.ts`): placeholder-blokken uit data, op het terrein gezet, laden en ontladen met hun chunk (incl. colliders). De camera kijkt niet door muren.
- **Triggers** (`Triggers.ts`, `triggers.json`): cirkels of rechthoeken op de grond. Binnenlopen geeft `triggerEntered`; de eerste keer ook `placeFirstVisited` (uitlegtekst, opgeslagen in `visitedPlaces`). Een trigger met een voorwaarde (`Conditions.ts`) kan een poort zijn: de stadspoort gebruikt `canLeaveCity` (Sultan verslagen en level 5), die in fase 1 altijd waar is.
- **Checkpoints** (`Checkpoints.ts`): langslopen maakt het je checkpoint (`checkpointSet` → melding + autosave); bij het bed/heiligdom kun je rusten (nu alleen een melding).
- **Instances** (`Instances.ts`): `enterInstance(id)` / `exitInstance()` bestaan als interface voor interieurs en dungeons met een laadscherm; in fase 1 weigert de wereld elke instance.

## HUD (`src/ui/HUD.ts`, `HudVisibility.ts`)

Elk element is zichtbaar zolang het minstens één **reden** heeft (`show(reason)`, eventueel met een tijd) en faadt dan rustig in en uit. De regels uit het concept (gold alleen bij een shop of verandering, balken alleen in gevecht, XP na een verslagen vijand, HP-balk blijft onder 30%) staan op één plek en zijn getest; sinds fase 2 allemaal in gebruik (zonenaam, meldingen, interactie-icoontje, HP/mana/energie in gevecht, XP na een verslagen vijand, gold bij buit of doodgaan, HP en mana even na een drankje). Bij doodgaan legt de HUD een zwart scherm met tekst over alles heen (`setBlackout`). De HUD staat bovenin, nooit op de plek van de joystick of de knoppen.

## Seizoenen (`src/services/SeasonService.ts`)

Uit de echte datum: ISO-week 1 = Summer, elke week het volgende seizoen (Summer → Autumn → Winter → Spring). Week 53 loopt gewoon door. Geeft ook de tijd tot het volgende seizoen. Te forceren met F4, het cheatmenu of `?season=winter`. In fase 1 alleen zichtbaar in debug.


## Open wereld en streaming (stap 1.7)

### Het idee in één zin
De hoogte en kleur van de grond zijn een **formule** (`TerrainField`) uit `zones.json` + een vaste seed. Een Web Worker rekent die formule uit voor stukjes van 64 × 64 m (**chunks**) rond de speler; de hoofdthread zet de resultaten in kleine porties om in 3D-meshes.

### Bestanden
| Bestand | Wat |
|---|---|
| `src/world/TerrainField.ts`, `Noise.ts` | Hoogte + kleur overal in de wereld. Zones mengen op hun grens (`blendWidth`), aan de wereldrand zakt het land in zee. Puur (geen Three.js), dus te testen en ook in de worker te gebruiken. |
| `src/world/terrainConfig.ts` | Zet `zones.json` om in platte data voor de worker (zones, scatter-regels, open plekken). |
| `src/workers/terrain.worker.ts` | Bouwt per chunk: posities, normalen, kleuren, driehoeken, hoogtes en de plek van bomen/rotsen. Stuurt alles terug als transferable buffers (geen kopie). Bij de start bouwt hij ook de grove wereldkaart. |
| `src/world/ChunkMesh.ts` | Mesh-data van een chunk (met "rokje" tegen kieren tussen detailniveaus), de grove wereldkaart, en `gridHeight` (hoogte op exact de getekende driehoeken). |
| `src/world/Scatter.ts` | Plek van bomen/rotsen per chunk, altijd hetzelfde (seed per chunk), niet in water, niet op steile hellingen, niet bij spawnpunten/checkpoints. |
| `src/world/ChunkPlanner.ts` | Pure beslissingen: welke ring, welk detailniveau, wanneer ontladen, welke chunk eerst. |
| `src/world/WorldStreamer.ts` | Voert het plan uit: vraagt chunks aan bij de worker (max. 4 tegelijk), bouwt per frame max. 2 ms meshes, voegt bomen/rotsen + colliders toe, ruimt op met `dispose()`. Is ook de `Ground` (hoogte voor lopen en camera). |
| `src/world/GroundedMover.ts` | Lopen over terrein: colliders (spatial hash) + helling-limiet + diep water. |
| `src/world/FloatingOrigin.ts` | Schuift het tekenmidden mee als de speler > 1000 m weg is. |
| `src/world/ZoneLocator.ts` | In welke zone sta ik (hoogste `priority` wint). |
| `src/world/ChunkDebug.ts` | Chunkranden met statuskleuren (debug). |

### Ringen (afstand in chunks, als vierkant gemeten)
- **Actief** (≤ `active`): volle detail (32 × 32 vakjes), bomen/rotsen, botsing.
- **Preload** (≤ `preload`): lage detail (8 × 8 vakjes), geen bomen.
- **Unload** (> `unload`): pas dan wordt een geladen chunk opgeruimd. Volle detail blijft nog één ring langer staan. Dat is de hysterese: heen en weer lopen op een grens laat chunks niet flikkeren.
- De ringgroottes komen uit `quality.json` (per grafische stand).
- **Botsing** staat los daarvan: chunks binnen `collisionRing` (`zones.json`) krijgen colliders, op elke stand even ver. Bomen en rotsen staan op elke stand op dezelfde plek; alleen versiering zonder botsing (riet) wordt minder op Low. Zo is gameplay op Low, Mid en High gelijk (§2.3).

### Van verzoek tot mesh
1. De speler komt in een andere chunk → `ChunkPlanner` bepaalt per chunk wat hij moet zijn.
2. Elke frame stuurt de streamer de belangrijkste verzoeken naar de worker (dichtbij en in de looprichting eerst).
3. De worker bouwt de chunk (±1 ms) en stuurt de buffers terug.
4. De streamer maakt er binnen 2 ms per frame een `Mesh` van (+ één `InstancedMesh` per soort boom/rots + colliders).
5. Komt een antwoord binnen voor een chunk die al weg is of opnieuw is aangevraagd, dan wordt het weggegooid (`requestId`).

### Nooit een gat
Onder alles ligt de grove wereldkaart (raster van `farGridSpacing` m, iets lager, met polygon offset). Zolang een chunk nog niet geladen is, zie je die.

### Coördinaten
- Simulatie en save gebruiken altijd **echte wereldcoördinaten** (1 eenheid = 1 meter, x = oost, z = zuid).
- Alles met wereldcoördinaten hangt onder één `Group` (`world`), die met `-origin` verschoven wordt. De camera wordt relatief aan de origin geplaatst.

### Een zone of bomen toevoegen
Alleen data in `public/data/zones.json`:
- Zone: `bounds`, `terrain.baseHeight`, `terrain.amplitude`, `terrainColor` (stijlgids-token).
- Bomen/rotsen: `scatter: [{ "prop": "tree", "perHectare": 40, "minScale": 0.8, "maxScale": 1.4 }]`.
- Nieuwe soort: `world.props` (+ een placeholder-model in `src/entities/PropFactory.ts`, later een glTF-bestand).
- De `DataValidator` controleert verwijzingen en grenzen bij het opstarten.

## Bundel en laden

- Three.js (`three-….js`) en andere bibliotheken (`vendor-….js`) staan in eigen bestanden en blijven in de browsercache tussen versies.
- De character creator en de wereld laden pas als ze nodig zijn (`src/core/LazyState.ts`); vanaf het titelscherm worden ze al opgehaald.
- `scripts/check-bundle.mjs` laat de build falen als één bestand groter is dan 800 kB.

## Cheatmenu (alleen debug)
`src/systems/Cheats.ts` (snelheid, vliegen) en `src/ui/CheatPanel.ts` (F6 of de knop "Cheats"): snelheid, vliegen, chunkranden, seizoen forceren, benchmark opnieuw, save exporteren/importeren als tekstcode, teleport naar elke zone, XP/gold/drankjes/gear geven, de grootte van het debugvenster. Wordt nooit opgeslagen; zet je debugmodus uit, dan gaan alle cheats uit. Het debugvenster zelf (`DebugOverlay`) heeft 5 groottes (F3 wisselt, ook "verborgen"); debugmodus en cheats blijven aan als het verborgen is.

## NPC's (stap 1.9)

- **Data:** `public/data/npcs.json`. `roles` geven kleur, placeholder-model en botsingsstraal; `npcs` geven plek, gedrag (`static` / `wander` / `follow`), dialoog-keys en eventueel `dialogueWhen` (andere zinnen als een voorwaarde uit `triggers.json` waar is) en `season`. `settings` bevat alle afstanden en tijden.
- **Simulatie** (vaste stap, `src/systems/Npcs.ts`): tonen/verbergen rond de speler (vaste afstand, met marge), statische NPC's draaien naar de speler, wanderers (`NpcBehavior.ts`) lopen binnen de botsingsring, de companion (`entities/Companion.ts`) zwerft om de speler heen (zie hieronder). Solide NPC's duwen de speler weg. Alles beweegt met dezelfde `GroundedMover` als de speler (muren, hellingen, diep water).
- **Tekenen** (`src/render/NpcRenderer.ts`): één InstancedMesh per modeldeel uit `entities/NpcFactory.ts`, geïnterpoleerd tussen simulatiestappen.
- **Praten** (`WorldState` + `ui/Dialog.ts`): het dichtstbijzijnde NPC binnen bereik krijgt het interactie-icoontje; E of tikken opent het dialoogvenster. Events: `npcTalked` (elk gesprek), `npcMet` (eerste keer → autosave).
- **Pringle** (`entities/Companion.ts`, getallen in `follow` van Pringle in `npcs.json`): geen vaste afstand. Hij kiest steeds een plekje naast je (tussen `minDistance` en `maxDistance`, schuin opzij, nooit recht voor je en nooit tussen jou en de camera). Sta je stil, dan zit hij, kijkt rond en wandelt af en toe (`strollSpeed`, pauzes `idlePauseSeconds`) naar een ander plekje, zonder langs je voeten te lopen. Loop je echt (langer dan ~1 s), dan draaft hij naast je mee (`speed`), blijft aan zijn kant, snuffelt soms even en haalt je weer in. Loop je naar hem toe om te aaien, dan blijft hij zitten. Ver weg of vast achter een muur: hij springt naast je.
- **Pakdier** (Biscuit, stap 3.2): een NPC met `interaction: "pack"` en `pack.maxKg` volgt je met hetzelfde `Companion`-gedrag als Pringle (eigen `follow`-getallen: verder weg, rustiger). Hij komt pas als zijn `presentWhen` waar is (`hasBiscuit` = de quest *A Friend for the Road* van Marco is klaar, die na Sultan begint). E bij hem opent `ui/menus/PackPanel.ts` (alleen buiten een gevecht). De logica staat in `src/systems/PackAnimal.ts` (puur, getest): wat op het pakdier ligt (`character.pack` in de save) telt niet voor je draaglast, maar is ook niet bruikbaar (drankjes, gear en questitems werken alleen vanuit je eigen tas). Gedragen gear blijft bij jou; wapens en armor wegen mee tot `maxKg`, de rest past altijd. `minDistance` moet groter zijn dan `interactRange` (validator), anders pakt het pakdier steeds de E-toets af.
- **Wachten bij een ingang** (haak voor dungeons): `Npcs.waitAt(id, x, z, …)` laat een companion op een plek staan (hij doet dan mee als gewone NPC, ook bij teleport blijft hij staan); `Npcs.stopWaiting(...)` roept hem terug naast je. Nog niet gebruikt; komt bij de instances (3.3) en De Wortelgrotten.
- **Nieuwe NPC toevoegen:** zet hem in `npcs.json` (en zijn id in `npcs` van zijn zone in `zones.json`) en zijn teksten in `en.json` + `nl.json`. De validator controleert de rest.


## Grafische standen (stap 1.10)

- **Eén baas:** `src/render/QualityManager.ts` kiest de stand en zet de renderer (resolutie, anti-aliasing). Iedereen die meer wil aanpassen luistert naar het event `qualityChanged`; de wereld (`WorldState.applyPreset`) past dan mist, kijkafstand, chunk-ringen, schaduwen en de dichtheid van versiering (riet) aan.
- **Welke stand:** `chosenLevel` in `src/render/quality.ts`: koos de speler Low/Mid/High in Settings, dan die; bij Auto de automatisch gekozen stand (`autoQuality` in de save); daarvoor de `default` uit `quality.json`.
- **Benchmark** (alleen bij Auto zonder gekozen stand): de eerste seconden in de wereld (na `warmupSeconds`, `durationSeconds` lang) wacht elk frame op de GPU (één pixel teruglezen) en meet hoe lang simuleren + tekenen duurt. De **mediaan** (één trage frame door laden telt niet) bepaalt de stand: ≤ `highMaxFrameMs` High, ≤ `midMaxFrameMs` Mid, anders Low. Opgeslagen + melding.
- **Automatisch omlaag** (alleen bij Auto): `QualityTuner` middelt de fps over vensters van `windowSeconds`. Onder `belowFps` → één stand omlaag + melding. Na elke wissel, pauze of binnenkomen eerst `graceSecondsAfterChange` niets. Nooit omhoog. Alleen spelen in de wereld telt (niet pauze, menu's of de tab op de achtergrond).
- **Wat een stand verandert** (alleen uiterlijk, nooit gameplay, §2.3): resolutie (`pixelRatio`), anti-aliasing (`off`, `fxaa` als nabewerking, `msaa` via een render target met 4 samples), schaduwen (`shadowDistance` m rond de speler, `shadowMapSize`, `shadowSoftness`), kijkafstand en mist (`fogFar`), chunk-ringen, versiering zonder botsing (`density.props`), fps-doel bij fps "Auto" (`fpsTarget`). Botsing, NPC-afstand en bomen/rotsen zijn op elke stand gelijk.
- **Schaduwen:** één zon (`DirectionalLight`) die met de speler meeschuift (in hele schaduw-texels, tegen kruipende randen). Chunks en gebouwen ontvangen, bomen/rotsen/gebouwen/speler/NPC's werpen.
- `density.grass`, `density.effects` en `lodBias` staan al in de data voor later (gras, effecten); ze doen nog niets.

## Gevecht (fase 2)

- **Zwaard en HP** (`src/systems/Combat.ts`): pure functies op de vaste tijdstap. `stepSword` krijgt wat je indrukte en geeft terug welke slag landt (fast/heavy) met hoeveel schade; `inSwingArc` zegt of een doel in de boog staat; `assistedHeading` doet de richthulp. Alle getallen in `player.json` (`sword`, `combat`, `regen`).
- **Vijanden** (`src/entities/Enemy.ts`, `src/systems/Enemies.ts`): **één pool**, gevuld bij het bouwen van de wereld uit `spawns` (losse vijanden op een vaste plek: trainingspoppen, Treewardens, de Goblin Chief) en `spawnAreas` (een cirkel met `count` groepjes) in `zones.json`. Een groepje is één vijand, of `groupSize` vijanden (goblins 2–3). Elke plek in de pool houdt zijn soort; vijanden gaan aan en uit (verslagen, terugkomen, een Big Slime die splitst in 2 Green Slimes uit plekken die daarvoor klaarstaan). Zo wordt er tijdens het spelen niets aangemaakt. Getekend binnen `npcs.settings.showRadius`, bewegen en vechten binnen `monsters.json` → `settings.simulateRadius` (60 m, waar botsing geladen is), op elke stand hetzelfde. Een verslagen groepje komt na `respawnSeconds` terug, maar alleen als je minstens `respawnMinPlayerDistance` weg bent.
- **AI** (`src/systems/EnemyAI.ts`, pure functies op de vaste stap): rustig = rondlopen rond hun plek (`wander`), binnen `ai.aggroRadius` merken ze je op (neutrale Treewardens alleen als je ze slaat) en roepen hun groepje (`packAggroRadius`). Dan: achtervolgen → **windup** (zichtbaar: oranje gloed, achteroverleunen, inkrimpen) → slag → herstellen. Soorten (`ai.attack.style`): `strike` (raakt vóór hem als je bij het landen nog binnen bereik staat), `lunge` (slime springt `lungeDistance` vooruit en raakt bij contact), `shoot` (pijl uit `Projectiles.ts`, vliegt naar waar je stond). Speciale aanvallen uit `attacks` met `everyNth` en `areaRadius` (Big Swing, Heavy Slam) krijgen een **rode cirkel** op de grond die volloopt (`render/CombatEffects.ts`). Terug naar huis (en heel) als ze te ver van hun plek zijn (`leashRadius`), vastlopen, je knock-out gaat, of een Treewarden rustig wordt (`calmDownSeconds`) of in zijn veilige gebied staat (`safeAreas`, daar is hij ook niet te raken).
- **Speler geraakt** (`WorldState.hurtPlayer`): HP omlaag, rood getal en rode rand.
- **Doodgaan** (`WorldState.startDying` / `stepDeath`, getallen in `player.json` → `death`): bij 0 HP wordt het scherm zwart ("Je bent verslagen", hoeveel gold je kwijt bent), je verliest 10% van je gold (naar beneden afgerond, `Progression.deathGoldLoss`), items houd je. Je wordt wakker bij je checkpoint met volle HP en mana, de vijanden zijn weer heel, en de game slaat meteen op. Tijdens het zwarte scherm kun je niets en vallen vijanden niet aan. Event `playerDied`.
- **XP en levels** (`src/systems/Progression.ts`, puur en getest): `xpToNextLevel` uit `player.json`; na het einde van de tabel kost elk level evenveel als de laatste stap. Een verslagen vijand geeft zijn `xp` (`monsters.json`); een level omhoog geeft +HP/+mana (`perLevel`), meer zwaardschade (`damagePerLevel`) en vult HP en mana (`levelUpRefill`). Events `monsterDefeated`, `xpGained`, `levelUp`; de XP-balk volgt de HUD-regels en loopt na een level eerst helemaal vol.
- **Buit en tas** (`src/systems/Inventory.ts`, puur en getest): `rollDrops` rolt de `drops` van een vijand (kans en min–max); buit gaat meteen in de tas (geen spullen op de grond), gold naar de gold-teller (rechtsboven even zichtbaar). De tas heeft geen limiet (concept). Tas openen: I of B, of het tas-knopje naast pauze; het spel wacht zolang de tas open is (`ui/menus/BagPanel.ts`). Event `itemsGained`.
- **Drankjes**: items met `type: "potion"` hebben een `potion`-blok (`hp`, `mana`) in `items.json`. Q of de drankknop (telefoon, met het aantal erop) drinkt het eerste drankje uit `player.json` → `potions.quickOrder` dat je hebt; in de tas kies je zelf. `cooldownSeconds` tussen twee drankjes; bij volle HP drink je niets. Event `potionDrunk`.
- **Rusten**: E bij een checkpoint maakt HP en mana vol en slaat op. Event `playerRested`.
- **Tekenen** (`src/render/EnemyRenderer.ts`, modellen in `src/entities/EnemyFactory.ts`): één InstancedMesh per modeldeel, met `scale` per soort (Big Slime = grote slime). Slimes stuiteren en plat bij doodgaan, rechtop-vijanden leunen in hun slag en vallen om. Pijlen en waarschuwingen in `src/render/CombatEffects.ts`.
- **Schadegetallen** (`src/ui/DamageNumbers.ts`): vaste pool DOM-elementen boven de 3D-wereld.
- **Een nieuwe vijand toevoegen:** zet hem in `monsters.json` (met `model` en een `ai`-blok) en een `spawn` of `spawnArea` in de zone; een nieuw placeholder-model komt in `EnemyFactory.ts`. De validator controleert de verwijzingen (en dat een vijand die loopt en vecht een `ai`-blok heeft), een test controleert dat elk model bestaat.
- **Cheatmenu:** "Monsters vallen aan" uit = rustig rondlopen tussen de vijanden. "Geven": +100 XP, +50 Gold, +5 Health Potion, +3 Slime Gel.
- **Wapenbonus:** het gedragen wapen (`equipment.weapon`) geeft zijn `weapon.damageBonus` uit `items.json` bij elke slag (fast en heavy), bovenop level en combo.
- **Gescripte gevechten** (intro): `fights` in `cutscenes.json` (arena, tegenstanders, beats met acties). `src/systems/FightScript.ts` speelt de beats af op de vaste tijdstap (wachten op slagen of seconden), `src/scenes/IntroFightState.ts` maakt er effecten van. Een paneel met `"fight": "<id>"` in een cutscene wordt zo'n gevecht; daarna gaat de intro verder (`ctx.introPanel`). Een nieuwe grap = een nieuwe beat of actie in de data.

## Quests (stap 2.5)

- **Data** (`quests.json`): een quest heeft een `giver` (NPC), `requires` (level, eerdere quests, items), `objectives`, `dialogue` (`offer`, `progress`, `complete`: tekst-keys) en `rewards` (XP, gold, items, `upgrades` zoals `old_sword` → `honed_old_sword`, en `unlocks` zoals `garden_plot`). Een nieuwe quest is alleen data.
- **Soorten doelen:** `talk` (praat met een NPC; de gever zelf telt meteen bij het aannemen, zoals het verhaal van Old Bertha), `find` (items in je tas hebben), `deliver` (items brengen; ze gaan uit je tas bij het inleveren), `kill`, `boss`, `buy` (kopen in een winkel, eventueel alleen bij één NPC), `rest` (rusten bij een (bepaald) checkpoint), `visit` (een trigger-gebied in lopen) en `choosePath` (je pad kiezen bij een leraar, Your Resolve). `rest`, `visit` en `choosePath` hebben een eigen tekst-key (`text`) die zegt waar.
- **Logica** (`src/systems/Quests.ts`, puur en getest): `QuestBook` werkt direct op `save.quests`. Status per quest: `locked` → `available` → `active` → `ready` → `done`. Getelde doelen tellen pas na het aannemen; item-doelen kijken naar je tas, dus wat je al had telt mee. `forNpc` kiest wat een NPC zegt: eerst een quest om in te leveren, dan een nieuwe, dan een lopende.
- **In de wereld** (`WorldState`): praten met een gever met een quest neemt hem meteen aan (melding "Nieuwe quest"), laat bij een lopende quest zien wat je nog mist (✓/✗-lijstje onder de laatste zin, `ui/questText.ts`), en levert een klare quest meteen in (beloning met tekstjes boven je hoofd, opslaan). Events (`monsterDefeated`, `playerRested`, `triggerEntered`, `itemBought`, `itemsGained`, `npcTalked`) tellen voor de lopende quests en geven een korte melding ("Steel and Slime · Breng Slime Gel naar Hilda Ironhand 2/3" of "ga terug naar Hilda"). Nieuwe events: `questStarted`, `questReady`, `questCompleted`, `itemBought`.
- **Markeringen:** een gouden ruit boven een NPC met een nieuwe quest, een blauwe boven een NPC waar je een quest kunt inleveren (één InstancedMesh in `NpcRenderer`, onverlicht).
- **Tas:** onder je spullen staan de lopende quests met elk doel en ✓/✗.
- **Winkel** (`ui/menus/ShopPanel.ts`): een NPC met `shop` in `npcs.json` (Marco) opent na het laatste zinnetje zijn winkel (niet na Escape of weglopen). Eén item per klik, prijs in gold; gold rechtsboven volgens de HUD-regel "bij een shop". Het spel wacht zolang de winkel open is.
- **Validator:** gever, NPC's, items, monsters, triggers en checkpoints bestaan; een quest met gever heeft `dialogue`; een `buy`-doel heeft een winkel die het item verkoopt; upgrades verwijzen naar bestaande items; gold is niet te koop.
- **Quests zonder gever** (Defeat Sultan): beginnen vanzelf zodra `requires` klopt (melding + `description`), en zijn meteen klaar als het doel gehaald is (er is niemand om ze bij in te leveren).

## Baasgevecht: Sultan (stap 2.6)

- **Data** (`monsters.json`, bij de baas): `boss` zegt welke `quest`, welke `trigger` (het gebied vlak voor de stadspoort) en welke `cutscene` erbij horen, waar de `arena` ligt (cirkel, niemand kan eruit), waar de baas en jij beginnen, de pauze tussen aanvallen, hoe ver hij na een aanval wegspringt (`retreatGap`), hoe lang hij daarna stilstaat (`vulnerableSeconds`), zijn zinnen (`retryLine`, `enrageLine`, `winLine`) en de tips (`strikeHint`, `guardHint`, `guardText`). Elke aanval in `attacks` heeft een `pattern`: `combo` (klauwslagen achter elkaar: Claw Combo, Flurry), `pounce` (sprong naar waar je stond: Pounce) of `charge` (rennen over een rode streep: Dash Strike), met afstanden (`minGap`/`maxGap`), waarschuwingstijd, bereik en een eigen `hint`. Onder `enrage.belowHpFraction` wordt hij `speedFactor` sneller en komt Flurry erbij (`onlyWhenEnraged`, `everyNth`).
- **AI** (`src/systems/BossAI.ts`, puur en getest): `stalk` (rondcirkelen en naderen tot de volgende aanval past) → `telegraph` (de waarschuwing) → `attack` → `retreat` (wegspringen) → `opening` (stilstaan: **alleen dan kun je hem raken**, `Enemy.guarded` is dan uit) → … Op 60 en 120 Hz precies hetzelfde. De baas zit in dezelfde pool als de andere vijanden (`Enemies.bosses`), maar staat alleen tijdens zijn gevecht in de wereld.
- **In de wereld** (`src/scenes/BossEncounter.ts`): het trigger-gebied in lopen terwijl de quest kan beginnen (of loopt) speelt de stripcutscene één keer (`src/ui/ComicCutscene.ts`, panelen uit `cutscenes.json` met `caption`, `background`, `zoom`, `shake`, `flash`; overslaanbaar), daarna het gevecht: jij en de baas op je plek, HP-balk van de baas bovenin, gouden ring op de grond, Pringle weg (`transformsFrom`). Tips verschijnen één keer (`seenHints`). Winnen: de quest is klaar, Sultan staat daarna als NPC buiten de poort (`presentWhen` in `npcs.json`) en Pringle is weg (`absentWhen`). Verliezen = gewoon doodgaan: wakker bij je checkpoint, terug naar de poort, en dan begint het gevecht meteen opnieuw (cutscene al gezien).
- **Tekenen:** `EnemyRenderer` geeft de baas zijn houdingen (gloed, door de knieën, sprongen, klauwslagen, hijgen); `WarningRenderer` tekent de rode streep van de Dash Strike en de arenaring. Model: `placeholder:sultan` (kattenman) in `EnemyFactory.ts`, dezelfde vorm als NPC (`placeholder:catman`).
- **Balans en prestaties** (stap 2.7): `src/systems/Balance.test.ts` laat een nagebootste speler (de echte zwaard-, beweeg- en baascode) tegen Sultan vechten: snel ontwijken, langzaam ontwijken en nooit ontwijken, met grenzen voor duur en winst. Verander je getallen in `monsters.json`, dan zie je meteen of het gevecht te makkelijk of te moeilijk wordt (`npx vitest run Balance --silent=false` laat de uitslag zien). `src/systems/EnemiesPerf.test.ts` meet de rekentijd van alle vijanden op de vaste tijdstap.
- **Een nieuwe baas** is data: een monster met `boss` en `attacks` met een `pattern`, een trigger, een quest zonder gever (doel `boss`) en een cutscene.

## Gear en draaglast (stap 3.1)

- **Alles in data:** gear staat in `items.json` (`type` weapon/armor, `slot` hat/mantle/amulet/ring, `rarity`, `weight` in kg en `stats`: hp, mana, damagePercent, damageReductionPercent, moveSpeedPercent). De validator eist een gewicht bij elk wapen en elke armor, en stats alleen bij gear.
- **`src/systems/Gear.ts` (puur, getest):** 6 slots (`weapon`, `hat`, `mantle`, `amulet`, `ring1`, `ring2`). De tas bevat al je spullen; `character.equipment` zegt alleen wat je draagt. `equip` kiest het slot (ringen: eerst een lege ring), `unequip` laat nooit je wapen los, `dropMissingEquipment` haalt gedragen spullen weg die niet meer in de tas zitten.
- **Draaglast zoals Elden Ring:** `carriedWeight` telt alle wapens en armor in je tas (aan of reserve); grondstoffen, drankjes en questitems wegen niets. Maximum = `player.json` → `load.baseKg` + `perLevelKg` per level. De eerste stand in `load.tiers` waarvan `maxRatio` niet overschreden wordt geldt (licht ≤ 30%, middel ≤ 70%, zwaar ≤ 100%, anders overbelast).
- **Beweging:** `loadedMovement` (in `Movement.ts`) maakt van de basisbeweging een versie met de stand erin: loopsnelheid × `walkFactor` × (1 + snelheid van gear), dash × `dashDistanceFactor`, extra energie, `dashRecoverySeconds` (na een dash even stilstaan, de "fat roll") en `canDash`. Licht is precies de oude beweging (test).
- **Gevecht:** gear zet op `CombatState` `gearHp`, `gearMana`, `damageFactor` en `damageTakenFactor`; `applyLevel` telt de HP/mana mee, `stepSword` vermenigvuldigt de schade, `damageTaken` verzacht inkomende schade (minstens 1).
- **Wereld:** `WorldState.applyGear` rekent alles opnieuw uit bij aandoen/uitdoen, nieuwe gear in de tas, een level omhoog en een quest-beloning; bij een andere stand verschijnt de uitleg uit `load.tiers[].message`. Aan- en uitdoen kan alleen buiten een gevecht. Het poppetje toont hoed en amulet in hun zeldzaamheidskleur, de mantel alleen als je hem draagt, en een zwaarder zwaard groter (`CharacterModel.setGear`).


## Blender-zones: Greyhaven (2026-10-10)

Een zone met een blok `scene` in `zones.json` komt uit Blender in plaats van uit het gestreamde terrein.

| Bestand | Wat |
|---|---|
| `public/zones/greyhaven/` | De export uit Blender: `greyhaven.glb` (Y-up, KHR_mesh_quantization, één mesh per materiaal, bomen als losse `Tree*`-nodes), `player.glb`, `materials.json` (hoe elk materiaal eruitziet, terreinkaart, spawn), `tex/`. Niet met de hand aanpassen: een nieuwe export overschrijft ze |
| `src/world/scene/SceneAssets.ts` | Laadt alles async met voortgang (laadscherm in `WorldState`) |
| `src/world/scene/SceneZone.ts` | Maakt de meshes (toon-materiaal per Blender-materiaal), bomen als InstancedMesh per materiaal per 60 m-cel, één MeshBVH voor de botsing (zonder water, klimop en gloeiende materialen), stamcirkels, lantaarnposities. Is `Ground`, `Mover` en `CameraOccluder`, dus de bestaande spelercontroller, NPC's en camera werken er gewoon mee |
| `src/world/scene/ScenePlayerModel.ts` | `player.glb` met de toon-shader en de kleuren uit de character creator (`CharacterModel.useModel`) |
| `src/render/toon/ToonMaterial.ts`, `SkyDome.ts` | De toon-shader (triplanar, terreinkaart, twee tinten, gloed, water, mist, lantaarnlichten) en de lucht. Licht- en luchtkleuren zijn **gedeelde uniforms** |

- **Coördinaten:** de Blender-oorsprong ligt op `scene.offset` in de wereld. Blender (x, y, z-up) = wereld (x + offset.x, z + offset.y, −y + offset.z). Alle data (spawnpunten, NPC's, triggers, veilige zones) blijft in wereldcoördinaten. De debugregel `chunks` toont in een Blender-zone je positie in Blender-coördinaten.
- **Lopen:** een capsule duwt je alleen zijwaarts uit muren; een straal naar beneden vanaf `stepHeight` (0,55 m) zet je op de grond, dus trappen werken. Van een rand val je met zwaartekracht. Onder de zee (`respawnBelowWater`) of buiten de kaart: terug naar het eerste spawnpunt.
- **Overgang:** een `exit` in `scene` laadt de open wereld (`travel` in `WorldState`: bestemming in de save, dan wordt de wereld opnieuw opgebouwd). Loop je in de open wereld een zone met `scene` binnen, dan laadt die (aankomst bij het dichtstbijzijnde spawnpunt). In een Blender-zone horen alleen de NPC's, triggers, checkpoints en monsters van die zone erbij; in de open wereld juist die van de andere zones.
- **Nieuwe Blender-zone:** export in `public/zones/<id>/`, een blok `scene` + spawnpunten in `zones.json`. De validator controleert kleuren, mist en uitgangen.

## Dag en nacht (2026-10-10)

- **Klok** (`src/services/DayNightService.ts`): tijd van de dag = (`Date.now()`) modulo de lengte van een dag uit `public/data/daynight.json` (nu 40 min: dag 20, schemer 3, nacht 14, ochtendschemer 3). Iedereen ziet dezelfde tijd zonder server. Testmodus (cheatmenu): naar een fase springen, sneller laten lopen, terug naar de echte klok. Getest in `DayNightService.test.ts`.
- **Licht** (`src/render/DayNightLighting.ts`): per fase een *look* (kleuren zijn stijlgids-tokens, groep `licht`). Rond elke wissel mengen twee looks vloeiend (`blendMinutes`). Elke frame worden de gedeelde uniforms bijgewerkt (toon-materialen, lucht) en de Three.js-lichten en mist van de open wereld. Een zone met `"lighting": "goldenHour"` krijgt altijd de look `golden_hour`.
- **Lantaarns:** de gloed van lantaarns/kristallen en ramen volgt de look; op High krijgen de dichtstbijzijnde lantaarns echte lichten (`lanternLights`).

## Mobs bij nacht (2026-10-10)

- **Data:** per zone `safeZones` (NPC-gebieden, daar verschijnt nooit iets) en `nightSpawns` (gebied, monsters met gewicht, `maxAlive`, levels, `respawnSeconds`, eventueel `testOnly`); regels in `world.nightSpawning`; welke fases in `daynight.json` (`spawnPhases`).
- **Systeem:** `Enemies.stepSpawning` op de vaste stap, in **dezelfde pool** als alle andere vijanden (geen eigen vijandcode). Per gebied en per monster in de lijst staan `maxAlive` groepjes klaar (`Pack` met `night: true`); er zijn er nooit meer dan `maxAlive` tegelijk in de wereld. Elke `checkSeconds` kiest een gebied een monster op gewicht en zet een vrij groepje neer op een willekeurige plek: in het gebied, buiten elke veilige zone, tussen min- en max-afstand van de speler, op droge grond. Daarna doen AI, aanvallen, splitsen (Big Slime), liggen na verslaan (`monsters.json` → `settings.corpseSeconds`) en tekenen precies hetzelfde als bij de vijanden overdag. Is een groepje helemaal weg, dan komt zijn plek na `respawnSeconds` weer vrij. Overdag blijven bestaande monsters staan (open vraag). Getest in `NightSpawns.test.ts`.

## Instances: Brink's toren en Sams kelder (stap 3.3, 2026-10-11)

- **Data** (`zones.json`, `instances` van een zone met `scene`): een instance met een blok `scene` wordt uit het Blender-model van de zone geknipt. `door` (vorm in de stad: daar loop je naar binnen), `region` (doos in wereldcoördinaten: alleen de driehoeken die er helemaal in liggen horen bij de instance, behalve `exclude`-materialen), `cut` (doos: deze driehoeken laat de stad weg, eventueel alleen `materials`), `spawn` (waar je binnenkomt, met hoogte, want een toren heeft verdiepingen), `exit` (vorm binnen + waar je buiten weer staat) en `cutscene` (de eerste keer, `cutscenes.json`). NPC's met `instance` staan alleen in die instance.
- **Knippen** (`src/world/scene/SceneFilter.ts`, getest): `instanceFilter` / `zoneFilter` maken een filter; `SceneZone` filtert bij het bouwen per mesh de index (de vertices worden gedeeld, er wordt niets gekopieerd). Ook bomen, lantaarns en de BVH-botsing volgen het filter. In een instance is de kaart (`onMap`) de doos van de instance.
- **Flow** (`WorldState.enterInstance` / `exitInstance`): door de deur → `world.instance` in de save → de wereld wordt opnieuw opgebouwd met alleen de instance (laadscherm met de naam van de instance), de stad wordt opgeruimd. De eerste keer speelt de cutscene (`seenCutscenes`). Door de uitgang → terug in de stad op `exit.to`. Herladen in een instance zet je weer in de instance (save versie 7). Event `instanceEntered` voor quests.
- **Nu:** `brink_tower` (de toren met het paarse dak en de vier elementkristallen; de stad houdt de buitenkant, het interieur zit in de instance) en `sam_cellar` (de kelder onder de oostvleugel van de Academy, via de trap; de stad laat de hele kelder weg).
- **Een nieuwe instance** = alleen data: dozen opmeten in Blender (wereld = Blender x + offset.x, z-hoogte, −y), deur, spawn, uitgang en eventueel een cutscene.

## Your Resolve: je pad kiezen (stap 3.4, 2026-10-11)

- **Data** (`npcs.json`): een leraar heeft een blok `teaches`: `path` (`sword`, `light` of `dark`, één leraar per pad), `when` (een voorwaarde uit `triggers.json`, nu `canChoosePath` = Sultan verslagen en nog geen pad), `offer` (zinnen vooraf), `question` ("Will you train under me?"), `confirm` ("Weet je het zeker?"), `accepted` en `declined`. Na de keuze zegt elke leraar iets anders via `dialogueWhen` met de nieuwe voorwaarden `pathSword` / `pathLight` / `pathDark` (je eigen leraar) en `pathChosen` (een andere leraar).
- **Voorwaarde `path`** (`world/Conditions.ts`): `{ "type": "path", "is": "none" | "any" | "sword" | "light" | "dark" }`. `ConditionContext.path` komt uit `save.path` (stond al sinds fase 1 in de save, dus geen nieuwe saveversie).
- **Keuzeknoppen in de dialoog** (`ui/Dialog.ts`): `open(..., { choices, selected })` zet antwoordknoppen onder de laatste zin. Tikken of klikken op een knop, of W/S/A/D, pijltjes of de joystick om te kiezen en E, spatie, Enter of een klik (muis gevangen) om te bevestigen. Met knoppen in beeld doet een tik naast de knoppen niets. Escape of weglopen sluit zonder te kiezen. Bruikbaar voor elke latere keuze.
- **Flow** (`WorldState.askToTrain` → `confirmPath` → `takePath`, pure regels in `systems/PathChoice.ts`): Nee mag altijd (`declined`, je kunt naar een andere leraar). Ja vraagt nog één keer, en daar staat **"Nee, nog niet" voorgeselecteerd**, zodat E-spammen nooit per ongeluk kiest. Ja, zeker → `save.path` (kan maar één keer), event `pathChosen`, melding, opslaan, en het doel `choosePath` maakt de quest *Your Resolve* klaar (zonder gever, dus meteen ingeleverd: +50 XP).
- **Quest *Your Resolve*** (`quests.json`): zonder gever, begint vanzelf na Defeat Sultan (ook in oude saves bij het laden). Een leraar die op je antwoord wacht, krijgt dezelfde gouden ruit als een NPC met een nieuwe quest.
- **Cheatmenu:** "Sultan verslagen (overslaan)" en "Pad: Geen / Zwaard / Licht / Duister" om snel te testen (Geen = de leraren vragen het weer).
- **Validator:** de voorwaarde en alle teksten van `teaches` bestaan, een leraar is een NPC om mee te praten, en elk pad heeft hooguit één leraar.
