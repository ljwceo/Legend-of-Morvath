# PLAN – Legend of Morvath

> Dit is het enige plan-bestand. Alle fases staan hier, opgehakt in kleine stappen die in
> één korte sessie af kunnen. Lees **alleen de stap waar je aan werkt**, niet het hele bestand.
> Geschiedenis, besluiten en meetresultaten staan in `docs/PROGRESS.md`; techniek in
> `docs/ARCHITECTURE.md`. De projectregels staan in `CLAUDE.md`.

**Status:** `[ ]` open · `[~]` bezig · `[x]` klaar
**Eén stap = één sessie = één branch = één pull request.**

### Zo gebruik je dit bestand (usage sparen)

1. Begin een chat met: _"Lees CLAUDE.md en stap X.Y uit PLAN.md. Doe alleen die stap."_
2. Claude leest `CLAUDE.md` + die ene stap. `docs/PROGRESS.md` en het spelconcept alleen als de
   stap erom vraagt (en dan alleen het stukje dat nodig is).
3. Klaar? Zet de stap op `[x]`, zet één regel in `docs/PROGRESS.md`, commit, push, pull request. Stop.
4. Nieuwe wens of besluit van Bo/Lucas? Zet hem als nieuwe stap of in **Notities**, niet in `CLAUDE.md`.

---

## Fase 1 – Basis + open wereld + character creator · **klaar** (2026-10-09)

Doel: een runnende, vloeiende 3D base game met open wereld, rondlopen en character creator.

- [x] **1.1 Projectopzet** — Vite + TypeScript (strict), Three.js, ESLint + Prettier, Vitest, GitHub Actions naar Pages. _Klaar als:_ leeg 3D-scherm met draaiende kubus staat online via Pages.
- [x] **1.2 Kern** — `FixedStep` + `GameLoop` (60 Hz + interpolatie), `EventBus`, `StateMachine`, `Random`, `Renderer`, `DebugOverlay`. _Klaar als:_ de demo draait even snel op 60 en 120 fps en F3 toont fps/frametijd/draw calls.
- [x] **1.3 Data, taal, opslaan, seizoen** — alle JSON + zod-schema's + `DataLoader`/`DataValidator`, `I18n` (en/nl + key-check), `SaveManager` (versies + migraties), `SeasonService`. _Klaar als:_ alle tests slagen en een kapot databestand geeft een duidelijke foutlijst.
- [x] **1.4 Schermen** — Boot → LanguageSelect → Title → Intro-stub → World, plus Pause en Settings. _Klaar als:_ de hele flow werkt heen en terug, inclusief save wissen (2× bevestigen).
- [x] **1.5 Character creator** — naam (max 16), lichaamstype, 5 kapsels, 19 haarkleuren, 6 huid, 6 mantel, Random. _Klaar als:_ het draaiende poppetje verandert live mee en "Begin je reis" maakt de save.
- [x] **1.6 Speler en camera** — WASD + joystick (4 m/s), dash met energie en cooldown, camera over de schouder met zoom en vrij draaien, collision via spatial hash. _Klaar als:_ 2 s lopen = 8 m op 60 én 120 fps.
- [x] **1.7 Open wereld** — zones uit data, chunks met actieve/preload/unload-ring, terrein in een Web Worker, gebudgetteerd laden, floating origin, mist, InstancedMesh. _Klaar als:_ heen en weer lopen laat chunks en colliders niet groeien (test) en geeft geen hapering.
- [x] **1.8 Inhoud** — Greyhaven, Greenwood (Old Tjikko, elfenstad, heiligdom) en Mournfen uit data, triggers + eerste-bezoek-teksten, checkpoints, zonenaam, autosave, HUD met fade. _Klaar als:_ je naadloos van zone naar zone loopt en de uitleg bij een eerste bezoek verschijnt.
- [x] **1.9 NPC's** — 9 NPC's in Greyhaven, dialoogvenster (NL + EN), Pringle volgt en is te aaien, Treewardens lopen rond. _Klaar als:_ praten werkt in beide talen en ontmoete NPC's staan in de save.
- [x] **1.10 Grafische standen** — `QualityManager` (Low/Mid/High), benchmark bij eerste start, automatisch één stand omlaag, debug compleet (chunks, seizoen, teleport, save export/import). _Klaar als:_ de drie standen alleen verschillen in uiterlijk, nooit in gameplay.
- [x] **1.11 Afronden** — "Meet 20 s"-knop, 10-minutentest, `docs/ARCHITECTURE.md`, Definition of Done nalopen. _Klaar als:_ geen geheugengroei na 10 minuten lopen en de documentatie klopt.

**Open:** fps op een echte iPhone is nooit gemeten (zie Notities).

---

## Fase 2 – Solo-gevecht en de eerste dag · **gebouwd** (2026-10-10), wacht op spelen

Doel: het onwinbare intro-gevecht, de eerste dag in Greyhaven (±level 3), vechten in de Greenwood en Sultan verslaan.

- [x] **2.1 Gevechtskern** — HP/mana/energie, fast hit (10 schade / 10 energie, elke 3e +50%), heavy hit (25 / 25, 0,9 s uithalen), raken in een boog, schadegetallen uit een pool, HUD-regels aan, trainingspoppen. _Klaar als:_ 60 en 120 Hz geven exact dezelfde slagen (test).
- [x] **2.2 Intro-gevecht** — paneel 4 van de intro speelbaar: Lucael en Baelor, onwinbaar, komisch, overslaanbaar, alles in `cutscenes.json`. _Klaar als:_ je kunt lopen en slaan, niet winnen, en wordt wakker in het Monastery.
- [x] **2.3 Vijanden** — één pool, AI (rondlopen, achtervolgen, aanvallen, naar huis), spawngebieden in `zones.json`; Green Slime, Big Slime, Goblin, Goblin Archer, Goblin Chief, Treewarden. _Klaar als:_ 45 vijanden tegelijk kosten < 0,1 ms per stap en zijn gelijk op Low/Mid/High.
- [x] **2.4 XP, levels, buit, doodgaan** — XP-curve, levelmelding, buit + tas, drankjes, doodgaan (−10% gold → checkpoint), rusten in bed, save versie 3. _Klaar als:_ doodgaan en rusten werken en de oude save migreert.
- [x] **2.5 Quests van de eerste dag** — questsysteem uit `quests.json` + de vijf quests (Ansel, Marco, Hilda, Rose, Bertha), winkel van Marco, Hilda slijpt je zwaard. _Klaar als:_ de vijf quests werken in NL en EN en brengen je op ±level 3.
- [x] **2.6 Sultan, de beginnersbaas** — cutscene "Pringle" (overslaanbaar), 800 HP, Claw Combo, Pounce, Dash Strike, Flurry onder 50%, hints de eerste keer, winnen en verliezen. _Klaar als:_ winnen maakt Sultan een NPC en verliezen geeft meteen een herkansing.
- [x] **2.7 Afronden** — balanstest met een nagebootste speler, rekentijd van de vijanden, draw calls per stand, geheugen. _Klaar als:_ Definition of Done van fase 2 is nagelopen.
- [ ] **2.8 Spelen en meten (Bo/Lucas)** — fase 2 écht spelen en "Meet 20 s" op de pc. _Klaar als:_ Bo en Lucas zeggen of Sultan te makkelijk of te moeilijk is en de fps per stand staat in `docs/PROGRESS.md`.

