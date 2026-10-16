# Brief stap 4.1: De echte Forge

Bron: spelconcept (Google Doc, 1 keer gelezen; de tekst is 810k tekens, dus gezocht in de opgeslagen export op Forge, Hilda, upgrade, gear, materiaal, zeldzaamheid).

## 1. Wat het concept zegt

- Hilda Ironhand is de smid in de Forge (Market Square, Greyhaven). Ze maakt en upgradet gear en breekt materialen af.
- Bij de eerste bezoek aan de Forge: "You can trade gold for upgrades or new items." (cutscene-tekst, Engels)
- Eerste quest "Steel and Slime": breng 3 Slime Gel, dan krijg je 60 XP en wordt je Old Sword een Honed Old Sword (+3 schade op elke slag).
- Gear heeft 4 zeldzaamheden: common, rare, epic, legendary.
- Wapens: 1 wapen in het wapenslot, wisselen alleen buiten gevecht.
- Crafting-regels: simpele recepten zijn vanaf het begin bekend, betere via boekrol of baas. Skills Smith's Eye (kans op hogere zeldzaamheid bij smeden) en Master's Touch (extra item bij craften) bestaan al in de skill tree.
- Materialen altijd te vinden: Wood, Iron Ore, Slime, Crystal Shard. Elk seizoen één eigen item.
- Gold: rechtsboven, alleen zichtbaar bij een shop.
- Dood: je verliest 10% gold; items, gear en grondstoffen blijven.
- Geen concept-getallen voor upgrade-niveaus, kosten per niveau of materiaal per niveau.

## 2. Wat al in de data/code bestaat

- `public/data/items.json`: `rarities` (common, rare, epic, legendary), `crystalSizes`, en `items`. Relevante items:
  - `old_sword` (weapon, sword, damageBonus 0, common)
  - `honed_old_sword` (weapon, sword, damageBonus 3, common)
  - `academy_blade` (rare, damageBonus 5), `goblin_cleaver` (rare, 6), `chiefs_greatblade` (epic, 10)
  - Armour (`travel_mantle`, `iron_helm`, `ironweave_mantle`, enz.): `armor: null`, dus geen stats in data.
  - Alle items hebben `upgrade: null`: het veld bestaat in het schema maar is niet gebruikt.
- `public/data/npcs.json`: `hilda` (name "Hilda Ironhand", role "smith", zone greyhaven, dialogue npc.hilda.1 / npc.hilda.2).
- `public/data/quality.json`: alleen grafische presets, niets over gear.
- `src/data/schemas.ts`: `itemSchema` (strictObject, regel ~1129) met `rarity: id`; de `upgrade`-key is aanwezig in de data, dus het schema heeft een plek ervoor (controleer dit bij het bouwen).
- `src/save/SaveData.ts`: save-migraties lopen tot en met versie 8 (`8: ... character.spells`). Het huidige `SAVE_VERSION` is niet nagelezen; de nieuwe versie is dus minstens 9 en moet met een migratie erbij.
- `src/save/SaveManager.ts`: laden met migraties, weigeren van nieuwere saves.
- Inventaris: `itemStack` = `{ item, count }` (schemas.ts regel ~67). Dat past niet op één wapen-instantie met eigen upgrade-niveau.

## 3. Niet in het concept, dus de kleinste veilige keuze

- Upgrade-niveaus, kosten en max-niveau: data-tabel `public/data/forge.json` met placeholder-getallen (bijv. 3 niveaus, +3 damage per niveau, gold + 1 materiaal per niveau), markeren als tijdelijk in PLAN.md Notities.
- Wat een upgrade geeft: alleen `weapon.damageBonus` verhogen; armour krijgt wel het upgrade-veld maar geen stat-effect tot er armour-stats bestaan.
- Opslag van het niveau: een `upgradeLevel` op een wapen-instantie (niet op de stack); wapen in wapenslot en in de tas krijgen elk een instantie-id of het niveau wordt per instantie bijgehouden. Nieuwe save-versie met migratie (lege lijst/0 als default).
- Materialen afbreken (concept noemt het): buiten 4.1 laten, of één regel in data zonder UI. Kleinste keuze: niet bouwen.
- Upgrade alleen buiten gevecht en alleen in de Forge (concept: "alleen buiten gevecht" uit de stap-tekst); toets via bestaande combat-state.
- Teksten (koop-knop, bevestiging, niet genoeg gold/materiaal) in en.json en nl.json; namen Honed/Old Sword blijven Engels.
- Smith's Eye en Master's Touch: niet aanpassen in deze stap.
- Gold-kosten: zelfde gold-systeem als bestaande shops (Marco); geen nieuwe valuta.

## 4. Echte open vragen voor Bo/Lucas

Geen. Alle ontbrekende getallen kunnen als placeholder in data, en de stap is zonder antwoord te bouwen.

Brief klaar
