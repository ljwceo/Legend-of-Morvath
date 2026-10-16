# Personage – Blender-scripts (Fase A)

Bron: `Hero_Start_Rigged.blend` (sinds A.0, 2026-10-15; staat niet in de repo, Bo heeft hem lokaal), collectie `StartCharacter` met het lijf `Body` (materialen `Skin`, `Tunic`). Het oude `Greyhaven.blend`-poppetje van losse stukken werkt in het script nog steeds.
De scripts draaien zonder venster en **slaan het .blend-bestand nooit op**.

| Bestand | Chat | Wat |
|---|---|---|
| `01_prep_mixamo.py` | 1 (A.1) | Lijf klaarmaken voor Mixamo → `body_for_mixamo.fbx` |
| `02_import_mixamo.py` | 2 (A.2a) | Mixamo-rig + clips terug in Blender → `Hero_Start_Animated.blend` (Deel C) |
| `03_attach_gear.py` | 2 (A.2b) | Hoed, haar, cape, zwaard en tijdelijke staf aan het skelet → `Hero_Start_Player.blend` (Deel D). De export naar `player.glb` komt in A.2c |

**Mixamo-licentie:** de bestanden uit Mixamo (en `body_for_mixamo.fbx`) gaan **nooit** in git.
Ze staan in de map `Mixamo` naast `Greyhaven.blend` (buiten de repo) of in `art-source/` (in `.gitignore`). Alleen de
uiteindelijke `public/zones/greyhaven/player.glb` gaat in git.

---

## Eerst: het echte personage maken (besluit 2026-10-13)

Het huidige poppetje is van losse cilinders en bolletjes. Bo maakt eerst de looks; daarna draait
`01_prep_mixamo.py` op het nieuwe model. Zo werkt Mixamo er straks goed mee:
- Het **lijf als één geheel** (armen, benen, romp, hoofd aan elkaar), in de collectie `StartCharacter`.
- **Armen schuin naar beneden** (A-pose), handen een stukje van het lijf.
- **Extra ringen (loop cuts) bij ellebogen, knieën, schouders en heupen.**
- **Hoed, haar, cape en zwaard als losse delen** (die komen in Chat 2 aan het skelet).
- Materiaalnamen houden: `Skin`, `Hair`, `Cloak_Navy`, `Hat_Navy`, `Gold_Trim` (de character creator kleurt die), en `Outline` voor de omlijning.
- Maximaal ±30.000 driehoeken in totaal.

Klaar (A.0): het nieuwe lijf heet `Body` en het script herkent dat. Alleen als er geen `Body` is, zoekt hij nog de oude stukken (`Torso`, `Arm_L`, ...).

---

## Deel A – `01_prep_mixamo.py` draaien (Chat 1)

**In Blender (makkelijkst):**
1. Open `Greyhaven.blend` in Blender zoals altijd.
2. Klik bovenin op het tabblad **Scripting**.
3. Klik in het tekstvak op **New**.
4. Open op GitHub `tools/blender/character/01_prep_mixamo.py`, klik rechtsboven op **Copy raw file**
   (het icoontje met de twee blaadjes) en plak het in Blender (Ctrl+V).
5. Klik op **▶** (Run Script). Na een paar seconden is hij klaar.
6. Naast `Greyhaven.blend` staat nu een map **`Mixamo`** met `body_for_mixamo.fbx`.

Het script verandert niets aan je scène. Opslaan hoeft niet, maar het kan ook geen kwaad.
Gaat er iets mis? Kijk in *Window → Toggle System Console* of stuur `Mixamo\log_prep.txt`.

**Zonder venster (voor wie dat wil):**
`blender -b Greyhaven.blend --python tools/blender/character/01_prep_mixamo.py -- <uitvoermap>`

Wat het script doet:
- Kopieert de lijfstukken (Torso, Neck, Head, Shoulder_L/R, Arm_L/R, Hand_L/R, Belt, Leg_L/R,
  Boot_L/R) en voegt ze samen tot één mesh `Body`. Haar, hoed, cape, kraag en zwaard blijven
  eruit (die komen in Chat 2 terug). De zwarte omlijning (`Outline`) ook.