---

## Fase 3 – Je pad, Entrance Exam en gear · stap 3.0 t/m 3.5 **gebouwd**

- [x] **3.0 Debugvenster in groottes** — Groot / Normaal / Klein / Alleen fps / Verborgen (F3 of drie vingers), keuze per browser onthouden. _Klaar als:_ het cheatmenu (F6) blijft werken met een verborgen venster.
- [x] **3.1 Gear en draaglast** — 6 slots, 4 zeldzaamheden, stats, aan/uitdoen in de tas, draaglast licht/middel/zwaar/overbelast, gear als buit en bij Marco. _Klaar als:_ overbelast = 50% lopen en geen dash, en de grenzen zijn getest.
- [x] **3.2 Ezel Biscuit** — via Marco na Sultan, loopt mee, pakdier-tas (60 kg), spullen erop zijn pas bruikbaar als je ze eruit haalt, save versie 6. _Klaar als:_ laden en pakken werkt alleen dichtbij Biscuit en buiten gevecht.
- [x] **3.3 Instances** — deur/portaal → kort laadscherm → kaart uit `instances.json` → opruimen bij weggaan; Academy-hal (Brink) en kelder van Sam, uit het Blender-model. _Klaar als:_ geheugen groeit niet bij instances in en uit.
- [x] **3.4 Your Resolve** — keuzeknoppen in de dialoog, drie leraren, nee mag altijd, ja vraagt nog één keer, pad in de save. _Klaar als:_ alle drie de paden werken in NL en EN.
- [x] **3.5 Staf en lock-on** — Arcane Shard (links, geen mana), 5 spells met reisafstand (rechts, mana), lock-on met marker en camera, missen bij een vijandaanval of te ver wegkijken, richthulp in het cheatmenu, save versie 8. _Klaar als:_ lock-on werkt met zwaard én staf en is gelijk op elke grafische stand.

_De oude stappen 3.6 en 3.7 zijn fase 3.8 en 3.10 geworden (besluit Bo, 2026-10-12)._

---

## Fase 3.6 – Buttonmapping en lock-on (Elden Ring-stijl) · **gebouwd** (2026-10-12)

- [x] **3.6.1 Mapping-laag** — `src/core/Bindings.ts`, standaardbindingen in `controls.json`, eigen bindingen in de save (versie 9), twee bindingen per actie, muisknoppen even goed bindbaar. _Klaar als:_ Escape en F3/F4/F6 zijn niet te binden en de rest wel.
- [x] **3.6.2 Settings → Besturing** — "druk een toets…", conflicten afpakken met melding, Backspace leegt, Terug naar standaard. _Klaar als:_ een bezette toets wordt bij de oude actie weggehaald en het blijft bewaard na herladen.
- [x] **3.6.3 `{key}`-teksten** — elke hint toont de toets die jij hebt ingesteld; test faalt als een tekst zelf een toets noemt. _Klaar als:_ het icoontje boven een NPC verandert mee.
- [x] **3.6.4 Lock-on-marker** — wit puntje met dun ringetje op het midden van de vijand, altijd even groot in CSS-pixels. _Klaar als:_ dichtbij en ver weg even groot, en gelijk op Low/Mid/High.
- [x] **3.6.5 Zichtcheck + doel wisselen** — straal van de camera naar de vijand (MeshBVH / terrein + gebouwen), tolerantie 0,2 s, doel wisselen op een eigen knop. _Klaar als:_ een huis of boom tussen camera en vijand breekt de lock, en de tolerantie is gelijk op 60 en 120 fps.

---

## Fase 3.7 – Stats en builds (puntensysteem) · **gebouwd** (2026-10-12)

- [x] **3.7.1 `stats.json`** — tien stats (HP, Defense, Strength, Power, Mana, Magic Power, Regen, Dexterity, Faith, Luck) met zachte grenzen. _Klaar als:_ elke stat doet wat de data zegt (tests).
- [x] **3.7.2 Automatische groei eruit** — `perLevel`, `sword.damagePerLevel`, `staff.shard.damagePerLevel`, `spells.perLevel` en `skills.json → core` vervallen. _Klaar als:_ een level geeft precies 1 punt en niets anders.
- [x] **3.7.3 Punten in de character creator** — 20 punten vrij verdelen, Random, drie startvoorstellen, live te zien wat het doet. _Klaar als:_ een nieuw spel begint met 20 verdeelde punten en het poppetje draait er gewoon bij.
- [x] **3.7.4 Statusvenster** — op een eigen instelbare toets: level, ongebruikte punten, stats, wat gear en perks erbovenop doen; besteden kan niet in een gevecht. _Klaar als:_ gold kan nooit punten of stats kopen.
- [x] **3.7.5 Migratie** — save versie 10: oude saves krijgen `20 + (level − 1)` punten ongebruikt met een melding. _Klaar als:_ level en pad blijven gelijk na de migratie.

---

## Fase 3.8 – Entrance Exams, je pad en de stadspoort · **gebouwd** (2026-10-13)

