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
Status: plan goedgekeurd (2026-10-10); stap 3.0 t/m 3.5 gebouwd (3.3: toren van Brink en kelder van Sam als instances uit het Blender-model; 3.4: *Your Resolve*, je pad kiezen; 3.5: vechten met een staf en lock-on). Details, keuzes en stappen in `docs/PROGRESS.md`.
Opgesplitst (2026-10-12, Bo): het restant gaat verder als **fase 3.6 t/m 3.10** onderaan dit bestand, elk in een eigen chat. De oude stap 3.6 (exams) is nu fase 3.8 en de oude stap 3.7 (afronden) is nu fase 3.10.
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

### Besluiten van 2026-10-12 (Bo) – fase 3 wordt opgesplitst
Fase 3 bleek te groot voor één reeks, en er kwamen drie nieuwe wensen bij. Het restant van fase 3 is daarom opgesplitst in **fase 3.6 t/m 3.10** (elk in een eigen chat, elke stap een eigen pull request). Wat de stappen 3.0 t/m 3.5 betreft verandert niets; die zijn gebouwd.

Nieuwe afspraken die vanaf nu overal gelden:
1. **Elke knop is zelf in te stellen** (buttonmapping), net als in een gewone pc-game. Ook de lock-knop en "doel wisselen".
2. **Lock-on werkt als in Elden Ring:** een klein **wit puntje met een dun ringetje** op het midden van de vijand (niet door muren heen te zien). Locken kan alleen op een vijand die dichtbij genoeg is **en te zien is**; komt er iets tussen **de camera** en de vijand, dan stopt de lock. Doel wisselen met een eigen knop.
3. **Levels zijn een puntensysteem, geen automatische groei.** Je begint met **20 punten** die je in de character creator verdeelt over tien stats (HP, Defense, Strength, Power, Mana, Magic Power, Regen, Dexterity, Faith, Luck) en **elk level geeft 1 punt**. De automatische +10 HP en +5 mana per level en de schade per level verdwijnen: alles komt uit je punten, je gear en je perks. Punten komen **alleen** uit XP-levels.
4. **Gold is alleen voor spullen:** items, drankjes, zwaarden, staven, gear. Je kunt er nooit stats of punten mee kopen.
5. **De stat-punten van `skills.json` (`core`, met de tegenstellingen en 1–2 punten per level) vervallen** en worden deze tien stats, 1 punt per level voor iedereen. De skill tree van fase 4 gaat daarna alleen nog over **skills en perks**, niet meer over losse statpunten.
6. **Faith** hoort bij bepaalde magie; **lichtmagie komt later in het spel** en is extra effectief tegen duistere vijanden. Duister houdt zijn eigen krachtcurve (sterk aan het begin, later zwakker).
7. **Eieren:** er zijn **10 vindbare eieren** in het spel, elk eenmalig bij een **mini-boss** op een vaste plek, plus **het ei van Sultan** (van het baasgevecht zelf). Een ei lever je bij Sultan in om **al je punten opnieuw te verdelen** (je level en je pad blijven).

