# HSPlanner review — calc engine & item data (2026-08-21)

Branch: feat/guide-imports-data-fixes (fork Scherholz/HSPlanner).

## Engine findings (ranked)

### [HIGH] Tree conversions into life/mana erase the %increased multiplier
- Where: `engine/src/calc/stats/mod.rs:372-396 (+ stats/finalize.rs:35-37, 188-223)`
- What: Step 18 multiplies life/mana (flat x (1+increased) x (1+more)) into `stats`; step 20 pushes conversion sources ("X% of Defense converted to Life", life/mana nodes 1534/1548/1876/1912/2354); step 21 re-sums those keys from flat sources only. Any build with such a node loses all %increased life/mana on the displayed life and EHP.
- Fix: Apply conversions before the multiplier pass (from a pre-multiplier snapshot) or re-run the multiplier pass on touched keys after step 21. (verified by reading)

### [HIGH] Conversions targeting increased_life never move life
- Where: `engine/src/calc/tree/parse/conversion.rs:98-127`
- What: Nodes 2972-2980 ("X% of Attack Damage -> Increased Life") and 1740 push into `increased_life` after life was already multiplied; the stat row changes, life does not.
- Fix: Same fix as above. (same root cause)

### [HIGH] Dual wield sums both weapons' attacks_per_second
- Where: `engine/src/calc/stats/inventory.rs:71-93 -> skills/attack.rs:167, weapon.rs:131, build.rs:387`
- What: Every implicit of every slot is applied, offhand included; 89 one-handers and 50 two-handers carry `implicit.attacks_per_second`. Two wands (Master of Wands) or two 2H (Hercules Grip) -> base APS 3.5 before IAS. Offhand enhanced_damage / physical_skills / melee_range also join the shared pool (rule uncertain).
- Fix: Skip (or max) `attacks_per_second` from the offhand slot; decide an explicit policy for offhand damage implicits. (verified by reading)

### [MED-HIGH] Attack-skill path ignores tag rank bonuses
- Where: `engine/src/calc/skills/attack.rs:51-64 vs rank.rs:21-42`
- What: `eff_rank` uses all_skills + element + item bonuses but not projectile/sentry/explosion tag skills; the UI rank (rankBonuses) and the spell path do include them.
- Fix: Use `rank::effective_rank_range_for` in attack.rs. (agent)

### [MED-HIGH] Item-granted passive attribute stats applied after attributes are totalled
- Where: `engine/src/calc/stats/mod.rs:348-360`
- What: Flexing etc. push to_strength/to_vitality into attr_sources after `attributes` is computed, so they never reach str->ED / vit->life conversions.
- Fix: Move step 15 before steps 9-13, or re-sum attributes and derived stats after it. (agent)

### [MED] enhanced_defense is item-only; every non-implicit ED source is dropped
- Where: `engine/src/calc/stats/helpers.rs:74-79, inventory.rs:38-69`
- What: 51 affixes, 46 runewords, 6 tree nodes and `enhanced_defense_based_on_level` contribute nothing to defense.
- Fix: Fold rolled/runeword ED into the item's effective defense; treat global ED as a multiplier on total defense. (agent)

### [MED] on_hit / on_cast procs assume 1 trigger per second
- Where: `engine/src/calc/build.rs:479-483, 519-523`
- What: Only on_kill uses kills/sec; hit/cast procs (Envenom, Storm Cloud sub-procs...) ignore the hit/cast rate already derived for ailments.
- Fix: Reuse `rate x count` (cast rate for on_cast) for proc DPS. (agent)

### [MED] rank_slot_items multi-skill ranking drifted from the frontend merge
- Where: `engine/src/calc/commands/performance.rs:104-147`
- What: Summed avg-hit + first skill's proc, dropping ailment DPS and execute multipliers - the Upgrade Advisor ranked on a different DPS definition than the app for multi-skill builds.
- Fix: FIXED in this branch (9de28a6): mirrors mergeCombinedPerformance. (fixed)