- [x] **3.8.1 Negen exam-quests** — 3 per leraar, alleen voor je eigen pad, op elkaar volgend, in EN en NL. _Klaar als:_ de exams brengen je van ±level 3 naar level 5 (520 XP).
- [x] **3.8.2 Doel-type `train`** — "raak de trainingspop N keer", bij Brink en Sam met een opgeladen spreuk. _Klaar als:_ de voortgang staat in de questlijst.
- [x] **3.8.3 Doel-type `waves`** — drie waves slimes op het trainingsveld, `pauseSeconds` tussen de waves, "Wave 2/3" in de questlijst. _Klaar als:_ doodgaan of van het veld lopen (`leaveSeconds`, nu 3 s) zet de drill terug op wave 1 (save 15).
- [x] **3.8.4 Statuseffecten als systeem** — `monsters.json → statusEffects` + `onHit`: Chilled, Burning, leech, hogere sprong, Weakened. _Klaar als:_ een ander monster krijgt ze zonder nieuwe code.
- [x] **3.8.5 Pad-effecten zwaardvechter** — beter zwaard, geen mana (balk weg), 115% kracht, perks Iron Body / Battle Hardened / Swift Blade (ook in de zwaai-tijden). _Klaar als:_ HP, ontvangen schade en aanvalssnelheid veranderen echt.
- [x] **3.8.6 Pad-effecten mage** — Mage Staff + Crystal Ceremony als stripcutscene (Brink: Water/Fire/Nature/Wind, Sam: Dark), kristal in de save. _Klaar als:_ de cutscene is overslaanbaar en de bijbehorende spreuk werkt.
- [x] **3.8.7 Stadspoort** — `canLeaveCity` = Sultan verslagen + laatste exam klaar, save versie 12. _Klaar als:_ daarvoor blijft de poort dicht met de bestaande melding en teleport in het cheatmenu werkt altijd.
- [ ] **3.8.8 Spelen en terugkoppelen (Bo/Lucas)** — is de nieuwe tweede exam (drie waves) zwaar genoeg, en klopt het Dark-Slime-effect? _Klaar als:_ Bo heeft open vragen 15 en 16 beantwoord.

---

## Fase 3.9 – Eieren, mini-bosses en opnieuw verdelen · **gebouwd** (2026-10-13)

- [x] **3.9.1 Tien mini-bosses** — vaste plekken verspreid over alle zones, komen na 10 minuten terug. _Klaar als:_ er staat er in elke zone minstens één en geen twee in Greyhaven.
- [x] **3.9.2 Eieren als itemsoort** — `type: "egg"`, wegen niets, niet te gebruiken, elk ei eenmalig (in de save) + het ei van Sultan uit zijn baasgevecht. _Klaar als:_ een gevonden ei komt nooit terug.
- [x] **3.9.3 Herverdelen bij Sultan** — praat je met een ei in je tas: "Alles opnieuw verdelen? Dat kost één ei." met Ja/Nee + nog één keer bevestigen, event `statsReset`, save versie 13. _Klaar als:_ level, pad, gear en quests blijven gelijk en het ei is op.
- [ ] **3.9.4 Spelen en terugkoppelen (Bo/Lucas)** — zijn de tien mini-bosses sterk genoeg? _Klaar als:_ Bo zegt of de HP/schade van de mini-bosses goed staat.

---

## Extra – Filmische cutscenes (Elden Ring-stijl) · stap 1 en 2 **gebouwd** (2026-10-13)

Besluit uit het concept: cutscenes worden filmisch in de 3D-wereld zelf (`"type": "cinematic"` met `anchor`, `actors` en `shots` in `cutscenes.json`), met je eigen personage en gear in beeld. De strips blijven werken tot ze vervangen zijn. Overslaan = ±1 s ingedrukt houden. Alles op de vaste tijdstap, dus 60 en 120 fps zijn precies gelijk.

- [x] **C.1 Systeem + proef Pringle → Sultan** — `CinematicTimeline` (pure logica), `CinematicStage` (actors in 3D), `CinematicCutscene` (balken, ondertitels, naamkaart, fade/flits/tint, skip-ring), HUD en knoppen weg tijdens de film, overwinningstekst na een baas (`boss.victory`). _Klaar als:_ de zes shots van Pringle → Sultan lopen door in het baasgevecht en 60 en 120 fps geven precies hetzelfde (test).
- [x] **C.2 Eindscène na Sultan** — twee varianten (zwaard en mage) gekozen door de laatste treffer, slow motion, bevroren beeld, de ton, Pringle uit de rook, het ei als kaart, BOND FORGED in de balk van de zonenaam, Sultan vertelt als NPC waar je items vindt. _Klaar als:_ beide varianten spelen en zijn overslaanbaar.
- [ ] **C.3 Kijken en meten (Bo/Lucas)** — beide eindscènes bekijken via cheatmenu → Baasgevecht, en "Meet 20 s" tijdens een cutscene op Low en High. _Klaar als:_ Bo zegt of de scènes goed voelen en de fps staat in `docs/PROGRESS.md`.
- [ ] **C.4 De overige strips omzetten** — de intro (6 panelen + het intro-gevecht), de uitleg in de toren van Brink en de kelder van Sam, en de Crystal Ceremony. _Klaar als:_ elke omgezette cutscene is overslaanbaar en de oude strip-code is alleen nog voor wat nog niet om is.
- [ ] **C.5 Blender-camera's en echte modellen** — `cameraClip` (camera-animatie uit glTF) echt laten werken en de placeholders in `CinematicStage` vervangen. _Klaar als:_ een camera uit Blender speelt een shot en de draw calls blijven gelijk.

---

## Fase 3.10 – Afronden fase 3 · **bezig** (3.10.1, 3.10.3, 3.10.3b en 3.10.4 klaar)

Doel: fase 3 is af, gemeten en opgeschreven. Alleen bestaande getallen bijschaven, geen nieuwe systemen.

