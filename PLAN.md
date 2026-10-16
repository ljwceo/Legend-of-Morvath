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

## Extra – Filmische cutscenes (Elden Ring-stijl) · stap 1, 2 en C.4a **gebouwd** (2026-10-15)

Besluit uit het concept: cutscenes worden filmisch in de 3D-wereld zelf (`"type": "cinematic"` met `anchor`, `actors` en `shots` in `cutscenes.json`), met je eigen personage en gear in beeld. De strips blijven werken tot ze vervangen zijn. Overslaan = ±1 s ingedrukt houden. Alles op de vaste tijdstap, dus 60 en 120 fps zijn precies gelijk.

- [x] **C.1 Systeem + proef Pringle → Sultan** — `CinematicTimeline` (pure logica), `CinematicStage` (actors in 3D), `CinematicCutscene` (balken, ondertitels, naamkaart, fade/flits/tint, skip-ring), HUD en knoppen weg tijdens de film, overwinningstekst na een baas (`boss.victory`). _Klaar als:_ de zes shots van Pringle → Sultan lopen door in het baasgevecht en 60 en 120 fps geven precies hetzelfde (test).
- [x] **C.2 Eindscène na Sultan** — twee varianten (zwaard en mage) gekozen door de laatste treffer, slow motion, bevroren beeld, de ton, Pringle uit de rook, het ei als kaart, BOND FORGED in de balk van de zonenaam, Sultan vertelt als NPC waar je items vindt. _Klaar als:_ beide varianten spelen en zijn overslaanbaar.
- [ ] **C.3 Kijken en meten (Bo/Lucas)** — beide eindscènes bekijken via cheatmenu → Baasgevecht, en "Meet 20 s" tijdens een cutscene op Low en High. _Klaar als:_ Bo zegt of de scènes goed voelen en de fps staat in `docs/PROGRESS.md`.
- [x] **C.4a Intro filmisch (nieuw verhaal van Bo, 2026-10-15)** — de intro is één filmische scène met het speelbare gevecht erin (`IntroSceneState`, vervangt `IntroFightState`): een eigen `THREE.Scene` met de set uit data (`CinematicSet`: de mistdeur, zwevende boekenkasten, stoelen aan het plafond, de badlands), film → gevecht → film. Door de mistdeur van het kasteel van Morvath een kamer in waar tijd en werkelijkheid niet gelden; Lucael teleporteert om je heen en bekijkt je, Baelor loopt door bevroren tijd; jouw explosie; het gevecht (±1 min, vier aanvallen: slaan, explosie, donder over de hele kamer, een grote ijspegel — bijna alles mist ("Dodged!"), wat raakt doet 0) terwijl de broers ruziën wat ze met je moeten; Lucael krimpt je, Baelor tilt je op, Lucael slaat je weg met een honkbalknuppel; je landt in de badlands, de kat (Sultan, zonder naam) likt je gezicht; zwart; wakker in het klooster. Alles in `cutscenes.json`: `fight`/`afterFight` op een cinematic, actors `model: "fight"` en `prop:bat`, nieuwe shot-velden `hops`, `headingFrom`/`headingTo`, `ownTime` en `narration`, en per gevecht `set`, `abilities`, `dodge` en `seed`. Ontwerp en afwijkingen in `docs/intro-cinematic-design.md`; headless check `node scripts/intro-check.mjs` (`--skip`, `--quality low|mid|high`). _Klaar als:_ de hele intro speelt en is in elk deel overslaanbaar, en de check loopt zonder fouten. (Gebouwd 2026-10-15. Gemeten in headless Chromium op alle drie de standen, zonder fouten: draw calls film 1 **25–51 / 27–53 / 26–52** (Low / Mid / High), gevecht **29–52 / 31–54 / 30–53**, film 2 **13–51 / 15–53 / 14–52**, tegen 157–159 in Greyhaven; Mid en High alleen +2 voor FXAA; fps is daar niet te meten. Na Bo's proefronde (2026-10-15): een indicator die laat zien wanneer je vaardigheden weer klaar zijn — chips op de pc (`AbilityBar`), een wig op de telefoonknop — in de intro én in de wereld (de Shard en de spell van de staf). Bo: spelen op pc en iPhone, fps meten, en open vraag 20, 21 en 22.)
- [x] **C.4 De overige strips omzetten** — de uitleg in de toren van Brink en de kelder van Sam, en de Crystal Ceremony. _Klaar als:_ elke omgezette cutscene is overslaanbaar en de oude strip-code is alleen nog voor wat nog niet om is. (Gebouwd 2026-10-16: de uitleg van Brink, die van Sam en beide Crystal Ceremonies zijn films met ondertitels, allemaal overslaanbaar met Escape ingedrukt houden; alle strip-code, `panels` in het schema, de strip-taalkeys, de strip-CSS en `IntroState` zijn weg. De ceremonie blijft in de wachtrij tot hij echt gestart is. Alle camerastanden zijn schattingen op papier en nog niet in het spel bekeken: Bo/Lucas bekijken ze via de toren, de kelder en een nieuwe staf-quest, en geven bij te sturen standen door.)
  - _Auto-run 2026-10-16, eerste poging (de tweede run is wel goedgekeurd, zie hierboven): afgekeurd omdat na één herstelronde nog strip-resten over waren: dode taal-keys (`intro.skip`, `intro.tapToContinue`, `cutscene.skip`, `cutscene.tapToContinue`, `cutscene.brink_tower.caption1-3`, `cutscene.sam_cellar.caption1-3`, `cutscene.crystal_ceremony.caption3`) en de strip-uitzondering in `I18n.test.ts` (r. 97-108). Verder was het af: de vier scènes als cinematic + skippable, `ComicCutscene`, `PanelSequence`, het strip-intropad, `panels` in het schema en de `.ui-comic*`/`.ui-intro-card*`-CSS weg. Let ook op: `playPendingCutscene` zet `pendingCutscene = null` vóór `startCutscene`, dus een mislukte start laat de ceremonie verdwijnen; en de oude captions beschreven poses (Brink heft zijn hand, Sam stapt in de cirkel) die NPC's in een film nog niet kunnen._
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

- [x] **D.1 Fysica-module met tests** — `src/systems/HingedBodies.ts` plus `HingedBodies.test.ts`, nog niets aan de game gekoppeld. _Klaar als:_ tests slagen voor: een cirkel die van de ene kant door het lijnstuk loopt duwt het de andere kant op, en andersom; zonder duwer gaat de hoek terug naar 0 en blijft daar; nooit boven een aanslag; een kant met aanslag 0 beweegt die kant nooit op; een cirkel precies op het scharnier geeft geen sprong; een cirkel met dash-snelheid (uit `player.json`) laat de hoek nooit boven de aanslag komen en de deur komt daarna tot rust; 600 stappen van 1/60 s geven hetzelfde als dezelfde 600 stappen in twee reeksen. `npm run lint`, `typecheck` en `test` groen. (Gebouwd 2026-10-14: 16 tests; conventie positieve hoek = naar links gezien vanaf het scharnier, zoals `rotation.y`; de veer-, demp- en duwgetallen staan nog als testwaarden en komen in D.2 in `scene.doorSettings`.)
- [x] **D.2 Data, schema en validator** — `scene.doors` en `scene.doorSettings` in `zones.json` met de drie kloosterdeuren, schema in `src/data/schemas.ts`, DataValidator-regels (`box` bevat `hinge` én `tip`, `box` is niet leeg, minstens één kant van `openDegrees` is groter dan 0) met tests. De scharnierpunten en vrije kanten uit Blender (`docs/MONASTERY.md` noemt de objecten en de z-waarden van de openingen) en nagemeten in de game met `?debug=1` (de debugregel `chunks` toont je positie in Blender-coördinaten). _Klaar als:_ de validator slaagt op de echte data en faalt op elke fout uit de regels hierboven; in `docs/PROGRESS.md` staat per deur welke kant het scharnier zit en hoeveel graden vrij, als aanname voor Bo. (Gebouwd 2026-10-14, samen met D.3: drie deuren `hall_cloister`, `hall_garden`, `church_portal`; het portaal is een dubbele deur waarvan de linkerhelft in Blender open staat, alleen de dichte rechterhelft wordt een deur en die opent alleen naar buiten.)
- [x] **D.3 Deuren knippen en tekenen** — `SceneZone` maakt per deur een `Group` uit de driehoeken in `box`, met het scharnier als oorsprong; de `box` werkt als `opening` voor de botsingsmesh; een cheat in het cheatmenu (F6) zet alle deuren op een vaste hoek, zodat je zonder fysica kunt zien dat ze om de goede hoek draaien en niets van het kozijn meedraait. _Klaar als:_ met de cheat draaien alle drie de deuren om hun scharnier, niets anders beweegt mee, draw calls stijgen met hooguit het aantal deuren × hun materialen, en geometrieën en textures gaan bij verlaten weer terug (`node scripts/mem-check.mjs --only instances --instance brink_tower --cycles 2`). (Gebouwd 2026-10-14: `SceneZone.doors`, `setDoorAngle`, cheat "Doors" met uit / −85° / −45° / 0° / 45° / 85°, afgekapt op de aanslagen; mem-check 92/14 → 64/7 → 92/14.)
- [x] **D.4 Koppelen aan de speler** — `WorldState` voert de speler (en zijn dash-substappen) als duwer aan `HingedBodies`, zet elke stap de hoeken en tekent ze geïnterpoleerd; de cheat uit D.3 blijft. `docs/ARCHITECTURE.md` krijgt een stukje over deuren. _Klaar als:_ alle drie de kloosterdeuren zwaaien van je af open als je erdoorheen loopt (van beide kanten), vallen weer dicht, gaan bij een dash niet door de muur, en `?fps=30` en `?fps=120` geven dezelfde zwaai; fps en draw calls op Low, Mid en High zijn gelijk aan voor de stap (getallen in `docs/PROGRESS.md`). (Gebouwd 2026-10-14: `src/systems/Doors.ts` (`SwingingDoors`), `PusherList` en duwers die onthouden waar ze vandaan kwamen in `HingedBodies.ts`, `SceneZone.setMoveTrace` voor de substappen; 713 tests. Nog door Bo te spelen op pc en iPhone.)

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
- [x] **A.0 Looks van het personage in Blender (Bo, blokkeert A.1b)** — besluit van 2026-10-13: eerst het echte model maken. _Klaar als:_ Bo zegt dat het model klaar is; daarna draait A.1 opnieuw op dat model. (Klaar 2026-10-15: `Hero_Start_Rigged.blend`, collectie `StartCharacter` met één lijf `Body` van 1,80 m (5.342 driehoeken, materialen `Skin` en `Tunic`, A-pose ±40°) en het Rigify-skelet `Hero_Rig`; Bo vindt de looks goed genoeg, fijnslijpen komt later. `01_prep_mixamo.py` draait op dit model en geeft `body_for_mixamo.fbx`.)
- [x] **A.1b Mixamo (Bo, Deel B)** — `body_for_mixamo.fbx` door Mixamo auto-rig halen en de animaties uit de clipnamen-tabel downloaden (zie `tools/blender/character/README.md`). _Klaar als:_ `body_rigged.fbx` + alle animatie-FBX's staan in `art-source/` en de Mixamo-preview buigt zonder rare vervormingen. **Klaar (2026-10-16):** de rig en alle clips (plus 5 zwaard-extra's) staan in `art-source/`; A.2a is erop gebouwd.
- [x] **A.2a Mixamo terug in Blender: rig en clips** — `02_import_mixamo.py`: importeren, schaal ×0,01, `mixamorig:Hips` → `Hips`, elke animatie één Action met de juiste clipnaam, horizontale `Hips`-beweging eruit, clips inkorten (`Dash` 0,18–0,25 s, `Heavy_Windup` past bij 0,9 s, `Cast_Gather` als nette lus). _Klaar als:_ elke clip speelt in Blender zonder wegglijden. **Klaar (2026-10-16):** `02_import_mixamo.py` (headless, of vanuit de Scripting-tab: start zichzelf zonder venster, de bron wordt nooit opgeslagen) maakt `Hero_Start_Animated.blend` naast de bron: `PlayerRig` (65 botten zonder `mixamorig:`), `Body` (1,80 m, `Skin`/`Tunic` per vlak teruggezet, `Hero_Skin_Clothes` weg) en 24 Actions: 18 clips (`Heavy` gesplitst in `Heavy_Windup` 1,23 s + `Heavy_Strike` 1,63 s, `Dash` 0,20 s, `Cast_Gather` als lus) plus 5 zwaard-extra's. De import staat al in meters (geen ×0,01). De Mixamo-clips staan in T-pose en het lijf in A-pose, dus elke clip is per bot op wereld-oriëntatie op de rig gebakken (gecontroleerd: 0,000°). Resterende Hips-drift 0,00 cm bij alle 24 clips. Hoe je het draait en wat je in de log moet zien: `tools/blender/character/README.md` → Deel C.
- [x] **A.2b Hoed, haar, zwaard en cape** — Hair/Hat/Hat_Band/Hat_Brim stijf aan `Head`, `Sword_*` stijf aan `RightHand`, cape terug + 3 kettingen van 3 botten (`Cape_L/M/R 1-3`) aan `Spine2` met weights, cape-botten in geen enkele clip. _Klaar als:_ hoed, haar en zwaard bewegen mee en de cape gaat mee met het lijf. (Klaar 2026-10-16: `03_attach_gear.py` maakt `Hero_Start_Player.blend` uit `Hero_Start_Animated.blend` + de oude spullen van het poppetje uit `Greyhaven.blend`, passend gemaakt op 1,80 m. Zwaard in de **rechter**hand (het oude poppetje had hem links), plus een tijdelijke staf `Staff_Shaft`/`Staff_Crystal` in dezelfde greep; `Collar_Trim` stijf aan `Spine2`; in `Cast_Gather`/`Cast_Release` heeft de rechterhand de vuist van `Idle_Sword`. 17.378 driehoeken. Gekeken in `Idle_Sword`, `Run`, `Slash_1` en `Cast_Gather`.)
- [x] **A.2c Export + check** — `export_web.py` (speler-deel): `export_animations=True`, armature + skin mee, geen `export_apply` op de armature, Draco uit als hij met skin stukloopt. Checkscript print botten, driehoeken (≤ 30.000), clips met duur en bestandsgrootte (≤ 2 MB). _Klaar als:_ `player.glb` heeft skelet + skin + alle clips met de juiste namen en de game start nog in Greyhaven. **Klaar (2026-10-16):** een eigen script `tools/blender/character/04_export_player.py` (de bron is `Hero_Start_Player.blend`, niet Greyhaven.blend; `export_web.py` maakt geen `player.glb` meer en beide scripts voegen samen in `materials.json`). `player.glb`: 74 botten, 1 skin (`Body`, `Cloak`, `Cloak_Trim`), 24 clips met exact hun Action-naam en duur, 17.378 driehoeken, 1,51 MB met Draco (skin werkt). Eerst 2,34 MB: de glb-JSON was 1,15 MB door 5.328 kanalen; kanalen zonder keys die niet bewegen (cape-botten, verschuivingen behalve `Hips`) laat de exporter nu weg, zonder verlies. `Idle_Sword_2` hoeft dus niet korter. `materials.json`: `Staff_Crystal` (emit) erbij, `Skin`/`Tunic` voorlopig `flat` met de gemiddelde texturekleur plus `tex: Hero_BaseColor.jpg` (1024 px). Check: `check_player_glb.py` (draait ook vanzelf na de export). Game: de halve slag in `ScenePlayerModel` is weg (de speler kijkt vooruit) en de staf is verborgen zoals het zwaard. Hoe je het draait: README → Deel E.
- [ ] **A.3a Skinning in de toon-shader** — de skinning-chunks zitten al in `ToonMaterial` sinds Pringle (stap D.1); hier alleen nog de **Outline** erbij en controleren dat statische meshes niets duurder worden. Ook hier (besluit 2026-10-16): `Skin` en `Tunic` getextureerd tekenen (nieuw kind `textured` in `materials.json` + `mode: 'textured'`; de `tex` staat er sinds A.2c al) met de huidskleur uit de character creator als **tint over de texture** (besluit 2026-10-16: je eigen personage moet overal zichtbaar zijn, zie A.6). Of de normal map (`Hero_Normal`, spierlijnen en plooien) er ook bij komt, beslissen Bo en Lucas na deze stap. _Klaar als:_ de SkinnedMesh van de speler vervormt mee, met omlijning, en draw calls/fps blijven gelijk.
- [ ] **A.3b `animations.json` + model doorgeven** — nieuw databestand met schema en validator; `ScenePlayerModel` houdt de SkinnedMesh, laat de Blender-`Sword_*` aan `RightHand` zien (zwaard én staf) en geeft de clips door. _Klaar als:_ de DataValidator keurt het bestand en de clips komen aan.
- [ ] **A.3c `PlayerAnimator`** — `AnimationMixer` + state machine (Idle, Walk, Run, Sprint, Jump, Fall, Land, Dash, `Dash_Recover`, Attack, Cast, Hit, Death, Interact), crossfades 0,15–0,25 s, `timeScale = snelheid / referentiesnelheid`, **aanvallen op voortgang** (`action.time = progress × duur`) zodat de slag samenvalt met de hitbox, combo Slash*1 → 2 → 3. \_Klaar als:* de keuze-functie is puur en getest, voeten glijden niet en de slag raakt visueel op het moment van de schade.
- [ ] **A.3d Bovenlijf, leunen en debug** — kopie van de cast-clip met alleen bovenlijf-botten bovenop de loopclip (`castMoveFactor`), licht leunen bij draaien en remmen, F3 toont state + clip, cheatmenu speelt elke clip los af. Het placeholder-poppetje houdt `setSwordPose` als terugval. _Klaar als:_ casten tijdens lopen ziet er goed uit en headless Chromium geeft geen fouten.
- [ ] **A.4a Spring bones** — `src/render/SpringBones.ts`: per cape-bot stijfheid, demping, zwaartekracht en een maximale hoek; eigen vaste substap (bijv. 120 Hz met accumulator); getallen in `animations.json → cape`, cheat-baar. _Klaar als:_ de cape beweegt exact hetzelfde op 60 en 120 fps (test) en er zijn geen allocaties per frame.
- [ ] **A.4b Botsing en reset** — botsbollen op heupen, bovenbenen en rug; resetten na teleport of respawn. _Klaar als:_ de cape gaat niet door de benen bij rennen of dashen en zwiept nooit door de wereld na een teleport.
- [ ] **A.5a Open vragen aan Bo (eerst stellen)** — mag je in de lucht dashen? Mag je in de lucht aanvallen of casten? Kost springen energie? Sprinten vasthouden of aan/uit? _Klaar als:_ alle vier de antwoorden staan in Notities.
- [ ] **A.5b Sprinten en springen in de simulatie** — `player.json`: `sprint` (speed, energyPerSecond) en `jump` (heightMeters, gravity, coyoteSeconds ±0,1, bufferSeconds ±0,12, airControl); `MoverState` krijgt vy, grounded, sprinting, coyoteTime, jumpBuffer; `GroundedMover` met echte verticale snelheid. _Klaar als:_ springen is precies even hoog en ver op 60 en 120 Hz (test) en coyote time + jump buffer zijn getest.
- [ ] **A.5c Toetsen, knoppen en draaglast** — acties `jump` en `sprint` in `controls.json` (let op botsing met dash), knoppen in TouchControls, teksten in `en.json` + `nl.json`, bestaande saves krijgen de nieuwe standaardtoetsen; sprong en sprint schalen mee met de draaglast, overbelast = niet sprinten of springen. _Klaar als:_ de nieuwe toetsen zijn instelbaar in Settings → Besturing en de DataValidator slaagt.

