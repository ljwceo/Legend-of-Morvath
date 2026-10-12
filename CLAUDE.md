# Legend of Morvath – Master Prompt voor Claude Code

> Plak dit hele bestand in Claude Code. Dit is een levend document: nieuwe fases en wijzigingen worden onderaan toegevoegd (zie "Fase-log" en "Hoe je een fase toevoegt").
> Laatst bijgewerkt: 9 oktober 2026 (met de toevoegingen van Bo in het spelconcept).

---

## 0. Eerste opdracht (doe dit voordat je iets bouwt)

1. Lees de repo `ljwceo/journey-gaym` volledig door. Er staat mogelijk al code van een eerdere PeerJS-netwerktest (geslaagd op 8 oktober 2026). Bewaar die in `/experiments/net-test/` en verwijder niets zonder het te melden. Er staat ook een stijlgids in `docs/art-style`; laat die staan.
2. Sla dit bestand op als `CLAUDE.md` in de root van de repo, zodat je het bij elke sessie automatisch leest. Maak ook `docs/PROGRESS.md` aan (zie §12).
3. Schrijf eerst een kort plan (bestanden, volgorde, risico's) en wacht op mijn akkoord voordat je begint met fase 1.
4. Code, bestandsnamen, variabelen en commentaar in het Engels. Uitleg aan mij in het Nederlands.

---

## 1. Wat we bouwen

**Legend of Morvath** is een co-op progressie-RPG in de browser, gemaakt door Bo en Lucas. Je bent een rondtrekkende mage (of zwaardvechter) op het continent Eryndor. Twee demi-god necromancers, Lucael en Baelor (de Lords of Morvath), verspreiden corruptie; hoe verder je naar het oosten trekt, hoe sterker het kwaad. De wereld speel je solo; samen vechten alleen in raids (later, via PeerJS en een kamercode).

Het volledige spelconcept staat in de Google Doc "Legend of Morvath – spelconcept". Dat concept is de bron voor verhaal, gebieden, skills, gear, NPC's, stats en vijanden. De wereld is **volledig 3D** (Three.js), camera over de schouder (zoals Genshin Impact), vrij lopen in alle richtingen.

**Doel van nu:** een runnende, vloeiende 3D base game. Geen art, geen mooie looks. Alleen placeholders (capsules, kubussen, gekleurd terrein). Wel een stevige technische basis die later alles kan dragen: open wereld, async streaming, data-gedreven systemen, taal, opslaan, grafische standen.

---

## 2. Harde eisen (gelden voor elke fase, altijd)

1. **Altijd vloeiend:** minimaal 60 fps, 120 fps op schermen die dat kunnen. Getest op iPhone (Safari) en pc (Chrome).
2. **Fps-onafhankelijke logica:** spellogica draait op een **vaste tijdstap** (60 Hz) met een accumulator; rendering interpoleert tussen simulatiestappen. Het spel loopt op 60 en 120 fps exact even snel. Nooit snelheden per frame, altijd per seconde.
3. **Gameplay is op elke grafische stand gelijk:** Low, Mid en High verschillen alleen in uiterlijk, nooit in snelheid, bereik, hitboxes of wat je kunt zien van vijanden (geen voordeel in raids).
4. **Geen allocaties in de game loop:** hergebruik vectoren, matrices en objecten. Pooling voor alles wat vaak verschijnt (projectielen, effecten, damage-getallen, vijanden).
5. **Data buiten de code:** alle content en alle balansgetallen in JSON (`/public/data/`). Een nieuwe NPC, item, vijand of zone is alleen data, geen code.
6. **Alle tekst in taalbestanden:** `lang/en.json` en `lang/nl.json`. Geen enkele UI-string hardcoded. Namen (personages, plekken, items, skills, quests) blijven in beide talen Engels. Gesproken stemmen zijn later altijd Engels; ondertitels in de gekozen taal.
7. **Alleen gratis diensten:** GitHub Pages, PeerJS, localStorage. Geen betaalde backend, geen accounts.
8. **Debugmodus:** via `?debug=1` of een toets (F3). Toont fps, frametijd, draw calls, triangles, geheugen (geometries/textures), geladen chunks en zones, spelerpositie, huidige grafische stand, huidig seizoen, en een teleport-menu naar elke zone.
9. **Niet verder bouwen dan de huidige fase.** Wel de basis zo maken dat latere fases erop passen.

---

## 3. Tech stack

- **Three.js** (laatste stabiele versie) met WebGLRenderer.
- **Vite + TypeScript** (strict mode). Build naar `dist/`, deploy via GitHub Actions naar GitHub Pages (let op de juiste `base` in de Vite-config).
- **PeerJS** pas vanaf de co-op fase; netwerkcode los houden van de spelwereld (host-authoritative, zie §11).
- Geen physics-engine in fase 1. Eigen simpele collision (zie §6). Rapier (WASM) mag later als het nodig is.
- Web Workers voor zwaar werk (terreingeneratie, data-parsing van grote chunks).
- Lint/format: ESLint + Prettier. Tests voor pure logica (data-validatie, save-migraties, streaming-beslissingen, seizoensberekening, quality-keuze) met Vitest.

---

## 4. Grafische standen: Low, Mid en High

Alle renderinstellingen hangen aan één `QualityManager` met drie presets in `public/data/quality.json`.

| | Low | Mid | High |
|---|---|---|---|
| Resolutie (pixel ratio) | laag (bijv. 0,75–1) | normaal (1–1,5) | vol (tot 2) |
| Schaduwen | uit | simpel (kleine shadow map) | mooi (grotere map, zachtere randen) |
| Kijkafstand / chunk-ringen | kort | middel | ver |
| Gras, kleine props, effecten | weinig | normaal | veel |
| Antialias | uit | uit/FXAA | aan |
| Fps-doel | 60 | 60 | 120 waar mogelijk |

- **Automatisch kiezen:** bij de eerste start draait een korte benchmark van een paar seconden (bijv. een testscène of de eerste seconden in de wereld) en kiest Low, Mid of High. Opslaan in de save.
- **Automatisch omlaag:** zakt het spel langere tijd (bijv. 5 seconden gemiddeld) onder 60 fps, dan gaat het één stand omlaag met een klein berichtje in beeld. Nooit vanzelf omhoog tijdens het spelen.
- **Zelf kiezen:** in Settings. Kiest de speler zelf, dan staat automatisch aanpassen uit (met een optie "Auto" om het weer aan te zetten).
- Altijd: frustum culling, eigen culling per chunk, **InstancedMesh** voor herhaalde objecten (bomen, rotsen, gras, hekjes), LOD voor terrein en grote objecten (minstens 2 niveaus), mist (Fog) om de kijkafstand te verbergen, en `dispose()` op alles wat ontladen wordt.

---

## 5. Projectstructuur

```
/public
  /data          zones.json, npcs.json, quests.json, items.json, monsters.json,
                 player.json, appearance.json, quality.json, spells.json,
                 skills.json, combos.json, seasons.json, cutscenes.json, triggers.json
  /lang          en.json, nl.json
  /assets        (leeg/placeholders; later glTF + KTX2 textures)
/src
  main.ts
  /core          GameLoop, Time (fixed step), EventBus, StateMachine, Input, Random
  /render        Renderer, QualityManager, CameraRig, DebugOverlay, Pools
  /world         WorldStreamer, Zone, Chunk, Terrain, FloatingOrigin, SpatialHash,
                 Colliders, Triggers, Checkpoints
  /workers       terrain.worker.ts
  /entities      Entity/Component basis, Player, Npc, Companion (Pringle)
  /systems       Movement, Collision, Interaction, (later: Combat, Loot, ...)
  /data          DataLoader, DataValidator, types (TypeScript types per JSON)
  /i18n          I18n (laden, wisselen, fallback naar en)
  /save          SaveManager (versies + migraties)
  /services      SeasonService
  /ui            HUD (fade-systeem), menus, dialoog-venster, virtuele joystick,
                 character creator (HTML/CSS overlay)
  /scenes        Boot, LanguageSelect, CharacterCreate, Title, Intro (stub), World
/docs            PROGRESS.md, ARCHITECTURE.md
/experiments     oude test-code
```

---

## 6. Open wereld en async loading (de kern van fase 1)

### Schaal
- 1 eenheid = 1 meter. Het "echte" Eryndor is ca. 400 km; in-game comprimeren we dat. Startgrootte van de wereld ongeveer 4 × 2,5 km, volledig instelbaar via `zones.json`. Ontwerp het zo dat de wereld later veel groter kan worden.
- **Floating origin:** zodra de speler verder dan ~1000 m van de oorsprong is, schuift de hele wereld terug zodat de speler weer bij (0,0,0) staat.

### Zones
- Elke zone staat in `zones.json`: id, naam (Engels), grenzen (polygoon of rechthoek), level-bereik, placeholder-kleur van het terrein, mistkleur, buren, spawnpunten, checkpoint (positie + soort, zie hieronder), en een lijst met NPC-ids.
- Zones voor fase 1 (posities volgens de kaart in het concept): **Greyhaven** (westkust, met haven en eilandfort in de baai), **The Greenwood of Aerandir** (noordoost van Greyhaven) en **The Mournfen** (zuidoost, langs de kust). De andere zones (Eredhollow, Ruins of Dunmar, Mountains of Karad Vorn, Plains of Tharond, Morvath, Black Citadel, Frozen Lake) bestaan al als data met grenzen en kleur, maar zonder inhoud.
- Zonewissel buiten is **naadloos** (geen laadscherm). Bij het betreden van een zone: korte naambalk in beeld ("The Greenwood of Aerandir"), autosave, en een hook voor muziek/mist-wissel.
- Interieurs en dungeons zijn later aparte "instances" met een kort laadscherm; maak daar nu alleen de interface voor (`enterInstance(id)` / `exitInstance()`).

### Placeholder-inhoud per zone (alleen vormen, geen art)
- **Greyhaven:** stadsmuur met landpoort in het oosten, haven, Market Square aan de rivier, Monastery hoger op de heuvel, Academy hoog in het midden (groot blok met torens), trainingsveld naast de Academy, Garden aan de rivieroever, Forge, Alchemy Lab, The Golden Kettle, aquaduct-brug, wachttoren in het noorden. Gebouwen = blokken met een label in debug.
- **The Greenwood of Aerandir (elfenbos):** veel instanced bomen, kleine riviertjes, **Old Tjikko** als enorme boom in het midden, een elfenstad-gebied (platforms/bruggen in de bomen als simpele blokken), en een **elfenheiligdom** als checkpoint in plaats van een Monastery. Markeer alvast de plek van de dungeon De Wortelgrotten (alleen een ingang-blok, nog geen instance).
- **The Mournfen:** vlak, nat terrein, een Monastery op palen als checkpoint.

### Chunks (streaming binnen zones)
- Wereld verdeeld in vierkante chunks (bijv. 64 × 64 m, instelbaar).
- Rondom de speler: een **actieve ring** (volledig geladen + collision), een **preload-ring** (laden op de achtergrond) en een **unload-ring** met marge (hysterese), zodat chunks niet flikkeren aan de rand. Ringgroottes komen uit de grafische stand.
- Laden is **async en gebudgetteerd:** terrein-heightmaps worden in een Web Worker gemaakt (deterministische noise met een vaste seed + zone-instellingen), teruggestuurd als transferable buffers, en per frame wordt maar een beperkte hoeveelheid werk op de main thread gedaan (bijv. max 2 ms of 1 chunk per frame). Nooit een frame-drop door laden.
- Prioriteit: chunks in de looprichting en dichtbij eerst.
- Chunk-inhoud (bomen, rotsen, gebouwblokken) komt uit data + deterministische scattering per zone; alles als InstancedMesh.
- Nog niet geladen chunks: tijdelijk vlak terrein in de zonekleur, zodat er nooit een gat in de wereld zit.
- Debug: toon chunk-randen en hun status (laden/actief/ontladen) met kleuren.

### Triggers (voor de eerste dag en latere quests)
- `triggers.json`: zones op de grond (cirkel of rechthoek) met een id. Betreden geeft een event op de EventBus (`triggerEntered`, `placeFirstVisited`). Wordt opgeslagen wanneer een plek voor het eerst bezocht is.
- In fase 1 alleen een korte tekstmelding bij het eerste bezoek (bijv. bij de Forge: *"You can trade gold for upgrades or new items."*). Echte cutscenes komen later via `cutscenes.json`.
- **Stadspoort:** in het concept kun je de stad pas uit na Sultan en level 5. Maak de poort nu al een trigger met een voorwaarde (`canLeaveCity`), maar zet de voorwaarde in fase 1 op "altijd waar", zodat ik de andere zones kan testen. Teleporteren in debug werkt altijd.

### Asset-pipeline (klaarzetten, nog geen echte art)
- `AssetManager` met cache, referentie-telling en async laden (GLTFLoader, later met KTX2/Draco).
- Placeholder-fabriek: speler = capsule in de gekozen kleuren (zie §8), NPC = capsule met kleur per rol, Monastery = grijs blok met dak, huizen = blokken, bomen = cilinder + kegel (instanced), Old Tjikko = heel grote boom.
- Wanneer echte modellen komen, vervangen we alleen de placeholder-factory; de rest van de code verandert niet.

---

## 7. Speler, camera, besturing, collision

- **Camera:** third-person **over de schouder, zoals Genshin Impact** (gewijzigd op 2026-10-09; eerst was het schuin van boven). Laag achter de speler, kijkt licht naar beneden, blijft strak bij het karakter (fps-onafhankelijk). Inzoomen met scrollwiel/knijpen binnen grenzen. Gaat niet onder de grond.
- **Camera draaien:** vrij rond de speler, omhoog en omlaag. Pc: één keer klikken in het spel, daarna draait de muis de camera zonder knop (pointer lock, muis verborgen); Escape geeft de muis vrij en pauzeert. Touch: met één vinger slepen buiten de joystick. Gevoeligheid instelbaar in Settings.
- **Camera bij lopen:** de camera blijft waar de speler hem zet; W loopt de kant op waar de camera kijkt. Bij opzij lopen draait de camera licht mee (zoals Genshin). Getallen in config.
- **Lopen:** WASD en pijltjestoetsen op pc; virtuele joystick op touch (linkeronderhoek, verschijnt waar je drukt). Beweging relatief aan de camera, 360°. **Loopsnelheid 4 m/s** (uit `player.json`).
- **Dash:** korte sprong in looprichting (spatie / knop op mobiel). Volgens het concept kost dash **25 energie** en heeft hij **1 seconde cooldown**. Energie: max 100, vult 20 per seconde bij, pas 1 seconde nadat je niets meer doet; zonder genoeg energie geen dash. Alle getallen in `player.json`.
- **Interactie:** E of tik op een NPC/object binnen bereik. Een klein icoontje boven het dichtstbijzijnde interactieve object.
- **Grond:** speler volgt de hoogte van het terrein (heightmap-sample), met helling-limiet.
- **Collision:** statische colliders (cirkels en rechthoeken in het XZ-vlak) in een **spatial hash**; speler is een cirkel die er langs schuift. Colliders worden per chunk in- en uitgeladen. Wereldranden en diep water blokkeren.
- Input-laag abstract (`Input.getMoveVector()`, `Input.isPressed('dash')`) zodat gamepad later makkelijk erbij kan. Touch-knoppen en joystick krijgen vaste "veilige zones" die de HUD nooit mag bedekken.

---

## 8. Systemen die vanaf fase 1 meteen goed moeten

### Taal (i18n)
- Bij de allereerste start: taalkeuze (English / Nederlands) **voor** al het andere. Opgeslagen, later te wijzigen in Settings.
- `t('key', {params})` met fallback naar Engels en een waarschuwing in debug bij een ontbrekende key.
- Een script/test dat controleert of `en.json` en `nl.json` dezelfde keys hebben.

### Personage maken
Na de taalkeuze en vóór de intro (alleen bij New Game). In het midden staat je 3D-poppetje dat langzaam ronddraait; je kunt het ook zelf draaien.
- **Naam:** zelf typen, maximaal 16 tekens, alleen letters en cijfers (valideren).
- **Lichaamstype:** man of vrouw (2).
- **Kapsel:** 5 per lichaamstype.
- **Haarkleur:** 19 opties: rood, oranje, geel (blond), groen, blauw, paars, roze en bruin, elk licht en donker, plus zwart, wit en grijs.
- **Huidskleur:** 6 tinten. **Mantelkleur:** 6 kleuren uit de stijlgids (o.a. navy en paars), altijd met gouden borduursel.
- **Random-knop** die alles willekeurig kiest.
- **Startspullen:** een oud zwaard en een eenvoudige reismantel in de gekozen kleur (nu alleen als data in de save).
- Alle opties in `appearance.json`. **Fase 1:** placeholder-poppetje (capsule-lijf, bol-hoofd, simpele "haar"-vorm en mantel) waarvan de kleuren live meeveranderen. Kapsels en lichaamstypes zijn later aparte 3D-modellen; kleuren worden later alleen andere kleuren op hetzelfde model. Bouw het zo dat het verwisselen van model per keuze alleen data is.
- De naam boven je hoofd zie je nooit van jezelf, alleen van anderen (later, in raids).

### Data + validatie
- `DataLoader` laadt alle JSON-bestanden async bij het opstarten (met laadbalk).
- `DataValidator` controleert alles bij het opstarten: verwijzingen bestaan (een NPC verwijst naar een bestaande zone, een quest naar een bestaand item), ids zijn uniek, verplichte velden aanwezig, getallen binnen redelijke grenzen. In debug: duidelijke foutlijst op het scherm; in productie: logs.
- TypeScript-types voor elk JSON-bestand.
- Maak in fase 1 alle JSON-bestanden aan met een kleine, geldige voorbeeldset. Zet in `player.json` en `monsters.json` alvast de getallen uit het concept (speler level 1: 100 HP, 50 mana, 100 energie, +10 HP en +5 mana per level, XP-curve 100/150/220/300/400/520/660; vijanden Green Slime, Big Slime, Goblin, Goblin Archer, Goblin Chief, Sultan en Treewarden met hun HP, schade, snelheid en XP). Ze worden in fase 1 nog niet gebruikt, maar het schema ligt dan vast.

### Opslaan
- **Eén save.** Alles wordt daarin bewaard. `SaveManager` met localStorage, **versienummer + migraties** (`migrations[v]`).
- **Automatisch opslaan** bij elk checkpoint (Monastery/heiligdom), bij elke nieuwe zone en bij afsluiten (`visibilitychange` / `pagehide`, want iPhone Safari vuurt `beforeunload` niet betrouwbaar).
- **Save verwijderen** alleen via Settings, met twee keer bevestigen. Daarna begin je helemaal opnieuw (ook taalkeuze en personage).
- Toon in Settings een korte waarschuwing dat browsergegevens wissen ook je save wist.
- Opgeslagen in fase 1: taal, grafische stand (+ of die automatisch is), instellingen, personage (naam + uiterlijk + startspullen), spelerpositie + zone, laatste checkpoint, bezochte plekken (triggers), ontmoete NPC's, gespeelde tijd.
- Alleen in debug: save exporteren/importeren als tekstcode (handig voor testen).

### HUD (subtiel)
Het concept wil zo weinig mogelijk in beeld: meestal zie je niets. Bouw in fase 1 het **HUD-systeem**, ook al zijn de meeste balken nog leeg:
- Elk HUD-element kan rustig in- en uitfaden en heeft een reden om zichtbaar te zijn (`show(reason)` / `hide(reason)`).
- Regels uit het concept (klaarzetten, in fase 2 echt gebruiken): Gold rechtsboven alleen bij een shop of als je gold krijgt/kwijtraakt; HP, mana en energie alleen tijdens een gevecht; XP-balk alleen na een verslagen vijand, daarna faden alle balken weer uit; onder 30% HP blijft de HP-balk staan.
- In fase 1 wel zichtbaar: de zonenaam bij binnenkomen, checkpoint-melding, eerste-bezoek-tekst, interactie-icoontje, en (als test) de energiebalk die kort verschijnt bij een dash.
- Op mobiel staat de HUD nooit op de plek van de joystick of de knoppen.
- **Afspraak:** zodra de HUD in de game zit, vraag je Bo en Lucas of ze hem zo willen houden of willen aanpassen.

### NPC's (data-gedreven basis)
- NPC uit `npcs.json`: id, naam, zone + positie, rol, dialoog-keys, optioneel seizoen. Een nieuwe NPC = alleen data.
- Praten opent een simpel dialoogvenster (tekst via i18n, doorklikken). Questlogica komt later; zet alleen de haken klaar (voorwaarden, "wat je nog mist").
- Placeholder-capsules in Greyhaven: Brother Ansel (Monastery), Marco the Merchant (Market Square), Hilda Ironhand (Forge), Professor Fizzwick (Alchemy Lab), Rose the Herbalist (Garden), Old Bertha (The Golden Kettle), Master Brink (Academy), Wizard Sam (kelder onder de Academy; nu gewoon naast de Academy), Sir Garrick (trainingsveld). Plus **Pringle de kat** die de speler volgt (simpel volg-gedrag, aaien = interactie, niet praten).
- In The Greenwood: een paar **Treewardens** als langzaam rondlopende, neutrale placeholders (grote cilinders). In de elfenstad zijn ze later niet aan te vallen; zet daar nu al een vlag voor in de data (`attackable: false` binnen een gebied).

### Checkpoints
- Elke zone heeft een checkpoint met een soort (`monastery`, `elven_shrine`, `stilt_monastery`, ...). Langslopen = nieuw checkpoint (melding + autosave). Bij het bed/heiligdom uitrusten = nu alleen een melding; levens/mana komen in fase 2.

### Seizoenen
- `SeasonService` berekent het seizoen uit de echte datum: **de eerste week van het jaar is Summer**, daarna wisselt het elke week: Summer → Autumn → Winter → Spring → opnieuw. Gebruik ISO-weeknummers en schrijf er een test voor (ook rond de jaarwisseling).
- Geeft ook de tijd tot het volgende seizoen. Debug-knop om het seizoen te forceren. In fase 1 alleen tonen in debug; gameplay-effecten komen later.

### Scenes / game states
`Boot → LanguageSelect (alleen zonder save) → Title (Continue / New Game / Settings) → CharacterCreate (bij New Game) → Intro (stub: 6 tekstpanelen, overslaanbaar) → World` (wakker worden in het Monastery van Greyhaven), plus Pause en Settings als overlay. Een `StateMachine` regelt de overgangen en ruimt alles op bij het verlaten. Bestaat er al een save, dan vraagt New Game eerst of de huidige save overschreven mag worden.

### Settings
Taal, grafische stand (Auto / Low / Mid / High), fps-cap (Auto/60/120), volume (alvast de slider), debugmodus, save verwijderen (2x bevestigen).

---

## 9. Fase 1 – Definition of Done

Fase 1 is af als ik dit allemaal kan doen, op pc én iPhone:

- [ ] De game opent vanaf GitHub Pages, vraagt de eerste keer de taal, toont het titelscherm.
- [ ] New Game opent de character creator: naam (max 16), lichaamstype, kapsel, 19 haarkleuren, 6 huidskleuren, 6 mantelkleuren, random-knop; het draaiende poppetje verandert live mee.
- [ ] Daarna speelt de intro-stub (overslaanbaar) en word ik wakker bij het Monastery in Greyhaven.
- [ ] Ik loop met WASD/joystick rond (4 m/s), kan dashen (kost energie, 1 s cooldown), de camera hangt over mijn schouder zoals in Genshin, ik kan hem vrij rond mezelf draaien (pc: muis zonder knop) en W loopt de kant op waar ik kijk.
- [ ] Bij het eerste bezoek aan een plek in Greyhaven verschijnt een korte uitleg.
- [ ] Ik loop naadloos van Greyhaven naar The Greenwood of Aerandir (met Old Tjikko, riviertjes, elfenstad-gebied, heiligdom) en The Mournfen; de zonenaam verschijnt; er is geen hapering bij het laden van chunks.
- [ ] Ik kan met NPC's praten in het Nederlands en Engels; Pringle loopt mee en is te aaien; Treewardens lopen rond in het bos.
- [ ] Een checkpoint wordt mijn checkpoint; de game slaat automatisch op bij checkpoint, nieuwe zone en afsluiten; Continue zet me terug waar ik was.
- [ ] Save verwijderen in Settings vraagt twee keer om bevestiging en zet me terug naar het begin.
- [ ] Bij de eerste start kiest de game zelf Low, Mid of High; ik kan het in Settings veranderen; bij langdurig < 60 fps gaat hij één stand omlaag met een berichtje.
- [ ] Debugmodus toont fps, draw calls, chunks, grafische stand, seizoen en een teleport-menu. Teleport naar elke zone werkt.
- [ ] Stabiel 60 fps op iPhone, 120 fps op een 120 Hz-scherm (High), en op 60 en 120 Hz loop ik even snel.
- [ ] Na 10 minuten heen en weer lopen groeit het geheugen niet (chunks worden echt ontladen).
- [ ] DataValidator, de taal-key-check en de Vitest-tests (incl. seizoen en save-migratie) slagen.
- [ ] `docs/ARCHITECTURE.md` legt uit hoe streaming, zones, triggers, data, saves en grafische standen werken.

---

## 10. Werkwijze voor Claude Code

1. **Plan eerst**, wacht op akkoord, bouw dan in kleine stappen. Na elke stap: draait het, wat heb ik gedaan, wat kan ik nu testen.
2. **Kleine commits** met duidelijke berichten (Engels), per afgerond onderdeel.
3. **Performance controleren** na elk groot onderdeel (fps, draw calls, geheugen in debug), op alle drie de grafische standen. Wordt iets trager, eerst oplossen.
4. **Vraag het mij** als iets uit het concept onduidelijk is of botst met een harde eis, in plaats van zelf een grote keuze te maken.
5. **Tijdelijke namen:** zie je een placeholder-naam, meld dan dat die nog niet definitief is. Huidige lijst: Hilda Ironhand, Professor Fizzwick, Marco the Merchant, Old Bertha, Brother Ansel, Sir Garrick the Blademaster, ezel Biscuit, De Wortelgrotten (Moerastrol Grimbald), Toren van de Gevallen Leerling (Schaduwmagiër Veyra), Draken-crypte (Botdraak Ashkarn), de baas van The Forgotten Book, de valuta **Gold**, de elfenstad (nog geen naam), **Treewardens**, het lichtwezen in Old Tjikko (nog geen naam). Gebruik ze alleen in data, nooit in code.
6. Houd `docs/PROGRESS.md` bij (zie §12).
7. Testinstructies voor iPhone: hoe ik de dev-server op mijn telefoon open (lokaal netwerk, `vite --host`) of via de Pages-deploy.

### Werken met GitHub (verplicht)
Bo en Lucas werken samen in deze repo en hebben soms verschillende ideeën. Daarom komt niets direct in `main`.
- Per stap of taak een eigen branch (bijv. `fase-1-opzet`, `fix-joystick`). Daar werken en committen.
- Klaar? Branch pushen en een pull request openen. In gewone taal (Nederlands): wat er veranderd is, waarom, en hoe je het test op pc en iPhone.
- Claude mag de pull request zelf samenvoegen (merge) in `main` als de taak af is en de game zonder fouten start (afgesproken op 2026-10-09). Bo of Lucas kan een pull request altijd nog bekijken of tegenhouden door dat te zeggen.
- Verandert er iets aan het concept, de stijlgids of een eerdere beslissing? Zet dat bovenaan in de pull request.

### Spelconcept lezen
Het spelconcept staat in Google Docs: "Legend of Morvath – spelconcept" (id `10Yi8_lYVsLEa_WpR76Exs0ecsY9mXxTk5a6SC4sSKUk`). Lees het via de Google Drive-connector als die beschikbaar is. Zo niet, vraag Bo of Lucas om de relevante tekst.

---

## 11. Vooruitblik (niet bouwen, wel rekening mee houden)

| Fase | Inhoud |
|---|---|
| 1 | **Basis + open wereld + rondlopen + character creator** (dit document) |
| 2 | Solo-gevecht: HP/mana/energie, zwaardaanvallen (fast hit 10 schade / 10 energie met auto-combo, elke 3e slag +50%; heavy hit 25 schade / 25 energie, ~1 s uithalen), eerste vijanden uit `monsters.json`, XP en levels, HUD-regels echt aan, eerste dag in Greyhaven (kleine quest per basis-NPC, ±level 3), baas Pringle/Sultan (800 HP, Claw Combo, Pounce, Dash Strike, Flurry onder 50%, altijd met zwaard), doodgaan (−10% gold, terug naar checkpoint, cutscene overslaanbaar bij herkansing) |
| 3 | Main quest *Your Resolve*: kiezen tussen Sir Garrick, Master Brink en Wizard Sam ("Will you train under me?", nee mag altijd, ja = nog één keer bevestigen), quests tot level 5, stadspoort open. Gear: wapen (zwaard/staf), hoed, mantel, amulet, 2 ringen, 4 zeldzaamheden, gewicht, pakdier Biscuit |
| 4 | Forge, markt, spellboek, kristallen, skill tree |
| 5 | Co-op dungeon/raid via PeerJS (host rekent alles uit, client stuurt alleen input), combo's, namen boven het hoofd van anderen, teammate-icoontje aan de schermrand (buiten joystick/knoppen) |
| 6 | Polish, art-pass (anime/toon-shading in 3D, echte kapsels en lichaamstypes), audio, cutscenes |
| later | Seizoenseffecten, crafting, drogen, Garden, Grimoire, lichtwezen-quest in Old Tjikko (alleen lente), Nature Crystal in de Greenwood, eenmalig overstappen van zwaardvechter naar mage, alle zones |

Ontwerp-afspraken die nu al gelden voor die fases:
- **Entities** met losse componenten, zodat vijanden, NPC's en spelers dezelfde basis delen.
- **Simulatie los van rendering:** de wereldstaat moet te serialiseren zijn, zodat een host hem later kan delen in raids.
- **EventBus** voor dingen als `zoneEntered`, `placeFirstVisited`, `npcTalked`, `checkpointSet`, zodat quests later kunnen meeluisteren zonder bestaande code te wijzigen.
- **Pad van de speler** (`sword` / `light` / `dark`) als veld in de save, nu nog leeg.

---

## 12. Fase-log (levend deel – hier groeit de prompt)

`docs/PROGRESS.md` houdt per fase bij: status, wat gebouwd is, bekende problemen, gemeten fps op iPhone en pc per grafische stand, en besluiten die we onderweg namen.

### Hoe je een fase toevoegt
Voeg onderaan dit bestand een blok toe in dit formaat en zeg tegen Claude Code: *"Lees CLAUDE.md, we beginnen met fase X."*

```
### Fase X – <naam>
Doel: <wat de speler na deze fase kan>
Bouwen: <systemen en content>
Data: <welke JSON-bestanden erbij komen of veranderen>
Niet doen: <wat expliciet buiten deze fase valt>
Definition of Done:
- [ ] ...
```

### Fase 1 – Basis + open wereld + character creator
Status: afgesloten op de pc (2026-10-09): Mid 60 fps en High 120 fps zonder haperingen. iPhone niet gemeten (overgeslagen op verzoek). Details in `docs/PROGRESS.md`.

### Fase 2 – Solo-gevecht en de eerste dag
Status: alle stappen gebouwd (2.1 t/m 2.7, 2026-10-10); wacht op spelen en fps meten op de pc door Bo en Lucas. Extra (2026-10-10, Bo): Greyhaven uit Blender als eerste zone, dag-en-nachtcyclus en mobs bij nacht. Details en de Definition of Done in `docs/PROGRESS.md`.
Doel: het speelbare intro-gevecht tegen Lucael en Baelor (onwinbaar, episch en komisch), de eerste dag in Greyhaven spelen (kleine quest per basis-NPC, ±level 3), in de Greenwood vechten tegen slimes en goblins, en Sultan verslaan (beginnersbaas: test of je de basis snapt).
Bouwen: HP/mana/energie, zwaardaanvallen (muis: links fast hit, rechts heavy hit; telefoon: knoppen), vijanden met AI en spawngebieden (Green Slime, Big Slime, Goblin, Goblin Archer, Goblin Chief, Treewarden), XP en levels, buit en een simpele tas, drankjes, doodgaan en rusten, HUD-regels aan, questsysteem met de quests van de eerste dag (Marco en Hilda in een simpele versie), cutscene-speler, speelbaar intro-gevecht (paneel 4), baasgevecht Sultan met hints de eerste keer.
Data: `player.json` (aanvallen, regen, level-bonussen), `monsters.json` (gedrag, waarschuwingen, buit), `zones.json` (spawngebieden), `quests.json`, `npcs.json`, `items.json` (drankjes, Slime Gel), `cutscenes.json`, `triggers.json` (poortvoorwaarde), save versie 3.
Niet doen: klassekeuze, staf, spells, kristallen, gear, Biscuit (fase 3); echte Forge, markt, skill tree (fase 4); co-op (fase 5). Speciale aanvallen komen later op eigen toetsen/knoppen.
Afspraken: Sultan vecht je vóór de klassekeuze; de stadspoort gaat pas open na de klassekeuze (fase 3) en blijft tot dan open om te testen. Testen op de pc.
Definition of Done:
- [ ] Ik kan met de muis (en op de telefoon met knoppen) fast en heavy hits doen; energie, combo en schade kloppen met het concept.
- [ ] In de Greenwood lopen slimes en goblins rond, vallen aan en verschijnen opnieuw; de Treewarden valt alleen terug aan en is in de elfenstad niet aan te vallen.
- [ ] Ik krijg XP, ga levels omhoog (balken en XP volgens de HUD-regels), krijg buit en kan een drankje drinken.
- [ ] Doodgaan kost 10% gold en ik word wakker bij mijn checkpoint; rusten in bed maakt HP en mana vol.
- [ ] De vijf quests van de eerste dag werken in het Nederlands en Engels en brengen me rond level 3.
- [ ] De intro heeft een speelbaar gevecht tegen Lucael en Baelor: ik kan bewegen en slaan maar niet winnen, ze overrompelen me op een komische manier, daarna word ik wakker in het Monastery. Overslaanbaar.
- [ ] Sultan: de cutscene speelt (overslaanbaar), het gevecht leert en test de basis (duidelijke waarschuwingen, momenten om te slaan, hints de eerste keer), en verliezen of winnen werkt.
- [ ] Alles blijft 60/120 fps op de pc, ook met veel vijanden, en is op elke grafische stand gelijk.
- [ ] Tests (gevechtsformules, XP, quests, save-migratie) en de DataValidator slagen.

### Fase 3 – Je pad, Entrance Exam en gear
Status: plan goedgekeurd (2026-10-10); stap 3.0 t/m 3.4 gebouwd (3.3: toren van Brink en kelder van Sam als instances uit het Blender-model, via PR #34 in `main`; 3.4: *Your Resolve*, je pad kiezen). Details, keuzes en stappen in `docs/PROGRESS.md`.
Doel: na Sultan kies je in de Academy je pad (Sir Garrick, Master Brink of Wizard Sam), doet zijn Entrance Exam tot level 5 en kunt daarna de stad uit. Je draagt gear met gewicht (draaglast zoals Elden Ring) en ezel Biscuit draagt je extra spullen. Een mage vecht met staf, kristal, Arcane Shard en één spell, met lock-on.
Bouwen: debugvenster in groottes + cheats zonder venster; gear (6 slots, 4 zeldzaamheden, stats) en draaglast (licht/middel/zwaar/overbelast); Biscuit met pakdier-tas (spullen erop zijn niet bruikbaar tot je ze eruit haalt); instances via deur/portaal (Academy-hal, kelder van Sam) met cutscene bij de eerste keer; keuzedialoog Your Resolve; staf-gevecht (Arcane Shard, 5 spells met reisafstand, lock-on, richthulp in het cheatmenu); Entrance Exams, pad-effecten, Crystal Ceremony, poort open.
Data: `items.json` (gear, staven, zwaarden, gewicht, stats), `player.json` (draaglast, perks, lock-on, richthulp), `npcs.json` (Biscuit, keuzes), `quests.json` (Your Resolve + exams), `spells.json`, `monsters.json` (gear-buit), `cutscenes.json` (Crystal Ceremony, uitleg Brink/Sam), `instances.json` (nieuw), `triggers.json` (poort, deuren), save versie 6+.
Niet doen: skill tree, spellboek, kristallen mergen/renderen, echte Forge en markt (fase 4); co-op (fase 5); Warrior/Berserker, Old Rivals, Grimoire, Nine Lives (later). De naam Ruben komt nergens voor tot Old Rivals.
Definition of Done:
- [ ] Het debugvenster heeft groottes (ook verborgen) en het cheatmenu werkt ook als het venster verborgen is.
- [ ] Na Sultan kies ik in de Academy mijn pad: nee mag altijd, ja vraagt nog één keer; de keuze staat in de save.
- [ ] Door een deur ga ik naar de Academy-hal en de kelder van Sam (kort laadscherm); de eerste keer legt Brink/Sam zijn magie uit; weggaan zet me terug en de kaart wordt opgeruimd.
- [ ] De Entrance Exam van elke leraar werkt in NL en EN, brengt me naar level 5 en opent daarna de stadspoort.
- [ ] Zwaardvechter: beter zwaard, geen mana, perks. Mage: staf met kristal (Crystal Ceremony), Arcane Shard en één spell die werken; licht en duister volgen hun krachtcurve.
- [ ] Lock-on werkt; schoten kunnen missen bij een vijandaanval of als ik te ver wegkijk; de richthulp is in het cheatmenu aan te passen.
- [ ] Gear in 6 slots en 4 zeldzaamheden; draaglast maakt me trager (licht/middel/zwaar/overbelast) zoals in het plan.
- [ ] Biscuit loopt mee en draagt spullen; wat op Biscuit ligt kan ik pas gebruiken als ik het eruit haal.
- [ ] Alles blijft 60/120 fps op de pc en is op elke grafische stand gelijk; geheugen groeit niet bij instances in en uit.
- [ ] Tests (draaglast, lock-on/missen, keuzes, quests, save-migratie) en de DataValidator slagen.