- [x] **3.10.1 Balans nameten** — nagebootste speler met zwaard, lichtmage en duistere mage, plus een paar extreme builds (alles in HP, alles in Strength, alles in Magic Power). _Klaar als:_ geen build slaat alles kapot of komt nergens doorheen, en de uitkomsten staan in `docs/PROGRESS.md`. **Klaar (2026-10-14):** gemeten op de tweede exam, de derde exam (Greenwood) en de eerste mini-boss; geen build komt nergens doorheen en geen build slaat alles kapot. Geen data veranderd — twee vragen liggen bij Bo (open vragen 16 en 18 in `docs/PROGRESS.md`).
- [ ] **3.10.2 Meet 20 s op de pc** — Low, Mid en High, in Greyhaven, bij het goblinkamp en tegen Sultan. _Klaar als:_ 60 fps op Mid en 120 fps op High, met de getallen in `docs/PROGRESS.md`.
- [x] **3.10.3 Geheugen controleren** — 10 minuten heen en weer lopen én 5× een instance in en uit. _Klaar als:_ geometries/textures gaan elke keer terug naar hun beginwaarde. **Gemeten (2026-10-14):** nieuw testscript `scripts/mem-check.mjs` (speelt de game zelf in een testbrowser; uitleg in de README). **Geometrieën komen elke keer precies terug** — in de open wereld, in de stad én 5× de toren van Brink in en uit (buiten 87, binnen 64, weer buiten 87) — en de heap groeit niet. **Textures niet:** elke laadbeurt van een Blender-zone laat er 1 à 2 achter. Getallen in `docs/PROGRESS.md`; oplossen is stap 3.10.3b.
- [x] **3.10.3b Achtergebleven textures opruimen** — zoek uit welke textures na het verlaten van een Blender-zone blijven staan (verdachten in `docs/PROGRESS.md`: de textures ín `greyhaven.glb` / `player.glb`, het gecachete model van Pringle, de targets van de renderer) en geef ze vrij. _Klaar als:_ `node scripts/mem-check.mjs` 5× in en uit een instance doet en de textures elke keer op hun beginwaarde terugkomen. **Klaar (2026-10-14):** het was de **bone texture van Pringles skelet** — elke kopie van zijn model krijgt een eigen skelet, three.js zet de botmatrices daarvan in een texture, en `AnimatedRig.dispose` gaf dat skelet nooit vrij (één texture per wereld-opbouw, twee als hij ook in een cutscene speelt). De `.glb`-bestanden van de stad bevatten geen textures en de renderer-targets kloppen. Fix: één `skeleton.dispose()` in `AnimatedRig.dispose`, met een test. `mem-check.mjs` kon in deze testbrowser de camera niet draaien (de debug-overlay ving de muis af); gerepareerd, zie `docs/PROGRESS.md`. Getallen daar.
- [x] **3.10.4 `docs/ARCHITECTURE.md` bijwerken** — stats, buttonmapping, lock-on, exams, eieren, instances. _Klaar als:_ de documentatie klopt met de code. **Klaar (2026-10-14):** alle zes onderwerpen nagelopen tegen de code en de data; buttonmapping, lock-on, de stats-sectie zelf, de exam-sectie en de ei-sectie klopten al. Tien plekken bijgewerkt die achterliepen, o.a. `applyLevel` → `applyStats`, draaglast komt nu uit Strength, de staf is sinds fase 3.8 gewoon in het spel, elf mini-bosses waarvan tien een ei dragen, drie Greenwood-side quests naast de negen exams, en de velden `entrance`/`enabled` van een instance.
- [ ] **3.10.5 Definition of Done nalopen** — fase 3.6 t/m 3.9 afvinken, alle tests + taal-key-check + DataValidator draaien. _Klaar als:_ alles slaagt en fase 3 staat in `docs/PROGRESS.md` als afgesloten.

---

## Extra – Pringle als echt model met animaties · **gebouwd** (2026-10-14)

Bo maakte Pringle in Blender (`Sultan_kat.blend`, buiten de repo): eigen skelet en de clips Idle, Walk en Run. Een geanimeerd NPC-model is nu alleen data (`npcs.json` → `roles` → `animated`) plus een `.glb`.

- [x] **D.1 Pringle in de game** — `public/characters/pringle/pringle.glb`, `src/render/AnimatedNpcs.ts` (laadt met de zone, placeholder blijft tot het model er is, clipkeuze uit de echt gemeten snelheid met marge en crossfade), skinning + `textured` in `ToonMaterial`, debugregel `npcs` toont de clip. _Klaar als:_ de voeten glijden niet op slenteren en meedraven (sinds D.4: 0,6 en ±4 m/s), en de animatie stuurt nooit de simulatie (gelijk op 60 en 120 fps).
- [ ] **D.2 Spelen en meten (Bo/Lucas)** — Pringle in Greyhaven bekijken en de fps meten. _Klaar als:_ Bo zegt of het loopt zoals het moet en de fps staat in `docs/PROGRESS.md`.
- [x] **D.3 glTF-actors in de cutscenes** — `CinematicStage` gebruikt het echte model voor een actor met `placeholder:cat` (`AnimatedModels.createNow`), met Idle/Walk/Run op de snelheid in filmtijd. _Klaar als:_ Pringle speelt in de cutscenes met zijn echte model. (Gebouwd 2026-10-14; `Head_Shake` bestaat nog niet, hoort bij C.5.)
- [x] **D.3b Rustiger lopen + aai-animaties** — nieuwe Walk en galop (snelheid uit de simulatie in plaats van frametijden, slenteren 0,6 m/s), drie aai-clips om de beurt (`animated.pets`, Pringle blijft `petHoldSeconds` zitten), instelbaar Blender-script `tools/blender/pringle/`. _Klaar als:_ Pringle loopt niet meer "als een geëlektrocuteerde spin" en elke aai speelt de volgende clip. (Gebouwd 2026-10-14; Bo speelt het in D.2.)
- [ ] **D.4 Sultan in mensvorm** — eigen chat, met een skelet dat de andere mensen later delen; tot dan blijft de placeholder bij de poort staan. _Klaar als:_ Sultan staat als mens bij de poort met zijn eigen clips.

---

## Stap D – Deuren die meezwaaien · **open** (vier chats van ±30 min; prompts in `docs/prompts/STAP-D-DEUREN.md`)

Doel: de deuren van het klooster (hal → kloostergang, hal → tuin, het kerkportaal) zijn nu dichte
meshes waar je dankzij `scene.openings` doorheen loopt, maar ze doen verder niets. Ze worden echte
draaideuren: loop je ertegenaan, dan zwaait de deur van je af open (om een scharnier) en valt hij
daarna rustig weer dicht. De fysica is een los, herbruikbaar systeem dat niets van deuren, Three.js,
Blender of de speler weet, zodat Pringle, NPC's, kisten, luiken en poorten er later zonder nieuwe
code aan kunnen. Vier stappen van elk ±30 minuten; de eisen hieronder gelden voor alle vier.

**Eisen (gelden voor D.1 t/m D.4)**
- Fysica in `src/systems/HingedBodies.ts`: kent alleen een scharnierpunt op de grond (x, z), een
  lijnstuk met een lengte dat om dat scharnier draait (hoek 0 = dicht), een aanslag per kant, en een
  lijst duwers (cirkels: x, z, straal). Per vaste tijdstap (60 Hz): raakt een cirkel het lijnstuk, dan
  duwt hij het van zich af (hoeksnelheid uit de overlap); zonder duwer veert het lijnstuk gedempt
  terug naar dicht. Geen allocaties per stap; pure functies (`segmentAt`, `pushFromCircle`, `step`).