_Chat 5 (A.5a–c) heeft geen Blender nodig en mag vóór of tegelijk met A.2–A.4._

**Jouw personage overal (besluit Bo, 2026-10-16):** wat je in de character creator kiest (man/vrouw, kapsel, haarkleur, huidskleur, mantelkleur, …) is overal in het spel jouw poppetje: in de creator zelf, de intro, Greyhaven, de open wereld en de cutscenes. Het oude placeholder-poppetje verdwijnt. Komt na A.3 en A.4 (eerst moet één model goed bewegen en er goed uitzien).

- [ ] **A.6a Modellen voor alle keuzes (Bo in Blender, daarna script)** — Bo maakt een **vrouwelijk lijf** dat op hetzelfde skelet `PlayerRig` past (zodat alle 24 clips erop werken) en de **5 kapsels** uit de creator (kort, naar achteren, slordig, lang, paardenstaart) als losse meshes met materiaal `Hair`, net als het lijf in A.0. Daarna zet een script (bijv. `05_body_variants.py`) ze stijf aan `Head` / skinned aan `PlayerRig`, en nemen `04_export_player.py` + `check_player_glb.py` ze mee (namen vast in de check, grenzen voor driehoeken en grootte blijven gelden). _Klaar als:_ `player.glb` heeft beide lijven en alle 5 kapsels op één skelet, de check is groen, en elke clip speelt op beide lijven zonder rare vervormingen (te zien in `tools/player-preview/`).
- [ ] **A.6b Jouw poppetje overal (code)** — één gedeeld spelersmodel uit `player.glb` met de gekozen lijfvorm, het kapsel en de kleuren (tint op `Hair`, `Skin`, `Cloak_Navy`, `Hat_Navy`, `Gold_Trim`), gebruikt in de character creator (verandert live mee), de intro (`IntroSceneState`), de open wereld, Greyhaven en `CinematicStage`. `PlaceholderFactory` en `setSwordPose` blijven alleen als terugval als het model niet laadt. _Klaar als:_ een man en een vrouw met verschillende kapsels en kleuren zien er in de creator, de intro, Greyhaven en de open wereld precies hetzelfde uit, en fps en draw calls op Low, Mid en High blijven binnen de harde eisen.