### [MED] Weapon panel vs attack-skill panel disagree on crit and additive physical
- Where: `engine/src/calc/skills/weapon.rs:77-84 vs skills/mod.rs:342-365, attack.rs:99-118`
- What: Weapon panel: no 95% crit clamp, ignores crit_damage_more, additive physical outside the %; the attack path does the opposite.
- Fix: Pick one model (the attack.rs one feeds DPS). (agent)

### [MED] Resist-based conversions ignore sign and cap
- Where: `engine/src/calc/tree/parse/conversion.rs:83-97, 113-142; stats/finalize.rs:151-166; attributes.rs:568-606`
- What: "All Resistances over the cap" and "Negative All Resistances" resolve to raw all_resistances; the 75% cap exists only in the UI.
- Fix: Use max(0, -res) and max(0, res-cap); decide whether "Resistances" means the all_res key or the five totals. (agent, rule guess)

### [MED-LOW] flat_elemental_skill_damage applied to physical skills
- Where: `engine/src/calc/skills/damage.rs:281-285`
- What: 65 physical skills receive elemental flat damage.
- Fix: Gate on ELEMENTS.contains(damage type). (agent)

### [MED-LOW] Passive-skill ranks use a mid-pipeline snapshot of all_skills
- Where: `engine/src/calc/stats/skills.rs:50-88`
- What: Item-granted passives (Roll the Dice +7 all skills...) raise active damage ranks but not passive ranks.
- Fix: Compute passive ranks after step 15 or re-run. (agent)

### [LOW-MED] Star scaling of skillBonuses ignores S10 charms
- Where: `engine/src/calc/rank.rs:75-79 vs inventory.rs:26-27`
- What: Implicits use can_star_forge(slot, season); skillBonuses use is_gear_slot - 30 charms with skillBonuses scale in one place and not the other in S10.
- Fix: Use the same season-aware predicate. (agent)

### [LOW] Percent weapon-fold stats are floored
- Where: `engine/src/calc/stats/helpers.rs:50-59 (mod.rs:276)`
- What: A 12.5% node contributes 12%.
- Fix: Don't floor percent folds. (agent)

### [LOW] Set pieces counted per equipped item
- Where: `engine/src/calc/stats/sets.rs:10-17`
- What: Two copies of the same set ring count as 2 pieces (rule guess).
- Fix: Count distinct set items if the game does. (agent, rule guess)

### [LOW] Spell crit excludes base/dex crit
- Where: `engine/src/calc/skills/mod.rs:342-356`
- What: Spell-tagged skills read only spell_crit_*; base 5% crit and dex->crit damage never reach spells (verify in-game).
- Fix: Confirm the rule; unify if wrong. (agent, rule guess)

### [LOW] Merc stats computed at level 1, no class
- Where: `frontend/utils/build/mercStats.ts:14-38`
- What: "Based on Level" merc items scale by 0.01.
- Fix: Pass the hero/merc level. (agent)

### [LOW] Enemy physical resistance only applied in the weapon panel
- Where: `engine/src/calc/skills/weapon.rs:135-151 vs attack.rs`
- What: AttackSkillInput has no resistance input; moot today (UI never exposes physical).
- Fix: Thread enemy_resistances through attack.rs or drop it from weapon.rs. (agent)

### [LOW] Small asymmetries
- Where: `engine/src/calc/build.rs:136-152, 167-201, 385-392; ailment.rs:110-115`
- What: uses_attack_speed uses r_max(aps) for both ends; proc targets use the main skill's shared subtree stats; on_kill/on_cast state appliers treated as per-hit.
- Fix: Case-by-case. (agent)

### [INFO] Parsed-but-unapplied stats
- Where: `data/items, data/game-config.json, tree parser`
- What: Item implicits not in game-config: increased_attack_rating (32 items), cooldown_recovery (16), flat_magic_skill_damage (6), max_crushing_blow_stacks (2); rune ignore_all_res not fanned out; defense_based_on_level (6 items) unmapped; ~20 tree keys (damage_unarmed, spell_damage, crushing_blow_chance, attack_speed_full_life, physical_to_<elem>...) have no engine consumer; skill passiveStats leak descriptive keys (cast_rate x12, proc_chance x18...); 162/848 affixes have no statKey.
- Fix: Add the missing stat definitions or strip dead keys; each is a silent "this item does nothing" for users. (agent)

