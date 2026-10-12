# Monastery of Greyhaven – Blender-asset

> Gebouwd in Blender met Claude op 2026-10-12. Bestand: `C:\Users\Bo\Documents\Morvath\Greyhaven\assets\Monastery.blend`
> (backups: `Monastery_backup_before_tiles`, `_before_interior`, `_before_garden`). Scripts: `tools/blender/monastery/`.
> Staat nog **niet** in Greyhaven: dat gebeurt (zoals bij de smidse) in de aparte Greyhaven-chat.

![Klooster en tuin](monastery/garden_overview.png)

## Opbouw (zoals een echt middeleeuws klooster, naar het St. Gall-plan)

| Deel | Plek (lokaal, +Y = noord) | Wat |
|---|---|---|
| Kerk | noord, x −12…14 | Middenschip + zijbeuken, ronde apsis (oost), poort + roosvenster (west), klokkentoren met spits (NW) |
| Kloostergang | midden, 20 × 20 m | Overdekte gangen met rondbogen, binnentuin met kruidenbedden, waterput, lantaarns |
| Oostvleugel | x 10…22, y −10…10 | **Van binnen speelbaar**: hal + 6 kamers (zie hieronder) |
| Eetzaal (Refectory) | zuid, x −10,6…22 | Loopt door tot de oostmuur, zodat de hoek dicht is |
| Westvleugel | west | Voorraad/gasten, grote poort naar buiten |
| **Monastery Garden** | oost + achter de kerk | Vredige tuin met vijver, beekjes, moestuin (zie hieronder) |

## Daken en muren

- **Leien:** 4 vormen (A recht, B visschub, C punt, D afgebroken hoek) in 3 tinten, rijen half over elkaar en verspringend,
  elke rij precies passend tussen de dakranden. Spits vooral visschubben.
- **Nok- en graatpannen:** E (hoekig) en F (rond, op de kerk). 0,6 m lang, om de 0,5 m: de brede voorkant valt over de
  smalle, lagere achterkant van de volgende, dus de naden lopen strak over.
- **Muurstenen:** A, B, C (gewone muur) en de grote funderingsstenen D, E in de onderste 1,2 m. Alleen de zichtbare
  voorkant van een steen is gemodelleerd (8 vertices), rond ramen en deuren wordt ruimte gelaten.
- Ramen: stenen boog, vensterbank, houten kozijn, glas in lood (warm gloeiend). Deuren: planken, ijzeren banden, ringgreep.

## Oostvleugel – binnen

12 m breed, muren 0,6 m dik, plankenvloer, plafond op 6,5 m met donkere balken. Ingang vanuit de kloostergang, een
tweede deur aan de oostkant gaat de tuin in.

| Room | Wat erin staat |
|---|---|
| Hall | gang met banken en lantaarns, deuren naar kloostergang en tuin |
| Dormitory | 5 bedden met kisten; **bed met rode deken = speler** (`MON_Spawn_PlayerBed`) |
| Infirmary | 2 bedden, kruidenrek, tafel |
| Warming Room | open haard + schoorsteen, banken, kleed |
| Chapter House | stenen banken langs de muren, stoel van de abt, lessenaar |
| Scriptorium | schrijftafels bij het raam, boekenkast |
| Brother Ansel's Cell | bed, bureau, kist (`MON_NPC_BrotherAnsel`) |

![Dormitory](monastery/dormitory.png)

## Monastery Garden

Ongeveer twee keer de oppervlakte van het klooster, in de vorm die Bo tekende: van de zuidoosthoek langs de hele
oostkant en achter de kerk langs tot de toren, met een lage stenen muur eromheen. Je komt erin via de oostdeur van de hal.

- **Vijver** (midden-oost) met een grindpad eromheen, waterlelies, riet, rotsen, 2 treurwilgen, 4 stenen lantaarns,
  bankjes en een prieel aan de oostkant.
- **Beekje** uit een bronnetje met watervalletje (noordoost) de vijver in; aan de andere kant stroomt het achter de kerk
  langs naar een poel. Twee houten bruggetjes waar het pad het water kruist.
- **Koi:** voor nu weggehaald (2026-10-12, Bo). De kleuren `GH_Monastery_Koi_White/Black` blijven bewaard in het .blend.
- **Groen:** boomgaard achter de kerk, bloesembomen, loofbomen, treurwilgen, struiken, bloemenvelden, lavendel langs het pad.
- **Moestuin met kweekbare bedden** (met hekje, vogelverschrikker, regenton):

| Marker | Gewas nu |
|---|---|
| `MON_FarmPlot_1` | Cabbage |
| `MON_FarmPlot_2` | Carrot |
| `MON_FarmPlot_3` | Pumpkin |
| `MON_FarmPlot_4` | Wheat |
| `MON_FarmPlot_5` | Moonbell (magisch kruid, magieblauw) |
| `MON_FarmPlot_6` | Empty (omgespit, klaar om te planten) |

Elke marker heeft de eigenschappen `crop` en `farmable = true`.

![Vijver](monastery/pond.png)