- Snijdt extra ringen in de armen, benen, romp en nek, zodat ellebogen, knieën en rug kunnen buigen.
- Zet de armen in een A-pose (45° naar buiten, rond de schouder).
- Draait het lijf met het gezicht naar Blender −Y (de voorkant voor Mixamo), voeten op 0, in het midden.

Wat eruit komt (in de uitvoermap):
- `body_for_mixamo.fbx` – dit upload je naar Mixamo.
- `prep_info.json` – wat er gedraaid en verschoven is (Chat 2 gebruikt dit om alles weer recht te zetten).
- `log_prep.txt` – maten, aantal driehoeken, materialen. Bij een fout staat hier waar het misging.

Controle (optioneel): open een leeg Blender, *File → Import → FBX*, kies `body_for_mixamo.fbx`.
Je ziet één poppetje zonder hoed/haar/cape, armen schuin naar beneden, voeten op de grond.

---

## Deel B – Mixamo (Bo, met de hand)

1. Ga naar [mixamo.com](https://www.mixamo.com) en log in (gratis Adobe-account).
2. **Upload Character** → kies `body_for_mixamo.fbx`.
   - Staat het poppetje met zijn rug naar je toe of ligt het? Draai het in de eerste stap met
     de draai-knoppen tot je het van voren ziet, en klik dan *Next*.
3. **Auto-Rigger:** sleep de bolletjes naar kin, polsen, ellebogen, knieën en kruis.
   - *Skeleton LOD*: **No Fingers** (de handen zijn bolletjes, vingers zijn niet nodig).
   - Klik *Next* en kijk in de preview of de armen en benen netjes buigen (geen rare uitrekkingen).
     Dat is meteen de Definition of Done van Chat 1: lukt dit, laat het weten.
4. **Gerigd poppetje downloaden:** zonder animatie (*T-Pose*), *Format: FBX Binary*,
   *Skin: With Skin*. Sla op als **`body_rigged.fbx`**.
5. **Animaties downloaden**, met jouw poppetje geselecteerd (dan passen ze op jouw skelet):
   - Vink **In Place** aan als die optie er is.
   - Zet *Character Arm-Space* iets hoger (±55–65) als de armen door het lijf gaan.
   - Download: *Format: FBX Binary*, **Skin: Without Skin**, *Frames per Second: 30*,
     *Keyframe Reduction: none*.
   - Sla elk bestand op met **precies de clipnaam** hieronder (bijv. `Slash_1.fbx`).

| Clipnaam (bestandsnaam) | Zoek in Mixamo bijvoorbeeld |
|---|---|
| `Idle` | Idle, Breathing Idle |
| `Walk` | Walking |
| `Run` | Running |
| `Sprint` | Fast Run |
| `Jump_Start` | Jumping Up |
| `Jump_Air` | Falling Idle |
| `Land` | Falling To Landing |
| `Dash` | Dodging / Running Slide (kort stuk, wordt ±0,2 s) |
| `Dash_Recover` | Run To Stop |
| `Slash_1`, `Slash_2`, `Slash_3` | Sword And Shield Slash, Sword And Shield Attack (3 verschillende) |
| `Heavy_Windup` + `Heavy_Strike` | Standing Melee Attack Downward, Great Sword Slash (mag één bestand zijn: `Heavy.fbx`, Chat 2 knipt hem) |
| `Cast_Gather` | Standing 1H Cast Spell, Magic Spell Casting (het opladen) |
| `Cast_Release` | Standing 1H Magic Attack |
| `Hit` | Standing React Small From Front, Hit Reaction |
| `Death` | Standing Death Backward, Dying |
| `Interact` | Button Pushing, Picking Up |

   Kies gerust op gevoel; Chat 2 kan clips inkorten, knippen en de horizontale beweging eruit halen.
6. Zet alles in de map `Mixamo` naast `Greyhaven.blend`, bijvoorbeeld:
   ```
   Mixamo\body_rigged.fbx
   Mixamo\Idle.fbx
   Mixamo\Walk.fbx
   ...
   ```
   Daarna: nieuwe chat, *"Lees CLAUDE.md. We doen Fase A, Chat 2."* Chat 2 maakt een script dat
   jij weer lokaal draait (de Mixamo-bestanden komen niet in de repo, dus Claude kan er niet bij).

   Hoe het gerigde bestand heet maakt voor Deel C niet uit (het script herkent het aan de inhoud:
   skelet + mesh met skin), en vingers in het skelet zijn prima.

---

## Deel C – `02_import_mixamo.py` draaien (stap A.2a)

Zet de Mixamo-rig en alle clips terug in Blender. Het resultaat is een **nieuw** bestand
`Hero_Start_Animated.blend` naast `Hero_Start_Rigged.blend`; de bron wordt nooit opgeslagen.

**In Blender (makkelijkst):**
1. Open `Hero_Start_Rigged.blend`.
2. Tabblad **Scripting** → **New** → plak de inhoud van `tools/blender/character/02_import_mixamo.py`
   (op GitHub: **Copy raw file**) → **▶ Run Script**.
3. Je ziet de melding *Mixamo import started* en er verschijnt een zwart consolevenster: dat is een
   tweede Blender zonder venster die het werk doet, zodat je open bestand niet verandert. Na een
   paar seconden opent de Mixamo-map vanzelf en komt de melding *Mixamo import done*
   (of *failed*, kijk dan in `log_import.txt`).
4. Het script gebruikt de Mixamo-map `C:\Users\Bo\Morvath\Characters\Mixamo` (`MIXAMO_DIR`, bovenin
   het script). Bestaat die map niet, dan pakt het de map `Mixamo` naast het open .blend-bestand.

**Zonder venster:**

```bat
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup --python tools\blender\character\02_import_mixamo.py -- "C:\Users\Bo\Morvath\Characters\Mixamo" "C:\Users\Bo\Documents\Morvath\Characters\Hero_Start_Rigged.blend"
```

Een derde argument is het uitvoerbestand (standaard `Hero_Start_Animated.blend` naast de bron).

Wat het script doet:
- Zoekt het gerigde poppetje op **inhoud** (skelet + mesh met skin), niet op bestandsnaam. `mixamorig:`
  verdwijnt uit de bot- en vertexgroepnamen; de rig heet `PlayerRig`, de mesh `Body`, allebei in de
  collectie `StartCharacter`, met toegepaste transforms. De hoogte wordt gecontroleerd (1,80 m);
  alleen als die niet klopt wordt er geschaald (de import staat al in meters).
- Zet de materialen `Skin` en `Tunic` uit `Hero_Start_Rigged.blend` per vlak terug (vlakmiddens
  gematcht met een KD-tree, niet op vlakvolgorde). Het Mixamo-materiaal `Hero_Skin_Clothes` verdwijnt.
- Elke clip-FBX wordt één Action met precies de bestandsnaam (fake user aan). De Mixamo-clips staan
  in **T-pose** en het poppetje in **A-pose**, daarom worden de keys niet gekopieerd maar wordt elke
  clip per bot op wereld-oriëntatie op `PlayerRig` gebakken; het script controleert dat zelf
  (`check ... deg`, hoort 0,000 te zijn).
- `Dash` → de 6 snelste frames (0,2 s). `Heavy` → `Heavy_Windup` + `Heavy_Strike`, geknipt 2 frames
  vóór de piek van de handsnelheid. `Cast_Gather` → een nette lus (laatste frame = eerste).
- Uit **alle** clips gaat de horizontale verplaatsing van `Hips` (begin-XY en de lineaire drift van
  begin naar eind); de hoogte blijft. `Walk`, `Run`, `Death`, enz. blijven dus op hun plek.
- `T-Pose.fbx` en FBX's met alleen een mesh worden genegeerd. Andere skelet-FBX's met meer dan twee
  frames gaan ongewijzigd mee als extra clip (`Walk_Sword`, `Run_Sword`, `Idle_Sword`, …).
- `Idle` staat op de rig als je het bestand opent; een andere clip kies je in de Dope Sheet →
  Action Editor.

Wat je onderaan `log_import.txt` moet zien:

```
CHECK actions: 24 (expected 24)
CHECK prefix: none left
CHECK retarget: worst 0.000 deg (limit 0.5) OK
CHECK drift: worst 0.00 cm left (limit 2.0) OK
CHECK materials: Body has ['Skin', 'Tunic'], faces {'Skin': 4450, 'Tunic': 892}, all materials ['Skin', 'Tunic'], Hero_Skin_Clothes gone
CHECK height: 1.800 m (1.80 +- 0.02) OK, feet at z = 0.0000
CHECK names: rig PlayerRig, mesh Body, collection ['StartCharacter'], triangles 5342
saved ...\Hero_Start_Animated.blend ... bytes
DONE
```

Staat er `ERROR` of `TOO MUCH`, stuur `log_import.txt` op. `clips.json` heeft per clip: naam,
bronbestand, frames, duur in seconden, lus ja/nee, wat er geknipt is, verwijderde drift, resterende
drift (`driftCm`, hoort onder 2), uitwijking binnen de clip (`swayCm`) en de retarget-fout.
Let op: `Heavy_Windup` duurt 1,23 s (de game rekent met 0,9 s); het script meldt dat alleen, de
animator speelt aanvallen straks op voortgang, dus het blijft kloppen met de hitbox.

---

## Deel D – `03_attach_gear.py` draaien (stap A.2b)

Neemt `Hero_Start_Animated.blend` (uit Deel C) en zet de spullen van het oude poppetje uit
`Greyhaven.blend` erop. Resultaat: **`Hero_Start_Player.blend`** naast `Hero_Start_Animated.blend`.
Beide invoerbestanden blijven onaangeroerd.

**In Blender:** open `Hero_Start_Animated.blend`, tabblad **Scripting**, **New**, plak het script,
controleer bovenin `GREYHAVEN` (pad naar `Greyhaven.blend`) en klik **▶**. Er start een tweede
Blender in een consolevenster; een melding zegt wanneer hij klaar is.

**Zonder venster:**
`blender -b --factory-startup --python tools/blender/character/03_attach_gear.py -- <Hero_Start_Animated.blend> <Greyhaven.blend> [<uitvoer.blend>]`

Wat erin zit:
- `Hair`, `Hat`, `Hat_Band`, `Hat_Brim` stijf aan het bot `Head`.
- `Sword_Blade`, `Sword_Guard`, `Sword_Grip` en de tijdelijke staf `Staff_Shaft`, `Staff_Crystal`
  stijf aan `RightHand` (de greep loopt dwars door de vuist; zwaard en staf staan allebei in het
  bestand, de game kiest straks welke zichtbaar is).
- `Collar_Trim` stijf aan `Spine2`; `Cloak` en `Cloak_Trim` op de cape-botten `Cape_L1-3`,
  `Cape_M1-3`, `Cape_R1-3` (aan `Spine2`, links = +X). Geen clip beweegt de cape-botten.
- In `Cast_Gather` en `Cast_Release` heeft de rechterhand een vuist (de greep uit `Idle_Sword`).

Wat je onderaan `log_gear.txt` moet zien:

```
stiff on bones (Head, RightHand, Spine2), largest jump 0.000000 m
cape bones ['Cape_L1', ..., 'Cape_R3'] from z 1.501 to 0.395
Cast_Gather: 80 finger channels of the right hand take the grip of Idle_Sword
triangles (with modifiers) 17378, limit 30000
saved ...\Hero_Start_Player.blend
DONE
```

`gear.json` (naast het resultaat) noemt per object het bot, of het meebuigt met de cape, de materialen
en het aantal driehoeken. Wil je de pasvorm bijstellen: de getallen staan bovenin het script
(`HEAD_SCALE`, `CLOAK_SCALE`, `SWORD_SCALE`, `STAFF_LENGTH`, ...).