## Verified OK

- combine_additive_and_more / stats_combined / diminishing-returns fold and S9->S10 DR values
- rank-scaling conventions (class passives, item-granted, subskills) and +All/element/tag skills feeding active damage
- enhanced damage multiplies weapon base only; additive physical after; unarmed 2-6
- Based-on-Level scaling before attribute totals
- extra-damage conditions additive, deadly/crushing blow, multicast gating
- entity (summon/sentry) DPS model
- runeword XOR socket stats, rainbow x1.5, socket transforms, augment clamp, forge gating, charm stars S10-only
- all_resistances / max_all fan-out and UI 75% + max cap
- frontend bridge field mapping, disabled potions, merc aura max-merge, dualWield rules

## Item data cross-check

# HSPlanner item data vs hsguides.com (data.win extract) — cross-check

- Items compared: 1048 of 1094 non-common names (46 not found on hsguides)
- Stat lines matched by phrase: 3004 · value mismatches: 229 (7.6%) across 142 items
- Of these: 22 look like order-of-magnitude/data-entry errors (≥5× apart), 146 differ by ≥25%, 61 are small range drifts (likely season balance changes)
- Method: stat text from hsguides ("+[a-b]% Enhanced Damage" …) parsed into HSPlanner stat keys for ~45 common stats; compared against the S10-patched `implicit` of the HSPlanner item with the same name. Only parsable, shared stats are compared; unparsed lines are ignored.

## Likely data-entry errors (≥5× apart)

| Item | Stat | HSPlanner | hsguides |
|---|---|---|---|
| Amethyst Knight's Amulet | faster_cast_rate | 2–4 | 20 |
| Anubis Oculus | life | 35–50 | 350–500 |
| Arcana Eye | mana | 20–30 | 250–300 |
| Ashbringer | life | 40–50 | 340–450 |
| Behemoth's Damascus Body | enhanced_defense | 5 | 160–180 |
| Book of Revelations | all_attributes | 2 | 15–20 |
| Chronomancer's Curio of Time | all_attributes | 2–4 | 25 |
| Flame Diviner's Cord | enhanced_defense | 45–75 | 445–575 |
| Flame Diviner's Sanctum | all_attributes | 5 | 30–45 |
| Flame Diviner's Ward | fire_skill_damage | 5 | 25–35 |
| Hands of Flame | enhanced_defense | 30–40 | 330–440 |
| Juggernaut's Siege Helm | life | 40 | 350 |
| King's Tower Shield | enhanced_defense | 5 | 240–300 |
| Lancer's Wall | enhanced_defense | 3–5 | 90–130 |
| Leviathan's Carcass | life | 1 | 1000 |
| Mayo's Old Sock | life | 100 | 600 |
| Pirate Captain's Boots | enhanced_defense | 50–80 | 350–480 |
| Plunderer's Jacket | enhanced_defense | 1–3 | 160–200 |
| The Templar | enhanced_defense | 3–5 | 90–130 |
| Traveler's Leather Jacket | faster_hit_recovery | 25 | 150 |
| Zealot's Book of Prophecy | mana | 35 | 500 |
| Zealot's Guise of Doom | mana | 30 | 500 |

## Differ by ≥25%

