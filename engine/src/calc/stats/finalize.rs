use super::*;

// ---------- finalization helpers ----------

// Display name; `_more` variants are prefixed with "Total ".
pub(crate) fn stat_name(key: &str) -> String {
    if let Some(def) = stat_def(key) {
        if key.ends_with("_more") && def.key != key {
            return format!("Total {}", def.name);
        }
        return def.name.clone();
    }
    key.to_string()
}

pub(crate) fn compute_final_attributes(attr_sources: &SourceMap) -> HashMap<String, Ranged> {
    let mut attributes = HashMap::new();
    for attr in data::game_config().attributes.iter() {
        let sum =
            sum_contributions(attr_sources.get(&attr.key).map(|v| v.as_slice()).unwrap_or(&[]));
        attributes.insert(attr.key.clone(), sum);
    }
    attributes
}

pub(crate) fn compute_final_stats(stat_sources: &SourceMap) -> HashMap<String, Ranged> {
    let mut stats = HashMap::with_capacity(stat_sources.len());
    for (k, list) in stat_sources.iter() {
        stats.insert(k.clone(), sum_contributions(list));
    }
    stats
}

// One multiplied-flat stat: flat × (1 + pct) × (1 + more).
pub(crate) struct MultiplierSpec {
    pub flat: String,
    pub pct: Option<String>,
    pub more: Option<String>,
    pub floor: bool,
}

// life/mana × increased × more; replenishes opt out of floor. Ailment
// durations: (base + flat seconds) × increased%. No floor — the fraction is
// visible progress toward the next once-per-second tick.
pub(crate) static MULTIPLIER_SPECS: Lazy<Vec<MultiplierSpec>> = Lazy::new(|| {
    let spec = |flat: &str, pct: Option<&str>, more: Option<&str>, floor: bool| MultiplierSpec {
        flat: flat.to_string(),
        pct: pct.map(str::to_string),
        more: more.map(str::to_string),
        floor,
    };
    let mut out = vec![
        spec("life", Some("increased_life"), Some("increased_life_more"), true),
        spec("mana", Some("increased_mana"), Some("increased_mana_more"), true),
        spec("mana_replenish", None, Some("mana_replenish_more"), false),
        spec("life_replenish", None, Some("life_replenish_more"), false),
    ];
    for a in AILMENT_DURATION_PREFIXES {
        out.push(spec(
            &format!("{a}_duration"),
            Some(&format!("{a}_duration_pct")),
            None,
            false,
        ));
    }
    out
});

pub fn apply_multipliers_pass(stats: &mut HashMap<String, Ranged>) {
    for spec in MULTIPLIER_SPECS.iter() {
        apply_multiplier(
            stats,
            &spec.flat,
            spec.pct.as_deref(),
            spec.more.as_deref(),
            spec.floor,
        );
    }
}

// Conversions push new sources after the multiplier pass ran, and the plain
// re-sum of a touched key drops its multiplier. Rebuild every multiplied stat
// whose flat or percent key was touched: flat re-summed from sources, then
// multiplied again with the (possibly re-summed) percent totals in `stats`.
//
// Model (planner's choice, pending in-game verification): a conversion reads
// its source at the fully multiplied value, and what it adds is flat — it joins
// the target's flat pool and is multiplied by the target's own %increased/%more
// like any other flat source. suggest_engine::engine::compute_final_state
// follows the same model so the optimizer and the engine agree.
pub fn reapply_multipliers_for_touched(
    stats: &mut HashMap<String, Ranged>,
    stat_sources: &SourceMap,
    touched: &HashSet<String>,
) {
    for spec in MULTIPLIER_SPECS.iter() {
        let feeds = touched.contains(&spec.flat)
            || spec.pct.as_ref().is_some_and(|k| touched.contains(k))
            || spec.more.as_ref().is_some_and(|k| touched.contains(k));
        if !feeds {
            continue;
        }
        let Some(list) = stat_sources.get(&spec.flat) else {
            continue;
        };
        stats.insert(spec.flat.clone(), sum_contributions(list));
        apply_multiplier(
            stats,
            &spec.flat,
            spec.pct.as_deref(),
            spec.more.as_deref(),
            spec.floor,
        );
    }
}

// Ailments with a modeled base duration in game-config defaultBaseStats.
pub(crate) const AILMENT_DURATION_PREFIXES: &[&str] = &[
    "bleed",
    "burning",
    "frostbite",
    "permafrost",
    "poisoned",
    "rabies",
    "shadowburn",
    "stasis",
];