- Aanslagen per kant (`left` / `right`, 0 = die kant nooit). Raakt de hoek een aanslag: hard afkappen
  én hoeksnelheid op 0 (geen terugstuiter, nooit door de muur). Maximale hoeksnelheid in `settings`,
  zodat een dash de deur niet lanceert; de duwkracht en de snelheid worden daarop afgekapt.
- Duwers worden per **substap** van hun beweging tegen het lijnstuk gehouden (de speler beweegt in
  `SceneZone.moveCircle` al in stukjes van 0,2 m), zodat een dash die in één stap door de deur gaat
  toch duwt in plaats van de deur over te slaan.
- Alles in data: `zones.json` → `scene.doors`, per deur `id`, `hinge` (x, z, wereld), `tip` (vrije
  uiteinde van de dichte deur, x, z), `box` (zelfde vorm als een `opening`: de ruimte met de
  deurdriehoeken), `openDegrees: { left, right }` (gezien vanaf het scharnier, kijkend naar de tip;
  neem 5–10° minder dan de muur toelaat). Gedeelde getallen (veerkracht, demping, duwsterkte,
  maximale hoeksnelheid) in `scene.doorSettings`. Nooit getallen in code.
- Uiterlijk uit de bestaande `greyhaven.glb`, geen nieuwe Blender-export: `SceneZone` knipt de
  driehoeken binnen `box` uit de statische meshes (`filterGeometry`, zoals voor `openings` en de
  instances) in een eigen `Group` per deur met het scharnier als oorsprong; `rotation.y` = de hoek,
  elke frame geïnterpoleerd tussen de vorige en de huidige stap. De deurdriehoeken blijven buiten de
  botsings-BVH (de deur is passeerbaar, bewust); de `box` van een deur neemt de rol van de `opening`
  over, `openings` blijft voor deuropeningen zonder deur.
- Harde eisen uit `CLAUDE.md`: vaste tijdstap, geen allocaties in de loop, op Low/Mid/High precies
  dezelfde zwaai, geen hexcodes of UI-tekst in code (er is geen tekst nodig).
- Niet in deze stap: deuren op slot, deuren die blokkeren, geluid, NPC's als duwers. Wel de basis zo
  dat dat later alleen data en een extra duwer is.
- Risico's om in elk plan te noemen: een te ruime `box` knipt kozijn mee (dan draait het kozijn mee);
  de scharnierkant en de aanslagen zijn aannames tot Bo ze in Blender nakijkt; aanslagen komen uit
  data, dus verplaats je een deur in Blender, dan moeten `box`, `hinge`, `tip` en `openDegrees` mee
  (automatisch de vrije hoek uit de BVH halen is een latere verbetering).

- [x] **D.1 Fysica-module met tests** — `src/systems/HingedBodies.ts` plus `HingedBodies.test.ts`, nog niets aan de game gekoppeld. _Klaar als:_ tests slagen voor: een cirkel die van de ene kant door het lijnstuk loopt duwt het de andere kant op, en andersom; zonder duwer gaat de hoek terug naar 0 en blijft daar; nooit boven een aanslag; een kant met aanslag 0 beweegt die kant nooit op; een cirkel precies op het scharnier geeft geen sprong; een cirkel met dash-snelheid (uit `player.json`) laat de hoek nooit boven de aanslag komen en de deur komt daarna tot rust; 600 stappen van 1/60 s geven hetzelfde als dezelfde 600 stappen in twee reeksen. `npm run lint`, `typecheck` en `test` groen. (Gebouwd 2026-10-14: 16 tests; conventie positieve hoek = naar links gezien vanaf het scharnier, zoals `rotation.y`; de veer-, demp- en duwgetallen staan nog als testwaarden en komen in D.2 in `scene.doorSettings`.)
- [x] **D.2 Data, schema en validator** — `scene.doors` en `scene.doorSettings` in `zones.json` met de drie kloosterdeuren, schema in `src/data/schemas.ts`, DataValidator-regels (`box` bevat `hinge` én `tip`, `box` is niet leeg, minstens één kant van `openDegrees` is groter dan 0) met tests. De scharnierpunten en vrije kanten uit Blender (`docs/MONASTERY.md` noemt de objecten en de z-waarden van de openingen) en nagemeten in de game met `?debug=1` (de debugregel `chunks` toont je positie in Blender-coördinaten). _Klaar als:_ de validator slaagt op de echte data en faalt op elke fout uit de regels hierboven; in `docs/PROGRESS.md` staat per deur welke kant het scharnier zit en hoeveel graden vrij, als aanname voor Bo. (Gebouwd 2026-10-14, samen met D.3: drie deuren `hall_cloister`, `hall_garden`, `church_portal`; het portaal is een dubbele deur waarvan de linkerhelft in Blender open staat, alleen de dichte rechterhelft wordt een deur en die opent alleen naar buiten.)
- [x] **D.3 Deuren knippen en tekenen** — `SceneZone` maakt per deur een `Group` uit de driehoeken in `box`, met het scharnier als oorsprong; de `box` werkt als `opening` voor de botsingsmesh; een cheat in het cheatmenu (F6) zet alle deuren op een vaste hoek, zodat je zonder fysica kunt zien dat ze om de goede hoek draaien en niets van het kozijn meedraait. _Klaar als:_ met de cheat draaien alle drie de deuren om hun scharnier, niets anders beweegt mee, draw calls stijgen met hooguit het aantal deuren × hun materialen, en geometrieën en textures gaan bij verlaten weer terug (`node scripts/mem-check.mjs --only instances --instance brink_tower --cycles 2`). (Gebouwd 2026-10-14: `SceneZone.doors`, `setDoorAngle`, cheat "Doors" met uit / −85° / −45° / 0° / 45° / 85°, afgekapt op de aanslagen; mem-check 92/14 → 64/7 → 92/14.)
- [ ] **D.4 Koppelen aan de speler** — `WorldState` voert de speler (en zijn dash-substappen) als duwer aan `HingedBodies`, zet elke stap de hoeken en tekent ze geïnterpoleerd; de cheat uit D.3 blijft. `docs/ARCHITECTURE.md` krijgt een stukje over deuren. _Klaar als:_ alle drie de kloosterdeuren zwaaien van je af open als je erdoorheen loopt (van beide kanten), vallen weer dicht, gaan bij een dash niet door de muur, en `?fps=30` en `?fps=120` geven dezelfde zwaai; fps en draw calls op Low, Mid en High zijn gelijk aan voor de stap (getallen in `docs/PROGRESS.md`).

---

## Fase A – Personage-animaties (Mixamo + eigen cape)