### Fase 3.6 – Buttonmapping en lock-on (Elden Ring-stijl)
Doel: ik kan elke toets en muisknop zelf instellen, en lock-on voelt als Elden Ring: een klein wit puntje op de vijand, dat verdwijnt zodra er iets tussen mijn camera en hem staat.
Bouwen: mapping-laag in `Input` met standaardbindingen uit data en eigen bindingen in de save, twee bindingen per actie (W én pijltje), muisknoppen even goed bindbaar als toetsen, **Settings → Besturing** ("druk een toets…", conflicten afpakken met melding, Terug naar standaard), alle hint-teksten via `{key}` zodat ze de ingestelde toets tonen; lock-on-marker als **wit puntje met dun ringetje** op het midden van de vijand (altijd even groot op het scherm, niet door muren heen), **zichtcheck van de camera naar de vijand** (straal tegen de MeshBVH van Greyhaven of terrein + gebouwen in de open wereld; gras, klimop, water en kleine props blokkeren niet) met een tolerantie van 0,2 s tegen geknipper, **doel wisselen** op een eigen knop, alle getallen cheat-baar.
Data: `controls.json` (nieuw: standaardbindingen), `player.json` (`lockOn`: marker, zicht, tolerantie, wisselen), `lang/en.json` + `nl.json` (actienamen, Besturing, `{key}`-teksten), save versie 9 (`settings.keybindings`).
Niet doen: gamepad (de mapping maakt het later makkelijk), stats, exams, eieren.
Definition of Done:
- [ ] In Settings → Besturing stel ik elke actie in op een toets of muisknop; een bezette toets wordt bij de oude actie weggehaald met een melding; Terug naar standaard werkt; het blijft bewaard na herladen.
- [ ] Alle hints in het spel noemen de toets die ík heb ingesteld.
- [ ] Lock-on zet een klein wit puntje met een dun ringetje op het midden van de vijand, even groot dichtbij en ver weg, op elke grafische stand gelijk.
- [ ] Ik kan alleen locken op een vijand die dichtbij genoeg is en te zien is; loopt er een huis, boom of muur tussen mijn camera en hem, dan stopt de lock.
- [ ] Doel wisselen met mijn eigen knop pakt de volgende zichtbare vijand.
- [ ] 60/120 fps blijft gelijk; tests (mapping, conflicten, zichtstraal, tolerantie in seconden, wisselen, save 8 → 9) en de DataValidator slagen.

### Fase 3.7 – Stats en builds (puntensysteem)
Doel: ik bouw mijn eigen personage: 20 punten aan het begin, 1 punt per level, tien stats met zachte grenzen, en een statusvenster waarin ik alles zie.
Bouwen: `stats.json` met de tien stats en wat één punt doet, met **zachte grenzen (soft caps)** zoals Elden Ring; punten verdelen in de **character creator** (nieuwe stap met het poppetje erbij: vrij verdelen, Random, en drie startvoorstellen zwaardvechter / lichtmage / duistere mage, live te zien wat het met je HP, schade en mana doet); **1 punt per level**, alleen uit XP; **statusvenster** op een eigen instelbare toets (level, ongebruikte punten, je stats, en wat gear en perks erbovenop doen), punten besteden kan altijd behalve in een gevecht; de automatische groei per level (`perLevel`, `sword.damagePerLevel`, `staff.shard.damagePerLevel`) eruit en in de stats; `skills.json` → `core` vervalt.
Data: `stats.json` (nieuw), `player.json` (startwaarden, geen groei per level meer), `skills.json` (core eruit, perks blijven), `lang/*.json`, save versie 10 (`character.stats` + ongebruikte punten; oude saves krijgen `20 + (level − 1)` punten ongebruikt met een melding).
Niet doen: skill tree en skills (fase 4), eieren en herverdelen (fase 3.9), nieuwe spells.
Definition of Done:
- [ ] Een nieuw spel laat me 20 punten verdelen (vrij, Random of een startvoorstel) en het poppetje draait er gewoon bij.
- [ ] Elk level geeft precies 1 punt; gold kan nooit punten of stats kopen.
- [ ] Alle tien de stats doen wat `stats.json` zegt, met zachte grenzen, en gear en perks komen erbovenop.
- [ ] Het statusvenster opent op mijn eigen toets en laat zien wat elke stat me geeft; in een gevecht kan ik niets besteden.
- [ ] Een gemiddelde build is ongeveer zo sterk als de speler nu; een extreme build voelt anders maar niet gebroken.
- [ ] Oude saves houden hun level en krijgen hun punten ongebruikt terug met een melding.
- [ ] 60/120 fps gelijk; tests (puntentelling, zachte grenzen, HP/mana/schade-formules, migratie) en de DataValidator slagen.