// Item-granted skill conversions; returns touched keys for re-sum.
pub fn apply_item_granted_conversions(
    item_granted_ranks: &HashMap<String, Ranged>,
    stats: &HashMap<String, Ranged>,
    player_conditions: &HashMap<String, bool>,
    stat_sources: &mut SourceMap,
) -> HashSet<String> {
    let mut touched: HashSet<String> = HashSet::new();
    for granted in data::item_granted_skills().iter() {
        let Some(converts) = granted.passive_converts.as_ref() else {
            continue;
        };
        // Conditional blessings only convert while their config toggle is on.
        if let Some(cond) = granted.condition.as_ref() {
            if !player_conditions.get(cond.as_str()).copied().unwrap_or(false) {
                continue;
            }
        }
        let key = normalize_skill_name(&granted.name);
        let (rank_min, rank_max) = item_granted_ranks.get(&key).copied().unwrap_or((0.0, 0.0));
        if rank_max <= 0.0 {
            continue;
        }
        for conv in converts.per_rank.iter() {
            let from = stats.get(&conv.from).copied().unwrap_or((0.0, 0.0));
            let from_more = stats
                .get(&format!("{}_more", conv.from))
                .copied()
                .unwrap_or((0.0, 0.0));
            let effective = combine_additive_and_more(from, from_more);
            let add_min = ((conv.base_pct + conv.pct * rank_min) / 100.0) * effective.0;
            let add_max = ((conv.base_pct + conv.pct * rank_max) / 100.0) * effective.1;
            if add_min == 0.0 && add_max == 0.0 {
                continue;
            }
            let rank_label = if rank_min == rank_max {
                format!("{rank_min}")
            } else {
                format!("{rank_min}-{rank_max}")
            };
            let label = format!(
                "Converted from {} ({}, rank {rank_label})",
                stat_name(&conv.from),
                granted.name
            );
            push_source(
                stat_sources,
                &conv.to,
                SourceContribution {
                    label,
                    source_type: SourceType::Item,
                    value: (add_min, add_max),
                    forge: None,
                },
            );
            touched.insert(conv.to.clone());
        }
    }
    touched
}

// Tree conversions can target attributes (re-summed in place) or stats
// (returned in `touched` for the orchestrator to re-sum).
#[allow(clippy::too_many_arguments)]
pub fn apply_tree_conversions(
    tree_conversions: &[(ParsedConversion, String)],
    attributes: &mut HashMap<String, Ranged>,
    stats: &HashMap<String, Ranged>,
    attr_sources: &mut SourceMap,
    stat_sources: &mut SourceMap,
) -> HashSet<String> {
    use crate::calc::tree::parse::ConvertKind;
    let mut touched: HashSet<String> = HashSet::new();
    for (conv, source_label) in tree_conversions.iter() {
        let source_value: Ranged = match conv.from_kind {
            ConvertKind::Attribute => attributes
                .get(&conv.from_key)
                .copied()
                .unwrap_or((0.0, 0.0)),
            ConvertKind::Stat => {
                let from = stats.get(&conv.from_key).copied().unwrap_or((0.0, 0.0));
                let from_more = stats
                    .get(&format!("{}_more", conv.from_key))
                    .copied()
                    .unwrap_or((0.0, 0.0));
                combine_additive_and_more(from, from_more)
            }
        };
        let add_min = (conv.pct / 100.0) * source_value.0;
        let add_max = (conv.pct / 100.0) * source_value.1;
        if add_min == 0.0 && add_max == 0.0 {
            continue;
        }
        let label = format!(
            "{source_label}: {}% of {}",
            conv.pct,
            stat_name(&conv.from_key)
        );
        let contrib = SourceContribution {
            label,
            source_type: SourceType::Tree,
            value: (add_min, add_max),
            forge: None,
        };
        match conv.to_kind {
            ConvertKind::Attribute => {
                push_source(attr_sources, &conv.to_key, contrib);
                if let Some(list) = attr_sources.get(&conv.to_key) {
                    attributes.insert(conv.to_key.clone(), sum_contributions(list));
                }
            }
            ConvertKind::Stat => {
                push_source(stat_sources, &conv.to_key, contrib);
                touched.insert(conv.to_key.clone());
            }
        }
    }
    touched
}

// Post-pipeline disable flags. Currently only zeros life_replenish/_pct.
pub fn apply_tree_disables(disables: &HashSet<DisableTarget>, stats: &mut HashMap<String, Ranged>) {
    if disables.contains(&DisableTarget::LifeReplenish) {
        stats.insert("life_replenish".to_string(), (0.0, 0.0));
        stats.insert("life_replenish_pct".to_string(), (0.0, 0.0));
    }
}