## Losse tuinmodellen (collectie `MON_GardenPieces`)

Net als de leien en stenen zijn alle tuinonderdelen losse modellen; de tuin gebruikt **instances** (gedeelde mesh) ervan.
Pas je een model aan, dan verandert elk exemplaar in de tuin mee. Bomen in de tuin heten `GH_Tree_MON_<soort>_<nr>`,
zodat de web-export ze als bomen herkent (zoals de `GH_Tree*`-nodes in Greyhaven).

| Groep | Modellen (`GH_Monastery_…`) |
|---|---|
| Bomen | `Tree_Oak_A`, `Tree_Oak_B`, `Tree_Pine`, `Tree_Willow`, `Tree_Apple` (met appels), `Tree_Sakura_A`, `Tree_Sakura_B` (met afgevallen bloesem) |
| Rotsen | `Rock_A` (kei), `Rock_B` (platte steen), `Rock_C` (groepje), met mos bovenop |
| Fruit | `Fruit_Apple`, `Fruit_Pear`, `Fruit_Plum` |
| Gewassen, 3 groeistadia | `Crop_<Cabbage/Carrot/Pumpkin/Wheat/Moonbell>_1_Seedling`, `_2_Growing`, `_3_Ripe` |
| Overig | `Scarecrow` |

In de tuin: 41 bomen, 39 rotsen, 94 gewassen (rijp), de vogelverschrikker en afgevallen appels onder de appelbomen.
De kweekbedden `MON_FarmPlot_1…6` hebben nu ook `stage` (0 = leeg, 3 = rijp). Script: `tools/blender/monastery/05_garden_pieces.py`.

![Tuinmodellen](monastery/garden_pieces.png)

**Sakura's (2026-10-12):** de kroon is een takkenstelsel (stam → dikke takken → takken → twijgen) met losse
bloesemtrosjes, zodat je de takken door de bloesem heen ziet. Onder de boom liggen losse blaadjes.
**Vallende blaadjes:** per sakura een *collection instance* van `MON_PetalFall_Sakura_A/B` (28 blaadjes, lus van 240
frames = 10 s, draaien en zweven met de wind mee, verdwijnen als ze landen). In de tuin staan ze in `MON_Garden_PetalFalls`,
op dezelfde plek, draaiing en grootte als de boom. Of de glTF-export deze animatie meeneemt moet nog getest worden;
anders kan de game de blaadjes zelf laten vallen vanaf de boomposities (goedkoop met één InstancedMesh).