### Fase 3.8 – Entrance Exams, je pad en de stadspoort
Status: gebouwd op 2026-10-13 (negen exams, `train`-doel, pad-effecten met de drie perks, Crystal Ceremony per leraar, poort na Sultan + exam, save 12); wacht op spelen door Bo en Lucas. Details in `docs/PROGRESS.md`.
Doel: na mijn keuze doe ik de Entrance Exam van mijn leraar tot level 5, krijg wat mijn pad me geeft, en daarna gaat de stadspoort open.
Bouwen: **drie exam-quests per leraar** (9 in totaal, alleen voor je eigen pad, elk de volgende pas na de vorige, in EN en NL; opbouw: iets leren bij je leraar → het gebruiken in de Greenwood → terugkomen en voordoen), één nieuw doel-type `train` ("raak de trainingspop N keer", bij Brink en Sam met een opgeladen spreuk); **pad-effecten**: zwaardvechter een beter zwaard, geen mana (manabalk weg), 115% kracht en de perks Iron Body / Battle Hardened / Swift Blade (bestaan al als data, werken nog niet; `attackSpeedPercent` moet in de zwaai-tijden), mage de **Mage Staff** + **Crystal Ceremony** als stripcutscene (Brink: willekeurig Water/Fire/Nature/Wind, Sam: Dark) met het kristal in de save; `canLeaveCity` wordt **Sultan verslagen + exam klaar**.
Data: `quests.json` (9 exams), `npcs.json`, `items.json` (beter zwaard), `skills.json` (perks aan), `cutscenes.json` (Crystal Ceremony), `spells.json`, `triggers.json` (`canLeaveCity`), `lang/*.json`, save versie +1 (kristal).
Niet doen: skill tree, spellboek en meer spells, kristallen mergen, Forge en markt (fase 4); eieren (fase 3.9).
Definition of Done:
- [ ] De drie exams van elke leraar werken in NL en EN en brengen me van ±level 3 naar level 5 (520 XP).
- [ ] Zwaardvechter: beter zwaard, geen mana, 115% kracht en de drie perks werken echt (HP, schade die ik krijg, aanvalssnelheid).
- [ ] Mage: de Crystal Ceremony speelt (overslaanbaar), ik krijg mijn staf met kristal en de bijbehorende spreuk; licht en duister volgen hun krachtcurve.
- [ ] Na de exam gaat de stadspoort open; daarvoor niet, met de bestaande melding. Teleport in het cheatmenu blijft altijd werken.
- [ ] 60/120 fps gelijk; tests (exams, perks, kristal in de save, poortvoorwaarde) en de DataValidator slagen.

### Fase 3.9 – Eieren, mini-bosses en opnieuw verdelen
Doel: ik vind eieren bij mini-bosses en lever er één in bij Sultan om mijn hele build opnieuw te verdelen.
Bouwen: **10 vindbare eieren**, elk eenmalig bij een **mini-boss** op een vaste plek (data: plek, mini-boss, ei; eenmalig, dus in de save), plus het **ei van Sultan** uit het baasgevecht; eieren wegen niets en zijn niet te gebruiken, alleen in te leveren; **Sultan na zijn gevecht** (hij staat al bij de oostmuur): praat je met een ei in je tas, dan vraagt hij "Alles opnieuw verdelen? Dat kost één ei." met Ja/Nee en nog één keer bevestigen; hij geeft **al je punten vrij** (level, pad, gear en quests blijven) en je verdeelt ze opnieuw in hetzelfde venster als in de character creator; event `statsReset`.
Data: `items.json` (eieren), `monsters.json` (mini-bosses), `zones.json` (hun plekken), `npcs.json` (Sultan als inleverpunt), `lang/*.json`, save versie +1 (welke eieren gevonden zijn).
Niet doen: nieuwe dungeons, eieren kopen bij Marco, pad opnieuw kiezen (dat kan nooit).
Definition of Done:
- [ ] Er zijn 10 mini-bosses met elk eenmalig een ei, plus het ei van Sultan; een gevonden ei komt nooit terug.
- [ ] Met een ei verdeel ik bij Sultan al mijn punten opnieuw; zonder ei of zonder hem verslagen te hebben kan het niet, en niet in een gevecht.
- [ ] Mijn level, pad, gear en quests blijven na het herverdelen precies gelijk; het ei is op.
- [ ] 60/120 fps gelijk; tests (eenmalige drop, herverdelen houdt het totaal gelijk, kosten, voorwaarden) en de DataValidator slagen.