| Item | Stat | HSPlanner | hsguides |
|---|---|---|---|
| Ancient Aegis | faster_hit_recovery | 50 | 75 |
| Anubis Oculus | to_vitality | 15 | 5–30 |
| Arcana Eye | faster_cast_rate | 10 | 15–30 |
| Arcana Eye | magic_skill_damage | 8–15 | 20 |
| Arcane Robes of Authority | faster_cast_rate | 10–15 | 20–30 |
| Arcanist's Wrath | all_resistances | 35 | 15–25 |
| Aztec Necklace | ignore_poison_res | 5–15 | 15 |
| Battle Mage's Wand | faster_cast_rate | 50 | 25–40 |
| Battle Mage's Wand | magic_skill_damage | 8 | 15 |
| Blood Moon Crescent | movement_speed | 50–100 | 69 |
| Blood-letter's Plated Gauntlet | to_vitality | 8 | 15 |
| Bone Conjurer's Grips | to_energy | 15 | 25 |
| Bone Conjurer's Mask | to_energy | 10 | 10–30 |
| Book of Revelations | faster_cast_rate | 10–20 | 30 |
| Bronze Legion Girdle | all_resistances | 5 | 5–10 |
| Celestial's Authority | all_resistances | 20–40 | 15–30 |
| Champion's Medal of Valor | all_resistances | 10–30 | 20 |
| Charcoal Memento | increased_attack_speed | 20–35 | 20 |
| Chestplate of Fire | all_skills | 1 | 3–4 |
| Chestplate of Fire | enhanced_defense | 130–160 | 530–660 |
| Chronomancer's Curio of Time | arcane_skill_damage | 4–8 | 15–25 |
| Chronomancer's Observance | all_resistances | 10 | 15 |
| Chronomancer's Omnipotence | movement_speed | 30 | 45 |
| Clafaxier | ignore_poison_res | 4–10 | 15 |
| Crystal Cane of Ice | all_skills | 1 | 1–2 |
| Crystal Infused Wand | ignore_arcane_res | 5–15 | 15 |
| Cuirass of Blood | increased_attack_speed | 20–40 | 8–20 |
| Cuirass of Blood | life_steal | 10 | 5–7 |
| Damien's Head | all_attributes | 5 | 10 |
| Damien's Head | all_skills | 1 | 2–3 |
| Devil's Gem | ignore_arcane_res | 5–15 | 15 |
| Doctor's Visage | life | 30–40 | 120–160 |
| Dragon Knight's Flail | magic_skill_damage | 5–10 | 15–25 |
| Electro | ignore_lightning_res | 4–10 | 15 |
| Electro | lightning_skill_damage | 4–15 | 10–20 |
| Executioner's Cocoon | all_skills | 2 | 2–4 |
| Exiled Pagan's Mantle | all_skills | 2–4 | 4–6 |
| Exiled Pagan's Mantle | faster_cast_rate | 10 | 30 |
| Flame Diviner's Cord | fire_skill_damage | 3–8 | 15–25 |
| Flame Diviner's Refuge | enhanced_defense | 80–130 | 380–430 |
| Flame Diviner's Sanctum | enhanced_defense | 130–160 | 430–560 |
| Flame Diviner's Sanctum | to_vitality | 10 | 50 |
| Flame Diviner's Ward | enhanced_defense | 90–130 | 490–530 |
| Flame Diviner's Ward | faster_cast_rate | 10–20 | 35 |
| Flaming Coin | all_skills | 1–2 | 2–3 |
| Flaming Marchers | movement_speed | 20–30 | 35–50 |
| Frozen Carver | life_steal | 3–6 | 5–8 |
| Frozen Carver | to_strength | 10 | 20 |
| Gambler's Demise | life | 1–350 | 1–500 |
| Girdle of Resilience | life | 30 | 150 |
| Gladiator's Battle Sandals | movement_speed | 20–30 | 30–40 |
| Gladiator's Wrecking Ball | enhanced_damage | 240–280 | 840–980 |
| Gladiator's Wrecking Ball | movement_speed | 25 | 30–40 |
| Glowstick Estoc | increased_attack_speed | 35–50 | 35–20 |
| God's Benevolence | magic_skill_damage | 10 | 15–25 |
| Grandwizard's Robe | all_resistances | 20–35 | 20 |
| Grandwizard's Robe | faster_cast_rate | 30 | 20 |
| Gurag's Pebble | physical_skills | 1 | 2–3 |
| Gurag's Stone Crusher | enhanced_damage | 420–475 | 820–975 |
| Gurag's Stone Crusher | to_vitality | 25 | 50–200 |
| Hands of Flame | all_skills | 1–2 | 2–3 |
| Hands of Flame | faster_cast_rate | 15–25 | 40 |
| Hands of Flame | fire_skill_damage | 10–20 | 30–45 |
| Hazmat Suit | ignore_poison_res | 8–20 | 10–15 |
| Hermes Boots | all_attributes | 18–25 | 10–20 |
| Hermes Boots | all_resistances | 30–40 | 20–25 |
| Icy Crusher | to_vitality | 15–20 | 25–35 |
| Justiciar's Thunder Sash | faster_cast_rate | 10–15 | 15–25 |
| Kallik's Fury | all_skills | 1 | 2 |
| Khodo's Wedding Band | all_skills | 2 | 1–2 |
| Light Bringer's Mark | all_skills | 1–3 | 2–4 |
| Manahungerers | to_energy | 15–25 | 45–55 |
| Marcher's of Hatred | all_skills | 2–3 | 3–4 |
| Marcher's of Hatred | movement_speed | 30–100 | 75–100 |
| Marksman's Hunting Bow | increased_attack_speed | 10–20 | 15–30 |
| Mystique Allure | all_resistances | 20 | 30 |
| Mystique Allure | all_skills | 1 | 3–5 |
| Mystique Allure | enhanced_defense | 260–300 | 660–700 |
| Nobunaga's Battle Slicer | ignore_arcane_res | 20 | 25–40 |
| Philosopher's Stone | all_attributes | 15 | 20–40 |
| Pillar of Niflheim | deadly_blow | 15 | 10 |
| Pirate Captain's Boots | movement_speed | 20–30 | 40–50 |
| Pirate Captain's Hat | enhanced_defense | 80–130 | 280–330 |
| Pirate Captain's Hat | to_dexterity | 15 | 35 |
| Pirate Captain's Shirt | enhanced_defense | 130–160 | 530–560 |
| Pirate Captain's Shirt | to_dexterity | 10–20 | 40–65 |
| Pirate Captain's Shirt | to_vitality | 15 | 50 |
| Plunderer's Spy Glass | cold_skill_damage | 8–15 | 15–25 |
| Poison Ivy | poison_skill_damage | 5–15 | 10–20 |
| Poison Ivy | to_dexterity | 7 | 15 |
| Poison Ivy | to_strength | 7 | 15 |
| Rapidshell Medallion | increased_attack_speed | 10 | 12–20 |
| Redneck's Cap | life | 50–60 | 160–260 |
| Redneck's Cap | to_vitality | 10 | 20–30 |
| Rendguard of Carnage | crushing_blow_chance | 15–25 | 6–15 |
| Rendguard of Carnage | deadly_blow | 15–25 | 6–15 |
| Revenant's Lasher | increased_attack_speed | 20–40 | 40–60 |
| Rift Eye | mana | 750–1250 | 250–500 |
| Sacred Aegis | life | 750–1 | 420–700 |
| Sacred Marchers | movement_speed | 20–30 | 40–50 |
| Sacred Robe | all_resistances | 10–30 | 25–30 |
| Sacred Robe | to_energy | 10–15 | 30–45 |
| Sacred Whip | all_resistances | 10 | 15 |
| Sand Manipulator's Authority | ignore_arcane_res | 5–15 | 8–25 |
| Sand Manipulator's Authority | to_intelligence | 10 | 30 |
| Sand Manipulator's Kalasiris | all_resistances | 10 | 30 |
| Sand Manipulator's Kalasiris | enhanced_defense | 160–200 | 260–300 |
| Sand Manipulator's Kalasiris | magic_find | 10–20 | 15–30 |
| Sands of Time | faster_cast_rate | 20 | 30 |
| Satanic Eye | all_attributes | 7–15 | 10–20 |
| Scout's Medal of Honor | to_dexterity | 10 | 15–30 |
| Set's Lightning Sash | lightning_skill_damage | 15–25 | 25–35 |
| Set's Lightning Sash | lightning_skills | 2–4 | 3–6 |
| Shield of the Abyss | enhanced_defense | 240–300 | 540–600 |
| Shield of the Abyss | faster_hit_recovery | 60 | 125 |
| Shield of the Abyss | ignore_cold_res | 8–20 | 15–25 |
| Solar Prophet's Signet | fire_skills | 1 | 1–2 |
| Spell Eater | all_skills | 6 | 4 |
| Spiritus | all_skills | 1–2 | 2–3 |
| St. Amitiel's Truth | deadly_blow | 20 | 30 |
| St. Hallgar's Bloodforged Aegis | all_skills | 3 | 4–5 |
| Steve's Wand of Fortune | all_skills | 2–4 | 3–6 |
| Stone of Archaeology | magic_find | 10–15 | 15–40 |
| Tal's Pendant | all_attributes | 8 | 15 |
| Tarek's Tradeoff | movement_speed | 30–40 | 30–70 |
| Tarethiel's Ancient Wisdom | all_skills | 1 | 1–3 |
| The Templar | life | 500–750 | 380–550 |
| Thor's Battle Cap | ignore_arcane_res | 3–8 | 8–15 |
| Traveler's Leather Jacket | all_attributes | 5 | 20 |
| Traveler's Leather Jacket | all_skills | 1 | 1–3 |
| Traveler's Leather Jacket | enhanced_defense | 160–180 | 150–300 |
| Treasure Pendant | magic_find | 10–30 | 25–50 |
| Treasure Pendant | movement_speed | 10 | 10–30 |
| Tropical Storm | lightning_skill_damage | 25–40 | 20–30 |
| Valkyrie's Battle Raiment | ignore_lightning_res | 7–15 | 15–20 |
| Venom's Skull | poison_skills | 1 | 2 |
| Vorpal Sharktooth | enhanced_damage | 255–290 | 720–830 |
| Vorpal Sharktooth | increased_attack_speed | 20–30 | 35–50 |
| Vorpal Sharktooth | life_steal | 3–6 | 10–15 |
| Vorpal Sharktooth | to_strength | 15 | 50 |
| Whisper Walker's Feiyue | all_skills | 1 | 1–2 |
| Zealot's Book of Prophecy | arcane_skill_damage | 10–15 | 45–55 |
| Zealot's Deathbringers | arcane_skill_damage | 15–25 | 40–50 |
| Zealot's Deathbringers | arcane_skills | 1 | 4–6 |
| Zealot's Deathbringers | faster_cast_rate | 20–30 | 40–50 |
| Zealot's Guise of Doom | to_energy | 15 | 30–40 |

