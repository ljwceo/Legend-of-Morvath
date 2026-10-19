# PLAN – Legend of Morvath

> Dit is het enige plan-bestand. Alle fases staan hier, opgehakt in kleine stappen die in
> één korte sessie af kunnen. Lees **alleen de stap waar je aan werkt**, niet het hele bestand.
> Geschiedenis, besluiten en meetresultaten staan in `docs/PROGRESS.md`; techniek in
> `docs/ARCHITECTURE.md`. De projectregels staan in `CLAUDE.md`.
> Van een deel van de afgeronde stappen (C.4a, C.4, 3.10.x, D.1–D.4, A.0–A.3d, 4.1–4.3) staat het
> uitgebreide verslag in `docs/PLAN-RESULTATEN.md`; hier staat bij die stappen alleen de opdracht,
> "Klaar als:" en een verwijzing. Andere afgeronde stappen hebben hun verslag nog hier.

**Status:** `[ ]` open · `[~]` bezig · `[x]` klaar
**Eén stap = één sessie = één branch = één pull request.**

### Zo gebruik je dit bestand (usage sparen)

1. Begin een chat met: _"Lees CLAUDE.md en stap X.Y uit PLAN.md. Doe alleen die stap."_
2. Claude leest `CLAUDE.md` + die ene stap. `docs/PROGRESS.md` en het spelconcept alleen als de
   stap erom vraagt (en dan alleen het stukje dat nodig is).
3. Klaar? Zet de stap op `[x]`, zet één regel in `docs/PROGRESS.md`, commit, push, pull request. Stop.
4. Nieuwe wens of besluit van Bo/Lucas? Zet hem als nieuwe stap of in **Notities**, niet in `CLAUDE.md`.
5. **Klein bouwen, Bo laten testen** (Bo, 2026-10-15): één bouwronde per vraag, geen extra review- en fixrondes; zet het op de branch (of de proefpagina) en wacht op feedback in plaats van zelf door te polijsten.
6. **Ochtendtestbank** (Bo, 2026-10-16): na een nacht van de nachtbouwer staat er 's ochtends een losse testpagina klaar (artifact "Morvath Testbank", altijd dezelfde link) met de echte panelen, data en teksten van de nieuwe stappen; gebouwd met `npm run testbank` (`tools/testbank/`). Bo checkt die en zegt daarna of `auto-dev` in `main` mag.

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
  - _Superseded door Fase G (2026-10-17): elke build heeft mana en je leraar is een eerste specialisatie, geen permanente klasse. Hier bewaard als historische implementatiestand; de code doet dit nog tot G.2._
- [x] **3.8.6 Pad-effecten mage** — Mage Staff + Crystal Ceremony als stripcutscene (Brink: Water/Fire/Nature/Wind, Sam: Dark), kristal in de save. _Klaar als:_ de cutscene is overslaanbaar en de bijbehorende spreuk werkt.
  - _Superseded door Fase G (2026-10-17): staven verdwijnen uit het actieve spel en permanente element-ontgrendelingen vervangen het kristal als toegang tot spells; de Crystal Ceremony wordt verhalend aangepast (G.7/G.9), niet blind verwijderd. Hier bewaard als historische implementatiestand._
- [x] **3.8.7 Stadspoort** — `canLeaveCity` = Sultan verslagen + laatste exam klaar, save versie 12. _Klaar als:_ daarvoor blijft de poort dicht met de bestaande melding en teleport in het cheatmenu werkt altijd.
- [ ] **3.8.8 Spelen en terugkoppelen (Bo/Lucas)** — is de nieuwe tweede exam (drie waves) zwaar genoeg, en klopt het Dark-Slime-effect? _Klaar als:_ Bo heeft open vragen 15 en 16 beantwoord.

---

## Fase 3.9 – Eieren, mini-bosses en opnieuw verdelen · **gebouwd** (2026-10-13)

- [x] **3.9.1 Tien mini-bosses** — vaste plekken verspreid over alle zones, komen na 10 minuten terug. _Klaar als:_ er staat er in elke zone minstens één en geen twee in Greyhaven.
- [x] **3.9.2 Eieren als itemsoort** — `type: "egg"`, wegen niets, niet te gebruiken, elk ei eenmalig (in de save) + het ei van Sultan uit zijn baasgevecht. _Klaar als:_ een gevonden ei komt nooit terug.
- [x] **3.9.3 Herverdelen bij Sultan** — praat je met een ei in je tas: "Alles opnieuw verdelen? Dat kost één ei." met Ja/Nee + nog één keer bevestigen, event `statsReset`, save versie 13. _Klaar als:_ level, pad, gear en quests blijven gelijk en het ei is op.
- [ ] **3.9.4 Spelen en terugkoppelen (Bo/Lucas)** — zijn de tien mini-bosses sterk genoeg? _Klaar als:_ Bo zegt of de HP/schade van de mini-bosses goed staat.

---

## Extra – Filmische cutscenes (Elden Ring-stijl) · stap 1, 2 en C.4a **gebouwd** (2026-10-15)

Besluit uit het concept: cutscenes worden filmisch in de 3D-wereld zelf (`"type": "cinematic"` met `anchor`, `actors` en `shots` in `cutscenes.json`), met je eigen personage en gear in beeld. De strips blijven werken tot ze vervangen zijn. Overslaan = ±1 s ingedrukt houden. Alles op de vaste tijdstap, dus 60 en 120 fps zijn precies gelijk.

- [x] **C.1 Systeem + proef Pringle → Sultan** — `CinematicTimeline` (pure logica), `CinematicStage` (actors in 3D), `CinematicCutscene` (balken, ondertitels, naamkaart, fade/flits/tint, skip-ring), HUD en knoppen weg tijdens de film, overwinningstekst na een baas (`boss.victory`). _Klaar als:_ de zes shots van Pringle → Sultan lopen door in het baasgevecht en 60 en 120 fps geven precies hetzelfde (test).
- [x] **C.2 Eindscène na Sultan** — twee varianten (zwaard en mage) gekozen door de laatste treffer, slow motion, bevroren beeld, de ton, Pringle uit de rook, het ei als kaart, BOND FORGED in de balk van de zonenaam, Sultan vertelt als NPC waar je items vindt. _Klaar als:_ beide varianten spelen en zijn overslaanbaar.
- [ ] **C.3 Kijken en meten (Bo/Lucas)** — beide eindscènes bekijken via cheatmenu → Baasgevecht, en "Meet 20 s" tijdens een cutscene op Low en High. _Klaar als:_ Bo zegt of de scènes goed voelen en de fps staat in `docs/PROGRESS.md`.
- [x] **C.4a Intro filmisch (nieuw verhaal van Bo, 2026-10-15)** — de intro is één filmische scène met het speelbare gevecht erin (`IntroSceneState`, vervangt `IntroFightState`): een eigen `THREE.Scene` met de set uit data (`CinematicSet`: de mistdeur, zwevende boekenkasten, stoelen aan het plafond, de badlands), film → gevecht → film. Alles in `cutscenes.json`: `fight`/`afterFight` op een cinematic, actors `model: "fight"` en `prop:bat`, nieuwe shot-velden `hops`, `headingFrom`/`headingTo`, `ownTime` en `narration`, en per gevecht `set`, `abilities`, `dodge` en `seed`. Ontwerp en afwijkingen in `docs/intro-cinematic-design.md`; headless check `node scripts/intro-check.mjs` (`--skip`, `--quality low|mid|high`). _Klaar als:_ de hele intro speelt en is in elk deel overslaanbaar, en de check loopt zonder fouten. _Klaar 2026-10-15 · verhaal en verslag: `docs/PLAN-RESULTATEN.md` › C.4a_
- [x] **C.4 De overige strips omzetten** — de uitleg in de toren van Brink en de kelder van Sam, en de Crystal Ceremony. _Klaar als:_ elke omgezette cutscene is overslaanbaar en de oude strip-code is alleen nog voor wat nog niet om is. _Klaar 2026-10-16 · verslag: `docs/PLAN-RESULTATEN.md` › C.4_
- [ ] **C.5 Blender-camera's en echte modellen** — `cameraClip` (camera-animatie uit glTF) echt laten werken en de placeholders in `CinematicStage` vervangen. _Klaar als:_ een camera uit Blender speelt een shot en de draw calls blijven gelijk.

---

## Fase 3.10 – Afronden fase 3 · **bezig** (3.10.1, 3.10.3, 3.10.3b en 3.10.4 klaar)

Doel: fase 3 is af, gemeten en opgeschreven. Alleen bestaande getallen bijschaven, geen nieuwe systemen.

- [x] **3.10.1 Balans nameten** — nagebootste speler met zwaard, lichtmage en duistere mage, plus een paar extreme builds (alles in HP, alles in Strength, alles in Magic Power). _Klaar als:_ geen build slaat alles kapot of komt nergens doorheen, en de uitkomsten staan in `docs/PROGRESS.md`. _Klaar 2026-10-14 · verslag: `docs/PLAN-RESULTATEN.md` › 3.10.1_
- [ ] **3.10.2 Meet 20 s op de pc** — Low, Mid en High, in Greyhaven, bij het goblinkamp en tegen Sultan. _Klaar als:_ 60 fps op Mid en 120 fps op High, met de getallen in `docs/PROGRESS.md`.
- [x] **3.10.3 Geheugen controleren** — 10 minuten heen en weer lopen én 5× een instance in en uit. _Klaar als:_ geometries/textures gaan elke keer terug naar hun beginwaarde. _Klaar 2026-10-14 · verslag: `docs/PLAN-RESULTATEN.md` › 3.10.3_
- [x] **3.10.3b Achtergebleven textures opruimen** — zoek uit welke textures na het verlaten van een Blender-zone blijven staan (verdachten in `docs/PROGRESS.md`: de textures ín `greyhaven.glb` / `player.glb`, het gecachete model van Pringle, de targets van de renderer) en geef ze vrij. _Klaar als:_ `node scripts/mem-check.mjs` 5× in en uit een instance doet en de textures elke keer op hun beginwaarde terugkomen. _Klaar 2026-10-14 · verslag: `docs/PLAN-RESULTATEN.md` › 3.10.3b_
- [x] **3.10.4 `docs/ARCHITECTURE.md` bijwerken** — stats, buttonmapping, lock-on, exams, eieren, instances. _Klaar als:_ de documentatie klopt met de code. _Klaar 2026-10-14 · verslag: `docs/PLAN-RESULTATEN.md` › 3.10.4_
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

## Stap D – Deuren die meezwaaien · **klaar** (2026-10-14; vier chats van ±30 min, prompts in `docs/prompts/STAP-D-DEUREN.md`; scharnierkanten en aanslagen zijn aannames tot Bo ze in Blender nakijkt)

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