### Fase 3.10 – Afronden fase 3
Doel: fase 3 is af, gemeten en opgeschreven.
Bouwen: balans nameten met een nagebootste speler (zwaard, licht en duister, en een paar extreme builds), Meet 20 s op de pc (en iPhone als dat lukt) op Low, Mid en High, geheugen controleren (ook instances in en uit en 10 minuten heen en weer lopen), `docs/ARCHITECTURE.md` en `docs/PROGRESS.md` bijwerken.
Data: alleen bijschaven van bestaande getallen.
Niet doen: nieuwe systemen.
Definition of Done:
- [ ] 60 fps op Mid en 120 fps op High op de pc, gameplay gelijk op elke stand.
- [ ] Geen geheugengroei na 10 minuten lopen en na instances in en uit.
- [ ] Balans: geen build die alles kapot slaat of nergens doorheen komt.
- [ ] Alle tests, de taal-key-check en de DataValidator slagen; de documentatie klopt met de code.

### Fase A – Personage-animaties (Mixamo + eigen cape)
Status: prompt opgeslagen (2026-10-12, Bo); nog niets gebouwd. Elke chat een eigen branch + pull request.
Werkwijze: begin een chat met *"Lees CLAUDE.md. We doen Fase A, Chat X."* Volgorde: Chat 1 → (Bo: Mixamo, Deel B in `tools/blender/character/README.md`, komt in Chat 1) → Chat 2 → Chat 3 → Chat 4. Chat 5 (rennen + springen) heeft geen Blender nodig en mag al eerder of tegelijk.

#### Deel A – Context (geldt voor elke chat van fase A)

**Wat we bouwen.** De speler krijgt vloeiende animaties: idle, lopen, rennen, sprinten, springen (afzet, in de lucht, landen), dashen, zwaardaanvallen (3 combo-slagen, heavy windup + slag), spreuken (opladen + loslaten), geraakt worden, doodgaan en interacteren. Plus een cape die vanzelf wappert.

**De gekozen aanpak (besloten op 2026-10-12)**
- **Mixamo** (gratis, Adobe) doet het skelet en het lijf: auto-rig + de meeste animaties.
- **De cape maken we zelf:** extra cape-botten aan het Mixamo-skelet, weight-painted in Blender. In de game bewegen die botten met code ("spring bones"), dus nooit met de hand animeren.
- **Hoed, haar en zwaard** hangen stijf aan een bot (`Head`, `RightHand`), zonder skinning.
- Later kan het lijf vervangen worden door een gekocht stylized basismodel; de stappen blijven dan hetzelfde, alleen begint Chat 1 met dat model.

**Hoe het nu in de repo zit (gecontroleerd op 2026-10-12)**
- `public/zones/greyhaven/player.glb` = 24 losse stijve stukken (Torso, Neck, Head, Hair, Shoulder_L/R, Arm_L/R, Hand_L/R, Belt, Leg_L/R, Boot_L/R, Cloak, Cloak_Trim, Collar_Trim, Hat, Hat_Band, Hat_Brim, Sword_Blade/Grip/Guard). Geen skelet, geen skin, geen animaties.
- Komt uit `Greyhaven.blend` (staat niet in de repo; Bo heeft hem lokaal), collectie `StartCharacter`, via `tools/blender/export_web.py` met `export_animations=False` en `export_apply=True` (dat laatste bakt een armature weg).
- `src/world/scene/ScenePlayerModel.ts` laadt het model, zet de toon-shader erop en kleurt materialen via de character creator: `Cloak_Navy`/`Hat_Navy` → mantle, `Gold_Trim` → embroidery, `Hair` → hair, `Skin` → skin. **Deze materiaalnamen moeten blijven bestaan.** `Sword_*`-nodes worden verborgen; de game tekent nu zelf een zwaard met `PlaceholderFactory.setSwordPose()` (rest / fast / windup / heavy).
- De toon-shader (`src/render/toon/ToonMaterial.ts`) is een eigen ShaderMaterial **zonder skinning**. Een SkinnedMesh vervormt daarmee niet. Moet erbij (Chat 3).
- Alleen in Greyhaven wordt `player.glb` gebruikt (`WorldState` → `buildPlayerModel` → `CharacterModel.useModel`). In de open wereld en in `IntroFightState` staat nog het placeholder-poppetje.
- `Player.syncModel(alpha)` interpoleert positie en heading; `showSword()` / `showStaff()` tekenen het wapen.
- Beweging (`src/systems/Movement.ts`, `player.json`): alleen lopen (4 m/s), draaien (720°/s) en dashen (4 m in 0,18 s, energie, cooldown, "fat roll" bij zware last). Geen rennen, geen springen. Zwaartekracht alleen bij van een rand vallen (`GroundedMover`).
- Gevecht: `CombatState` (swing, swingTime, heavyWindup, combo elke 3e slag), `StaffState.progress` (opladen 0–1), `castMoveFactor`, `heavyMoveFactor`.
- Acties in `controls.json`: moveForward/Back/Left/Right, attack, heavy, dash, interact, potion, bag, status, lock, lockSwitch, confirm, down.