---

## Fase 4 – Forge, markt, spellboek, kristallen, skill tree · **open** (stappen zijn een voorstel)

- [x] **4.1 De echte Forge** — Hilda upgradet wapens en gear met gold + materialen, niveaus en kosten in data, alleen buiten gevecht. _Klaar als:_ een upgrade verandert de stats van het item en staat in de save. **Klaar (2026-10-16, auto-run):** na het gesprek met Hilda opent de Forge; wapens (+schade) en armour (+hp/damage reduction) upgraden met gold + Slime Gel, alleen buiten gevecht, opgeslagen in `character.upgrades` (save v16). Niveau geldt per item-id (alle exemplaren delen het) en gaat mee bij de ruil Old Sword → Honed Old Sword. Getallen zijn tijdelijk (zie Notities).
- [x] **4.2 Markt en winkels** — meerdere handelaren uit data, koop- en verkoopprijzen, voorraad die terugkomt. _Klaar als:_ een nieuwe handelaar toevoegen is alleen data. **Klaar (2026-10-16, auto-run):** elke NPC met `shop` in `npcs.json` is een handelaar (geen code per NPC); verkopen voor prijs × `sellRatio` (standaard 0,5), optionele `stock` (max + `restockSeconds`) die per speeltijd terugkomt, opgeslagen in `shopStock` (save v17). Marco's gear heeft voorraad 2, potions onbeperkt. Getallen tijdelijk; Tobi en wisselend assortiment nog niet (zie Notities, vraag 24).
- [x] **4.3 Spellboek** — spellboek-UI, meer spells uit `spells.json`, spellslots per staf. _Klaar als:_ je spells wisselt buiten gevecht en de keuze staat in de save. **Klaar (2026-10-16, auto-run):** pauzemenu → Spellboek kiest per slot van je staf een geleerde spell van je kristal-element (of leeg), alleen buiten gevecht; eerste gevulde slot is de cast-spell; opgeslagen in `character.spellLoadout` (save v18). Per element een tweede spell (`learnLevel` 5) en de Adept Staff (rare, 2 slots) bij Marco. Namen en getallen tijdelijk (zie Notities, vraag 25).
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
| S-6 | Mage | Mana blijft; casten kost tijd waarin je kwetsbaar bent, je kunt eruit rollen. **Magie staat centraal en een goede mage is lastiger te beheersen dan brute force** (omgekeerd aan Elden Ring, waar mages als de makkelijke weg gelden): hogere vaardigheidsdrempel, veelzijdig (spells, enchants, boosts) en sterker voor wie het onder de knie heeft. De zwaardvechter is de toegankelijke keuze |
| S-7 | Raids | De eigen client beslist over zijn eigen rol, de host controleert ruim |
| S-8 | Springen | Blijft, geen dash of rol in de lucht; sluit aan op A.5a |

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
- [x] **S.2 Gamepad** — `Input` krijgt de Gamepad API als bron, standaardbindingen in `controls.json`, bindbaar in Settings → Besturing. _Klaar als:_ lopen, camera, lock-on, slaan en dash met een controller werken in Chrome en Safari en de mapping getest is.
  - _Auto-run 2026-10-16: goedgekeurd (vierde poging). Nog door Bo/Lucas te testen met een echte controller in Chrome en Safari; op de iPhone werkt de Gamepad API waarschijnlijk alleen via HTTPS (GitHub Pages), niet via `npm run dev` op het LAN. Start = pauze (niet bindbaar); menu's kiezen met controller komt later. Bekend klein punt: bij twee controllers kan de allereerste druk op de tweede verloren gaan._