- [x] **D.1 Fysica-module met tests** — `src/systems/HingedBodies.ts` plus `HingedBodies.test.ts`, nog niets aan de game gekoppeld. _Klaar als:_ tests slagen voor: een cirkel die van de ene kant door het lijnstuk loopt duwt het de andere kant op, en andersom; zonder duwer gaat de hoek terug naar 0 en blijft daar; nooit boven een aanslag; een kant met aanslag 0 beweegt die kant nooit op; een cirkel precies op het scharnier geeft geen sprong; een cirkel met dash-snelheid (uit `player.json`) laat de hoek nooit boven de aanslag komen en de deur komt daarna tot rust; 600 stappen van 1/60 s geven hetzelfde als dezelfde 600 stappen in twee reeksen. `npm run lint`, `typecheck` en `test` groen. _Klaar 2026-10-14 · verslag: `docs/PLAN-RESULTATEN.md` › Stap D · D.1_
- [x] **D.2 Data, schema en validator** — `scene.doors` en `scene.doorSettings` in `zones.json` met de drie kloosterdeuren, schema in `src/data/schemas.ts`, DataValidator-regels (`box` bevat `hinge` én `tip`, `box` is niet leeg, minstens één kant van `openDegrees` is groter dan 0) met tests. De scharnierpunten en vrije kanten uit Blender (`docs/MONASTERY.md` noemt de objecten en de z-waarden van de openingen) en nagemeten in de game met `?debug=1` (de debugregel `chunks` toont je positie in Blender-coördinaten). _Klaar als:_ de validator slaagt op de echte data en faalt op elke fout uit de regels hierboven; in `docs/PROGRESS.md` staat per deur welke kant het scharnier zit en hoeveel graden vrij, als aanname voor Bo. _Klaar 2026-10-14 · verslag: `docs/PLAN-RESULTATEN.md` › Stap D · D.2_
- [x] **D.3 Deuren knippen en tekenen** — `SceneZone` maakt per deur een `Group` uit de driehoeken in `box`, met het scharnier als oorsprong; de `box` werkt als `opening` voor de botsingsmesh; een cheat in het cheatmenu (F6) zet alle deuren op een vaste hoek, zodat je zonder fysica kunt zien dat ze om de goede hoek draaien en niets van het kozijn meedraait. _Klaar als:_ met de cheat draaien alle drie de deuren om hun scharnier, niets anders beweegt mee, draw calls stijgen met hooguit het aantal deuren × hun materialen, en geometrieën en textures gaan bij verlaten weer terug (`node scripts/mem-check.mjs --only instances --instance brink_tower --cycles 2`). _Klaar 2026-10-14 · verslag: `docs/PLAN-RESULTATEN.md` › Stap D · D.3_
- [x] **D.4 Koppelen aan de speler** — `WorldState` voert de speler (en zijn dash-substappen) als duwer aan `HingedBodies`, zet elke stap de hoeken en tekent ze geïnterpoleerd; de cheat uit D.3 blijft. `docs/ARCHITECTURE.md` krijgt een stukje over deuren. _Klaar als:_ alle drie de kloosterdeuren zwaaien van je af open als je erdoorheen loopt (van beide kanten), vallen weer dicht, gaan bij een dash niet door de muur, en `?fps=30` en `?fps=120` geven dezelfde zwaai; fps en draw calls op Low, Mid en High zijn gelijk aan voor de stap (getallen in `docs/PROGRESS.md`). _Klaar 2026-10-14 · verslag: `docs/PLAN-RESULTATEN.md` › Stap D · D.4_

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
- [x] **A.0 Looks van het personage in Blender (Bo, blokkeert A.1b)** — besluit van 2026-10-13: eerst het echte model maken. _Klaar als:_ Bo zegt dat het model klaar is; daarna draait A.1 opnieuw op dat model. _Klaar 2026-10-15 · verslag: `docs/PLAN-RESULTATEN.md` › A.0_
- [x] **A.1b Mixamo (Bo, Deel B)** — `body_for_mixamo.fbx` door Mixamo auto-rig halen en de animaties uit de clipnamen-tabel downloaden (zie `tools/blender/character/README.md`). _Klaar als:_ `body_rigged.fbx` + alle animatie-FBX's staan in `art-source/` en de Mixamo-preview buigt zonder rare vervormingen. **Klaar (2026-10-16):** de rig en alle clips (plus 5 zwaard-extra's) staan in `art-source/`; A.2a is erop gebouwd.
- [x] **A.2a Mixamo terug in Blender: rig en clips** — `02_import_mixamo.py`: importeren, schaal ×0,01, `mixamorig:Hips` → `Hips`, elke animatie één Action met de juiste clipnaam, horizontale `Hips`-beweging eruit, clips inkorten (`Dash` 0,18–0,25 s, `Heavy_Windup` past bij 0,9 s, `Cast_Gather` als nette lus). _Klaar als:_ elke clip speelt in Blender zonder wegglijden. _Klaar 2026-10-16 · verslag: `docs/PLAN-RESULTATEN.md` › A.2a_
- [x] **A.2b Hoed, haar, zwaard en cape** — Hair/Hat/Hat_Band/Hat_Brim stijf aan `Head`, `Sword_*` stijf aan `RightHand`, cape terug + 3 kettingen van 3 botten (`Cape_L/M/R 1-3`) aan `Spine2` met weights, cape-botten in geen enkele clip. _Klaar als:_ hoed, haar en zwaard bewegen mee en de cape gaat mee met het lijf. _Klaar 2026-10-16 · verslag: `docs/PLAN-RESULTATEN.md` › A.2b_
- [x] **A.2c Export + check** — `export_web.py` (speler-deel): `export_animations=True`, armature + skin mee, geen `export_apply` op de armature, Draco uit als hij met skin stukloopt. Checkscript print botten, driehoeken (≤ 30.000), clips met duur en bestandsgrootte (≤ 2 MB). _Klaar als:_ `player.glb` heeft skelet + skin + alle clips met de juiste namen en de game start nog in Greyhaven. _Klaar 2026-10-16 · verslag: `docs/PLAN-RESULTATEN.md` › A.2c_
- [x] **A.3a Skinning in de toon-shader** — de skinning-chunks zitten al in `ToonMaterial` sinds Pringle (stap D.1); hier alleen nog de **Outline** erbij en controleren dat statische meshes niets duurder worden. Ook hier (besluit 2026-10-16): `Skin` en `Tunic` getextureerd tekenen (nieuw kind `textured` in `materials.json` + `mode: 'textured'`; de `tex` staat er sinds A.2c al) met de huidskleur uit de character creator als **tint over de texture** (besluit 2026-10-16: je eigen personage moet overal zichtbaar zijn, zie A.6). Of de normal map (`Hero_Normal`, spierlijnen en plooien) er ook bij komt, beslissen Bo en Lucas na deze stap. _Klaar als:_ de SkinnedMesh van de speler vervormt mee, met omlijning, en draw calls/fps blijven gelijk. _Klaar 2026-10-16 · verslag: `docs/PLAN-RESULTATEN.md` › A.3a_
- [x] **A.3b `animations.json` + model doorgeven** — nieuw databestand met schema en validator; `ScenePlayerModel` houdt de SkinnedMesh, laat de Blender-`Sword_*` aan `RightHand` zien (zwaard én staf) en geeft de clips door. _Klaar als:_ de DataValidator keurt het bestand en de clips komen aan. _Klaar 2026-10-16 · verslag: `docs/PLAN-RESULTATEN.md` › A.3b_
- [x] **A.3c `PlayerAnimator`** — `AnimationMixer` + state machine (Idle, Walk, Run, Sprint, Jump, Fall, Land, Dash, `Dash_Recover`, Attack, Cast, Hit, Death, Interact), crossfades 0,15–0,25 s, `timeScale = snelheid / referentiesnelheid`, **aanvallen op voortgang** (`action.time = progress × duur`) zodat de slag samenvalt met de hitbox, combo `Slash_1` → `Slash_2` → `Slash_3`. _Klaar als:_ de keuze-functie is puur en getest, voeten glijden niet en de slag raakt visueel op het moment van de schade. _Klaar 2026-10-16 · verslag: `docs/PLAN-RESULTATEN.md` › A.3c_
- [x] **A.3d Bovenlijf, leunen en debug** — kopie van de cast-clip met alleen bovenlijf-botten bovenop de loopclip (`castMoveFactor`), licht leunen bij draaien en remmen, F3 toont state + clip, cheatmenu speelt elke clip los af. Het placeholder-poppetje houdt `setSwordPose` als terugval. _Klaar als:_ casten tijdens lopen ziet er goed uit en headless Chromium geeft geen fouten. _Klaar 2026-10-16 · verslag: `docs/PLAN-RESULTATEN.md` › A.3d_
- [x] **A.4a Spring bones** — `src/render/SpringBones.ts`: per cape-bot stijfheid, demping, zwaartekracht en een maximale hoek; eigen vaste substap (bijv. 120 Hz met accumulator); getallen in `animations.json → cape`, cheat-baar. _Klaar als:_ de cape beweegt exact hetzelfde op 60 en 120 fps (test) en er zijn geen allocaties per frame. _Klaar 2026-10-16 · verslag: `docs/PLAN-RESULTATEN.md` › A.4a_
- [x] **A.4b Botsing en reset** — botsbollen op heupen, bovenbenen en rug; resetten na teleport of respawn. _Klaar als:_ de cape gaat niet door de benen bij rennen of dashen en zwiept nooit door de wereld na een teleport. **Klaar (2026-10-18):** bollen en capsules op heup, rug, dijen en schenen (`animations.json → player.cape.colliders`), het hele bot botst (niet alleen de punt), reset na een sprong van meer dan 3 m en bij teleport/respawn; cheat "Botsbollen tonen". Plek en grootte van de bollen zijn een schatting: Bo bekijkt ze in het spel. Verslag in `docs/PROGRESS.md`.
- [x] **A.5a Open vragen aan Bo (eerst stellen)** — mag je in de lucht dashen? Mag je in de lucht aanvallen of casten? Kost springen energie? Sprinten vasthouden of aan/uit? _Klaar als:_ alle vier de antwoorden staan in Notities. **Klaar (2026-10-18):** zie Notities → open vragen, rij A.5.
- [x] **A.5b Sprinten en springen in de simulatie** — `player.json`: `sprint` (speed, energyPerSecond) en `jump` (heightMeters, gravity, coyoteSeconds ±0,1, bufferSeconds ±0,12, airControl); `MoverState` krijgt vy, grounded, sprinting, coyoteTime, jumpBuffer; `GroundedMover` met echte verticale snelheid. _Klaar als:_ springen is precies even hoog en ver op 60 en 120 Hz (test) en coyote time + jump buffer zijn getest. _Klaar 2026-10-18 · verslag: `docs/PLAN-RESULTATEN.md` › A.5b_
- [ ] **A.5c Toetsen, knoppen en draaglast** — acties `jump` en `sprint` in `controls.json` (let op botsing met dash), knoppen in TouchControls, teksten in `en.json` + `nl.json`, bestaande saves krijgen de nieuwe standaardtoetsen; sprong en sprint schalen mee met de draaglast, overbelast = niet sprinten of springen. _Klaar als:_ de nieuwe toetsen zijn instelbaar in Settings → Besturing en de DataValidator slaagt.
  - _Na A.5a (2026-10-18):_ sprint krijgt **geen eigen toets**: de dash-knop ingedrukt houden = sprinten (`MoveCommand.sprint`), alleen `jump` is een nieuwe actie. TouchControls valt af (besluit S-5). Sprintsnelheid schaalt al mee met de draaglast (factor op `walkSpeed`); hier blijft over: sprong bij draaglast en overbelast = niet sprinten of springen. `WorldState.command.jump`/`.sprint` staan nu nog vast op false.

_Chat 5 (A.5a–c) heeft geen Blender nodig en mag vóór of tegelijk met A.2–A.4._

**Jouw personage overal (besluit Bo, 2026-10-16):** wat je in de character creator kiest (man/vrouw, kapsel, haarkleur, huidskleur, mantelkleur, …) is overal in het spel jouw poppetje: in de creator zelf, de intro, Greyhaven, de open wereld en de cutscenes. Het oude placeholder-poppetje verdwijnt. Komt na A.3 en A.4 (eerst moet één model goed bewegen en er goed uitzien).

- [ ] **A.6a Modellen voor alle keuzes (Bo in Blender, daarna script)** — Bo maakt een **vrouwelijk lijf** dat op hetzelfde skelet `PlayerRig` past (zodat alle 24 clips erop werken) en de **5 kapsels** uit de creator (kort, naar achteren, slordig, lang, paardenstaart) als losse meshes met materiaal `Hair`, net als het lijf in A.0. Daarna zet een script (bijv. `05_body_variants.py`) ze stijf aan `Head` / skinned aan `PlayerRig`, en nemen `04_export_player.py` + `check_player_glb.py` ze mee (namen vast in de check, grenzen voor driehoeken en grootte blijven gelden). _Klaar als:_ `player.glb` heeft beide lijven en alle 5 kapsels op één skelet, de check is groen, en elke clip speelt op beide lijven zonder rare vervormingen (te zien in `tools/player-preview/`).
- [ ] **A.6b Jouw poppetje overal (code)** — één gedeeld spelersmodel uit `player.glb` met de gekozen lijfvorm, het kapsel en de kleuren (tint op `Hair`, `Skin`, `Cloak_Navy`, `Hat_Navy`, `Gold_Trim`), gebruikt in de character creator (verandert live mee), de intro (`IntroSceneState`), de open wereld, Greyhaven en `CinematicStage`. `PlaceholderFactory` en `setSwordPose` blijven alleen als terugval als het model niet laadt. _Klaar als:_ een man en een vrouw met verschillende kapsels en kleuren zien er in de creator, de intro, Greyhaven en de open wereld precies hetzelfde uit, en fps en draw calls op Low, Mid en High blijven binnen de harde eisen.

---

## Fase 4 – Forge, markt, spellboek, kristallen, skill tree · **open** (stappen zijn een voorstel)

- [x] **4.1 De echte Forge** — Hilda upgradet wapens en gear met gold + materialen, niveaus en kosten in data, alleen buiten gevecht. _Klaar als:_ een upgrade verandert de stats van het item en staat in de save. _Klaar 2026-10-16 · verslag: `docs/PLAN-RESULTATEN.md` › 4.1_
- [x] **4.2 Markt en winkels** — meerdere handelaren uit data, koop- en verkoopprijzen, voorraad die terugkomt. _Klaar als:_ een nieuwe handelaar toevoegen is alleen data. _Klaar 2026-10-16 · verslag: `docs/PLAN-RESULTATEN.md` › 4.2_
- [x] **4.3 Spellboek** — spellboek-UI, meer spells uit `spells.json`, spellslots per staf. _Klaar als:_ je spells wisselt buiten gevecht en de keuze staat in de save. _Klaar 2026-10-16 · verslag: `docs/PLAN-RESULTATEN.md` › 4.3_
  - _Superseded door Fase G (2026-10-17): slots per staf, het kristal-element als filter en het automatisch leren op level (`learnLevel`) worden vervangen door de Rookie Grimoire met voorbereide incantation-slots, permanente elementen en los geleerde incantations (G.3/G.5/G.7). Hier bewaard als historische implementatiestand._
- [ ] **4.4 Kristallen · uitgesteld (herontwerp nodig)** — de oude opzet (kristallen mergen/upgraden met effect op je staf en spells) is **vervallen** door Fase G: welke elementen je kunt gebruiken komt uit permanente element-ontgrendelingen, en staven zijn uit het actieve spel. De legacy-kristallen (`crystal`-items en `character.crystal` in de save) blijven bewaard en worden niet verwijderd. Wat ze later nog doen (bijv. crafting of iets anders) is een open inhoudsbesluit van Bo/Lucas; tot dan geen bouwwerk. _Klaar als:_ Bo/Lucas het toekomstige gebruik van legacy-kristallen hebben besloten en deze stap opnieuw is beschreven.
- [ ] **4.5 Skill tree** — alleen skills en perks (geen statpunten meer). Takken per specialisatie (Sword, Fire, Water, Wind, Nature, Dark en Crafting, waar het past), **niet** vastgezet aan een permanente klasse of pad. **Skillpunten komen uit mijlpalen** (Fase G), niet automatisch per level en los van de attribuutpunten (1 per level); de eerste Sword-mijlpaal komt van Sir Garrick (G.7). De huidige regels in `skills.json` → `rules` (`pointsPerLevel` per mage/sword, `classChoiceLevel`) gaan nog uit van het oude klassenmodel en worden bij het bouwen herschreven. De lijst mijlpalen en de puntwaarden zijn nog niet besloten. _Klaar als:_ elke tak werkt in NL en EN, de perks doen echt wat ze zeggen en skillpunten komen alleen uit mijlpalen (tests).
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

## Fase H – Geluid (muziek, effecten, stemmen) · **open** (voorstel 2026-10-16, wacht op H.0)

Doel: het spel klinkt: muziek en ambience per zone, effecten in de wereld, in de menu's en in het gevecht, en een volume dat echt werkt. Vervangt stap 6.3, die voor één sessie te groot was. Bedoeld als eigen groep naast de andere (voorstel: branch `auto/audio`, pas in `main` na akkoord van Bo/Lucas), met nieuwe bestanden in `src/audio/` en `public/data/audio.json`.

**Zo pak je het snel op:** beantwoord eerst H.0 (drie vragen, kost geen bouwtijd). Daarna mogen H.1 t/m H.3 meteen, ook tegelijk met wat er van Fase S nog open is (souls-like gevecht: S.0, S.2 t/m S.8, S.10 t/m S.14 en S.16 staan in `main`; S.1 en S.9 zijn nog open; het resterende werk van S.15 is opgegaan in G.5 van Fase G en wordt niet los uitgevoerd). Het gevecht waar H.4 op bouwt (uitputting, rol, aankondiging, poise, blok en parry: S.3 t/m S.7) staat al in `main`. Begin een chat met: _"Lees CLAUDE.md en stap H.1 uit PLAN.md. Doe alleen die stap."_

**Wat er al klaarstaat:** het volume-schuifje in Settings (`settings.volume`, 0–1, wordt opgeslagen en geeft `settingsChanged`) doet nog niets. Cutscene-shots hebben al `silence` en `CinematicCutscene` heeft een `silence()`-haak. `WorldState` pauzeert al bij pauze en bij een verborgen tabblad, en `zoneEntered` en `instanceEntered` bestaan al. Er zijn nog geen gevechtsevents op de EventBus.

**Vaste regels voor deze fase**