Doel: de speler krijgt vloeiende animaties (idle, lopen, rennen, sprinten, springen, dash, zwaard, spreuken, geraakt, dood, interactie) plus een cape die vanzelf wappert.

**Vaste regels voor deze fase**

1. **Animatie is alleen render-kant.** Hij leest de simulatie (`MoverState`, `CombatState`, `StaffState`) en stuurt die nooit. Geen hitbox, snelheid of timing hangt van een animatie af.
2. **Alles in place, geen root motion.** Horizontale beweging van `Hips` eruit filteren.
3. Clipnamen, fade-tijden, referentiesnelheden en cape-getallen in `public/data/animations.json` (zod-schema + DataValidator).
4. Geen allocaties per frame in de animator en de spring bones.
5. **Mixamo-FBX's komen nooit in de repo** (bewaren in `art-source/`, staat in `.gitignore`). Alleen `player.glb` gaat in git.
6. De materiaalnamen `Cloak_Navy`, `Hat_Navy`, `Gold_Trim`, `Hair`, `Skin`, `Outline` moeten blijven bestaan, anders werkt de character creator niet meer.

**Clipnamen (precies deze):** `Idle`, `Walk`, `Run`, `Sprint` · `Jump_Start`, `Jump_Air` (lus), `Land` · `Dash`, `Dash_Recover` · `Slash_1`, `Slash_2`, `Slash_3`, `Heavy_Windup`, `Heavy_Strike` · `Cast_Gather` (lus), `Cast_Release` · `Hit`, `Death`, `Interact`

- [x] **A.1 Lijf klaarmaken voor Mixamo** — `tools/blender/character/01_prep_mixamo.py`: lijfstukken van `StartCharacter` samenvoegen tot één mesh `Body` in A-pose, zonder hoed/haar/cape/zwaard, transforms toegepast, export naar `art-source/body_for_mixamo.fbx`. _Klaar als:_ het script draait headless én via het Scripting-tabblad en levert één mesh in A-pose.
- [ ] **A.0 Looks van het personage in Blender (Bo, blokkeert A.1b)** — besluit van 2026-10-13: eerst het echte model maken. _Klaar als:_ Bo zegt dat het model klaar is; daarna draait A.1 opnieuw op dat model.
- [ ] **A.1b Mixamo (Bo, Deel B)** — `body_for_mixamo.fbx` door Mixamo auto-rig halen en de animaties uit de clipnamen-tabel downloaden (zie `tools/blender/character/README.md`). _Klaar als:_ `body_rigged.fbx` + alle animatie-FBX's staan in `art-source/` en de Mixamo-preview buigt zonder rare vervormingen.
- [ ] **A.2a Mixamo terug in Blender: rig en clips** — `02_import_mixamo.py`: importeren, schaal ×0,01, `mixamorig:Hips` → `Hips`, elke animatie één Action met de juiste clipnaam, horizontale `Hips`-beweging eruit, clips inkorten (`Dash` 0,18–0,25 s, `Heavy_Windup` past bij 0,9 s, `Cast_Gather` als nette lus). _Klaar als:_ elke clip speelt in Blender zonder wegglijden.
- [ ] **A.2b Hoed, haar, zwaard en cape** — Hair/Hat/Hat*Band/Hat_Brim stijf aan `Head`, `Sword**`stijf aan`RightHand` (controleer welke arm het zwaard heeft!), cape terug + 3 kettingen van 3 botten (`Cape_L/M/R 1-3`) aan `Spine2` met weights, cape-botten in geen enkele clip. *Klaar als:\* hoed, haar en zwaard bewegen mee en de cape gaat mee met het lijf.
- [ ] **A.2c Export + check** — `export_web.py` (speler-deel): `export_animations=True`, armature + skin mee, geen `export_apply` op de armature, Draco uit als hij met skin stukloopt. Checkscript print botten, driehoeken (≤ 30.000), clips met duur en bestandsgrootte (≤ 2 MB). _Klaar als:_ `player.glb` heeft skelet + skin + alle clips met de juiste namen en de game start nog in Greyhaven.
- [ ] **A.3a Skinning in de toon-shader** — de skinning-chunks zitten al in `ToonMaterial` sinds Pringle (stap D.1); hier alleen nog de **Outline** erbij en controleren dat statische meshes niets duurder worden. _Klaar als:_ de SkinnedMesh van de speler vervormt mee, met omlijning, en draw calls/fps blijven gelijk.
- [ ] **A.3b `animations.json` + model doorgeven** — nieuw databestand met schema en validator; `ScenePlayerModel` houdt de SkinnedMesh, laat de Blender-`Sword_*` aan `RightHand` zien (zwaard én staf) en geeft de clips door. _Klaar als:_ de DataValidator keurt het bestand en de clips komen aan.
- [ ] **A.3c `PlayerAnimator`** — `AnimationMixer` + state machine (Idle, Walk, Run, Sprint, Jump, Fall, Land, Dash, `Dash_Recover`, Attack, Cast, Hit, Death, Interact), crossfades 0,15–0,25 s, `timeScale = snelheid / referentiesnelheid`, **aanvallen op voortgang** (`action.time = progress × duur`) zodat de slag samenvalt met de hitbox, combo Slash*1 → 2 → 3. \_Klaar als:* de keuze-functie is puur en getest, voeten glijden niet en de slag raakt visueel op het moment van de schade.
- [ ] **A.3d Bovenlijf, leunen en debug** — kopie van de cast-clip met alleen bovenlijf-botten bovenop de loopclip (`castMoveFactor`), licht leunen bij draaien en remmen, F3 toont state + clip, cheatmenu speelt elke clip los af. Het placeholder-poppetje houdt `setSwordPose` als terugval. _Klaar als:_ casten tijdens lopen ziet er goed uit en headless Chromium geeft geen fouten.
- [ ] **A.4a Spring bones** — `src/render/SpringBones.ts`: per cape-bot stijfheid, demping, zwaartekracht en een maximale hoek; eigen vaste substap (bijv. 120 Hz met accumulator); getallen in `animations.json → cape`, cheat-baar. _Klaar als:_ de cape beweegt exact hetzelfde op 60 en 120 fps (test) en er zijn geen allocaties per frame.
- [ ] **A.4b Botsing en reset** — botsbollen op heupen, bovenbenen en rug; resetten na teleport of respawn. _Klaar als:_ de cape gaat niet door de benen bij rennen of dashen en zwiept nooit door de wereld na een teleport.
- [ ] **A.5a Open vragen aan Bo (eerst stellen)** — mag je in de lucht dashen? Mag je in de lucht aanvallen of casten? Kost springen energie? Sprinten vasthouden of aan/uit? _Klaar als:_ alle vier de antwoorden staan in Notities.
- [ ] **A.5b Sprinten en springen in de simulatie** — `player.json`: `sprint` (speed, energyPerSecond) en `jump` (heightMeters, gravity, coyoteSeconds ±0,1, bufferSeconds ±0,12, airControl); `MoverState` krijgt vy, grounded, sprinting, coyoteTime, jumpBuffer; `GroundedMover` met echte verticale snelheid. _Klaar als:_ springen is precies even hoog en ver op 60 en 120 Hz (test) en coyote time + jump buffer zijn getest.
- [ ] **A.5c Toetsen, knoppen en draaglast** — acties `jump` en `sprint` in `controls.json` (let op botsing met dash), knoppen in TouchControls, teksten in `en.json` + `nl.json`, bestaande saves krijgen de nieuwe standaardtoetsen; sprong en sprint schalen mee met de draaglast, overbelast = niet sprinten of springen. _Klaar als:_ de nieuwe toetsen zijn instelbaar in Settings → Besturing en de DataValidator slaagt.

