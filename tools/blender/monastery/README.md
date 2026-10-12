# Monastery – Blender-scripts

Het Blender-bestand is `C:\Users\Bo\Documents\Morvath\Greyhaven\assets\Monastery.blend` (naast `Forge.blend`).
**Het .blend-bestand is de bron**; deze scripts laten zien hoe het gebouwd is en zijn handig om delen opnieuw te maken.
Een paar stappen (binnenkant van de oostvleugel, tuin) zijn direct in Blender uitgevoerd met de helpers hieronder;
de maten en lijsten daarvan staan in de tekstblokken in het .blend.

| Bestand | Wat | In het .blend als tekstblok |
|---|---|---|
| `01_build_monastery.py` | Eerste opzet: kerk, kloostergang, vleugels, toren (scene "Monastery") | – |
| `mon_helpers.py` | Maten van de oostvleugel, lijst van ramen/deuren/binnenmuren/kamers, raam- en deur-kits | `MON_build_helpers` |
| `03_tile_roofs.py` | Alle daken bedekken met de leien A–D en nok-/graatpannen E/F | `MON_roof_tiles` (alleen de functies) |
| `04_wall_stones.py` | Stenen A–C (en funderingsstenen D/E) op de muren | `MON_wall_stones` |
| `05_garden_pieces.py` | Losse tuinmodellen: bomen, rotsen, fruit, gewassen (3 groeistadia), vogelverschrikker | `MON_garden_pieces` |
| `06_card_trees.py` | Bomen in Genshin-stijl: kroon van veel losse blad-/bloesemkaartjes (sakura's, eiken, appelboom) | `MON_card_trees` |
| `07_willow.py` | Treurwilg in kaartjes-stijl met zwaaiende slierten (shape keys) en vuurvliegjes | `MON_willow` |
| `08_foliage_textures.py` | Tekent de trosjes-plaatjes (blad, bloesem, wilgensliert) met alpha; kopie in `textures/` | `MON_foliage_tex` |
| `09_foliage_materials.py` | Toon-materialen plaatje × kleur met doorzichtige rand (`GH_Monastery_Foliage_*`) | `MON_foliage_mats` |
| `10_cluster_trees.py` | **Huidige bomen** in Genshin-techniek: grote trosjes-kaartjes + bol-normals (vervangt 06/07 voor de kroon) | `MON_cluster_trees` |
| `11_grass.py` | Gras in Genshin-stijl: graspollen van kaartjes met een sprietjes-plaatje, normals omhoog, gestrooid over het gazon | `MON_grass` |
| `12_genshin_textures.py` | Kleur-plaatjes in geschilderde stijl: grond, gras, vijverbodem, rimpels, 5 bloemen, hout | `MON_genshin_tex` |
| `13_genshin_ground_grass.py` | Grond met plaatje (16 m tegel), vijverbodem-overgang (`BedMix`), graspollen in 3 tinten die de grond volgen | `MON_genshin_ground` |
| `14_genshin_water.py` | Water: diepte per punt (`WaterDepth`) → kleur + doorzichtigheid, schuimrand, rimpels | `MON_genshin_water` |
| `15_genshin_flowers.py` | Bloemenpollen (kaartjes met plaatje) op de plekken van de oude bloemen | `MON_genshin_flowers` |
| `16_genshin_bridges_wood.py` | Nieuwe houten boogbruggen + houtplaatje op bankjes, hekjes, moestuin | `MON_genshin_bridges` |
| `17_roof_gradient.py` | Daken: donkere leien bovenaan bij de nok, naar de dakrand toe lichter (5 tinten) | `MON_roof_gradient` |
| `18_bushes.py` | Bosjes in boom-techniek: 9 of 11 grote bladkaartjes (18/22 driehoeken), bol-normals | `MON_bushes` |
| `19_interiors_hollow.py` | Kerk, eetzaal, westvleugel en toren hol maken (muren 0,6 m) met gaten voor deuren, ramen, bogen (EXACT booleans) | `MON_interiors_hollow` |
| `20_interiors_floors_stairs.py` | Plankenvloeren, balkenplafonds, verdieping + trap westvleugel, wenteltrap + klokkenvloer toren | `MON_interiors_build` |
| `21_interiors_props.py` | Inrichting: kerkbanken + altaar, tafels + haard eetzaal, voorraad/gasten westvleugel, toren | `MON_interiors_props` |
| `22_extra_stones.py` | Extra stenen: dikkere stenen, keien, mosstenen, hoekstenen, stenen rond ramen | `MON_extra_stones` |
| `23_gravel_path.py` | Tuinpaden als grindpad: grindplaatje (2 m tegel), randstenen in muursteen-kleuren, losse steentjes | `MON_gravel_path` |
| – | Vorm van de tuin, vijver, beekjes | `MON_garden_layout` |

Gebruik in Blender: open het script in de Scripting-tab en voer het uit, of
`exec(bpy.data.texts["MON_build_helpers"].as_string())` in de Python-console.

Afspraken: 1 eenheid = 1 meter, vloer/grond op Z=0, +Y = noord, +X = oost. Alle objecten beginnen met `MON_`,
alle materialen met `GH_Monastery_` (GH_Toon-shader, dus de web-export herkent ze). Zie `docs/MONASTERY.md`.