1. **Geluid is alleen render-kant.** Het leest events en meters en stuurt de simulatie nooit; geen hitbox, timing of schade hangt van geluid af. Met en zonder geluid is de uitkomst op 60 en 120 Hz exact gelijk, en op Low, Mid en High ook.
2. **Alles in data.** `public/data/audio.json`: per cue de bron, bus, volume, toonhoogte-spreiding, cooldown en maximaal aantal tegelijk, met zod-schema en DataValidator. Geen bestandsnamen of getallen in code; ondertitels in `en.json` en `nl.json`.
3. **Geen allocaties in de gameloop.** Korte geluiden uit een pool, buffers één keer decoderen en hergebruiken.
4. **Geheugen gaat terug.** Buffers van een zone of instance gaan weg bij verlaten; `scripts/mem-check.mjs` telt ze mee (H.2).
5. **Browserregels.** De `AudioContext` start pas na de eerste klik of toets (het titelscherm vraagt die al). Stil bij pauze, bij een verborgen tabblad en tijdens een `silence`-shot.
6. **Alleen gratis bronnen** (`CLAUDE.md` sectie 2, punt 7). De herkomst en licentie van elk bestand staat in `audio.json` (`credit`).
7. **Bestandsbudget.** `scripts/check-bundle.mjs` meet alleen scripts, dus geluidsbestanden vallen er niet onder; H.1 voegt een eigen grens toe.
8. **Pc en controller** (besluit S-5 uit Fase S): geen iPhone-eisen voor geluid.

**Besluiten (H.0, Bo/Lucas)**

| Nr  | Vraag                                 | Voorstel                                                                                                                                                                                                                                           |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H-1 | Waar komt het geluid vandaan?         | Effecten zelf gesynthetiseerd met WebAudio (geen bestanden) of van vrije CC0-bronnen; tijdelijke CC0-muziek, echte muziek later. AI-muziek alleen na controle van de voorwaarden                                                                    |
| H-2 | Komen er stemmen?                     | Nu niet: eerst alleen tekst. Stemmen (altijd Engels, ondertitels in de gekozen taal, zoals het concept zegt) komen er alleen als dit "ja" wordt, in H.6                                                                                             |
| H-3 | Eén volume of meer schuifjes?         | H.1 gebruikt `settings.volume` als hoofdvolume. Losse schuifjes (muziek, effecten): nog open. H.0/H.1 bepalen of losse schuifjes een migratie van de instellingen of de save nodig hebben; zo ja, dan met de save-versie die op dat moment in `main` staat, en de bestaande instellingen van spelers blijven behouden                                          |

**Stappen**

- [ ] **H.0 Besluiten (Bo/Lucas)** — H-1 t/m H-3 beantwoorden en vastleggen in `docs/PROGRESS.md` → Besluiten. _Klaar als:_ alle drie een antwoord hebben.
- [ ] **H.1 Audio-motor** — `src/audio/AudioManager.ts` met één `AudioContext` en bussen (hoofd, muziek, effecten); `settings.volume` als hoofdvolume via `settingsChanged`; start na de eerste klik of toets; stil bij pauze en verborgen tabblad; de `silence`-haak van de cutscenes aangesloten; `audio.json` met schema en DataValidator-regels; een pool voor korte geluiden; een testgeluid in het cheatmenu (F6). De pure logica (bussen, ducking, cooldowns, varianten kiezen) staat los van de browser en is getest. _Klaar als:_ het schuifje in Settings echt werkt, geluid stopt bij pauze en bij een verborgen tabblad, de bestaande tests en de simulatie op 60 en 120 Hz ongewijzigd zijn, en het bestandsbudget een grens heeft.
- [ ] **H.2 Muziek en ambience per zone** — luistert naar `zoneEntered` en `instanceEntered` (en naar een event voor het verlaten van een instance, als dat er nog niet is); per zone en instance muziek of ambience in data; lus en vloeiende overgang; Greyhaven, de Greenwood, Mournfen, de toren van Brink, de kelder van Sam en de intro. _Klaar als:_ van zone naar zone lopen wisselt de muziek vloeiend zonder hapering, en `mem-check` laat de buffers bij verlaten terugkomen op de beginwaarde.
- [ ] **H.3 Wereld- en interfacegeluid** — stappen, deuren (de hoek uit `HingedBodies`; stap D liet geluid bewust weg), menu's, dialoog, tas, drankjes, level up, quest klaar, gold, checkpoint en doodgaan, via bestaande events (`levelUp`, `questCompleted`, `itemsGained`, `flaskUsed` (was `potionDrunk` tot G.5), `checkpointSet`, `playerDied`, …). _Klaar als:_ al deze momenten een geluid uit data geven en een nieuw geluid toevoegen alleen data is.
- [ ] **H.4 Gevechtsgeluid (bouwt op S.3 t/m S.7, die in `main` staan)** — slag, treffer en missen, rol, blok en parry, poise breken, uitgeput, spells per element, en de aankondiging van vijandaanvallen (de cue uit S.5b ook hoorbaar). Daarvoor komen er alleen-lezen gevechtsevents bij in `events.ts`. Het combo-geluid uit het concept hoort bij stap 5.5. _Klaar als:_ elke vijandaanval van tevoren te horen is, een geslaagde parry een eigen geluid heeft, en een test bewijst dat de simulatie met en zonder geluid exact dezelfde uitkomst geeft op 60 en 120 Hz.
- [ ] **H.5 Cutscene-audio en baasmuziek** — `silence` krijgt echt stilte, de donder uit de intro, een stinger bij de eindscène (BOND FORGED), muziek bij Sultan en andere baasgevechten, en muziek die zachter wordt tijdens dialoog. _Klaar als:_ elke cutscene zijn geluid heeft en overslaan het geluid netjes stopt.
- [ ] **H.6 Stemmen (alleen als H-2 "ja" is)** — gesproken regels altijd in het Engels, ondertitels in de gekozen taal uit `en.json` en `nl.json`, per NPC en cutscene in data. _Klaar als:_ één gesprek en één cutscene met stem spelen en de ondertitels meegaan met de taalkeuze.
- [ ] **H.7 Afronden** — de mix (onderlinge volumes, ducking), meten (cpu en geheugen, fps en draw calls gelijk aan vóór de fase op Low, Mid en High), `docs/ARCHITECTURE.md` en `CLAUDE.md` (map `src/audio`) bijwerken, en Bo en Lucas spelen en luisteren. _Klaar als:_ fps en draw calls niet slechter zijn dan vóór de fase en Bo en Lucas zeggen dat de mix goed klinkt.

**Risico:** H.1 t/m H.3 raken `schemas.ts`, `DataValidator.ts`, `WorldState.ts` en `SettingsPanel.ts`, net als Fase S. Houd de aanpassingen daar klein en op eigen regels, zodat het samenvoegen schoon blijft.

---

## Fase 6 – Polish, art-pass, audio, cutscenes · **open** (stappen zijn een voorstel)

- [ ] **6.1 Art-pass** — anime/toon-shading afmaken, echte modellen in plaats van placeholders. _Klaar als:_ alleen de placeholder-factory en de materialen veranderen, geen gameplay-code.
- [ ] **6.2 Echte kapsels en lichaamstypes** — per keuze een eigen model, kleuren blijven kleuren op hetzelfde model. _Klaar als:_ een nieuw kapsel toevoegen is alleen data.
- [ ] **6.3 Audio** — verplaatst naar **Fase H – Geluid** (voorstel 2026-10-16: muziek, effecten én stemmen is te veel voor één sessie). _Klaar als:_ Fase H is afgerond.
- [ ] **6.4 Cutscenes afmaken** — wat na stap C.4 nog strip is omzetten naar filmisch, met echte modellen en camera's uit Blender (zie **Extra – Filmische cutscenes**). _Klaar als:_ geen enkele cutscene is nog een tekstpaneel en alles blijft overslaanbaar.
- [ ] **6.5 Afronden fase 6** — meten op pc en iPhone, geheugen, documentatie. _Klaar als:_ 60 fps op de iPhone en 120 fps op High op de pc.

---

## Fase S – Souls-like gevecht · **open** (concept 2026-10-16, Bo/Lucas)

Doel: het gevecht souls-like maken (stamina, rol met onkwetsbare frames, aankondiging en raakvensters per aanval, poise) binnen de bestaande 3D-opzet, zonder enginewissel. Alle stappen van deze fase gaan via branch `auto/souls` en worden pas na akkoord van Bo/Lucas in `main` gezet. Concept: Claude Doc "Concept: Fase S – Souls-like gevecht".

**Besluiten (S.0, Bo/Lucas, 2026-10-16)**

| Nr | Vraag | Besluit |
| --- | --- | --- |
| S-1 | Hoe zwaar? | Uitdagend maar eerlijk: één moeilijkheid, duidelijke aankondiging per aanval, geen difficulty-instelling |
| S-2 | Rol en dash | Eén knop: de dash wordt de rol (met onkwetsbare frames); in lock-on rol je in de stickrichting |
| S-3 | Blokkeren en parry | **Ja, nu meebouwen** (stap S.7); timingvenster en staminakosten uit data |
| S-4 | Doodgaan | **Gold verliezen en terughalen bij je lijk** (nieuwe stap S.4b). Sterf je opnieuw voordat je het hebt opgehaald, dan is het weg. Geen verloren zielen |
| S-5 | Platform | **Pc en console (controller). De iPhone en de telefoon vallen af:** geen touch-besturing meer bouwen en niet meer meten op een iPhone. De bestaande touch-code blijft staan tot Bo/Lucas besluiten hem te verwijderen |
| S-6 | Mage | Mana blijft; casten kost tijd waarin je kwetsbaar bent, je kunt eruit rollen. **Magie staat centraal en een goede mage is lastiger te beheersen dan brute force** (omgekeerd aan Elden Ring, waar mages als de makkelijke weg gelden): hogere vaardigheidsdrempel, veelzijdig (spells, enchants, boosts) en sterker voor wie het onder de knie heeft. De zwaardvechter is de toegankelijke keuze. _Fase G (2026-10-17): de bedoeling blijft, maar "mage" en "zwaardvechter" zijn geen permanente klassen meer. Iedereen vecht met een melee-wapen en een Grimoire; een build die vooral op magie leunt is moeilijker te beheersen, een build die vooral op melee leunt is de toegankelijke keuze. Rollen uit een cast mag (zie Fase G, U-1)._ |
| S-7 | Raids | De eigen client beslist over zijn eigen rol, de host controleert ruim |
| S-8 | Springen | Blijft, geen dash of rol in de lucht; sluit aan op A.5a |
| S-9 | Voorbereide gevechtsslots | Als basis: **2 voorbereide hoofdwapens en 1 voorbereide incantation (Rookie Grimoire)**, plus **offhand-modi** (Grimoire / Shield / Sword Art) in plaats van een vast offhand-slot. Aantallen in data; Grimoire Pages (G.7: het gedeelde Academy-slot) en Weapon Harness Upgrades verhogen de capaciteit (G.5 bouwde het mechanisme). _De "4 drankjesslots" zijn superseded (Lucas, 2026-10-19, G.5): gewone drankjes zijn legacy; in plaats daarvan heb je herbruikbare **Flasks** (Health en Mana) met een permanente capaciteit die alleen bij een echte checkpoint-rust vullen._ _Oorspronkelijk besluit (Bo/Lucas, 2026-10-17, vraag 26): 2 hoofdwapens, 1 offhand en 4 drankjesslots; het deel "1 offhand-slot" is superseded door de offhand-modi van Fase G._ |
| S-10 | Tas in een gevecht | **Mag open, maar alleen voor drankjes, en het gevecht loopt gewoon door** (geen pauze). Buiten een gevecht blijft de tas pauzeren (Bo/Lucas, 2026-10-17, vraag 26). _G.5 (2026-10-19): "drankjes" = je twee Flasks; gewone drankjes zijn legacy en nergens meer te gebruiken._ |

**Eisen (gelden voor alle S-stappen)**

- Vaste tijdstap: alle vensters (onkwetsbare frames, raakvensters, stagger) in seconden uit data, geteld op 60 Hz. Op 60 en 120 fps geeft dezelfde invoer exact dezelfde uitkomst, met een test per stap.
- Gelijk op elke grafische stand: Low, Mid en High verschillen alleen in uiterlijk, nooit in timing of hitboxes.
- Data buiten de code: alle tijden, kosten en vensters in `public/data/`, alle teksten in `en.json` en `nl.json`, met `{keyDodge}`-achtige tokens voor toetsen.
- Geen allocaties in de gameloop en alle nieuwe effecten uit een pool.
- Eén stap per sessie en klein bouwen: niet vooruit werken; Bo en Lucas testen na elke stap.
- Pc en controller: in Fase S geen touch-besturing en geen iPhone-eisen (besluit S-5). Andere stappen die de iPhone of touch noemen, moeten nog herzien worden.

**Stappen**

- [x] **S.0 Besluiten (Bo/Lucas)** — vragen S-1 t/m S-8 beantwoorden en vastleggen in `docs/PROGRESS.md` → Besluiten, in `CLAUDE.md` sectie 1 en in het spelconcept. _Klaar als:_ alle acht vragen een antwoord hebben en sectie 1 souls-like noemt.
  - _2026-10-16: alle acht beantwoord (zie tabel hierboven en `docs/PROGRESS.md` → Besluiten Fase S). S-3 = **ja**, dus S.7 mag gebouwd worden. `CLAUDE.md` is bijgewerkt. Het spelconcept in Google Docs is nog niet bijgewerkt; dat doen Bo/Lucas zelf._
- [ ] **S.1 Meten vóór bouwen (Bo/Lucas)** — stap 3.10.2 uitvoeren op de pc (Low, Mid en High). _Klaar als:_ de fps per stand op de pc in `docs/PROGRESS.md` staan.
  - _Besluit (Bo/Lucas, 2026-10-18): **niet vervallen.** S.1 blijft nodig vóór de definitieve acceptatie en merge van G.2; alleen het bouwen van G.2 op een eigen branch mag al. Headless tests tellen niet als S.1-meting._
- [x] **S.2 Gamepad** — `Input` krijgt de Gamepad API als bron, standaardbindingen in `controls.json`, bindbaar in Settings → Besturing. _Klaar als:_ lopen, camera, lock-on, slaan en dash met een controller werken in Chrome en Safari en de mapping getest is.
  - _Auto-run 2026-10-16: goedgekeurd (vierde poging). Nog door Bo/Lucas te testen met een echte controller in Chrome en Safari; op de iPhone werkt de Gamepad API waarschijnlijk alleen via HTTPS (GitHub Pages), niet via `npm run dev` op het LAN. Start = pauze (niet bindbaar); menu's kiezen met controller komt later. Bekend klein punt: bij twee controllers kan de allereerste druk op de tweede verloren gaan._
- [x] **S.3 Stamina-regels** — de energiebalk blijft; erbij komen: regen pas na een pauze (`energyDelaySeconds` bestaat al), uitgeput zijn bij 0 en kosten per actie uit `player.json`. _Klaar als:_ elke actie kost wat de data zegt en 60 en 120 Hz exact dezelfde uitkomst geven (test).
  - _Auto-run 2026-10-16: goedgekeurd. Uitgeput zijn bij 0 (acties mogen starten zolang energie > 0, kosten afgekapt op 0), daarna `exhaustedDelaySeconds` en herstel bij `exhaustedRecoverEnergy` (startwaarden 1 s en 20, gevoelig voor de Sultan-balanstests; Bo/Lucas kunnen bijstellen). Bekend: wie uitgeput de snelle slag ingedrukt houdt, blijft op 0 hangen. Geen HUD-weergave van uitgeput zijn (later)._
