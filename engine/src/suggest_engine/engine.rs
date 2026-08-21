use std::collections::{HashMap, HashSet};

use super::aggregate::{
    aggregate_tree_mods, apply_attribute_divided_stats, apply_attribute_increased, apply_disables,
    apply_fan_outs, apply_multiplier, apply_per_attribute_stats, apply_tree_conversions,
    TreeAggregateResult,
};
use super::types::{ranged_add, AttrMap, GameConfig, Ranged, StatMap, TreeNodeInfo};

// (flat key, %increased key, %more key, floor) — mirrors the life/mana/
// replenish entries of calc::stats::finalize::MULTIPLIER_SPECS.
const MULTIPLIED_STATS: [(&str, Option<&str>, Option<&str>, bool); 4] = [
    ("life", Some("increased_life"), Some("increased_life_more"), true),
    ("mana", Some("increased_mana"), Some("increased_mana_more"), true),
    ("mana_replenish", None, Some("mana_replenish_more"), false),
    ("life_replenish", None, Some("life_replenish_more"), false),
];

pub struct FinalState {
    pub attrs: AttrMap,
    pub stats: StatMap,
    pub unsupported_lines: Vec<String>,
}

pub struct EngineInputs<'a> {
    pub attr_contributions: &'a HashMap<String, Vec<Ranged>>,
    pub stat_contributions: &'a HashMap<String, Vec<Ranged>>,
    pub allocated_tree_nodes: &'a [u32],
    pub tree_node_info: &'a HashMap<u32, TreeNodeInfo>,
    pub player_conditions: &'a HashMap<String, bool>,
    pub jewelry_ids: &'a HashSet<u32>,
    pub game_config: &'a GameConfig,
}

fn sum_contributions(contributions: &HashMap<String, Vec<Ranged>>) -> HashMap<String, Ranged> {
    let mut out: HashMap<String, Ranged> = HashMap::with_capacity(contributions.len());
    for (k, vs) in contributions {
        let mut sum: Ranged = (0.0, 0.0);
        for r in vs {
            sum.0 += r.0;
            sum.1 += r.1;
        }
        out.insert(k.clone(), sum);
    }
    out
}

fn add_into(map: &mut HashMap<String, Ranged>, k: &str, v: Ranged) {
    let cur = map.get(k).copied().unwrap_or((0.0, 0.0));
    map.insert(k.to_string(), (cur.0 + v.0, cur.1 + v.1));
}

