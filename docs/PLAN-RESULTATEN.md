# PLAN – verslagen van afgeronde stappen

Hier staan de uitgebreide notities van 21 afgeronde stappen, woord voor woord overgenomen uit `PLAN.md`
(op 2026-10-16, om `PLAN.md` korter te maken). In `PLAN.md` staat bij deze stappen alleen de opdracht en
het "Klaar als:"-criterium, met een verwijzing naar het stapnummer hieronder. Niet alle afgeronde stappen
zijn verplaatst: van de andere staat het verslag nog in `PLAN.md` zelf.

Een nieuw verslag? Eén korte regel in `PLAN.md`; het lange verhaal hier of in `docs/PROGRESS.md`.

## Extra – Filmische cutscenes (Elden Ring-stijl)

### C.4a Intro filmisch (nieuw verhaal van Bo, 2026-10-15)

Door de mistdeur van het kasteel van Morvath een kamer in waar tijd en werkelijkheid niet gelden; Lucael teleporteert om je heen en bekijkt je, Baelor loopt door bevroren tijd; jouw explosie; het gevecht (±1 min, vier aanvallen: slaan, explosie, donder over de hele kamer, een grote ijspegel — bijna alles mist ("Dodged!"), wat raakt doet 0) terwijl de broers ruziën wat ze met je moeten; Lucael krimpt je, Baelor tilt je op, Lucael slaat je weg met een honkbalknuppel; je landt in de badlands, de kat (Sultan, zonder naam) likt je gezicht; zwart; wakker in het klooster.