- [x] **S.4 Rol met onkwetsbare frames** — de dash krijgt `iFrames` (start en einde), `recoverySeconds` en afstand in `player.json`; de schadecheck slaat je over tijdens de onkwetsbare frames; richting volgt de lock-on. _Klaar als:_ een aanval die binnen het venster raakt mist, erbuiten wel raakt, en dat op 60 en 120 Hz gelijk is (test).
  - _Auto-run 2026-10-16: goedgekeurd. Venster 0,03–0,15 s en `recoverySeconds` 0,05 zijn startwaarden in `player.json` (bij 0,1 zakte de Balance-test voor Entrance Exam 2; bijstellen mag). Onkwetsbaar tegen alle schade via `hurtPlayer` (ook pijlen en brand). Richting = stick/toetsen ten opzichte van de camera, in lock-on draait de camera mee (per beeldje, niet per vaste stap); stilstaand rol je in kijkrichting. Geen rol in de lucht: `MoverState.airborne` is de haak, het springsysteem (A.5a) moet hem zetten. Het oude besluit van 2026-10-10 ("dash maakt niet onkwetsbaar") is vervangen door S-2. Nog geen HUD-weergave of effect van de onkwetsbare frames._
- [x] **S.4b Gold terughalen bij je lijk** — bij doodgaan verlies je gold (percentage in `player.json`, op verzoek van Bo/Lucas 2026-10-16 100%) en blijft het liggen op de plek waar je viel, als herkenbare markering in toon-stijl. Loop je erheen en pak je het op, dan krijg je het terug; ga je eerst opnieuw dood, dan is het oude gold weg en komt er een nieuwe markering. Opslaan en laden bewaren de markering (save-versie ophogen met migratie), teksten in `en.json` en `nl.json`. _Klaar als:_ doodgaan zet de markering, ophalen geeft het gold terug, een tweede dood vervangt de markering, en save en laden behouden hem (tests).
  - _Auto-run 2026-10-16: goedgekeurd. Ophalen = erover heen lopen binnen `death.markerPickupRadius` (1,6 m, startwaarde in `player.json`), alleen in dezelfde instance en op x/z (hoogte telt niet). Save-versie 19 met migratie. Verlies wordt nog direct van je gold afgetrokken; HUD toont dat na het wakker worden. Nog niet in de browser gespeeld: Bo/Lucas testen markering en ophalen._
- [x] **S.5a Aanvalsfases van vijanden** — elke vijandaanval in data in fases: aankondiging, raakvenster, herstel (`monsters.json`, `EnemyAI.ts`). _Klaar als:_ Green Slime en Goblin hun aanvallen uit data halen en een test bewijst dat schade alleen in het raakvenster valt.
  - _Auto-run 2026-10-16: goedgekeurd (derde bouwronde, aparte checkers). Aankondiging, raakvenster en herstel tellen in hele stappen (`PHASE_EPSILON`); `strikeSeconds` heet nu `hitSeconds` in `monsters.json`. Balansnotitie: alle lunge-slimes hebben `hitSeconds` 0,2501 (16 stappen, behoudt de oude balans; 0,25 gaf 15 stappen en brak Balance-tests). Strike- en shoot-aanvallen treffen 1 stap later en `dodging` duurt 0,1 s langer. Big Swing, Heavy Slam en Spore Burst hebben nog geen eigen raakvenster (S.8). Nog niet in de browser gespeeld._
- [x] **S.5b Aankondiging zichtbaar** — per aanval een duidelijke visuele cue in toon-stijl, de aankondigingstijd uit data. _Klaar als:_ elke aanval van tevoren te zien is en de cue op Low, Mid en High even lang duurt.
  - _Auto-run 2026-10-16: goedgekeurd (na één herstelronde: echte 60/120 fps-test). Cue per aanvalssoort: schijf (strike), lijn (lunge, shoot), gebied (specials), duur uit `windupSeconds`/`warningSeconds`, pool van 8+8. Cue toont reikwijdte nog niet exact (lunge-lijn start in het midden, strike-schijf is een volle cirkel i.p.v. 140° boog); rechtzetten in S.8. Max 8 cues van dezelfde vorm tegelijk. Sultan/BossAI nog zonder nieuwe cue (S.8). Lijnbreedte en maxlengte staan als visuele constanten in `AttackCue.ts`. Nog niet in de browser gezien: Bo/Lucas testen leesbaarheid en draw calls op Low/Mid/High._
- [x] **S.6 Stagger en poise** — een poise-balk voor vijanden en speler; een zware slag of kritieke treffer breekt poise; het gewicht van je uitrusting (draaglast) bepaalt hoe stabiel je staat. _Klaar als:_ een vijand wankelt als zijn poise breekt en zwaardere uitrusting jou stabieler maakt (test).
  - _Auto-run 2026-10-16: goedgekeurd (na één herstelronde: staf-schoten, alle monsters, zichtbare cues). Poise via `src/systems/Poise.ts`; speler-max = `baseMax` + `perKg` × gedragen kg (continu, geen tiers). Alle getallen (`player.json` → `poise`, `monsters.json`, `spells.json`) zijn startwaarden om bij te stellen: een kritieke snelle slag (12) breekt een Green Slime (20) niet in één keer, een zware slag (30) wel. Sultan en dummy hebben nog geen poise (S.8). HUD-balk alleen voor de speler (verschijnt bij minder dan vol), geen vijandbalk. Geen balanstest voor hoe vaak de speler wankelt. Nog niet in de browser gespeeld: Bo/Lucas testen of staggertijden eerlijk voelen._
- [x] **S.7 Blokkeren en parry (S-3 = ja)** — timingvenster uit data, kost stamina. _Klaar als:_ een goed getimede parry de aanval afvangt en het venster op 60 en 120 Hz gelijk is (test).
  - _Auto-run 2026-10-16: goedgekeurd. `src/systems/Guard.ts`; toets R en gamepad L3 (Pad10), bindbaar (`block`). Parry 0,2 s volledig afgevangen (geen schade/poise/energie, aanvaller wankelt als hij poise heeft); daarbuiten blok = 30% schade, kost energie, bij 0 energie breekt het blok (uitgeput, extra poise-schade). Alles in `player.json` → `guard`, startwaarden om bij te stellen. Alleen zwaardvechter (mage rolt, S-6). Geen richtingscheck (ook van achteren), nog geen guard-animatie of HUD-indicator; brand is niet te blokken; bij bossen alleen cosmetisch effect van een parry. Nog niet in de browser gespeeld._
  - _Fase G (2026-10-17): "alleen zwaardvechter" en toets L3 zijn superseded: guard/blok/parry voor elke build (G.2), op de controller LB (G.6). Hier bewaard als historische implementatiestand._
- [x] **S.8 Sultan opnieuw afstellen** — Sultan (Claw Combo, Pounce, Dash Strike, Flurry) herbouwen met de aanvalsfases uit S.5a; hij is de proefbaas. _Klaar als:_ Sultan alleen schade doet in zijn raakvensters en een nagebootste speler hem met rollen kan ontwijken (test).
  - _Auto-run 2026-10-16: goedgekeurd. Claw Combo/Flurry: elke zwaai `hitSeconds` 0,1 s (raakt max. 1x); Pounce raakt alleen bij de landing; Dash Strike = hele run is raakvenster; opening = `recoverySeconds` (`openingSeconds` vervallen); Sultan poise 60 (startwaarde, breken verlengt opening met een staggertijd). Een zwaai telt als geraakt zodra de geometrie klopt, ook als je onkwetsbaar bent: een rol dekt alleen het eerste contactmoment. Niet gedaan: Big Swing, Heavy Slam, Spore Burst zonder eigen raakvenster; cue-reikwijdte nog niet exact (volle cirkel i.p.v. 140°); dummy zonder poise. Nog niet in de browser gespeeld: Bo/Lucas testen of Sultan eerlijk en leesbaar voelt._
- [x] **S.10 Lock-on repareren** — Bo speelde S.8 op de pc: Tab, Mouse1 en andere toetsen locken niet op Sultan. De logica (`pickLockTarget`: bereik 18 m, hoek rond waar de camera kijkt, zicht) staat er al en is door Fase S niet aangeraakt, dus zoek eerst de echte oorzaak: reproduceer het in een testbrowser (Playwright, teleport naar Sultan of een goblin met de debugfuncties) en lees de debugregel `lock`. Wens van Bo: lock-on op de vijand waar de camera naar kijkt. _Klaar als:_ de oorzaak is gevonden en opgelost, een test op de pure logica en een headless-run bewijzen dat een druk op de lock-knop een vijand in beeld pakt (en op een vijand achter je niet), en de debugregel toont het doel.
  - _Auto-run 2026-10-16: goedgekeurd. Oorzaak: `lockable` hing aan `hittable`, en een bewaakte (`guarded`) Sultan is dat bijna nooit; nu `alive && !safe && behavior !== 'static'`. Richten en homing van schoten gebruiken ook `lockable` (schade/"Dodged!" ongewijzigd). `scripts/lock-check.mjs` heeft een vast Chromium-pad (alleen cloud). Nog niet door Bo/Lucas op de pc geprobeerd._