pub fn compute_final_state(inputs: &EngineInputs) -> FinalState {
    let tree: TreeAggregateResult = aggregate_tree_mods(
        inputs.allocated_tree_nodes,
        inputs.tree_node_info,
        inputs.player_conditions,
        inputs.jewelry_ids,
    );

    let attribute_keys: Vec<String> = if inputs.game_config.attribute_keys.is_empty() {
        vec![
            "strength".to_string(),
            "dexterity".to_string(),
            "intelligence".to_string(),
            "energy".to_string(),
            "vitality".to_string(),
            "armor".to_string(),
        ]
    } else {
        inputs.game_config.attribute_keys.clone()
    };

    let mut attrs: AttrMap = sum_contributions(inputs.attr_contributions);
    let mut stats: StatMap = sum_contributions(inputs.stat_contributions);

    for ak in &attribute_keys {
        attrs.entry(ak.clone()).or_insert((0.0, 0.0));
    }

    for (k, v) in &tree.attr_contributions {
        if k == "all_attributes" {
            for ak in &attribute_keys {
                add_into(&mut attrs, ak, *v);
            }
        } else {
            add_into(&mut attrs, k, *v);
        }
    }
    for (k, v) in &tree.stat_contributions {
        add_into(&mut stats, k, *v);
    }

    apply_attribute_increased(&mut attrs, &stats, &attribute_keys);

    apply_per_attribute_stats(
        &mut stats,
        &attrs,
        &inputs.game_config.default_stats_per_attribute,
    );
    apply_attribute_divided_stats(
        &mut stats,
        &attrs,
        &inputs.game_config.attribute_divided_stats,
    );

    apply_fan_outs(&mut stats);

    // Multiplied-flat stats: flat x (1 + increased) x (1 + more). Conversions
    // read the multiplied totals, but what they add is flat: it joins the
    // target's flat pool and is multiplied again — the same model as
    // calc::stats::finalize::reapply_multipliers_for_touched (planner's
    // choice, pending in-game verification), so optimizer and engine agree.
    let flat_totals: StatMap = MULTIPLIED_STATS
        .iter()
        .filter_map(|(flat, ..)| stats.get(*flat).map(|v| (flat.to_string(), *v)))
        .collect();
    for (flat, pct, more, floor) in MULTIPLIED_STATS {
        apply_multiplier(&mut stats, flat, pct, more, floor);
    }

    let converted = apply_tree_conversions(&mut attrs, &stats, &tree.conversions);
    for (k, v) in &converted {
        add_into(&mut stats, k, *v);
    }
    for (flat, pct, more, floor) in MULTIPLIED_STATS {
        let touched = |k: &str| converted.contains_key(k);
        if !(touched(flat) || pct.is_some_and(touched) || more.is_some_and(touched)) {
            continue;
        }
        let base = flat_totals.get(flat).copied().unwrap_or((0.0, 0.0));
        let added = converted.get(flat).copied().unwrap_or((0.0, 0.0));
        stats.insert(flat.to_string(), ranged_add(base, added));
        apply_multiplier(&mut stats, flat, pct, more, floor);
    }

    apply_disables(&mut stats, &tree.disables);

    for v in stats.values_mut() {
        if v.0.abs() < 1e-9 && v.1.abs() < 1e-9 {
            *v = (0.0, 0.0);
        }
    }

    FinalState {
        attrs,
        stats,
        unsupported_lines: tree.unsupported_lines,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calc::stats::{compute_build_stats, BuildStatsInput, ComputedStats, SourceMap};
    use crate::calc::types::CustomStat;

    fn calc_stats(custom_stats: &[CustomStat], tree: &HashSet<u32>) -> ComputedStats {
        let allocated = HashMap::new();
        let inventory = HashMap::new();
        let skill_ranks = HashMap::new();
        let active_buffs = HashMap::new();
        let tree_socketed = HashMap::new();
        let player_conditions = HashMap::new();
        let subskill_ranks = HashMap::new();
        let enemy_conditions = HashMap::new();
        compute_build_stats(&BuildStatsInput {
            class_id: None,
            level: 1,
            allocated_attrs: &allocated,
            inventory: &inventory,
            skill_ranks: &skill_ranks,
            active_aura_id: None,
            active_buffs: &active_buffs,
            custom_stats,
            allocated_tree_nodes: tree,
            tree_socketed: &tree_socketed,
            player_conditions: &player_conditions,
            subskill_ranks: &subskill_ranks,
            enemy_conditions: &enemy_conditions,
            granted_skill_ranks: None,
            main_skill_id: None,
        })
    }

    // Node 1912 ("10% of Maximum Mana added as Maximum life") converts into a
    // multiplied stat. Fed the engine's own flat sources, the optimizer must
    // land on the same life/mana as the engine: both multiply the converted
    // flat by the target's %increased.
    #[test]
    fn tree_conversion_into_life_matches_calc_engine() {
        const NODE: u32 = 1912;
        let Some(info) = crate::calc::data::tree_nodes().get(&NODE.to_string()) else {
            eprintln!("tree node {NODE} missing from data; skipping");
            return;
        };
        let cs = |key: &str, value: &str| CustomStat {
            stat_key: key.to_string(),
            value: value.to_string(),
        };
        let custom_stats = vec![
            cs("life", "100"),
            cs("increased_life", "50"),
            cs("mana", "1000"),
            cs("increased_mana", "100"),
        ];
        let without = calc_stats(&custom_stats, &HashSet::new());
        let with = calc_stats(&custom_stats, &[NODE].into_iter().collect());
        let expected_life = with.stats["life"];
        let expected_mana = with.stats["mana"];
        assert_ne!(expected_life, without.stats["life"], "node {NODE} must move life");

        // The optimizer gets the engine's unconverted flat sources as inputs.
        let as_contribs = |m: &SourceMap| -> HashMap<String, Vec<Ranged>> {
            m.iter()
                .map(|(k, list)| (k.clone(), list.iter().map(|c| c.value).collect()))
                .collect()
        };
        let stat_contributions = as_contribs(&without.stat_sources);
        let attr_contributions = as_contribs(&without.attribute_sources);
        let tree_node_info: HashMap<u32, TreeNodeInfo> = HashMap::from([(
            NODE,
            TreeNodeInfo {
                title: info.title.clone(),
                kind: info.kind.clone(),
                lines: info.lines.clone(),
            },
        )]);
        let state = compute_final_state(&EngineInputs {
            attr_contributions: &attr_contributions,
            stat_contributions: &stat_contributions,
            allocated_tree_nodes: &[NODE],
            tree_node_info: &tree_node_info,
            player_conditions: &HashMap::new(),
            jewelry_ids: &HashSet::new(),
            game_config: &GameConfig::default(),
        });
        assert!(state.unsupported_lines.is_empty(), "{:?}", state.unsupported_lines);
        assert_eq!(state.stats.get("mana").copied(), Some(expected_mana));
        assert_eq!(state.stats.get("life").copied(), Some(expected_life));
    }
}