(Gebouwd 2026-10-15. Gemeten in headless Chromium op alle drie de standen, zonder fouten: draw calls film 1 **25–51 / 27–53 / 26–52** (Low / Mid / High), gevecht **29–52 / 31–54 / 30–53**, film 2 **13–51 / 15–53 / 14–52**, tegen 157–159 in Greyhaven; Mid en High alleen +2 voor FXAA; fps is daar niet te meten. Na Bo's proefronde (2026-10-15): een indicator die laat zien wanneer je vaardigheden weer klaar zijn — chips op de pc (`AbilityBar`), een wig op de telefoonknop — in de intro én in de wereld (de Shard en de spell van de staf). Bo: spelen op pc en iPhone, fps meten, en open vraag 20, 21 en 22.)

### C.4 De overige strips omzetten

(Gebouwd 2026-10-16: de uitleg van Brink, die van Sam en beide Crystal Ceremonies zijn films met ondertitels, allemaal overslaanbaar met Escape ingedrukt houden; alle strip-code, `panels` in het schema, de strip-taalkeys, de strip-CSS en `IntroState` zijn weg. De ceremonie blijft in de wachtrij tot hij echt gestart is. Alle camerastanden zijn schattingen op papier en nog niet in het spel bekeken: Bo/Lucas bekijken ze via de toren, de kelder en een nieuwe staf-quest, en geven bij te sturen standen door.)

- _Auto-run 2026-10-16, eerste poging (de tweede run is wel goedgekeurd, zie hierboven): afgekeurd omdat na één herstelronde nog strip-resten over waren: dode taal-keys (`intro.skip`, `intro.tapToContinue`, `cutscene.skip`, `cutscene.tapToContinue`, `cutscene.brink_tower.caption1-3`, `cutscene.sam_cellar.caption1-3`, `cutscene.crystal_ceremony.caption3`) en de strip-uitzondering in `I18n.test.ts` (r. 97-108). Verder was het af: de vier scènes als cinematic + skippable, `ComicCutscene`, `PanelSequence`, het strip-intropad, `panels` in het schema en de `.ui-comic*`/`.ui-intro-card*`-CSS weg. Let ook op: `playPendingCutscene` zet `pendingCutscene = null` vóór `startCutscene`, dus een mislukte start laat de ceremonie verdwijnen; en de oude captions beschreven poses (Brink heft zijn hand, Sam stapt in de cirkel) die NPC's in een film nog niet kunnen._

## Fase 3.10 – Afronden fase 3

### 3.10.1 Balans nameten

**Klaar (2026-10-14):** gemeten op de tweede exam, de derde exam (Greenwood) en de eerste mini-boss; geen build komt nergens doorheen en geen build slaat alles kapot. Geen data veranderd — twee vragen liggen bij Bo (open vragen 16 en 18 in `docs/PROGRESS.md`).

### 3.10.3 Geheugen controleren

**Gemeten (2026-10-14):** nieuw testscript `scripts/mem-check.mjs` (speelt de game zelf in een testbrowser; uitleg in de README). **Geometrieën komen elke keer precies terug** — in de open wereld, in de stad én 5× de toren van Brink in en uit (buiten 87, binnen 64, weer buiten 87) — en de heap groeit niet. **Textures niet:** elke laadbeurt van een Blender-zone laat er 1 à 2 achter. Getallen in `docs/PROGRESS.md`; oplossen is stap 3.10.3b.

### 3.10.3b Achtergebleven textures opruimen

**Klaar (2026-10-14):** het was de **bone texture van Pringles skelet** — elke kopie van zijn model krijgt een eigen skelet, three.js zet de botmatrices daarvan in een texture, en `AnimatedRig.dispose` gaf dat skelet nooit vrij (één texture per wereld-opbouw, twee als hij ook in een cutscene speelt). De `.glb`-bestanden van de stad bevatten geen textures en de renderer-targets kloppen. Fix: één `skeleton.dispose()` in `AnimatedRig.dispose`, met een test. `mem-check.mjs` kon in deze testbrowser de camera niet draaien (de debug-overlay ving de muis af); gerepareerd, zie `docs/PROGRESS.md`. Getallen daar.

### 3.10.4 `docs/ARCHITECTURE.md` bijwerken

**Klaar (2026-10-14):** alle zes onderwerpen nagelopen tegen de code en de data; buttonmapping, lock-on, de stats-sectie zelf, de exam-sectie en de ei-sectie klopten al. Tien plekken bijgewerkt die achterliepen, o.a. `applyLevel` → `applyStats`, draaglast komt nu uit Strength, de staf is sinds fase 3.8 gewoon in het spel, elf mini-bosses waarvan tien een ei dragen, drie Greenwood-side quests naast de negen exams, en de velden `entrance`/`enabled` van een instance.

## Stap D – Deuren die meezwaaien

### D.1 Fysica-module met tests

(Gebouwd 2026-10-14: 16 tests; conventie positieve hoek = naar links gezien vanaf het scharnier, zoals `rotation.y`; de veer-, demp- en duwgetallen staan nog als testwaarden en komen in D.2 in `scene.doorSettings`.)

### D.2 Data, schema en validator

(Gebouwd 2026-10-14, samen met D.3: drie deuren `hall_cloister`, `hall_garden`, `church_portal`; het portaal is een dubbele deur waarvan de linkerhelft in Blender open staat, alleen de dichte rechterhelft wordt een deur en die opent alleen naar buiten.)

### D.3 Deuren knippen en tekenen

(Gebouwd 2026-10-14: `SceneZone.doors`, `setDoorAngle`, cheat "Doors" met uit / −85° / −45° / 0° / 45° / 85°, afgekapt op de aanslagen; mem-check 92/14 → 64/7 → 92/14.)

### D.4 Koppelen aan de speler

(Gebouwd 2026-10-14: `src/systems/Doors.ts` (`SwingingDoors`), `PusherList` en duwers die onthouden waar ze vandaan kwamen in `HingedBodies.ts`, `SceneZone.setMoveTrace` voor de substappen; 713 tests. Nog door Bo te spelen op pc en iPhone.)

## Fase A – Personage-animaties (Mixamo + eigen cape)

### A.0 Looks van het personage in Blender (Bo, blokkeert A.1b)

(Klaar 2026-10-15: `Hero_Start_Rigged.blend`, collectie `StartCharacter` met één lijf `Body` van 1,80 m (5.342 driehoeken, materialen `Skin` en `Tunic`, A-pose ±40°) en het Rigify-skelet `Hero_Rig`; Bo vindt de looks goed genoeg, fijnslijpen komt later. `01_prep_mixamo.py` draait op dit model en geeft `body_for_mixamo.fbx`.)

### A.2a Mixamo terug in Blender: rig en clips

**Klaar (2026-10-16):** `02_import_mixamo.py` (headless, of vanuit de Scripting-tab: start zichzelf zonder venster, de bron wordt nooit opgeslagen) maakt `Hero_Start_Animated.blend` naast de bron: `PlayerRig` (65 botten zonder `mixamorig:`), `Body` (1,80 m, `Skin`/`Tunic` per vlak teruggezet, `Hero_Skin_Clothes` weg) en 24 Actions: 18 clips (`Heavy` gesplitst in `Heavy_Windup` 1,23 s + `Heavy_Strike` 1,63 s, `Dash` 0,20 s, `Cast_Gather` als lus) plus 5 zwaard-extra's. De import staat al in meters (geen ×0,01). De Mixamo-clips staan in T-pose en het lijf in A-pose, dus elke clip is per bot op wereld-oriëntatie op de rig gebakken (gecontroleerd: 0,000°). Resterende Hips-drift 0,00 cm bij alle 24 clips. Hoe je het draait en wat je in de log moet zien: `tools/blender/character/README.md` → Deel C.

### A.2b Hoed, haar, zwaard en cape

(Klaar 2026-10-16: `03_attach_gear.py` maakt `Hero_Start_Player.blend` uit `Hero_Start_Animated.blend` + de oude spullen van het poppetje uit `Greyhaven.blend`, passend gemaakt op 1,80 m. Zwaard in de **rechter**hand (het oude poppetje had hem links), plus een tijdelijke staf `Staff_Shaft`/`Staff_Crystal` in dezelfde greep; `Collar_Trim` stijf aan `Spine2`; in `Cast_Gather`/`Cast_Release` heeft de rechterhand de vuist van `Idle_Sword`. 17.378 driehoeken. Gekeken in `Idle_Sword`, `Run`, `Slash_1` en `Cast_Gather`.)

### A.2c Export + check

**Klaar (2026-10-16):** een eigen script `tools/blender/character/04_export_player.py` (de bron is `Hero_Start_Player.blend`, niet Greyhaven.blend; `export_web.py` maakt geen `player.glb` meer en beide scripts voegen samen in `materials.json`). `player.glb`: 74 botten, 1 skin (`Body`, `Cloak`, `Cloak_Trim`), 24 clips met exact hun Action-naam en duur, 17.378 driehoeken, 1,51 MB met Draco (skin werkt). Eerst 2,34 MB: de glb-JSON was 1,15 MB door 5.328 kanalen; kanalen zonder keys die niet bewegen (cape-botten, verschuivingen behalve `Hips`) laat de exporter nu weg, zonder verlies. `Idle_Sword_2` hoeft dus niet korter. `materials.json`: `Staff_Crystal` (emit) erbij, `Skin`/`Tunic` voorlopig `flat` met de gemiddelde texturekleur plus `tex: Hero_BaseColor.jpg` (1024 px). Check: `check_player_glb.py` (draait ook vanzelf na de export). Game: de halve slag in `ScenePlayerModel` is weg (de speler kijkt vooruit) en de staf is verborgen zoals het zwaard. Hoe je het draait: README → Deel E.

### A.3a Skinning in de toon-shader

**Klaar (2026-10-16):** kind `textured` (`04_export_player.py` schrijft het, `SceneAssets` laadt die texture met `flipY = false` zodat de glTF-UV's kloppen, `buildMaterial` → `mode: 'textured'`). Huidskleur = tint over de texture, keuze (a) van Bo: tint = gekozen kleur ÷ gemiddelde texturekleur (`ScenePlayerModel.textureTint`, getest), zodat de huid gemiddeld precies de gekozen kleur is en het gezicht zijn schaduwen houdt. Omlijning op `Body`, keuze (a) van Bo: een Solidify "Outline" die het exportscript tijdens de export op `Body` zet (na de Armature, het .blend verandert niet) → de hull neemt de skin-weights over en buigt mee; `Body` 10.684 driehoeken, totaal 22.720, 1,55 MB. Gecontroleerd in de previewpagina (nieuw vinkje **Game-shader** + huidskleur-keuze) in `Run` en `Heavy_Strike`: lijf, cape en hoed buigen mee met hun omlijning. Greyhaven (klooster, 1280×720): draw calls Low 133 / Mid 134 / High 133 (was 131/133/132: +1 is de hull van het lijf, de rest ruis door Pringle in beeld), High 120 fps (8,3 ms); Low en Mid liepen op de 60-fps-cap met 1,5 ms cpu. Normal map: open vraag voor Bo en Lucas.

### A.3b `animations.json` + model doorgeven

**Klaar (2026-10-16):** `animations.json` → `player.clips` (19 rollen → clipnaam), `handBone`, `weapons` (`Sword_`, `Staff_`); `ScenePlayerModel` geeft `rig`, `skinned`, `clips` en `showWeapon(kind | null)`. Keuze (b) van Bo: het Blender-wapen blijft verborgen tot A.3c, want zonder animator zou het niet meezwaaien; **A.3c roept `showWeapon` aan en zet het placeholder-zwaard uit.**

### A.3c `PlayerAnimator`

**Klaar (2026-10-16):** `src/render/PlayerAnimator.ts` (keuze, clip, cliptijd en invoer puur en getest), alleen-lees-meters in de simulatie, getallen in `animations.json` (voetsnelheden en raakmomenten gemeten in `player.glb`). Keuze (a) van Bo: de schade valt nog steeds bij de klik, de slag-clip begint vlak vóór zijn raakmoment; gemeten in Greyhaven raakt de zwaardpunt 49–50 ms na de schade (combo 1-2-3 en de zware slag), een voet op de vloer schuift bij rennen mediaan 0,25 m/s (lijf 4 m/s). Fade naar een slag 0,06 s (korter dan 0,15, anders is de slag op het raakmoment nog half). Blender-wapen aan, placeholder-zwaard uit. 120 fps op Low/Mid/High, animator ±0,1 ms cpu. Casten/slaan tijdens lopen = hele lijf (A.3d); Jump en Sprint wachten op A.5b.

### A.3d Bovenlijf, leunen en debug

**Klaar (2026-10-16):** elke clip is gesplitst in een benen-laag (`Hips` en lager) en een bovenlijf-laag (`Spine` en hoger, `animations.json → upperBody`); tijdens lopen spelen de snelle slagen, `Cast_Gather`/`Cast_Release` én `Hit` alleen op het bovenlijf terwijl de benen `Walk`/`Run` doen (de zware slag blijft heel lijf: één regel in de data als dat anders moet). Een slag of schot maakt zich nu ook af terwijl je doorloopt. Leunen op `Spine` uit de versnelling (`lean`: in een bocht opzij, achterover bij remmen, max 6°/2°/4°). F3-regel `anim` (state, clips, leunen), cheatmenu-sectie Animatie (elke clip los, Auto = terug). Gemeten in Greyhaven: High 120 fps (8,3 ms, cpu 1,3–1,6 ms), Low 60 (cap), draw calls 133–135 (gelijk aan A.3c); Mid gaf in het browserpaneel 1–6 fps, maar dat was het paneel zelf (ook de kale `requestAnimationFrame` liep daar op 2–3 Hz met het spel gepauzeerd), nog op de pc nakijken.

### A.4a Spring bones

**Klaar (2026-10-16):** `src/render/SpringBones.ts` (Verlet-staartpunt per cape-bot, eigen substap van 120 Hz in hele stappen, anker per substap geinterpoleerd, getekend = mix van de laatste twee substappen, simuleert in de ruimte van `worldRoot`), getallen in `animations.json -> player.cape` (schema + DataValidator), cheatmenu-sectie Cape en F3-regel `cape`. Tests: dezelfde staartposities op 30/60/120/144 fps (< 1e-6 m recht, < 1 mm in een bocht), maximale hoek nooit overschreden, in rust recht en stil, pauze = niets verandert, substappen exact geteld, geen garbage collections. Afgesteld in Greyhaven (rust recht, rennen waait hem ca. 0,3 m achter je aan); fps 118-120 en draw calls gelijk op Low/Mid/High, cpu gelijk met cape aan en uit, heap vlak. Botsing en teleport blijven A.4b.

### A.5b Sprinten en springen in de simulatie

**Klaar (2026-10-18):** `player.json` → `sprint` (6,5 m/s, 15 energie/s) en `jump` (1,1 m hoog, zwaartekracht 22, 10 energie, coyote 0,1 s, buffer 0,12 s, airControl 0,5), met schema en DataValidator (sprint sneller dan lopen, sprong niet duurder dan alle energie). Alle getallen zijn startwaarden. In `Movement.ts`: `MoveCommand` kreeg `jump` (ingedrukt) en `sprint` (vastgehouden), `MoverState` kreeg `vy`, `grounded`, `sprinting`, `coyoteTime`, `jumpBuffer` en de afzetsnelheid `vx`/`vz`; `airborne` is nu gewoon "niet op de grond". Sprinten is een factor op de loopsnelheid, dus draaglast, statussen en de cheat-snelheid gelden ook voor sprinten. In de lucht houd je je afzetsnelheid, en de helft volgt de stick. De nieuwe `stepVertical` rekent de exacte parabool per stap en wordt gedeeld door `SceneZone.settle` (die heeft geen eigen `fallSpeed` en geen vaste zwaartekracht meer) en `GroundedMover.settle` (het open terrein heeft nu echte verticale snelheid; lopen volgt het terrein nog steeds altijd naar beneden). In een scène trekt de grond je in de lucht niet meer naar beneden. Niet aanvallen of casten in de lucht, niet springen of sprinten tijdens een slag, een zware aanloop, de guard of een cast. De animator leest `rising` en `sprinting` nu echt uit `MoverState`. Tests (18 nieuw + 2 DataValidator): sprong precies gelijk op 60 en 120 fps (hoogte, landingsplek, tijd in de lucht, energie), hoogte = data, met sprinten verder, coyote time, jump buffer, sprinten kost energie en stopt bij uitputting, dash vasthouden gaat over in een sprint, vallen van een richel met de air-markers voor de animator. Nog geen toetsen (A.5c): in het spel springt of sprint je dus nog niet. In Greyhaven kort gecontroleerd: lopen en een trede af werken en de console geeft geen fouten.

## Fase 4 – Forge, markt, spellboek, kristallen, skill tree

### 4.1 De echte Forge

**Klaar (2026-10-16, auto-run):** na het gesprek met Hilda opent de Forge; wapens (+schade) en armour (+hp/damage reduction) upgraden met gold + Slime Gel, alleen buiten gevecht, opgeslagen in `character.upgrades` (save v16). Niveau geldt per item-id (alle exemplaren delen het) en gaat mee bij de ruil Old Sword → Honed Old Sword. Getallen zijn tijdelijk (zie Notities).

### 4.2 Markt en winkels

**Klaar (2026-10-16, auto-run):** elke NPC met `shop` in `npcs.json` is een handelaar (geen code per NPC); verkopen voor prijs × `sellRatio` (standaard 0,5), optionele `stock` (max + `restockSeconds`) die per speeltijd terugkomt, opgeslagen in `shopStock` (save v17). Marco's gear heeft voorraad 2, potions onbeperkt. Getallen tijdelijk; Tobi en wisselend assortiment nog niet (zie Notities, vraag 24).

### 4.3 Spellboek

**Klaar (2026-10-16, auto-run):** pauzemenu → Spellboek kiest per slot van je staf een geleerde spell van je kristal-element (of leeg), alleen buiten gevecht; eerste gevulde slot is de cast-spell; opgeslagen in `character.spellLoadout` (save v18). Per element een tweede spell (`learnLevel` 5) en de Adept Staff (rare, 2 slots) bij Marco. Namen en getallen tijdelijk (zie Notities, vraag 25).