## Small drifts (<25%)

| Item | Stat | HSPlanner | hsguides |
|---|---|---|---|
| Abomination's Gut Ripper | enhanced_damage | 660–740 | 780–920 |
| Abomination's Gut Ripper | increased_attack_speed | 10–100 | 35–100 |
| Absolute Zero | increased_attack_speed | 25–35 | 27–35 |
| Arcana Eye | to_energy | 15 | 20 |
| Brimskull Trident | increased_attack_speed | 35–60 | 35–50 |
| Celestial's Authority | arcane_skill_damage | 30–50 | 40–50 |
| Celestial's Authority | ignore_arcane_res | 50–60 | 40–60 |
| Champion's Medal of Valor | to_vitality | 15–20 | 15–30 |
| Clafaxier | poison_skill_damage | 20 | 20–30 |
| Daisy | enhanced_damage | 775–850 | 814–945 |
| Daisy | physical_skills | 1–4 | 2–4 |
| Damien's Corrupted Head | all_skills | 2–4 | 3–4 |
| Diablo | fire_skill_damage | 30–66 | 16–66 |
| Dragon's Blessing | magic_find | 20–200 | 50–200 |
| Electro | increased_attack_speed | 10–30 | 15–30 |
| Fulgurite | all_skills | 1–2 | 1–3 |
| Gabriel's Broken Resolve | enhanced_damage | 890–975 | 890–945 |
| Gabriel's Broken Resolve | life_steal | 10–15 | 14–15 |
| Gaze of the Oblivion | to_vitality | 25–40 | 20–40 |
| Gladiator's Skullcrusher | enhanced_damage | 310–370 | 415–475 |
| Gladiator's Skullcrusher | to_strength | 20 | 25 |
| Gladiator's Wrecking Ball | deadly_blow | 50 | 60 |
| Glimmerfury | movement_speed | 15 | 20 |
| Glimmerfury | to_dexterity | 15 | 15–20 |
| Harlequinn's Veil | magic_find | 28–50 | 28–60 |
| High Demon's Necklace | life_steal | 3–7 | 4–7 |
| Icy Crusher | cold_skill_damage | 25–35 | 30–40 |
| Icy Crusher | enhanced_damage | 320–375 | 400–465 |
| Insignia of the Burning Legion | increased_attack_speed | 10–20 | 20 |
| Kallik's Fury | increased_attack_speed | 18 | 18–28 |
| Light Bringer's Mark | increased_attack_speed | 20–40 | 20–30 |
| Manafunneler's Conjurer | to_energy | 30–40 | 20–40 |
| Molten Paw | enhanced_damage | 380–420 | 420–500 |
| Pit Lord's Vanquisher | to_strength | 20–35 | 20–40 |
| Revenant's Lasher | all_skills | 3 | 2–3 |
| Revenant's Lasher | ignore_lightning_res | 15–25 | 20–30 |
| Rift Eye | arcane_skills | 2–4 | 2–3 |
| Rift Eye | to_energy | 25–40 | 25–30 |
| Riftmaster's Dirge | all_skills | 2–3 | 2 |
| Sacred Whip | magic_find | 20–35 | 25–40 |
| Satanic Eye | all_resistances | 10–30 | 20–30 |
| Scarred Battle Darts | life_steal | 6 | 5–8 |
| Scarred Battle Darts | physical_skills | 3–5 | 2–5 |
| Scout's Medal of Honor | movement_speed | 20 | 20–30 |
| Solar Prophet's Signet | fire_skill_damage | 5–15 | 8–15 |
| Spiritus | enhanced_damage | 225–260 | 255–320 |
| St. Mika's Zweihänder | all_skills | 3–5 | 5 |
| St. Mika's Zweihänder | movement_speed | 30 | 25–40 |
| Steve's Necklace | all_attributes | 50–100 | 50–80 |
| Steve's Punchbow | all_skills | 2 | 2–3 |
| Stone of Archaeology | movement_speed | 10–20 | 20 |
| Sähköpuimuri | enhanced_damage | 650–750 | 630–780 |
| Sähköpuimuri | increased_attack_speed | 70–80 | 60–85 |
| Sähköpuimuri | lightning_skill_damage | 23–40 | 25–40 |
| Tal's Pendant | magic_find | 20–30 | 25–40 |
| Unholy God's Flail | arcane_skill_damage | 15–25 | 12–20 |
| Viking's Sacred Axe | enhanced_damage | 285–340 | 320–380 |
| Whisper Walker's Feiyue | movement_speed | 30 | 40 |
| Wind's Force | to_dexterity | 40 | 50 |
| Wind's Force | to_strength | 40 | 50 |
| Wraith Forged Cleaver | life_steal | 11–15 | 12–18 |