**Bomen in Genshin-stijl (2026-10-12, naar Bo's voorbeelden):** de sakura's, eiken en de appelboom hebben nu een
kroon van heel veel kleine losse kaartjes (bloesem: bloemetje met 5 punten, blad: puntig ovaal) in trosjes en grote
wolken. Bovenkant en buitenkant zijn licht, binnen en onder donkerder, zodat de kroon in lagen lijkt te liggen.
Slanke, vertakte stammen; `Tree_Sakura_B` heeft twee stammen die om elkaar heen draaien. Tussen de wolken door zie je
nog takken. Nieuwe kleuren: `GH_Monastery_Blossom_Deep`, `GH_Monastery_TreeLeaf_Light/Mid/Deep`.
De vallende blaadjes beginnen nu in de nieuwe kroon. Script: `tools/blender/monastery/06_card_trees.py`
(backup ervoor: `Monastery_backup_before_card_trees.blend`).

| Model | Vertices |
|---|---|
| `Tree_Sakura_A` / `_B` | ~27.000 / ~26.000 |
| `Tree_Oak_A` / `_B` | ~11.000 / ~12.600 |
| `Tree_Apple` | ~8.000 |

Dat is zwaar per boom; omdat het instances zijn kost het geheugen weinig, maar voor de game is een lichtere versie
(minder kaartjes of een LOD voor verre bomen) slim.

![Sakura in Genshin-stijl](monastery/card_trees_sakura.png)
![Sakura met twee stammen](monastery/sakura_twin_trunks.png)
![Tuin met de nieuwe bomen](monastery/garden_card_trees.png)

**Treurwilgen en vuurvliegjes (2026-10-12, idee van Claude):** `Tree_Willow` is opnieuw gemaakt in de kaartjes-stijl:
korte dikke stam, koepel van blaadjes en 78 lange slierten blaadjes die tot vlak boven de grond hangen. De slierten
**zwaaien zachtjes in de wind** (shape keys `Sway_A`/`Sway_B` op de mesh, lus van 5 s; elke sliert beweegt een beetje
anders). Rond elke wilg zweven **16 vuurvliegjes** (`MON_Fireflies_Willow` als collection instance in
`MON_Garden_Fireflies`, lus van 10 s, elk knippert op zijn eigen moment). Script: `tools/blender/monastery/07_willow.py`
(backup ervoor: `Monastery_backup_before_willow.blend`). Ongeveer 17.000 vertices per wilg.

**Dennen:** voor nu uit de tuin gehaald (Bo wil er nog iets anders voor bedenken). Het model `Tree_Pine` staat nog in
`MON_GardenPieces`.

![Treurwilg met vuurvliegjes](monastery/willow_fireflies.png)

**Volle kroon en twijgjes (2026-10-12, Bo):** in elke kaartjes-kroon zijn de blaadjes binnenin groter (×1,5) en aan de
buitenkant kleiner (×0,7), zodat de kroon voller lijkt met minder kaartjes. Niets zweeft meer los: elke bladwolk hangt
aan een twijgje vanaf een tak, en bij de wilg zit elke sliert aan een dun hangend twijgje (`GH_Monastery_Willow_Twig`)
met de blaadjes eraan vast; het twijgje zwaait mee. Vertices nu: sakura ~25.600 / ~24.600, eik ~10.400 / ~12.100,
appel ~8.000, wilg ~19.000. Backup ervoor: `Monastery_backup_before_twigs.blend`.

**Wilg aan de boom vast (2026-10-12, Bo):** uit elk takeinde groeien 3 dunne boogtakken naar buiten en omlaag, met
blaadjes erop; de slierten hangen aan die boogtakken, dus alles zit aan de boom vast. ~23.400 vertices.

![Wilg met boogtakken](monastery/willow_twigs.png)

## Bomen in Genshin-techniek (2026-10-12, huidige versie)

Bo vroeg dezelfde techniek als Genshin Impact. Elke kroon bestaat nu uit **een paar honderd grote kaartjes**, en op elk
kaartje staat een **geschilderd trosje** blaadjes of bloesem met een doorzichtige rand (alpha cut-out):

- **Plaatjes** (`T_MON_LeafCluster`, `T_MON_BlossomCluster`, `T_MON_WillowCluster`, `T_MON_WillowStrand`): grijze
  schildering + alpha, 512 px (sliert 128 × 1024). De kleur komt uit het materiaal (licht / midden / donker), dus één
  plaatje werkt voor alle tinten. Ze staan in `assets/textures/` naast het .blend, zitten ook ín het .blend (packed) en
  er staat een kopie in `tools/blender/monastery/textures/`.
- **Materialen** `GH_Monastery_Foliage_<Leaf|Blossom|Willow|WillowStrand>_<Light|Mid|Deep>`: GH_Toon met plaatje × kleur
  en een doorzichtige rand. Eigenschap `mon_foliage` = naam van het plaatje (voor de export).
- **Bol-normals:** de normals van de kaartjes wijzen naar buiten vanaf het midden van de kroon, zodat de hele kroon
  belicht wordt als één zachte bol (zoals Genshin), niet als losse vlakjes.
- Grote kaartjes binnenin, kleinere aan de rand; elke bladwolk hangt aan een twijgje; wilgenslierten zijn lange linten
  met het slierten-plaatje, hangen aan boogtakken en zwaaien nog (shape keys).

| Model | Vertices (was) |
|---|---|
| `Tree_Sakura_A` / `_B` | ~4.300 / ~4.100 (25.600 / 24.600) |
| `Tree_Oak_A` / `_B` | ~2.300 / ~2.700 (10.400 / 12.100) |
| `Tree_Apple` | ~2.400 (8.000) |
| `Tree_Willow` | ~4.900 (23.400) |

Alle bomen in de tuin samen: van ±650.000 naar ±140.000 vertices.

**Nodig in de game** (open vraag 9): de toon-shader heeft nog geen bladmodus. Die moet het plaatje lezen, pixels met lage
alpha weggooien (`discard`), de custom normals gebruiken en (liefst) wind in de vertex-shader doen. De web-export moet
UV's, normals en het plaatje meenemen (materiaal-eigenschap `mon_foliage`). Tot dan zouden de kaartjes als volle
vierkantjes getekend worden.

![Tuin met trosjes-bomen](monastery/garden_cluster_trees.png)
![Sakura's](monastery/sakura_clusters.png)
![Eik](monastery/oak_clusters.png)
![Wilg](monastery/willow_clusters.png)

## Markers (collectie `MON_Markers`)

`MON_Spawn_PlayerBed`, `MON_NPC_BrotherAnsel`, `MON_Door_Cloister_Outside`, `MON_Door_East_Outside`,
`MON_Room_<naam>` (midden van elke kamer), `MON_FarmPlot_1…6`.

## Grootte (vertices)

| Collectie | Vertices |
|---|---|
| Daken (`MON_RoofTiles`) | ~277.000 |
| Muurstenen (`MON_WallStones`, incl. tuinmuur) | ~166.000 |
| Tuin (`MON_Garden`) | ~78.000 |
| Gebouw + ramen/deuren (`Monastery`) | ~20.000 |
| Meubels (`MON_Interior`) | ~2.600 |

Dat is veel meer dan de smidse (~13.000). Vóór het in Greyhaven gaat is een optimalisatiestap slim (net als bij de smidse),
vooral voor daken die je alleen van ver ziet.

## Tijdelijke namen

**Monastery Garden** en **Moonbell** zijn werktitels; nog niet definitief.