**Regels voor deze fase (bovenop de harde eisen in §2)**
1. **Animatie is alleen render-kant.** Hij leest de simulatie (`MoverState`, `CombatState`, `StaffState`) en stuurt die nooit. Geen hitbox, snelheid of timing hangt af van een animatie. Zo blijft het gelijk op 60/120 fps en op Low/Mid/High.
2. **Alles in place, geen root motion.** De simulatie verplaatst het personage al. Clips die toch verschuiven: de horizontale beweging van `Hips` eruit filteren.
3. **Data buiten de code:** clipnamen, fade-tijden, referentiesnelheden en cape-getallen in `public/data/animations.json` (nieuw, met zod-schema en DataValidator-checks).
4. **Geen allocaties per frame** in de animator en de spring bones.
5. **Mixamo-licentie:** de ruwe Mixamo-FBX-bestanden komen **niet** in de (publieke) repo. Bewaar ze buiten de repo of in `art-source/` (in `.gitignore`). Alleen de geëxporteerde `player.glb` gaat in git.
6. Code, bestandsnamen en commentaar in het Engels; uitleg aan Bo in het Nederlands. Eigen branch per chat + pull request, zoals in §10.

**Clipnamen (overal precies deze namen gebruiken)**

| Groep | Clips |
|---|---|
| Basis | `Idle`, `Walk`, `Run`, `Sprint` |
| Springen | `Jump_Start`, `Jump_Air` (lus), `Land` |
| Dash | `Dash`, `Dash_Recover` |
| Zwaard | `Slash_1`, `Slash_2`, `Slash_3`, `Heavy_Windup`, `Heavy_Strike` |
| Staf | `Cast_Gather` (lus), `Cast_Release` |
| Overig | `Hit`, `Death`, `Interact` |

#### Deel C – Opdrachtblokken per chat

##### Chat 1 – Lijf klaarmaken voor Mixamo (Blender)
Doel: een FBX van alleen het lijf die Mixamo goed kan riggen.
Bouwen: `tools/blender/character/01_prep_mixamo.py` (zelfde stijl als de andere `tools/blender`-scripts, draait met `blender -b Greyhaven.blend --python ...`):
- Kopieer de lijfstukken uit `StartCharacter` (Torso, Neck, Head, Shoulder_L/R, Arm_L/R, Hand_L/R, Belt, Leg_L/R, Boot_L/R) en voeg ze samen tot één mesh `Body`. Niet meenemen: Hair, Hat*, Cloak*, Collar_Trim, Sword_* (die komen in Chat 2 terug).
- Controleer de pose: hangen de armen recht naar beneden, zet ze in de kopie in een A-pose (±45°), anders kan Mixamo de polsen en ellebogen niet goed vinden.
- Transforms toepassen, voeten op 0, gezicht naar Blender −Y (zoals Mixamo verwacht), schaal in meters. Materiaalnamen (`Skin`, enz.) houden.
- Exporteer `body_for_mixamo.fbx` naar een map buiten de repo.
- Voeg `art-source/` toe aan `.gitignore`.
- Schrijf in `tools/blender/character/README.md` hoe je het draait en wat Deel B (Mixamo, door Bo) is.
Niet doen: game-code aanpassen, iets exporteren naar `public/`.
Definition of Done:
- [ ] `body_for_mixamo.fbx` bestaat, is één mesh in A-pose, zonder hoed/haar/cape/zwaard.
- [ ] Mixamo accepteert hem en de preview buigt zonder rare vervormingen (Bo test).