_Chat 5 (A.5a–c) heeft geen Blender nodig en mag vóór of tegelijk met A.2–A.4._

---

## Fase 4 – Forge, markt, spellboek, kristallen, skill tree · **open** (stappen zijn een voorstel)

- [ ] **4.1 De echte Forge** — Hilda upgradet wapens en gear met gold + materialen, niveaus en kosten in data, alleen buiten gevecht. _Klaar als:_ een upgrade verandert de stats van het item en staat in de save.
- [ ] **4.2 Markt en winkels** — meerdere handelaren uit data, koop- en verkoopprijzen, voorraad die terugkomt. _Klaar als:_ een nieuwe handelaar toevoegen is alleen data.
- [ ] **4.3 Spellboek** — spellboek-UI, meer spells uit `spells.json`, spellslots per staf. _Klaar als:_ je spells wisselt buiten gevecht en de keuze staat in de save.
- [ ] **4.4 Kristallen** — kristallen vinden, mergen/upgraden en hun effect op je staf en spells. _Klaar als:_ een gemerged kristal verandert je schade en je spell zichtbaar.
- [ ] **4.5 Skill tree** — alleen skills en perks (geen statpunten meer), takken per pad, skillpunten uit quests/levels zoals afgesproken. _Klaar als:_ elke tak werkt in NL en EN en de perks doen echt wat ze zeggen.
- [ ] **4.6 Afronden fase 4** — balans, Meet 20 s op Low/Mid/High, geheugen, documentatie. _Klaar als:_ 60/120 fps gelijk en alle tests + DataValidator slagen.

---

## Fase 5 – Co-op dungeon/raid via PeerJS · **open** (stappen zijn een voorstel)

- [ ] **5.1 Netwerklaag** — PeerJS-wrapper met kamercode, host/client, volledig los van de spelwereld. _Klaar als:_ twee browsers verbinden met een code en de verbinding valt netjes weg bij sluiten.
- [ ] **5.2 Host rekent alles uit** — serialiseerbare wereldstaat, client stuurt alleen input, host stuurt snapshots. _Klaar als:_ de gameplay van de client is gelijk aan die van de host (ook bij 150 ms vertraging).
- [ ] **5.3 Andere spelers in beeld** — namen boven het hoofd van anderen (nooit van jezelf), teammate-icoontje aan de schermrand buiten joystick en knoppen. _Klaar als:_ op de telefoon bedekt niets de besturing.
- [ ] **5.4 Raid-instance** — een dungeon/raid als instance die alleen samen te spelen is, met wachten bij de ingang. _Klaar als:_ samen in en uit werkt en geheugen groeit niet.
- [ ] **5.5 Combo's** — de combo's uit `combos.json` tussen twee spelers. _Klaar als:_ een combo telt alleen als beide spelers meedoen (test).
- [ ] **5.6 Afronden fase 5** — latency-test, meten, documentatie. _Klaar als:_ 60 fps op de pc tijdens een raid met twee spelers.

---

## Fase 6 – Polish, art-pass, audio, cutscenes · **open** (stappen zijn een voorstel)

- [ ] **6.1 Art-pass** — anime/toon-shading afmaken, echte modellen in plaats van placeholders. _Klaar als:_ alleen de placeholder-factory en de materialen veranderen, geen gameplay-code.
- [ ] **6.2 Echte kapsels en lichaamstypes** — per keuze een eigen model, kleuren blijven kleuren op hetzelfde model. _Klaar als:_ een nieuw kapsel toevoegen is alleen data.
- [ ] **6.3 Audio** — muziek per zone, sfx voor slaan/raken/lopen, volume-slider die echt werkt, stemmen altijd Engels met ondertitels in de gekozen taal. _Klaar als:_ geluid stopt netjes bij pauze en achtergrond.
- [ ] **6.4 Cutscenes afmaken** — wat na stap C.4 nog strip is omzetten naar filmisch, met echte modellen en camera's uit Blender (zie **Extra – Filmische cutscenes**). _Klaar als:_ geen enkele cutscene is nog een tekstpaneel en alles blijft overslaanbaar.
- [ ] **6.5 Afronden fase 6** — meten op pc en iPhone, geheugen, documentatie. _Klaar als:_ 60 fps op de iPhone en 120 fps op High op de pc.

---

## Later (backlog, nog geen stappen)

Seizoenseffecten · crafting en drogen · de Garden en farming (ook de bedden `MON_FarmPlot_1…6` in de kloostertuin) · Grimoire · lichtwezen-quest in Old Tjikko (alleen lente) · Nature Crystal in de Greenwood · eenmalig overstappen van zwaardvechter naar mage · de overige zones (Eredhollow, Ruins of Dunmar, Mountains of Karad Vorn, Plains of Tharond, Morvath, Black Citadel, Frozen Lake) · Warrior/Berserker (level 15) · Old Rivals (pas daar komt de naam Ruben voor) · Nine Lives (rematch met Sultan) · Second Wind · de Greenwood-side quests van de leraren (na de poort, gear als beloning) · een echte landpoort in het Blender-model.

---

## Notities

### Open vragen voor Bo en Lucas