- [x] **S.3 Stamina-regels** — de energiebalk blijft; erbij komen: regen pas na een pauze (`energyDelaySeconds` bestaat al), uitgeput zijn bij 0 en kosten per actie uit `player.json`. _Klaar als:_ elke actie kost wat de data zegt en 60 en 120 Hz exact dezelfde uitkomst geven (test).
  - _Auto-run 2026-10-16: goedgekeurd. Uitgeput zijn bij 0 (acties mogen starten zolang energie > 0, kosten afgekapt op 0), daarna `exhaustedDelaySeconds` en herstel bij `exhaustedRecoverEnergy` (startwaarden 1 s en 20, gevoelig voor de Sultan-balanstests; Bo/Lucas kunnen bijstellen). Bekend: wie uitgeput de snelle slag ingedrukt houdt, blijft op 0 hangen. Geen HUD-weergave van uitgeput zijn (later)._
- [x] **S.4 Rol met onkwetsbare frames** — de dash krijgt `iFrames` (start en einde), `recoverySeconds` en afstand in `player.json`; de schadecheck slaat je over tijdens de onkwetsbare frames; richting volgt de lock-on. _Klaar als:_ een aanval die binnen het venster raakt mist, erbuiten wel raakt, en dat op 60 en 120 Hz gelijk is (test).
  - _Auto-run 2026-10-16: goedgekeurd. Venster 0,03–0,15 s en `recoverySeconds` 0,05 zijn startwaarden in `player.json` (bij 0,1 zakte de Balance-test voor Entrance Exam 2; bijstellen mag). Onkwetsbaar tegen alle schade via `hurtPlayer` (ook pijlen en brand). Richting = stick/toetsen ten opzichte van de camera, in lock-on draait de camera mee (per beeldje, niet per vaste stap); stilstaand rol je in kijkrichting. Geen rol in de lucht: `MoverState.airborne` is de haak, het springsysteem (A.5a) moet hem zetten. Het oude besluit van 2026-10-10 ("dash maakt niet onkwetsbaar") is vervangen door S-2. Nog geen HUD-weergave of effect van de onkwetsbare frames._