##### Chat 2 – Mixamo terug in Blender: rig, cape, export
Doel: een nieuwe `player.glb` met skelet, skin, cape-botten en alle clips uit de tabel.
Bouwen: `tools/blender/character/02_import_mixamo.py` + aanpassing in `export_web.py`:
- `body_rigged.fbx` en alle animatie-FBX's importeren; schaal ×0,01 toepassen (Mixamo werkt in cm); botnamen `mixamorig:Hips` → `Hips` (de dubbele punt geeft problemen in Three.js); elke animatie wordt één Action met de clipnaam uit Deel A.
- Horizontale verplaatsing van `Hips` uit alle clips filteren (alleen de hoogte houden). Clips inkorten waar nodig: `Dash` ±0,18–0,25 s, `Heavy_Windup` past bij `windupSeconds` 0,9 s, `Cast_Gather` als nette lus.
- Hair, Hat, Hat_Band, Hat_Brim stijf aan bot `Head`; Sword_* stijf aan `RightHand` (grip in de hand, kling recht).
- Cape: Cloak, Cloak_Trim, Collar_Trim terug. Voeg 3 kettingen van 3 botten toe (`Cape_L1-3`, `Cape_M1-3`, `Cape_R1-3`), geparent aan `Spine2`. Weights: bovenrand op Spine2/schouders, de rest verloopt over de cape-botten. Cape-botten zitten in geen enkele clip.
- Materiaalnamen behouden (`Cloak_Navy`, `Hat_Navy`, `Gold_Trim`, `Hair`, `Skin`, `Outline`) zodat de character creator blijft werken. Zelfde oriëntatie en voethoogte als de huidige `player.glb`, zodat `ScenePlayerModel` niet hoeft te draaien.
- `export_web.py` (alleen het speler-deel): `export_animations=True`, armature + skin mee, geen `export_apply` op de armature (transforms vooraf toepassen), alle Actions als losse animaties. Controleer of Draco werkt met de skin; zo niet, Draco uit voor `player.glb`.
- Een korte check die uitprint: aantal botten, driehoeken (doel ≤ 30.000), clips met duur, bestandsgrootte (doel ≤ 2 MB).
Niet doen: game-code (behalve als de oude game door de nieuwe glb kapot gaat: dan alleen het minimale om hem weer te laten starten).
Definition of Done:
- [ ] `player.glb` heeft skelet + skin + alle clips met de juiste namen; cape-botten zonder animatie.
- [ ] In Blender: elke clip afspelen, niets glijdt weg, hoed/haar/zwaard bewegen mee, de cape gaat mee met het lijf.
- [ ] De game start nog in Greyhaven (het model mag nog in bind-pose staan).

##### Chat 3 – PlayerAnimator in de game
Doel: het personage speelt de juiste animatie, vloeiend overgaand, perfect in sync met het gevecht.
Bouwen:
- **Skinning in de toon-shader** (`ToonMaterial.ts`, ook de Outline): de skinning-chunks van Three.js toevoegen (`skinning_pars_vertex`, `skinbase_vertex`, `skinning_vertex`, `skinnormal_vertex`) zonder dat statische meshes duurder worden.
- `ScenePlayerModel.ts`: SkinnedMesh behouden, de Blender-`Sword_*` aan `RightHand` zichtbaar (voor zwaard én staf, afhankelijk van het wapen), de clips doorgeven.
- Nieuw `src/render/PlayerAnimator.ts`: een `AnimationMixer` + kleine state machine (Idle, Walk, Run, Sprint, Jump, Fall, Land, Dash, Dash_Recover, Attack, Cast, Hit, Death, Interact) die elke render-frame de simulatie leest:
  - Crossfades 0,15–0,25 s (uit `animations.json`).
  - Loop-snelheid gekoppeld aan echte snelheid (`timeScale = snelheid / referentiesnelheid`) zodat voeten niet glijden; snelheid uit de geïnterpoleerde positie.
  - **Aanvallen op voortgang, niet op tijd:** `action.time = progress × duur`, met progress uit `CombatState`/`StaffState` (net als `setSwordPose` nu). Zo valt de slag altijd samen met de hitbox, ook met `attackSpeedFactor`, input buffer en `noEnergySlowdown`. Combo: Slash_1 → 2 → 3.
  - Bovenlijf apart voor casten tijdens lopen (`castMoveFactor`): een kopie van de cast-clip met alleen de bovenlijf-botten, bovenop de loopclip van de benen.
  - Licht leunen bij scherp draaien en remmen.