## HSPlanner items not found on hsguides (name mismatch or missing there)

Blood Maggot Pendant, Captain's Anchor, Captain's Attire, Commander's Sentry Blaster, Conjured Tentacle, Destroyer's End, Devil's Horn, Ethereal Musket, Ghastly Skull, Ghost Armada, Ghostplunderer's Marchers, Grand Arch Wizard's Mantle, Grimtide's Necklace, Grimtide's Scimitar, Headsman's Bloodthrister, Hello its me, Steve!, Infected Grasp, Jar of Parasites, Judge, Jury & Executioner, Komodo's Bloodstrap, Leviathan's Blood, Leviathan's Crown, Leviathan's Ribcage, Leviathan's Spine, Overgrowth, Parasite Loop, Parasite Queen's Tiara, Parasitic Heart, Phantom Scimitar, Phantom Strike, Phantom's Step, Signet of Shadows (Arcane), Signet of Shadows (Cold), Signet of Shadows (Fire), Signet of Shadows (Lightning), Signet of Shadows (Physical), Signet of Shadows (Poison), Skeleton Crew's Band, Soulborn Belt, St. Draxis Pigstick, Stofflinx Cooking Cleaver, Wraith's Cloak (Arcane), Wraith's Cloak (Cold), Wraith's Cloak (Fire), Wraith's Cloak (Lightning), Wraith's Cloak (Poison)