- [x] **S.4b Gold terughalen bij je lijk** — bij doodgaan verlies je gold (percentage in `player.json`, startwaarde de huidige 10%) en blijft het liggen op de plek waar je viel, als herkenbare markering in toon-stijl. Loop je erheen en pak je het op, dan krijg je het terug; ga je eerst opnieuw dood, dan is het oude gold weg en komt er een nieuwe markering. Opslaan en laden bewaren de markering (save-versie ophogen met migratie), teksten in `en.json` en `nl.json`. _Klaar als:_ doodgaan zet de markering, ophalen geeft het gold terug, een tweede dood vervangt de markering, en save en laden behouden hem (tests).
  - _Auto-run 2026-10-16: goedgekeurd. Ophalen = erover heen lopen binnen `death.markerPickupRadius` (1,6 m, startwaarde in `player.json`), alleen in dezelfde instance en op x/z (hoogte telt niet). Save-versie 19 met migratie. Verlies wordt nog direct van je gold afgetrokken; HUD toont dat na het wakker worden. Nog niet in de browser gespeeld: Bo/Lucas testen markering en ophalen._
- [ ] **S.5a Aanvalsfases van vijanden** — elke vijandaanval in data in fases: aankondiging, raakvenster, herstel (`monsters.json`, `EnemyAI.ts`). _Klaar als:_ Green Slime en Goblin hun aanvallen uit data halen en een test bewijst dat schade alleen in het raakvenster valt.
- [ ] **S.5b Aankondiging zichtbaar** — per aanval een duidelijke visuele cue in toon-stijl, de aankondigingstijd uit data. _Klaar als:_ elke aanval van tevoren te zien is en de cue op Low, Mid en High even lang duurt.
- [ ] **S.6 Stagger en poise** — een poise-balk voor vijanden en speler; een zware slag of kritieke treffer breekt poise; het gewicht van je uitrusting (draaglast) bepaalt hoe stabiel je staat. _Klaar als:_ een vijand wankelt als zijn poise breekt en zwaardere uitrusting jou stabieler maakt (test).
- [ ] **S.7 Blokkeren en parry (S-3 = ja)** — timingvenster uit data, kost stamina. _Klaar als:_ een goed getimede parry de aanval afvangt en het venster op 60 en 120 Hz gelijk is (test).
- [ ] **S.8 Sultan opnieuw afstellen** — Sultan (Claw Combo, Pounce, Dash Strike, Flurry) herbouwen met de aanvalsfases uit S.5a; hij is de proefbaas. _Klaar als:_ Sultan alleen schade doet in zijn raakvensters en een nagebootste speler hem met rollen kan ontwijken (test).
- [ ] **S.9 Spelen en meten (Bo/Lucas)** — Sultan en een goblinkamp spelen op pc, met toetsenbord en met controller; "Meet 20 s" tijdens een gevecht op Low en High. _Klaar als:_ Bo en Lucas zeggen of het souls-like genoeg voelt en de fps in `docs/PROGRESS.md` staat.

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
| 4   | Moet `player.glb` ook in de open wereld gebruikt worden?             | **Ja, overal** (Bo, 2026-10-16): je eigen personage uit de creator in de creator, de intro, de open wereld, Greyhaven en de cutscenes. Stap A.6a + A.6b |
| 5   | Een echte landpoort in het Blender-model?                            | De muur is dicht behalve waar de rivier eronderdoor gaat. Daarna alleen data                                                                    |
| 7   | Hoe moet farming werken (zaad, groeitijd, oogst, seizoenen)?         | Alleen de bedden + markers staan in Blender                                                                                                     |
| 9   | Moet een schot op een onraakbare vijand melden dat hij beschermd is? | Voorstel: zo laten (je schiet erlangs)                                                                                                          |
| 10  | Moet de snel-drink-knop ook mana potions pakken?                     | Voorstel: zo laten, of een tweede knop                                                                                                          |
| A.5 | Vier vragen over rennen en springen (zie stap A.5a)                  | Nog niet gesteld                                                                                                                                |
| 19  | Hoe komt de speler het klooster uit? De kerk (met het portaal) heeft geen deur naar de kloostergang en de tuinmuur is dicht | Game: `openings` in `zones.json` maakt deuren beloopbaar (hal → kloostergang, hal → tuin, portaal). Nodig in Blender: een deur(opening) kloostergang → zuidbeuk van de kerk, of een hek in de tuinmuur; daarna één regel data |
| 20  | Brother Ansel zegt nog dat hij je **bewusteloos langs de weg** vond (`quest.a_quiet_awakening.offer.1`, `quest.tales_by_the_fire.offer.1`), terwijl in de nieuwe intro de kat je eerst vindt in de badlands | Zo gelaten: de reis van Morvath naar Greyhaven is een sprong naar zwart. Wil Bo de zin anders, dan is het alleen tekst in `en.json` en `nl.json` |
| 21  | Is het kasteel van de intro **The Black Citadel**? | De intro noemt het kasteel niet bij naam (verhaaltekst `intro.panel_1..3`, ongewijzigd); een naam is één tekstregel |
| 22  | In de intro zit **donder op de drankknop** (Q) en de **ijspegel op de lock-on-knop** (Tab of de middelste muisknop): zo houden, of eigen toetsen? | Alleen in de intro (`abilities[].action` in `cutscenes.json`), de echte bindingen blijven; de tip toont de ingestelde toets via `{keyPotion}` en `{keyLock}`, op de telefoon staan de namen op de knoppen. Eigen toetsen = een nieuwe `action` in `controls.json` + Settings → Besturing |
| 23  | Zijn de **Forge-getallen** goed, en moet een upgrade per exemplaar gelden in plaats van per item? | Tijdelijk (stap 4.1): 3 niveaus; wapens +3 schade per niveau voor 50/100/150 gold, armour +3–8 hp (+1–2% reductie) voor 40/80/120 gold; elk niveau 1/2/3 Slime Gel; niveau per item-id. Alles in `items.json` → `upgrade.levels` |
| 24  | Kloppen de **winkelgetallen** (verkoop 50%, voorraad, herstel-tijd), moet Marco's winkel wisselen, en komt Tobi the Snow Merchant er (waar)? | Tijdelijk (stap 4.2): `sellRatio` 0,5 (verkoopprijs = winkelprijs x ratio, een handelaar koopt alleen wat hij zelf verkoopt); Marco's 4 gear-items max 2 op voorraad, 1 terug per 600 s speeltijd (potions onbeperkt); voorraad in de save (v17). "Winkel wisselt steeds" niet gebouwd (vaste lijst). Tobi niet toegevoegd (rol/plek onbekend). Alles in `npcs.json` → `shop` |
| 25  | Kloppen de **spellboek-keuzes**? | Tijdelijk (stap 4.3): tweede spell per element automatisch geleerd vanaf level 5 (Ember Burst, Tidal Lash, Bramble Whip, Gale Cutter, Night Lance; iets sterker, 10% duurder); Adept Staff (rare, 2 slots) bij Marco voor 250 gold, voorraad 1; de keuze geldt per personage, niet per staf (een staf met minder slots maakt de extra slots leeg). Brief zei "alleen de 5 bestaande spells", stap zei "meer spells": stap gevolgd. Alles in `spells.json`/`items.json`/`npcs.json` |

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
