# Engine modelling assumptions (pending in-game verification)

Rules the calc engine applies that are not documented in the game data. Each
is the planner's chosen model, recorded so reviewers don't re-open it; replace
with the verified rule when one is confirmed in game.

## Dual wield (Master of Wands / Hercules Grip)

- **Attacks per second: main hand only.** The offhand weapon's base rate
  (`implicit.attacks_per_second`, or a user override of it) is discarded — not
  summed, averaged or maxed. `engine/src/calc/stats/inventory.rs`.
- **Base damage: main hand only.** The attack panel swings the `weapon` slot
  item; `base.attack_speed` is likewise read from the main hand only
  (`engine/src/calc/build.rs`, `inventory.rs`).
- Offhand non-rate implicits (enhanced_damage, +skills, melee_range, ...) join
  the shared stat pool like any other slot.
- A main-hand base with no APS source plus an offhand weapon falls back to the
  default 1.5 APS.

## Tree conversions into multiplied stats (life / mana / replenishes)

Nodes such as 1534/1548/1876/1912/2354 ("X% of A added as / converted to B")
and 1740/1814/2972 (targets `increased_life`):

- The conversion reads its source at the **fully multiplied** value
  (`flat x (1 + increased) x (1 + more)`).
- What it adds is **flat**: it joins the target's flat pool and is multiplied
  again by the target's own %increased / %more.
- Both pipelines implement this: `calc::stats::finalize::
  reapply_multipliers_for_touched` and `suggest_engine::engine::
  compute_final_state`; a parity test pins node 1912
  (`suggest_engine::engine::tests::tree_conversion_into_life_matches_calc_engine`).