- Placeholder-poppetje (open wereld, intro-gevecht) houdt `setSwordPose` als terugval, achter dezelfde interface.
- Debug (F3): huidige animatie-state + clip; cheatmenu: elke clip los afspelen.
- `public/data/animations.json` + schema + validator.
Niet doen: cape-beweging (Chat 4), nieuwe gameplay (Chat 5).
Definition of Done:
- [ ] Idle/lopen/dashen/zwaard/staf zien er vloeiend uit, zonder glijdende voeten, op 60 en 120 fps gelijk.
- [ ] De zwaardslag raakt visueel op hetzelfde moment als de schade.
- [ ] Draw calls en fps gelijk of nauwelijks anders op Low/Mid/High; geen allocaties per frame.
- [ ] Tests voor de state-keuze (pure functie) slagen; headless Chromium zonder fouten.

##### Chat 4 – Wapperende cape (spring bones)
Doel: de cape zwiept na bij lopen, rennen, dashen, springen en stilstaan, en gaat niet door de benen.
Bouwen: `src/render/SpringBones.ts`:
- Per cape-bot: een punt met stijfheid, demping, zwaartekracht en een maximale hoek; de ketting volgt het lijf met vertraging.
- Botsbollen op heupen en bovenbenen (en rug), zodat de cape er niet doorheen gaat.
- **Fps-onafhankelijk:** de veren draaien op een eigen vaste substap (bijv. 120 Hz met accumulator), zodat de cape op 60 en 120 fps precies hetzelfde beweegt. Na een teleport of respawn: resetten, geen zwiep door de hele wereld.
- Getallen in `animations.json` (`cape`), cheat-baar om af te stellen.
- Pure logica testen (stap, demping, botsing, reset).
Niet doen: echte cloth-simulatie, physics-engine.
Definition of Done:
- [ ] De cape hangt stil bij idle, wappert bij rennen/dashen, zweeft even na bij springen, valt na de landing terug.
- [ ] Geen cape door de benen bij rennen of dashen.
- [ ] Even mooi op 60 en 120 fps; geen fps-verlies op de iPhone.

##### Chat 5 – Rennen, sprinten en springen (simulatie)
Doel: de speler kan rennen/sprinten en springen, met hetzelfde gevoel op elk scherm.
Bouwen (gameplay, dus op de vaste stap, met tests):
- `player.json`: `sprint` (speed, energyPerSecond) en `jump` (heightMeters, gravity, coyoteSeconds ±0,1, bufferSeconds ±0,12, airControl).
- `MoverState`: vy, grounded, sprinting, coyoteTime, jumpBuffer. `GroundedMover`: echte verticale snelheid in plaats van alleen vallen.
- Draaglast: sprong en sprint schalen mee met de load tier; overloaded = niet sprinten of springen.
- `controls.json`: acties `jump` en `sprint` met standaardtoetsen (bijv. Spatie, Shift; check botsing met dash), TouchControls-knoppen, `lang/en.json` + `nl.json`. Bestaande saves krijgen de nieuwe toetsen als standaard.
- **Open vragen voor Bo (eerst stellen, niet zelf kiezen):** mag je in de lucht dashen? Mag je in de lucht aanvallen of casten? Kost springen energie? Sprinten vasthouden of aan/uit?
Niet doen: animaties (die volgen uit Chat 3 via vy/grounded/sprinting), klimmen, zwemmen.
Definition of Done:
- [ ] Springen is precies even hoog en ver op 60 en 120 Hz (test).
- [ ] Coyote time en jump buffer werken (test); landen op trappen en randen gaat goed.
- [ ] Sprinten kost energie en stopt als die op is; regen werkt zoals nu.
- [ ] Nieuwe toetsen instelbaar in Settings → Besturing; DataValidator en alle tests slagen.
