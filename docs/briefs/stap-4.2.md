# Brief stap 4.2: Markt en winkels

Bron: spelconcept (Google Doc, 1 keer gelezen als export; daarna gezocht in de export op Marco, Tobi, shop, merchant, price, Gold). Repo: `public/data/npcs.json`, `src/ui/menus/ShopPanel.ts`, `src/scenes/WorldState.ts` (shop-regie), `public/data/quests.json` (Marco als giver).

## 1. Wat het concept zegt

- Marco the Merchant (Market Square, Greyhaven): "gladde koopman die alles 'speciaal voor jou' verkoopt. Kopen en verkopen; zijn winkel wisselt steeds."
- Marco's winkel: Health Potion 10 Gold, Greater Health Potion 40, Mana Potion 12, Greater Mana Potion 45, plus "een paar stukken gear".
- Tobi the Snow Merchant komt als naam voor in het concept (regel rond "Tobi the Snow Merchant"); rol, locatie en winkel zijn niet uitgewerkt.
- Gold: rechtsboven, alleen zichtbaar bij een shop; dood kost 10% gold.
- Nieuwe spullen: "13 stukken gear als buit in de Greenwood en bij Marco" (Goblin Cleaver, Iron Helm, Heartwood Ring, namen voorlopig).
- Quest "Just For You" (Marco): koop 2 Health Potions, dan 40 XP en 5 Gold terug.
- Geen concept-tekst over verkoopprijzen, verkoop-percentage of hoe vaak voorraad terugkomt.

## 2. Wat al in de data/code bestaat

- `public/data/npcs.json`: `marco` (role merchant, zone greyhaven) heeft een `shop.items`-lijst met 8 entries (`item` + `price`): health_potion 10, greater_health_potion 40, mana_potion 12, greater_mana_potion 45, straw_hat 15, brass_ring 25, copper_amulet 30, padded_mantle 60. Dit komt overeen met het concept.
- `public/data/npcs.json`: `merchant` staat ook als NPC-kleur/type-entry (regel ~23), geen winkel.
- `public/data/quests.json`: quests met `giver: marco` (regels ~175 en ~325), o.a. "Just For You".
- `src/ui/menus/ShopPanel.ts`: één generieke shop-paneel: per item naam, prijs, bezit en Buy-knop; teksten via `shop.*` keys.
- `src/scenes/WorldState.ts` (regel ~2308): opent de shop van `npc.def.shop` na de laatste dialoogregel.
- `src/ui/HudVisibility.ts`: goud alleen zichtbaar bij shop (al klaar).
- Verkopen (speler verkoopt aan handelaar) bestaat in de code niet; `ShopPanel` kent alleen kopen.
- Geen voorraad-veld (`stock`, `restock`) in `npcs.json` of `ShopPanel`; koop is onbeperkt.
- `Tobi` komt in de repo niet voor (grep op `npcs.json` leverde geen tobi-entry).
- Geen `buyPrice`/`sellPrice` of verkoopprijs-veld in `items.json`.

## 3. Niet in het concept, dus de kleinste veilige keuze

- Verkoopprijs: vaste verhouding in data, bijv. `sellRatio: 0.5` per handelaar (default), geen per-item prijs. Eén regel in het schema.
- Handelaar-schema: `shop` krijgt optionele `sellRatio` en `stock` (per item: `max`, `restockSeconds`). Ontbreekt `stock`: onbeperkt, zoals nu. Zo blijft Marco werkend zonder data-wijziging.
- Voorraad die terugkomt: in-game tijd via `restockSeconds` (placeholder, bijv. 600 s), volledig vullen bij herstart. Tijd per seconde, geen frame-teller. Opslag van de resterende voorraad in de save (nieuwe versie + migratie, lege map als default).
- "Winkel wisselt steeds" (Marco): niet bouwen; placeholder is vaste lijst. Markeren als tijdelijk in PLAN.md Notities.
- Tobi the Snow Merchant: alleen als data-entry met placeholder-winkel (bijv. 2 items) en zone "nog niet bepaald"; geen eigen zone-plaatsing zonder bevestiging, of overslaan. Kleinste keuze: niet toevoegen in deze stap, alleen in de notitie noemen.
- Teksten (verkoop-knop, "verkocht", "geen voorraad", "niet genoeg gold") in `en.json` en `nl.json`; namen blijven Engels.
- Klaar-criterium "nieuwe handelaar is alleen data": de shop-regie in `WorldState.ts` moet elke NPC met `shop` oppakken zonder code per NPC. Test: een tweede handelaar in `npcs.json` met `role: merchant` en `shop` opent het paneel.
- Validator: `DataValidator` / `schemas.ts` moet `sellRatio` en `stock` kennen en `shop.items[].item` tegen `items.json` checken.

## 4. Echte open vragen voor Bo/Lucas

Geen. De stap is zonder antwoord te bouwen: verkoopratio, herstel-tijd en wisselende stock zijn placeholders in data en markeren in PLAN.md.

Brief klaar