| #   | Vraag                                                                | Stand nu                                                                                                                                        |
| --- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 15  | Wat doet een **Dark Slime** als hij je raakt?                        | Voorstel staat in de data: **Weakened** — 4 s lang doen je eigen treffers 25% minder. Eén regel in `monsters.json` anders                       |
| 16  | Een zwaardvechter kan de tweede exam halen door de knop in te houden | Hij komt er met minder HP uit; meer slimes passen niet binnen 520 XP. Wil Bo dat hij kan zakken, dan een ander soort vijand erbij (alleen data) |
| 1   | Wat gebeurt er overdag met mobs van 's nachts?                       | Ze blijven staan (test). Eén regel in `Enemies.stepSpawning`                                                                                    |
| 2   | Blijft Greyhaven in het gouden uur of krijgt de stad dag en nacht?   | Staat op `"lighting": "cycle"`; `"goldenHour"` is één woord in de data                                                                          |
| 4   | Moet `player.glb` ook in de open wereld gebruikt worden?             | Nu alleen in Greyhaven; buiten nog het placeholder-poppetje                                                                                     |
| 5   | Een echte landpoort in het Blender-model?                            | De muur is dicht behalve waar de rivier eronderdoor gaat. Daarna alleen data                                                                    |
| 7   | Hoe moet farming werken (zaad, groeitijd, oogst, seizoenen)?         | Alleen de bedden + markers staan in Blender                                                                                                     |
| 9   | Moet een schot op een onraakbare vijand melden dat hij beschermd is? | Voorstel: zo laten (je schiet erlangs)                                                                                                          |
| 10  | Moet de snel-drink-knop ook mana potions pakken?                     | Voorstel: zo laten, of een tweede knop                                                                                                          |
| A.5 | Vier vragen over rennen en springen (zie stap A.5a)                  | Nog niet gesteld                                                                                                                                |
| 19  | Hoe komt de speler het klooster uit? De kerk (met het portaal) heeft geen deur naar de kloostergang en de tuinmuur is dicht | Game: `openings` in `zones.json` maakt deuren beloopbaar (hal → kloostergang, hal → tuin, portaal). Nodig in Blender: een deur(opening) kloostergang → zuidbeuk van de kerk, of een hek in de tuinmuur; daarna één regel data |

### Nog te doen door Bo en Lucas

- Fase 2, 3.7, 3.8, 3.9 en het Blender-Greyhaven **spelen** en "Meet 20 s" draaien op de pc (stappen 2.8, 3.8.8, 3.9.4).
- De twee filmische cutscenes bekijken en meten (stap C.3).
- fps op een echte **iPhone** is nog nooit gemeten (sinds fase 1).
- Fase A: eerst de **looks van het personage** in Blender (stap A.0), daarna A.1 opnieuw + Mixamo (A.1b).

### Bekende problemen

- Elke start logt `missing text "common.close" (en)` (open vraag 17): `src/ui/Overlays.ts` vraagt het label op vóórdat `I18n.setLanguage` iets geladen heeft. Onschuldig, maar het vervuilt de debuglijst. Oplossing: het `aria-label` pas zetten als de knop in beeld komt.
- Three.js zelf is 548 kB in de bundel en kan niet verder opgesplitst worden.
- Vanuit het bed in het klooster kun je de kloostergang, de westvleugel en de tuin in, maar nog niet de stad (open vraag 19).
- 120 fps lukt op de iPhone waarschijnlijk niet (Safari tekent daar maximaal 60 keer per seconde); het spel loopt wel overal even snel.

### Tijdelijke namen (nog niet definitief, alleen in data gebruiken)

Hilda Ironhand · Professor Fizzwick · Marco the Merchant · Old Bertha · Brother Ansel · Sir Garrick the Blademaster · ezel Biscuit · De Wortelgrotten (Moerastrol Grimbald) · Toren van de Gevallen Leerling (Schaduwmagiër Veyra) · Draken-crypte (Botdraak Ashkarn) · de baas van The Forgotten Book · de valuta **Gold** · de elfenstad (nog geen naam) · **Treewardens** · het lichtwezen in Old Tjikko · Arcane Shard · de namen van de 5 spells, de gear, het betere zwaard en de exam-quests.
_Master Brink heet in het spel overal Master Brink; zijn echte naam (Ruben) komt pas voor in Old Rivals._

### Ontwerp-afspraken die blijven gelden (samenvatting; details in `docs/ARCHITECTURE.md`)

- **Camera:** over de schouder zoals Genshin Impact, vrij rond te draaien (pc: pointer lock), W loopt de kijkrichting op, zoomen binnen grenzen, nooit onder de grond.
- **Speler:** lopen 4 m/s, dash 25 energie met 1 s cooldown, energie max 100 en +20/s na 1 s rust — alles uit `player.json`.
- **Levels:** 20 startpunten + 1 punt per level over tien stats met zachte grenzen; geen automatische groei; **gold is alleen voor spullen**.
- **HUD:** zo leeg mogelijk, elk element faadt met een reden (`show(reason)`/`hide(reason)`); balken alleen in gevecht, HP-balk blijft onder 30%, gold alleen bij winst/verlies of een shop.
- **Zones:** naadloos buiten (zonenaam + autosave bij binnenkomen), interieurs en dungeons als instances met een kort laadscherm.
- **Checkpoints:** per zone één (`monastery`, `elven_shrine`, `stilt_monastery`, …); langslopen = nieuw checkpoint + autosave.
- **Seizoenen:** ISO-week 1 = Summer, daarna elke week verder (Summer → Autumn → Winter → Spring).
- **Opslaan:** één save in localStorage met versienummer + migraties; autosave bij checkpoint, nieuwe zone en afsluiten (`visibilitychange`/`pagehide`); verwijderen alleen via Settings met 2× bevestigen.
- **Telefoon:** alleen liggend (4:3 t/m 21:9, nooit uitgerekt, "Draai je telefoon" bij rechtop), knoppen ±1,5 cm, panelen passen op het scherm en scrollen, debugvenster begint klein en is weg te tikken (geen F3).
- **Lock-on:** wit puntje met dun ringetje op het midden van de vijand, even groot in CSS-pixels, breekt als er iets tussen de camera en de vijand komt (tolerantie 0,2 s), doel wisselen op een eigen knop.
- **Entities** met losse componenten, **simulatie los van rendering** (serialiseerbaar voor raids), **EventBus** voor `zoneEntered`, `placeFirstVisited`, `npcTalked`, `checkpointSet`, `statsReset`, … zodat quests later kunnen meeluisteren zonder bestaande code te wijzigen.
- Het pad van de speler (`sword` / `light` / `dark`) staat als veld in de save.