- [x] **S.11 Poise zichtbaar en van achteren raken** — een poise-balk bij vijanden (toon-stijl, alleen na schade, getallen uit data); een treffer van achteren doet extra poise-schade (hoek en vermenigvuldiger in data); Sultans poise zo afstellen dat zware slagen hem echt kunnen breken (bij Bo's test wankelde hij niet). _Klaar als:_ een vijand toont een balk die leegloopt en wankelt als hij breekt, een treffer van achteren doet meer poise-schade dan van voren (test), en een nagebootste speler breekt Sultans poise met zware slagen (test).
  - _Auto-run 2026-10-16: goedgekeurd (na één herstelronde). Echte oorzaak van Bo's "hij wankelde niet": de bossrenderer toonde geen wankel-houding; die is nu toegevoegd (Sultan brak ook met poise 60 al ~6x per gevecht in de simulatie). Sultans poise is 60 → 45 (startwaarde, het verschil is klein). Vijandbalk: pool van 8 DOM-balken, `monsters.json` → `settings.poise` (hoek 100°, factor 2, blijftijd 1,5 s). Achterkant-bonus alleen voor zwaardslagen, niet voor staf-schoten. De Balance-test bewijst niet los dat het zware slagen zijn die breken (snelle slagen breken hem ook). De balktest controleert zichtbaarheid en nablijven, niet het leeglopen. Nog niet in de browser gespeeld: Bo/Lucas testen balk en wankelen._
- [x] **S.12 Sultan draait trager tijdens zijn aanvallen** — Bo kan hem nu nooit van achteren raken, want Sultan draait 420°/s en kijkt altijd naar je. Per fase (aankondiging, raakvenster, herstel) een eigen draaisnelheid in data, zodat je hem kunt omlopen. _Klaar als:_ een test bewijst dat hij tijdens aankondiging en raakvenster niet sneller draait dan de data zegt en dat een nagebootste speler met een rol achter hem komt en daar zijn rug raakt.
  - _Auto-run 2026-10-16: goedgekeurd (vierde poging, na eerdere afkeuringen om te zwakke tests). `monsters.json` → `sultan.boss.turnDegreesPerSecond`: stalk 720, telegraph 150, attack 60, recovery 90 (startwaarden om bij te stellen; de oude code draaide 720°/s, de 420 uit de stapomschrijving geldt voor gewone monsters). Retreat draait niet, enrage versnelt het draaien niet. Pounce en charge draaien met de fasesnelheid naar hun vaste lijn, dus ze kunnen licht zijdelings glijden; in de combo stapt hij in zijn eigen kijkrichting. De rol brengt je naar zijn flank (~79°); pas lopen in de opening brengt je achter hem, de rugtreffer valt dicht bij de rand van de achterkant-hoek (100°), weinig marge. Tests draaien op 60 en 120 Hz. Nog niet in de browser gespeeld: Bo/Lucas testen of omlopen eerlijk voelt._
- [x] **S.13 Sultans aanvallen beter zichtbaar** — Bo vond de aanvallen niet goed te zien en te onderscheiden. Sultan is nog een placeholder-model zonder skeletanimatie, dus geef elke aanval een eigen, duidelijke houding of beweging in de renderer (`EnemyRenderer`, tijdsduur uit de aankondigingstijd in data): Claw Combo (poot omhoog, achteruit leunen), Pounce (inzakken en trillen), Dash Strike (achteruit leunen met de bestaande lijn), Flurry (draaien of flikkeren). Echte keyframe-animaties volgen pas als Bo een echt Sultan-model in Blender maakt (zelfde werkwijze als `tools/blender/pringle/`). _Klaar als:_ elke Sultan-aanval heeft een eigen houding uit data, de duur volgt de aankondigingstijd en is op Low, Mid en High en op 60 en 120 Hz gelijk (test op de pure tijdslogica).
  - _Auto-run 2026-10-16: goedgekeurd. Pose per aanval in `monsters.json` → `attacks[].pose` (lean, roll, crouch, shake, spin, flicker, gold), alleen in de aankondigingsfase, tijd = `warningSeconds` in simulatietijd (`src/systems/BossPose.ts`). Claw Combo: achterover + zijwaartse roll; Pounce: inzakken, trillen, goud; Dash Strike: sterk achterover; Flurry: twee keer draaien + flikkeren. Alle getallen zijn eerste schattingen om bij te stellen. Nog niet in de browser gezien: Bo/Lucas testen of de aanvallen nu te onderscheiden zijn._
- [x] **S.14 Gevechtsstatus en loadout-vergrendeling** — "in gevecht" volgt de bestaande aggro van vijanden en het baasgevecht, niet alleen de laatste treffer; tijdens een gevecht ligt je uitrusting vast. _Klaar als:_ een vijand die je aanvalt (ook zonder treffer) zet je in gevecht, je komt er pas uit als alle vijanden verslagen zijn of zijn afgehaakt (zonder flikkeren), een baasgevecht houdt je vast tot winst of dood, en gear, spellboek, pakdier en forge zijn tijdens een gevecht dicht (tests).
  - _2026-10-17: gebouwd. `holdCombat` (`Combat.ts`) houdt je in gevecht zolang een vijand je achtervolgt of aanvalt (`Enemies.anyEngaged`, bazen niet meegeteld) of `BossEncounter.fighting` loopt; eruit pas `combat.lingerSeconds` (4 s) nadat de laatste vijand losliet, dus geen flikkeren aan een aggro-rand. Guards in `src/systems/Loadout.ts`: `canModifyLoadout` (gear, spellboek, pakdier, forge) en `canSwitchPrepared` (geen wissel midden in een slag, zware aanloop, rol, guard/parry, cast of wankelen; heeft nog geen aanroeper, want voorbereide wapen-, offhand- en spellslots bestaan nog niet). Gevolg: HP-regen en de HUD-balken volgen nu ook een vijand die je alleen achtervolgt. Niet gebouwd (open vraag 26): voorbereide slots en hun aantal, drankjes alleen uit voorbereide slots, voorraad niet aanvullen uit de tas, en de tas die het spel niet pauzeert in een gevecht. Bedieningsknoppen ongewijzigd._
- [ ] **S.15 Voorbereide slots en de tas in een gevecht** (besluiten S-9 en S-10) — **NIET GEBOUWD. Superseded als losse stap: het resterende werk zit in G.5 (Fase G). Voer S.15 niet apart uit.** Oorspronkelijke omschrijving (historisch): 2 hoofdwapens, 1 offhand en 4 drankjesslots in je loadout (aantallen in `player.json`, save-versie omhoog met migratie); buiten een gevecht vul je ze in de tas; in een gevecht drink je alleen uit de slots, de voorraad in de slots wordt niet aangevuld uit de tas, en de tas opent zonder pauze met alleen de drankjes. Wisselen tussen voorbereide wapens via `canSwitchPrepared`. _Klaar als:_ slots staan in de save (ook na laden), in een gevecht kan alleen uit de slots gedronken worden en raakt een slot leeg zonder aan te vullen, de tas pauzeert in een gevecht niet en toont alleen drankjes, en buiten een gevecht werkt alles als nu (tests).
  - _Antwoorden Bo/Lucas (2026-10-17): max **5 per soort drankje** per slot (één soort per slot, de rest blijft reserve in de tas); slots aanvullen uit de tas **alleen bij een checkpoint of met de hand** (niet vanzelf na een gevecht); met de tas open in een gevecht **sta je stil en ben je kwetsbaar** (zoals Elden Ring); het offhand-slot komt er en **blijft leeg** tot er offhand-items in `items.json` staan. Open: wissel­knoppen (vraag 27). Nog niet gebouwd._
  - _Fase G (2026-10-17): het "lege offhand-slot" is vervangen door offhand-modi (Grimoire / Shield / Sword Art), de vaste aantallen door basiscapaciteiten (zie S-9), en de Mana Flask is een eigen herlaadbaar middel, niet vijf gewone mana potions uit de tas. Het vaste save-versienummer hieronder geldt niet meer: G.5 gebruikt de eerstvolgende vrije versie op het moment van bouwen._
  - _G.5 (Lucas, 2026-10-19): **superseded**, het geladen-drankjes-model is nooit gebouwd. Gewone drankjes zijn legacy-items (bewaard, niet meer te gebruiken) en de 4 drankjesslots, de "max 5 per slot", het bijvullen met de hand en de aparte Mana Flask als los middel zijn vervangen door de herbruikbare Health Flask en Mana Flask met één gedeelde permanente capaciteit (zie G.5). Alles hieronder is geschiedenis._
  - Afvinklijst (historisch; niet uitvoeren, het werk zit in G.5):
    - [ ] Aantallen in `player.json` (2 hoofdwapens, 1 offhand, 4 drankjesslots, max 5 per slot) + schema en validator
    - [ ] Slots in de save (oorspronkelijk gepland als versie 20 → 21; vervallen, zie hierboven) met migratie: huidig wapen = hoofdwapen 1, drankjes uit `quickOrder` en mana potions in de slots
    - [ ] Regels in `Loadout.ts`: slots vullen alleen buiten een gevecht, in een gevecht alleen drinken uit de slots, nooit aanvullen uit de tas tijdens een gevecht
    - [ ] Aanvullen bij een checkpoint en met de hand (in de tas, buiten een gevecht)
    - [ ] Q drinkt uit de drankjesslots in plaats van rechtstreeks uit de tas _(S.16: Q / X gebruikt nu het gekozen drankje uit de tas; moet naar de slots)_
    - [ ] Tas in een gevecht: geen pauze, alleen de 4 drankjesslots, speler staat stil en is kwetsbaar; klikken in de tas geeft geen slag _(S.16: geen pauze, stilstaan, kwetsbaar, geen slag en alleen drankjes zijn gebouwd; nog alle drankjes uit de tas in plaats van de 4 slots)_
    - [ ] Leeg offhand-slot in de loadout (en in de tas) _(S.16: leeg vak in het HUD-kruis)_
    - [ ] Wisselen tussen de twee hoofdwapens via `canSwitchPrepared` _(S.16: 1 / D-pad ← wisselt via `canSwitchPrepared`, nu nog door alle wapens in de tas; moet naar de 2 slots)_
    - [ ] Teksten in `en.json` en `nl.json`
    - [ ] Tests: regels, save-migratie, 60/120 Hz, en buiten een gevecht werkt alles als nu
- [x] **S.16 Gevechtsknoppen en snel wisselen (Elden Ring-stijl)** — controleren dat de tas in een gevecht geen aanvallen geeft, de muis vrijgeeft zonder de camera te draaien, het gevecht niet pauzeert en een controller er niet in vastloopt; dan de knoppen: controller D-pad ↑ spell, ← wapen, → andere hand, ↓ snel item, RB slaan, RT spell of zware slag, X snel item gebruiken; pc linkermuis slaan, rechtermuis spell (vasthouden = laden als de spell dat kan), wiel volgende/vorige spell, 1 wapen, 2 andere hand, 3 snel item, Q gebruiken. Een kleine HUD met de vier keuzes, geen hotbar. _Klaar als:_ alles hierboven werkt met toetsenbord en (nagebootste) controller, een cast houdt zijn spell als je wisselt, een wapenwissel wacht tot je aanval/rol/parry/cast klaar is, en de tests en de headless-check slagen.
  - _2026-10-17: gebouwd (PR #109, parallel aan S.14/S.15; beantwoordt vraag 27 met de Elden Ring-knoppen). De tas pauzeert in een gevecht niet meer en toont dan alleen drankjes (S-10; je staat stil, vijanden gaan door), de controller opent hem in een gevecht niet (melding). Wisselen gebruikt `canSwitchPrepared` uit S.14. **Tijdelijk tot S.15:** "voorbereid" = wat in je tas zit (alle wapens, alle drankjes) in plaats van de 2 + 1 + 4 slots van S-9. Ctrl + wiel zoomt (vraag 28). Save v20 zet oude controllerknoppen om. Alleen headless getest (`scripts/combat-controls-check.mjs`, met een nagebootste controller); Bo/Lucas testen met een echte controller en meten de fps._
  - _Fase G (2026-10-17): deels superseded, hier bewaard als historische implementatiestand. De D-pad-indeling blijft; RT blijft zware slag (de spell gaat naar de contextuele LT), blok wordt LB, `lockSwitch` gaat van LT af (rechterstick-flick bij lock-on) en `status` krijgt geen eigen controllerknop (G.6). "Voorbereid = alles in je tas" wordt vervangen door voorbereide sets (G.5). Dat de controller de tas in een gevecht niet kan openen is een beperking van S.16, geen gewenst eindontwerp._
- [ ] **S.9 Spelen en meten (Bo/Lucas)** — Sultan en een goblinkamp spelen op pc, met toetsenbord en met controller; "Meet 20 s" tijdens een gevecht op Low en High. _Klaar als:_ Bo en Lucas zeggen of het souls-like genoeg voelt en de fps in `docs/PROGRESS.md` staat.
  - _Besluit (Bo/Lucas, 2026-10-18): **niet vervallen.** S.9 blijft nodig vóór de definitieve acceptatie en merge van G.2 (zie G.2); headless tests tellen niet als S.9._

---

## Fase G – Grimoire-migratie · **open** (G.0 vastgelegd en G.1 data-fundament gebouwd, 2026-10-17; G.2 gebouwd op een eigen branch als draft-PR, 2026-10-18, nog niet in `main`)

Doel: van het oude model (zwaardvechter óf mage met staf en kristal) naar een **melee-first Soulslike in de stijl van Elden Ring**, waarin iedereen vecht met een melee-wapen en een **Grimoire**. Staven verdwijnen uit het actieve spel. Eén stap = één sessie = één branch = één pull request, zoals altijd. Elke stap begint pas als Bo/Lucas het startsein geven (G.1 kreeg dat op 2026-10-17; **G.2 begint niet automatisch**). Besluiten en de opgeloste vragen U-1 t/m U-9 staan ook in `docs/PROGRESS.md` → Besluiten Fase G.

**Huidige stand in de code (2026-10-17, ter vergelijking; dit is wat nu gebouwd is):** de staf (`mage_staff`, `adept_staff`) is een wapen met eigen schietlogica (`StaffCombat.ts`, `WorldState.stepStaffAndMove`); spellslots komen van de staf (`weapon.spellSlots`); spells zijn alleen bruikbaar als ze bij `character.crystal` passen (`Spellbook.usableSpells`); spells worden op level geleerd (`learnLevel`); het zwaardpad heeft geen mana (`player.json` → `paths.sword.noMana`); de guard werkt niet met een staf (_beide opgelost in G.2 op de G.2-branch, nog niet in `main`_); `choosePath` legt één pad voor altijd vast; Garricks `first_form` zet `academy_blade` meteen aan; de controller heeft blok op L3 (Pad10), status op LB (Pad4) en `lockSwitch` op LT (Pad6); "voorbereid" is nu alles in je tas (S.16).

### Ontwerp (canon, vastgelegd in G.0)

**Gevecht**
- Melee-first Soulslike: lichte en zware aanval, rol, blokkeren, parry, schilden en Sword Arts (wapenvaardigheden).
- Speelbare staven gaan uit het actieve spel. Iedereen vecht met een melee-wapen en een Grimoire; je leraar is een **eerste specialisatie, geen permanente klasse**.
- Elke nieuwe speler begint met de **Rookie Sword** (bestaand item-id `old_sword`, alleen de weergavenaam verandert), de **Rookie Grimoire** en de Neutral-incantation **Push**.
- Push kost 0 mana, heeft een kort bereik, minimale schade, weinig stagger en een herstel dat spammen tegengaat. De exacte getallen zijn **niet** in G.0 besloten.
- De Grimoire verschijnt tijdens een cast even zwevend naast de speler.
- Verplicht tweehandige wapens kunnen ook casten: de speler laat één hand los, cast en pakt het wapen daarna weer met twee handen vast.
- Een cast kan niet beginnen tijdens een aanval, de aanloop van een zware slag, een opgeheven guard, wankelen, rollen of een andere cast.
- Een rol mag een cast afbreken. Mana die al voor een afgebroken cast betaald was, komt niet terug; op welk moment de mana precies betaald wordt, beslist de latere cast-implementatie. Push merkt daar niets van (0 mana).

**Magie en progressie**
- Drie dingen blijven strikt gescheiden: (1) **permanente toegang tot een element**, (2) **geleerde incantations**, (3) **voorbereide incantations**.
- Elementen zijn permanente ontgrendelingen van je personage, geen kristallen die je uitrust: **Neutral** (altijd beschikbaar, voor Push), **Fire, Water, Wind, Nature, Dark**.
- Een element ontgrendelen leert je **niet** vanzelf alle incantations van dat element. Elke incantation vind of verdien je apart (quests, verkennen, expliciete beloningen); er wordt niets meer automatisch op level geleerd.
- Een incantation is bruikbaar als: het element ontgrendeld is, de incantation geleerd is, hij in een voorbereid incantation-slot staat, en aan de cast-voorwaarden is voldaan.
- Elementen kunnen ook buiten de leraren om ontdekt worden (U-5).
- De Rookie Grimoire begint met **precies 1** voorbereid incantation-slot. Tijdens de Academy krijgt **elke** leraarsroute het **tweede** slot via gedeelde Academy-voortgang (geen compensatie voor één bepaalde leraar). Meer **Grimoire Pages** verhogen het aantal voorbereide incantations; ze leren je geen spells.
- **Weapon Harness Upgrades** verhogen het aantal voorbereide hoofdwapens. De basis blijft 2 (S-9).
- Het maximumaantal Pages en Harnesses is **niet** besloten.
- Elke build heeft mana en elke build krijgt mana passief terug. Een herbruikbare, oplaadbare **Mana Flask** is als **concept** goedgekeurd; die verbruikt geen gewone reservevoorraad uit de tas. _Besloten in G.5 (Lucas, 2026-10-19): **herbruikbare Flasks** met één permanente capaciteit (start **1**: de Health Flask; de drie Greenwood-quests geven er elk één bij), die je alleen bij een echte checkpoint-rust verdeelt en vult (wakker worden na doodgaan vult ook, volgens de verdeling); gebruik via Q / X (3 / D-pad ↓ wisselt Health ↔ Mana); verborgen permanente capaciteitsupgrades in de wereld (elke ontdekking telt één keer). Gewone drankjes zijn legacy._
- Elementen, geleerde incantations en slot-uitbreidingen blijven in de save en blijven heel bij een respec bij Sultan.

**Leraren (na Sultan blijft de Academy-questlijn bestaan)**
- **Wizard Sam:** ontgrendelt Dark permanent en geeft de eerste Dark-incantation.
- **Master Brink (Ruben):** ontgrendelt permanent één willekeurig element uit Fire, Water, Wind of Nature, plus de eerste incantation van dat element. De uitkomst wordt bewaard en verandert niet na laden.
- **Sir Garrick:** geeft één actieve Sword Art en de eerste Sword-skillpunt/mijlpaal.
- Alle drie de routes houden de Rookie Sword en de Rookie Grimoire.
- De Academy-quests en de Crystal Ceremony worden verhalend aangepast, niet blind verwijderd.
- Andere elementen, incantations en skills kun je later vinden via optionele quests en verkennen. Er komen **geen** verplichte inhaal-quests die je automatisch de beloningen van de andere leraren geven; het gedeelde tweede Grimoire-slot is genoeg.
- Garricks `academy_blade`: het automatisch aantrekken vervalt. Blijft het een beloning, dan gaat het via de gewone tas/voorbereide wapens en wordt het **niet** automatisch aangetrokken. Het item wordt in G.0 niet verwijderd.

**Attributen, levels, skillpunten en Sultan**
- Character creation: 20 vrij te verdelen attribuutpunten bovenop vaste basisstats. Elke level-up: precies 1 attribuutpunt (zo werkt het nu al).
- Skillpunten staan los van attribuutpunten en komen uit **mijlpalen**, niet automatisch per level. Garricks beloning is de eerste Sword-mijlpaal.
- XP en Gold/Coins blijven aparte middelen. Het maximale level is nog niet besloten.
- Sultan reset/herverdeelt je attributen voor een geschikt ei. Een respec verandert **alleen attributen**: geen uitrusting, elementen, incantations, skills of andere voortgang erbij of eraf. De huidige `takeEgg` doet dat al zo (reset alleen `character.stats`); die bedoeling blijft.
- Alle bestaande ei-id's en -namen blijven ongewijzigd. Eieren worden **niet** hernoemd naar "Golden Egg" en er komt in G.0 geen nieuw Golden Egg-item; een speciaal Golden Egg kan later een los inhoudsbesluit zijn.

**Voorbereide loadout en de tas in een gevecht**
- Buiten een gevecht pas je je complete uitrusting en voorbereide loadout vrij aan. In een gevecht trek je niets nieuws aan uit de tas, maar wissel je alleen tussen wat je vooraf hebt voorbereid: hoofdwapens, incantations, offhand-modi en verbruiksitems.
- Gewone vijanden gebruiken aggro- en gevechtszones; baasgevechten spelen in gesloten arena's.
- De tas in een gevecht: pauzeert het spel niet, geeft geen onkwetsbaarheid, laat je kwetsbaar staan, toont alleen wat in een gevecht past (de voorbereide verbruiksitems), en kan voorbereide drankjes **niet** bijvullen uit de reserve.
- ~~Voor gewone drankjes met voorraad bevat een voorbereid slot een echte geladen hoeveelheid, geen onbeperkte verwijzing naar de reserve. De S.15-regel blijft: 4 drankjesslots, één soort per slot, maximaal 5 geladen per slot, niet bijvullen tijdens een gevecht, alleen buiten een gevecht bijvullen volgens de regels van G.5.~~ _Superseded (Lucas, 2026-10-19, G.5): er zijn geen geladen drankjes meer; gewone drankjes zijn legacy. De verbruiksitems in een gevecht zijn de twee Flasks._
- De Mana Flask telt **niet** als vijf gewone mana potions uit de tas. _G.5 (2026-10-19): de Health Flask en de Mana Flask delen één permanente capaciteit (start 1, de Health Flask; +1 per Greenwood-side-quest); ladingen vullen bij een echte checkpoint-rust en bij het wakker worden na doodgaan, de verdeling verandert alleen bij een rust; het quickslot (Q / X) gebruikt de gekozen Flask._
- Het oude "1 offhand-slot" van S-9 is vervangen door offhand-modi, niet door een tweede snelinventaris.

**Besturing (controller, ontwerpcontract)**

| Knop | Actie |
| --- | --- |
| RB / R1 | lichte aanval |
| RT / R2 | zware aanval |
| LB / L1 | blokkeren (vasthouden; de parry blijft het eerste venster van de guard) |
| LT / L2 | contextuele offhand-actie: Grimoire-modus = geselecteerde incantation casten, Shield-modus = schildvaardigheid, Sword Art-modus = Sword Art |
| R3 | lock-on aan/uit (ongewijzigd) |
| rechterstick-flick (tijdens lock-on) | ander doel kiezen; drempel en debounce volgen in G.6 |
| D-pad ↑ / ← / → / ↓ | voorbereide incantations / hoofdwapens / offhand-modi / verbruiksitems |

- Offhand-modi: **Grimoire, Shield, Sword Art**. Een verplicht tweehandig wapen kan geen Shield-modus gebruiken, maar wel Grimoire en Sword Art.
- Status heeft geen eigen gevechtsknop op de controller en blijft bereikbaar via de UI/het pauzemenu.
- Ander doel kiezen gaat **niet** naar L3, om geen botsing te krijgen met het sprinten van A.5.
- Toetsenbord: ander doel kiezen mag `KeyX` blijven; de contextuele offhand-actie krijgt later een vrije, aanpasbare toets (bijv. `KeyV`) nadat de implementatiestap heeft gecontroleerd dat er geen botsing is.
- Eigen toetsen of knoppen van spelers blijven bij elke latere migratie behouden.

**Schilden en tweehandige wapens**
- Fase G ondersteunt echte schilden (anders is de Shield-modus niet te testen). Een schild wordt nooit automatisch aangetrokken.
- Tweehandige wapens kunnen geen schild tegelijk actief gebruiken. Optionele tweehandige modi mogen gepland worden, maar horen niet in de eerste migratiesnede.
- Item-id, naam en stats van het schild, de getallen van de schildvaardigheid en de blokpercentages worden **niet** in G.0 vastgelegd (G.6/data).

**Legacy: staven en kristallen**
- Staf- en kristalitems worden niet verwijderd zonder migratie; hun id's blijven bestaan voor oude saves, en `character.crystal` blijft bewaard.
- Permanente element-ontgrendelingen vervangen het kristal als regel voor welke incantations bruikbaar zijn; bestaande kristallen zijn dus geen poort meer. Sam en Brink hoeven bij een element-ontgrendeling geen nieuw kristalitem te geven.
- Fase 4.4 (kristallen mergen voor staf en spells) is vervallen en uitgesteld tot er een besluit is over legacy-kristallen (bijv. crafting).

**Gereserveerde toekomstige inhoud (niet gebouwd, inhoud niet ingevuld):** Grimbald, Veyra, Ashkarn, Old Rivals en de Grand Grimoire voor de late game. Ze komen nu alleen voor als (tijdelijke) namen in dit plan; G.0 legt er geen inhoud voor vast.

### Opgeloste vragen (G.0, Bo/Lucas, 2026-10-17)

| Nr | Besluit |
| --- | --- |
| U-1 | Een rol mag een cast afbreken; al betaalde mana komt niet terug |
| U-2 | LT is contextueel; LB = blok; R3 = lock-on; op de controller ander doel kiezen met een rechterstick-flick, niet met L3 |
| U-3 | Offhand-modi: Grimoire / Shield / Sword Art; tweehandig sluit Shield uit; echte schilden komen in G.6 |
| U-4 | Geen verplichte inhaal-quests voor de andere leraren; elke route krijgt via gedeelde Academy-voortgang het tweede Grimoire-slot |
| U-5 | Elementen kunnen ook buiten de leraren om ontdekt worden |
| U-6 | ~~Gewone voorbereide drankjes zijn geladen voorraad, apart van de reserve; niet bijvullen in een gevecht.~~ _Superseded door G.5 (Lucas, 2026-10-19): gewone drankjes zijn legacy; de herbruikbare Health Flask en Mana Flask (één permanente capaciteit, vullen alleen bij een checkpoint-rust) zijn de verbruiksitems in een gevecht_ |
| U-7 | `academy_blade` wordt niet meer automatisch aangetrokken |
| U-8 | Bestaande eieren blijven ongewijzigd; geen massale hernoeming en geen nieuw Golden Egg in G.0 |
| U-9 | Kristallen zijn geen toegangspoort meer voor spells en geen nieuwe leraarsbeloning; alle legacy-kristaldata en -items blijven; fase 4.4 is uitgesteld en wordt opnieuw ontworpen |

### Bewust nog niet besloten (later: implementatie, inhoud of balans)

Maximaal level · Push-getallen · manakosten · verdere tuning van passieve manaregen (voor G.2 vastgelegd: basis 0,4/s blijft, Regen +0,03/s per punt voor elk pad) · de Flask-balans (50% HP / 30% mana per lading, 0,6 s drinktijd, 1 s cooldown: voorlopige startwaarden uit G.5) · wat er met de legacy-potions in monster-drops gebeurt (G.5 liet ze staan; de drie Greenwood-quests belonen sinds de correctieronde Flask-capaciteit) · maximaal aantal Grimoire Pages · maximaal aantal Weapon Harness Upgrades · schildstats · schadefactor van tweehandige wapens · cast-, loslaat- en grijptijden · mana- of staminakosten van een Sword Art · lijst mijlpalen en hoeveel skillpunten ze geven · toekomstig gebruik van legacy-kristallen · inhoud van de Grand Grimoire · inhoud van Grimbald, Veyra, Ashkarn en Old Rivals · item-id en naam van het eerste schild · het exacte deterministische algoritme om bij een oude staf-save een vervangend melee-wapen te kiezen (G.4).

### Stappen

Volgorde en afhankelijkheden: G.0 → G.1 → G.2 → G.3 → G.4 → G.5 → G.6 → G.7 → G.8 → G.9. G.8 kan met tijdelijke, procedurele beelden al na G.3 beginnen, maar de definitieve animaties wachten op G.6. **Geen save-versie is gereserveerd:** elke stap die de save verandert, neemt de eerstvolgende vrije versie op het moment van bouwen.

- [x] **G.0 Besluiten en documentatie** — het ontwerp hierboven, de opgeloste vragen U-1 t/m U-9 en deze stappen vastleggen in `PLAN.md`, `docs/PROGRESS.md` en (minimaal) `CLAUDE.md` sectie 1. Alleen documentatie. _Klaar als:_ de besluiten staan erin, oude afgeronde stappen hebben een "superseded"-notitie in plaats van een herschreven geschiedenis, en S.15 verwijst naar G.5. (Vastgelegd 2026-10-17; geen code, data, saves of tests aangeraakt.)
- [x] **G.1 Data-fundament** — de toekomstige data- en schemacontracten voor de Grimoire, Neutral/Push, de elementdefinities, grip-mogelijkheden (één- of tweehandig) en de configuratie van voorbereide capaciteit. Geen verandering in het gedrag van het spel; geen balansgetallen vastzetten. _Klaar als:_ DataValidator en de taal-key-check slagen op de echte data, bestaande tests zijn ongewijzigd groen, en het spel doet precies wat het eerder deed.
  - _Gebouwd (2026-10-17; samengevoegd in `main` via PR #110):_ `items.json` → item-type `grimoire` met `rookie_grimoire` (`grimoire.incantationSlots: 1`), `weapon.grip` (`oneHanded`/`twoHanded`; alle huidige zwaarden `oneHanded`, zoals de runtime ze nu vasthoudt; **voorlopig**: G.6 bepaalt het echte handgebruik), `legacy: true` op `mage_staff` en `adept_staff`; `spells.json` → element `neutral` met `alwaysUnlocked`, en een aparte lijst `incantations` met alleen `push` (Neutral, 0 mana; bereik, schade, stagger en herstel komen in G.3); `player.json` → `prepared.mainWeapons: 2`. Nieuwe DataValidator-regels: grimoire-instellingen horen bij type `grimoire`, een staf moet `legacy` zijn, elk niet-legacy wapen heeft een `grip`, incantation-id's botsen niet met spell-id's, en elk element heeft een spell of een incantation. Niets in de runtime leest dit nog: de startuitrusting, het casten met de staf, mana, de guard, saves (v20) en besturing zijn ongewijzigd.
  - _Bewust nog niet in G.1:_ `old_sword` heet nog "Old Sword" (de weergavenaam "Rookie Sword" is zichtbaar en hoort bij de stap die de startuitrusting omzet); Grimoire Pages en Weapon Harness Upgrades hebben nog geen data (vorm, aantal per upgrade en maximum zijn niet besloten); geen schild-item of offhand-modi in data (G.6); `BAG_TYPE_ORDER` en `bag.type.*` kennen `grimoire` nog niet: dat moet erbij in de stap die de Grimoire voor het eerst in de tas legt. Kleine keuzes ter controle: vraag 29.
- [~] **G.2 Gemeenschappelijke gevechtsbasis** — de nieuwe algemene gevechtsaannames waarmaken vóór de omschakeling naar de Grimoire: mana voor elke build, passieve manaregen, een resourcemodel waar de Mana Flask later in past (alleen het concept; ladingen, opladen en quickslot zijn nog niet besloten en worden hier niet verzonnen), guard/blok/parry voor elke build, en weg met het idee dat één permanente klasse geen mana heeft. Dit verandert gedrag, dus eerst de basismetingen van het open Soulslike-werk (S.1, S.9) doen, tenzij Bo/Lucas dat uitdrukkelijk laten vallen. _Klaar als:_ elke build mana heeft en passief terugkrijgt, elke build kan blokken en parryen, 60 en 120 Hz exact gelijk blijven (tests), en de balanstests opnieuw groen zijn of de afwijking aan Bo/Lucas is voorgelegd.
  - _Besluit poort (Bo/Lucas, 2026-10-18):_ S.1 en S.9 vervallen **niet**. Ze blokkeren het bouwen op een eigen G.2-branch niet meer, maar de G.2-PR blijft draft en wordt pas samengevoegd als (1) de S.1-metingen op een echte pc in `docs/PROGRESS.md` staan, (2) S.9 (spelen en meten in een gevecht) gedaan is, (3) eventuele balansafwijkingen bekeken zijn en (4) Bo/Lucas de uitkomst uitdrukkelijk goedkeuren. Headless tests tellen niet als S.1 of S.9.
  - _Besluit gedrag (Bo/Lucas, 2026-10-18):_ elke build heeft mana en passieve manaregen; basis 0,4 mana/s blijft; Regen geeft elk pad +0,03 mana/s per punt; HP-regen blijft zoals hij was; zwaard én staf kunnen blokken en parryen; parry-venster, staminakosten en de gevechtssimulatie blijven gelijk; oude saves laden zonder nieuwe `SAVE_VERSION` (een zwaardvechter zonder mana begint met 0 en loopt vanzelf vol); niets van de Mana Flask bouwen.
  - _Gebouwd (2026-10-18, branch `claude/hopeful-rubin-xpe8s3`, draft-PR; nog niet in `main`):_ `paths.*.noMana` (data en schema), `CombatState.hasMana`, `PathBonus.hasMana` en `HUD.setBarUsed` zijn weg: iedereen heeft `base.mana` + punten + gear. `stats.json` → Regen geeft mana als één getal voor elk pad (0,03/s per punt, boven 20 punten 0,015, gelijk aan wat light/dark al hadden; zwaard was 0, nog geen pad was 0,015/0,008); HP uit Regen ongewijzigd. Guard met een staf: `Guard.weaponFreeForGuard` (geen zwaai, zware aanloop of verzamelend schot), met de guard omhoog schiet de staf niet en loop je op `guard.moveFactor`. `Combat.restoreMana` voor het laden (save blijft v20). Geen Mana Flask-code of -data: hij kan later op dezelfde `mana`/`maxMana` werken. Tests: `src/systems/CommonCombat.test.ts` (15) en aangepaste verwachtingen in `Paths.test.ts`/`StatPreview.test.ts`; balanstests ongewijzigd groen; headless `scripts/g2-check.mjs` 11/11. Regen-tekst in `en.json`/`nl.json` aangepast. **Nog open:** S.1 en S.9 op een echte pc, en het akkoord van Bo/Lucas (zie de poort hierboven).
- [~] **G.3 Casten los van de staf** — casten loskoppelen van een uitgeruste staf; Neutral + Push en de regel voor permanente toegang tot elementen. Nieuwe incantations komen via ontdekkingen, quests en ontgrendelingen (G.7); de legacy-levelspells van light en dark blijven tot G.4 (besluit 2026-10-18, gaat vóór de G.0-formulering "niets meer op level"). Het spel moet de bestaande save-vorm van vóór Fase G nog kunnen lezen tot de save-migratie van G.4; in G.3 worden saves niet destructief gemigreerd. _Klaar als:_ met een zwaard in de hand werkt Push via de Grimoire, zwaardslagen zijn ongewijzigd, casten start niet tijdens aanvallen/zware aanloop/guard/wankelen/rollen/een andere cast, een rol breekt een cast af, oude saves laden en spelen nog, en 60/120 Hz en Low/Mid/High geven hetzelfde (tests).
  - _Besluiten P-1 t/m P-10 en drie aanvullingen (Bo/Lucas, 2026-10-18):_ Push = kort frontaal kegeltje, weinig HP-schade (schaalt met Magic Power en gear, nooit met het wapen in de hand), poise-schade en knockback die niet met stats schalen; lichte vijanden krijgen stagger (alleen via de bestaande poise-regels) en een fysieke knockback, bazen alleen poise; ±0,35 s voorbereiding, 0 mana, een kleine staminakost bij de start (nooit terug), cooldown; een geldige rol breekt de cast af met een korte herstartvergrendeling in plaats van de cooldown; matig herstel na een geslaagde cast. Elk nieuw personage begint met de Rookie Grimoire, bezit is genoeg; bestaande v20-saves krijgen tot G.4 tijdelijke runtime-toegang zonder migratie. Toets V (vasthouden is voor latere charge-spells); de controller volgt in G.6. Push werkt ook met een legacy staf in de hand; verslaat Push Sultan, dan speelt de zwaardvariant. Knockback stopt op botsingen zonder extra schade; een aparte, data-gestuurde `knockbackResistance` los van poise. **Push telt niet mee voor bestaande training- en Academy-oefendoelen.** **Tijdens een knockback loopt een vijand niet zelf; een aanval wordt alleen onderbroken als de poise breekt.**
  - _Gebouwd (2026-10-18, branch `claude/elegant-maxwell-wi8s5k`, gestapeld op de G.2-branch, draft-PR):_ één `CastState`/`stepCast` in `src/systems/Casting.ts` (was `StaffCombat.ts`) voor stafschoten én incantations; `src/systems/Grimoire.ts` (bezit of tijdelijke toegang, `LEGACY_GRIMOIRE_ACCESS` weg in G.4); Push-data in `spells.json` → `incantations[].cast`/`effect` (startwaarden), `knockbackResistance` in `monsters.json`, actie `cast` (KeyV) in `controls.json`, de Rookie Grimoire in `player.json` → `start.items`; knockback via de bestaande mover (`Enemies.push`, `EnemyAI.stepKnockback`); `Movement.dashStartsThisStep` beslist de rol vóór de cast-stap. Alle Push-getallen zijn startwaarden voor Bo/Lucas. Niet gedaan (bewust): G.4 (save-velden en migratie), G.5 (voorbereide slots), G.6 (controller, LT), G.8 (het zwevende boek: de bestaande cast-clips spelen nu ook met een zwaard). Nog door Bo/Lucas te spelen (zie `docs/PROGRESS.md`); de merge wacht op dezelfde poort als G.2 (S.1, S.9).
  - _Architectuur (notitie uit de review van G.1, 2026-10-18):_ één gedeelde cast-/gevechtspijplijn voor de legacy-spells en de nieuwe incantations; geen twee blijvende cast-implementaties naast elkaar. De pijplijn moet meerdere soorten effect aankunnen: projectiel, een duw op korte afstand (Push), verdedigende effecten en effecten op een gebied; neem dus niet aan dat elke incantation een projectiel is. Of de data één verzameling wordt of twee compatibele verzamelingen (`spells` en `incantations`) die dezelfde pijplijn voeden, wordt pas in G.3 besloten, na inspectie van de bestaande cast-code (`StaffCombat.ts`, `WorldState.stepStaffAndMove`). Legacy-spells en de save blijven compatibel tot de geplande migratie (G.4). De DataValidator-regel "elk element heeft een spell of een incantation" blijft in G.1 ongewijzigd; elementen die alleen vijanden gebruiken (`monster.element`) hebben in G.3 of G.7 mogelijk een gerichtere regel nodig.
- [~] **G.4 Grimoire-savemigratie en omschakeling** — pas nadat G.3 in de runtime werkt de opgeslagen spelerstoestand migreren, met de eerstvolgende vrije save-versie (niet vooraf vastgelegd). Eisen: oude saves blijven bruikbaar; alle legacy-staf- en kristal-id's en het bezit ervan blijven; quests, stats, XP, Gold, upgrades en andere voortgang blijven; wie een staf in handen heeft, krijgt een geldig melee-wapen zonder dat de staf verdwijnt; de permanente element- en Grimoire-toestand komt erbij; Push is beschikbaar; eigen besturing blijft; de migratie is idempotent en heeft een veilige backup. De deterministische regel voor het vervangende wapen wordt in G.4 besloten na inspectie van de dan geldende save en data (geen vage "sterkste wapen"-regel zonder geteste definitie). Voorbereide drankjesvoorraad wordt hier **nog niet** gemigreerd. _Klaar als:_ fixtures voor elk oud pad (zwaard, licht, donker, met en zonder staf in handen, midden in een Academy-quest) migreren zonder verlies, twee keer migreren hetzelfde geeft, de backup precies één keer geschreven wordt, en een respec de nieuwe toestand niet aanraakt (tests).
  - _Gebouwd (2026-10-19, branch `claude/bold-lamport-bmaz40`, draft-PR naar `main`, niet samengevoegd):_ save-versie **21**: `character.elements` (permanent ontgrendelde elementen) en `character.incantations` (los geleerde incantations), apart van elkaar en van `spells`/`spellLoadout` (legacy staf). Migratie 20 → 21 (`migrateCharacterToGrimoire`): Rookie Grimoire in je eigen tas (ligt hij alleen op het pakdier, dan verhuist hij; nooit een tweede), `elements` uit `character.crystal` als dat een echt kristal-element is (`CRYSTAL_ELEMENT_IDS`; het element van de Ceremony is voorgoed van jou; niets wordt geleerd), en de **deterministische vervangregel** voor een legacy staf in de hand: `honed_old_sword` uit de tas, anders `old_sword` uit de tas, anders één `old_sword` erbij; de staf blijft in de tas, kristallen, upgrades, gold, stats, XP, quests, unlocks en eigen toetsen blijven exact. Eenmalige backup van de oorspronkelijke save onder `<key>.backup.v20` vóór de eerste overschrijving (nooit vervangen, geen backup voor een actuele save, gaat mee bij verwijderen; mislukt de backup, dan wordt het origineel niet overschreven tot hij lukt). `LEGACY_GRIMOIRE_ACCESS` weg: alleen een Grimoire in de tas telt. Academy-quests ongewijzigd en haalbaar (de staf is weer aan te trekken voor de opgeladen-spell-exams; `grants.equip` van de staf-quests blijft legacy tot G.7/G.9). Tests 1122 → 1139; headless `scripts/g4-check.mjs`. **Niet gedaan (bewust):** geen melding in het spel over het verwisselde wapen, legacy-levelspells (`learnSpells`) blijven als deel van de legacy staf (G.9), geen voorbereide drankjes (G.5), geen wijziging aan de quests of de Ceremony (G.7/G.9). Ter controle door Bo/Lucas: of het kristal-element inderdaad meteen als permanent element mag gelden.
- [~] **G.5 Voorbereide loadouts en Flasks (vervangt S.15)** — de enige uitvoering van het onafgemaakte S.15-werk; er komt geen tweede S.15-systeem. Voorbereide hoofdwapens, voorbereide incantations, capaciteit via Grimoire Pages en Weapon Harness Upgrades, de herbruikbare Flasks, beperkingen van de tas in een gevecht, en D-pad-wissels over de voorbereide sets in plaats van de hele tas. _Klaar als:_ voorbereide sets en Flask-toestand staan in de save (ook na laden), in een gevecht kun je alleen tussen voorbereide wapens en incantations wisselen en alleen je Flasks gebruiken, een lege Flask vult alleen bij een echte checkpoint-rust, de tas pauzeert niet en toont dan alleen de Flasks, buiten een gevecht werkt alles zoals daarvoor, en elke gewone drankjesvoorraad blijft bij migratie, laden en opslaan exact gelijk (tests).
  - _Oorspronkelijke omschrijving (historisch, superseded door Lucas op 2026-10-19):_ geladen hoeveelheden voor gewone drankjes (4 slots, max 5 per slot), bijvullen bij een checkpoint of met de hand, niet bijvullen uit de reserve tijdens een gevecht, en de eis dat de totale drankjesvoorraad (reserve + geladen) gelijk blijft bij elke overdracht. Nooit gebouwd.
  - _Besluiten Lucas (2026-10-19):_ (1) **Flasks**: startcapaciteit ~~2, verdeeld 1 Health / 1 Mana~~ → **gecorrigeerd dezelfde dag: 1, de Health Flask (1 Health / 0 Mana)**, vol bij een nieuw spel en bij de eenmalige v21→v22-migratie, daarna vullen ze **alleen bij een daadwerkelijke checkpoint-rust én bij het wakker worden na doodgaan** (correctieronde, zie hieronder); (2) **rusten tijdens een gevecht is niet toegestaan**; alleen een geldige rustactie vult de Flasks en geeft toegang tot de Health/Mana-verdeling; (3) **legacy potions** blijven exact in tas, pakdier en andere containers, zijn **nergens** meer te gebruiken (ook niet buiten een gevecht) en worden als legacy getoond; (4) Marco verkoopt de vier oude drankjes niet meer; (5) voorlopige balans: Health 50% max HP, Mana 30% max mana, drinktijd 0,6 s, cooldown 1 s, alles configureerbaar in `player.json` → `flasks`; (6) effect en lading committen **atomair op één punt**: onderbreking ervoor kost niets en doet niets, erna is beides definitief; (7) Q / X gebruikt de gekozen Flask, 3 / D-pad ↓ wisselt Health ↔ Mana, eigen bindings blijven; (8) de loadout-UI via het pauzemenu en de tas, alleen buiten een gevecht te wijzigen.
  - _Correctieronde (Lucas, 2026-10-19; dezelfde branch en PR):_ **startcapaciteit 1** (1 Health / 0 Mana, lading vol; `player.json` → `flasks` en `FLASK_START_V22`); de drie Greenwood-side-quests `blade_in_the_woods`, `sparks_in_the_greenwood` en `shadows_in_the_greenwood` belonen **+1 permanente Flask-capaciteit** in plaats van 2 potions (`rewards.flaskCapacity: true`, via het bestaande ontdekkingsmechanisme met id `quest:<quest-id>`, dus nooit dubbel; de andere beloningen, eisen en teksten blijven); start + drie quests = **4**, zonder globaal maximum (verborgen ontdekkingen tellen gewoon door); **reconciliatie**: een save die zo'n quest al afrondde krijgt zijn lading bij het betreden van de wereld onder dezelfde id, één keer; **geen nieuwe save-versie** (de vorm verandert niet; een bestaande v22-save met 2 Flasks houdt ze); **wakker worden na doodgaan vult de Flasks** volgens de bestaande verdeling (capaciteit, verdeling en ontdekkingen ongewijzigd); 3 / D-pad ↓ slaat een Flask zonder toegewezen capaciteit stil over, een lege Flask met capaciteit blijft kiesbaar. Legacy-potions in monster-drops blijven (inhoudsbesluit, gerapporteerd).
  - _Gebouwd (2026-10-19, branch `claude/gallant-lovelace-mz8icm`, draft-PR, **niet samengevoegd**):_ save-versie **22** (`character.flasks`, `character.prepared`, `character.slotUpgrades`; migratie `migrateCharacterToLoadout`, Flasks één keer vol volgens `FLASK_START_V22`, voorbereide sets "nog niet gekozen" en bij het eerste betreden van de wereld deterministisch gevuld: het wapen in de hand, dan de tas; Push); `src/systems/Flasks.ts` (capaciteit, verdeling, rust, `useFlask` als het ene commit-punt, `FlaskUse` met drinktijd en annuleren, idempotente ontdekkingen via `discoveries`, reparatie van een beschadigde save zonder ooit bij te vullen); `src/systems/Prepared.ts` (voorbereide wapens en incantations, capaciteit = basis + Grimoire + unieke upgrades `weaponHarness`/`grimoirePages`, het Academy-slot van G.7 is een Grimoire Page met eigen id; geen legacy staf, geen potion, geen onbekende incantation in een slot; geleerd blijft onbeperkt); `WorldState`: Q / X start een drink van de gekozen Flask (niet midden in een slag, zware aanloop, guard, wankelen, rol of cast), een rol, wankelen of guard vóór het commit-punt annuleert zonder kosten, de lading wordt meteen opgeslagen; E bij een checkpoint = één rusttransactie (HP, mana, Flasks vol, één `playerRested`, één save) met het rustpaneel (`RestPanel.ts`) om de verdeling te wijzigen (vult direct bij, save bij sluiten); 1 / D-pad ← wisselt over de voorbereide wapens, wiel / D-pad ↑ over de voorbereide incantations (met een legacy staf in de hand nog over zijn eigen slots), V cast de voorbereide incantation; `LoadoutPanel.ts` (pauzemenu en tas): slots vullen buiten een gevecht, capaciteitsregel zichtbaar; de tas in een gevecht toont alleen de twee Flasks met Gebruiken, buiten een gevecht de Flask-stand, de knop "Loadout voorbereiden" en de oude drankjes met het label Legacy (geen Drink-knop meer, `Inventory.drinkPotion` weg); HUD: Flask-ladingen onder de balken en de gekozen Flask in het kruis; cheatmenu: +1 Flask-capaciteit, +1 Weapon Harness, +1 Grimoire Page (elk een eigen debug-ontdekking). Data: `player.json` → `flasks` vervangt `potions`, de vier drankjes `legacy: true`, uit Marco's winkel, validatorregels (verdeling telt op, geen legacy-potion in een winkel); de tutorial-quest "Just For You" koopt nu een Straw Hat (teksten aangepast, **ter controle**). Teksten in `en.json`/`nl.json`. Tests 1142 → zie `docs/PROGRESS.md`; headless `scripts/g5-check.mjs`. **Niet gedaan (bewust):** monster-drops en de drie Greenwood-questbeloningen geven nog legacy-potions (inhoudsbesluit), Flasks vullen niet bij het wakker worden na doodgaan (alleen een echte rust), geen controllerknop voor casten (G.6), geen wereldplekken voor Flask- of slotupgrades (alleen het mechanisme en de cheats), geen offhand-modi (G.6). **Alleen headless getest**; Lucas speelt de checklist uit de PR.
- [ ] **G.6 Schilden, grip en tweehandige wapens** — echte schilduitrusting; de modi Shield / Grimoire / Sword Art; regels voor verplicht tweehandig; tijdelijk één hand loslaten om te casten en daarna weer vastpakken, met loslaat- en grijptijden in simulatietijd; de contextuele LT; ander doel kiezen met de rechterstick tijdens lock-on; een migratie van de besturing die eigen bindingen niet overschrijft. Afstemmen met het open sprintwerk van A.5, zodat sprint, lock-on en doel wisselen niet botsen. _Klaar als:_ tweehandig + schild onmogelijk is, casten met een tweehandig wapen loslaat en weer vastpakt volgens de simulatietijd, casten nooit overlapt met aanval, parry, rol, wankelen of blok, LT doet in elke modus het juiste, eigen bindingen blijven staan, en 60/120 Hz gelijk is (tests).
  - _Besluit (Bo/Lucas, 2026-10-18):_ Chief's Greatblade is normaal tweehandig, maar kan met genoeg Strength met één hand gehanteerd worden. De Strength-drempel en de balansgevolgen zijn **niet** besloten en horen bij G.6. G.6 bepaalt ook hoe `weapon.grip` (G.1, voorlopig) het echte handgebruik en dit Strength-gebonden hanteren uitdrukt; tot dan staat de Greatblade in de data op `oneHanded`, zoals de runtime hem nu vasthoudt.
- [ ] **G.7 Ontdekkingen en voortgang via leraren** — permanente element-grants; los geleerde incantations; ontdekkingen en quest-grants; het gedeelde tweede Grimoire-slot via de Academy; Sams beloning; Brinks willekeurige permanente element + bijbehorende eerste incantation; Garricks Sword Art + eerste Sword-skillpunt/mijlpaal; geen automatische inhaal-quests; de basis voor skillpunten uit mijlpalen. Een ontgrendeld element leert je nooit automatisch alle incantations ervan. _Klaar als:_ een ontdekking eenmalig is (ook na laden), Brinks element na laden niet opnieuw getrokken wordt, elke leraarsroute het tweede slot krijgt, Garricks `academy_blade` (als hij blijft) niet automatisch aangetrokken wordt, en de teksten in NL en EN kloppen (tests).
- [ ] **G.8 Grimoire-beeld en animatie** — de zwevende Grimoire en de benodigde animaties voor casten, grip en tweehandig. Tijdelijke of procedurele boekbeelden mogen vóór het definitieve Blender-model; het definitieve gedrag volgt de timing van de simulatie, nooit die van de animatie. _Klaar als:_ het boek verschijnt, zweeft en verdwijnt op de simulatietijd, de draw calls blijven binnen de harde eisen op Low, Mid en High, en er zijn geen allocaties per frame.
- [ ] **G.9 Cutscenes, balans, opruimen en verificatie** — pas nadat de migratie bewezen veilig is: staf-specifieke cutscenes en teksten aanpassen, de nieuwe combinatie van zwaard en Grimoire balanceren, echt dode staf-code en -cheats verwijderen waar dat veilig is, legacy-data voor oude saves behouden, `docs/ARCHITECTURE.md` bijwerken, en de laatste tests en prestatiemetingen doen. _Klaar als:_ alle tests, de DataValidator en de taal-key-check slagen, er geen speelbare staf meer in teksten of cheats zit, oude saves nog laden, en de fps op Low/Mid/High in `docs/PROGRESS.md` staat.

---

## Later (backlog, nog geen stappen)

Seizoenseffecten · crafting en drogen · de Garden en farming (ook de bedden `MON_FarmPlot_1…6` in de kloostertuin) · lichtwezen-quest in Old Tjikko (alleen lente) · Nature Crystal in de Greenwood · de overige zones (Eredhollow, Ruins of Dunmar, Mountains of Karad Vorn, Plains of Tharond, Morvath, Black Citadel, Frozen Lake) · Warrior/Berserker (level 15) · Old Rivals (pas daar komt de naam Ruben voor) · Nine Lives (rematch met Sultan) · Second Wind · de Greenwood-side quests van de leraren (na de poort, gear als beloning) · een echte landpoort in het Blender-model.

---

## Notities

### Fase-letters (vast, niet hergebruiken)

Fases met een letter in plaats van een nummer. Een letter hoort bij precies één fase; een nieuwe fase krijgt een nieuwe, nog vrije letter. Stappen heten `<letter>.<nummer>`.

- **A** – Personage-animaties (Fase A)
- **C** – Filmische cutscenes (stappen C.1 en verder, onder *Extra – Filmische cutscenes*)
- **D** – Deuren die meezwaaien (Stap D)
- **G** – Grimoire-migratie (stappen G.0–G.9; vastgelegd 2026-10-17)
- **H** – Geluid (stappen H.0–H.7; tot 2026-10-18 voorgesteld als "Fase G", hernoemd omdat G voor de Grimoire is)
- **S** – Souls-like gevecht (Fase S)

### Open vragen voor Bo en Lucas

| #   | Vraag                                                                | Stand nu                                                                                                                                        |
| --- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 15  | Wat doet een **Dark Slime** als hij je raakt?                        | Voorstel staat in de data: **Weakened** — 4 s lang doen je eigen treffers 25% minder. Eén regel in `monsters.json` anders                       |
| 16  | Een zwaardvechter kan de tweede exam halen door de knop in te houden | Hij komt er met minder HP uit; meer slimes passen niet binnen 520 XP. Wil Bo dat hij kan zakken, dan een ander soort vijand erbij (alleen data) |
| 1   | Wat gebeurt er overdag met mobs van 's nachts?                       | Ze blijven staan (test). Eén regel in `Enemies.stepSpawning`                                                                                    |
| 2   | Blijft Greyhaven in het gouden uur of krijgt de stad dag en nacht?   | Staat op `"lighting": "cycle"`; `"goldenHour"` is één woord in de data                                                                          |
| 4   | Moet `player.glb` ook in de open wereld gebruikt worden?             | **Ja, overal** (Bo, 2026-10-16): je eigen personage uit de creator in de creator, de intro, de open wereld, Greyhaven en de cutscenes. Stap A.6a + A.6b |
| 5   | Een echte landpoort in het Blender-model?                            | De muur is dicht behalve waar de rivier eronderdoor gaat. Daarna alleen data                                                                    |
| 7   | Hoe moet farming werken (zaad, groeitijd, oogst, seizoenen)?         | Alleen de bedden + markers staan in Blender                                                                                                     |
| 9   | Moet een schot op een onraakbare vijand melden dat hij beschermd is? | Voorstel: zo laten (je schiet erlangs)                                                                                                          |
| 10  | Moet de snel-drink-knop ook mana potions pakken?                     | **Opgelost in S.16:** met 3 / D-pad ↓ kies je welk drankje Q / X gebruikt (standaard eerst de health potions uit `quickOrder`)                 |
| A.5 | Vier vragen over rennen en springen (zie stap A.5a)                  | **Beantwoord (Bo, 2026-10-18):** (1) in de lucht dashen of rollen: **nee** (besluit S-8); (2) in de lucht aanvallen of casten: **nee**; (3) springen kost energie: **ja, een beetje** (`jump.energyCost` 10); (4) sprinten: **de dash-knop vasthouden**, je rolt en loopt de rol uit in een sprint (geen aparte sprint-toets, geen aan/uit) |
| 19  | Hoe komt de speler het klooster uit? De kerk (met het portaal) heeft geen deur naar de kloostergang en de tuinmuur is dicht | Game: `openings` in `zones.json` maakt deuren beloopbaar (hal → kloostergang, hal → tuin, portaal). Nodig in Blender: een deur(opening) kloostergang → zuidbeuk van de kerk, of een hek in de tuinmuur; daarna één regel data |
| 20  | Brother Ansel zegt nog dat hij je **bewusteloos langs de weg** vond (`quest.a_quiet_awakening.offer.1`, `quest.tales_by_the_fire.offer.1`), terwijl in de nieuwe intro de kat je eerst vindt in de badlands | Zo gelaten: de reis van Morvath naar Greyhaven is een sprong naar zwart. Wil Bo de zin anders, dan is het alleen tekst in `en.json` en `nl.json` |
| 21  | Is het kasteel van de intro **The Black Citadel**? | De intro noemt het kasteel niet bij naam (verhaaltekst `intro.panel_1..3`, ongewijzigd); een naam is één tekstregel |
| 22  | In de intro zit **donder op de drankknop** (Q) en de **ijspegel op de lock-on-knop** (Tab of de middelste muisknop): zo houden, of eigen toetsen? | Alleen in de intro (`abilities[].action` in `cutscenes.json`), de echte bindingen blijven; de tip toont de ingestelde toets via `{keyPotion}` en `{keyLock}`, op de telefoon staan de namen op de knoppen. Eigen toetsen = een nieuwe `action` in `controls.json` + Settings → Besturing |
| 23  | Zijn de **Forge-getallen** goed, en moet een upgrade per exemplaar gelden in plaats van per item? | Tijdelijk (stap 4.1): 3 niveaus; wapens +3 schade per niveau voor 50/100/150 gold, armour +3–8 hp (+1–2% reductie) voor 40/80/120 gold; elk niveau 1/2/3 Slime Gel; niveau per item-id. Alles in `items.json` → `upgrade.levels` |
| 24  | Kloppen de **winkelgetallen** (verkoop 50%, voorraad, herstel-tijd), moet Marco's winkel wisselen, en komt Tobi the Snow Merchant er (waar)? | Tijdelijk (stap 4.2): `sellRatio` 0,5 (verkoopprijs = winkelprijs x ratio, een handelaar koopt alleen wat hij zelf verkoopt); Marco's 4 gear-items max 2 op voorraad, 1 terug per 600 s speeltijd (potions onbeperkt); voorraad in de save (v17). "Winkel wisselt steeds" niet gebouwd (vaste lijst). Tobi niet toegevoegd (rol/plek onbekend). Alles in `npcs.json` → `shop` |
| 25  | Kloppen de **spellboek-keuzes**? | Tijdelijk (stap 4.3): tweede spell per element automatisch geleerd vanaf level 5 (Ember Burst, Tidal Lash, Bramble Whip, Gale Cutter, Night Lance; iets sterker, 10% duurder); Adept Staff (rare, 2 slots) bij Marco voor 250 gold, voorraad 1; de keuze geldt per personage, niet per staf (een staf met minder slots maakt de extra slots leeg). Brief zei "alleen de 5 bestaande spells", stap zei "meer spells": stap gevolgd. Alles in `spells.json`/`items.json`/`npcs.json`. _Superseded door Fase G: niet meer automatisch leren op level, geen slots per staf, en Adept Staff wordt legacy_ |
| 26  | **Voorbereide gevechtsslots**: 2 hoofdwapens, 1 offhand en 4 drankjesslots? En mag de tas in een gevecht open zonder pauze? | **Beantwoord (Bo/Lucas, 2026-10-17):** ja, 2 + 1 + 4 (besluit S-9); de tas mag in een gevecht open voor drankjes, maar het gevecht gaat gewoon door (besluit S-10). Bouwen in stap S.15. _Fase G: het offhand-slot is vervangen door offhand-modi (S-9 bijgewerkt), en het bouwen gebeurt in G.5 in plaats van S.15_ |
| 27  | **Wisselknoppen voor de voorbereide slots** (stap S.15) | **Beantwoord (2026-10-17, stap S.16):** Elden Ring-stijl. Controller D-pad ↑ spell, ← wapen, → andere hand, ↓ snel item, X gebruiken; pc wiel = spell, 1 / 2 / 3 = wapen / andere hand / snel item, Q gebruiken |
| 28  | Het muiswiel kiest nu de spell; **zoomen is Ctrl + wiel**. Goed zo? | Gebouwd in S.16. Een wieltik kan in Instellingen → Besturing aan een andere actie; zonder actie op het wiel zoomt het weer gewoon |
| 29  | **Kleine keuzes uit G.1** (data, nog niet zichtbaar in het spel): is Chief's Greatblade één- of verplicht tweehandig? Mag de Rookie Grimoire verkocht worden? Welke kleur heeft Neutral? | **Greatblade beantwoord (Bo/Lucas, 2026-10-18):** normaal tweehandig, met genoeg Strength eenhandig; drempel en balans in G.6 (zie G.6), tot dan in de data `oneHanded` zoals de runtime hem nu vasthoudt. Nog open: Rookie Grimoire `tradeable: false` (zonder Grimoire kun je niet meer casten) en Neutral `steengrijs`. Elk is één regel in `items.json`/`spells.json` |

### Nog te doen door Bo en Lucas

- Fase 2, 3.7, 3.8, 3.9 en het Blender-Greyhaven **spelen** en "Meet 20 s" draaien op de pc (stappen 2.8, 3.8.8, 3.9.4).
- De twee filmische cutscenes bekijken en meten (stap C.3).
- De **nieuwe intro** spelen op pc en iPhone (nieuw spel; proefpagina of PR #95) en de fps meten op Low en High (stap C.4a).
- fps op een echte **iPhone** is nog nooit gemeten (sinds fase 1).
- Fase A: de **fps van de nieuwe speler op Low en Mid** meten in Greyhaven (A.2c kon alleen High live meten: 120 fps; draw calls staan in PROGRESS).
- Fase A (Bo, in Blender, voor stap A.6a): een **vrouwelijk lijf** op hetzelfde skelet en de **5 kapsels** uit de character creator. Mag tegelijk met A.3–A.4.

### Bekende problemen

- Elke start logt `missing text "common.close" (en)` (open vraag 17): `src/ui/Overlays.ts` vraagt het label op vóórdat `I18n.setLanguage` iets geladen heeft. Onschuldig, maar het vervuilt de debuglijst. Oplossing: het `aria-label` pas zetten als de knop in beeld komt.
- Three.js zelf is 548 kB in de bundel en kan niet verder opgesplitst worden.
- Vanuit het bed in het klooster kun je de kloostergang, de westvleugel en de tuin in, maar nog niet de stad (open vraag 19).
- 120 fps lukt op de iPhone waarschijnlijk niet (Safari tekent daar maximaal 60 keer per seconde); het spel loopt wel overal even snel.

### Tijdelijke namen (nog niet definitief, alleen in data gebruiken)

Hilda Ironhand · Professor Fizzwick · Marco the Merchant · Old Bertha · Brother Ansel · Sir Garrick the Blademaster · ezel Biscuit · De Wortelgrotten (Moerastrol Grimbald) · Toren van de Gevallen Leerling (Schaduwmagiër Veyra) · Draken-crypte (Botdraak Ashkarn) · de baas van The Forgotten Book · de valuta **Gold** · de elfenstad (nog geen naam) · **Treewardens** · het lichtwezen in Old Tjikko · Arcane Shard · de namen van de 5 spells, de vijf level-5-spells (Ember Burst, Tidal Lash, Bramble Whip, Gale Cutter, Night Lance), Adept Staff, de gear, het betere zwaard en de exam-quests.
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
