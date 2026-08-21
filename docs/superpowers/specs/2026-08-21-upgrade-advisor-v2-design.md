# Upgrade Advisor v2 — design

Date: 2026-08-21 · Status: implemented under stated assumptions (user not available for live Q&A)

## Problem

The Gear view's Upgrade Advisor scans every slot, ranks bare item bases with the engine
(`rank_slot_items`) and lists "current base → best base (+gain%)". Two gaps:

1. **Weapon slot ignores the offhand trade-off.** `rank_slot_items` swaps the weapon base but
   keeps whatever is in the offhand, so a two-handed candidate is scored *with the shield still
   equipped* — a state the store never allows (`withValidOffhand` drops the shield on equip). 2H
   weapons are therefore over-rated, and the 1H + shield alternative is never evaluated as a pair.
2. **A click only opens the slot picker.** There is no side-by-side view of "what I have" vs "what
   is proposed", and no one-click way to apply the suggestion.

## Goals

- Weapon suggestions come as **two explicit options**: best **two-handed** (offhand removed unless
  the tree allows it) and best **one-hand + shield** (best 1H, then best offhand for that 1H),
  each with its own gain vs the current setup — both shown so the user can choose.
- Clicking any suggestion opens a **compare dialog**: current item(s) and recommended item(s)
  side by side (item cards), DPS / build stat deltas, verdict, and a **Switch** button that
  applies the change (plus a secondary "Open slot picker" for fine-tuning).
- Keep the existing semantics everywhere else (bare-base comparison, 2% threshold, cap 5,
  progress per slot, empty-slot summary).

## Non-goals

- Carrying affixes/sockets/stars over to the new base (the dialog says so; the slot picker and
  stash already cover re-rolling).
- Ranking every (1H × offhand) pair. Cost is bounded: best 1H first, then offhands for it.
- Changing the Rust engine. All inventory shaping happens in the frontend before calling
  `rank_slot_items`.

## Design

### `frontend/views/gear/lib/upgradeAdvisor.ts`

`UpgradeSuggestion` grows:

```ts
kind: 'slot' | 'two_handed' | 'one_hand_shield'
changes: { slot: SlotKey; baseId: string | null }[]   // what "Switch" applies; null = unequip
currentScore: number; bestScore: number
offhandBaseName?: string                               // one_hand_shield: the paired shield
```

Weapon slot algorithm (only when a weapon is equipped; empty weapon stays an "empty slot"):

1. `baseline` = score of the current weapon base in the current inventory (as today).
2. Split weapon picker rows into `oneHand` and `twoHand` (`getItem(id).twoHanded`).
3. Rank `oneHand` with the current inventory (offhand kept). Rank `twoHand` with the offhand
   removed, except candidates for which `canOffhand(currentOffhand, candidate, tree)` holds
   (Hercules Grip) — those keep it. Each group is one `rankSlotItemsNative` call.
4. Best 1H → rank offhand picker rows (filtered by `canOffhand(base, best1H, tree)`; the
   current offhand is included only when it fits) with the best 1H equipped bare. Candidates
   are compared on one footing (bare 1H + bare offhand). If the current offhand wins, the
   option keeps it and its gain is the plain weapon swap (`keepScores[best1H]`); if a new
   shield wins, the gain is measured against a baseline with both slots bared (one extra
   engine call). A `dual_wield` option is added only when a weapon offhand clearly beats the
   best shield. Offhand-only upgrades are left to the standalone offhand slot scan (no
   duplicate rows). One-handers the store would separate from the current offhand (e.g. a
   wand offhand without Master of Wands) are ranked with the offhand removed, like 2H.
5. Emit up to two suggestions: `two_handed` (changes: weapon→2H, offhand→null when dropped) and
   `one_hand_shield` (changes: weapon→1H, offhand→shield when different). Whichever beats the
   baseline by more than the threshold is an upgrade; the other option is still listed (with
   its gain, possibly ≤ 0) so both choices are visible. Weapon options are exempt from the
   5-row cap; other slots are capped as before.
6. When the current weapon is already the best of its family, that family row is omitted
   (nothing to switch to).

Other slots: unchanged logic, `kind: 'slot'`, `changes: [{ slot, baseId: best }]`.

### `frontend/views/gear/UpgradeCompareModal.tsx` (new)

Props: `suggestion`, `deps: BuildPerformanceDeps`, `onSwitch(changes)`, `onPickSlot(slot)`,
`onClose`. Builds two inventories from `deps.inventory` (`lib/upgradeCompare.ts`): *before* =
only the slots the suggestion changes replaced by **bare** versions of the current bases
(everything else, e.g. a kept offhand, stays exactly as equipped — the same footing as the
gain%), *after* = the suggestion's changes applied (bare bases). The offhand card is shown for
context on weapon options; "Open slot picker" opens the first changed slot. Runs `computeBuildSummary` for both (reusing `lib/diff.ts`),
renders: verdict badge, item cards side by side (weapon [+ offhand] per side), Active-skill DPS
rows, build stat rows, a note that affixes/sockets are not carried over, and the buttons
**Switch to this** / **Open slot picker** / Close. Reuses `VerdictBadge`, `DiffSection` and
`CompareSummary` (exported from `CompareColumn.tsx`).

### `UpgradeAdvisor.tsx`

Rows show the family label (`Weapon · 2H`, `Weapon · 1H + shield`) and the detail
`Current → New (+ Shield)`. Clicking an upgrade row opens the compare modal; the empty-slot
row still jumps to the picker. **Switch** commits each change through the store
(`commitEquippedItem` with `makeEquippedItem`; `null` unequips) — the store's
`withValidOffhand` keeps weapon/offhand consistent. Results reset automatically when the build
changes (existing epoch logic).

### Tests

- `lib/upgradeAdvisor.test.ts`: weapon family behaviour (2H ranked without offhand, grip keeps
  it, 1H+shield pair, both options emitted, cap exemption), plus the existing cases.
- `UpgradeAdvisor.test.tsx`: row labels, click opens compare, Switch applies changes to the
  store, empty-slot row still routes to the picker.
- `UpgradeCompareModal.test.tsx`: renders cards and buttons, Switch/Close callbacks.

## Assumptions (made without the user)

- "Give both options" = always list both weapon families when a weapon is equipped and a
  better base exists in either family; gains are relative to the current setup.
- Comparison and Switch operate on bare bases, matching the advisor's existing contract.
- Hercules-Grip dual wield keeps the offhand for 2H candidates only when `canOffhand` allows it.

## Self-review outcome (same day)

A 4-dimension review with adversarial verification confirmed 14 findings; the gain-footing
mismatch (pair score with a bare offhand vs a baseline with the affixed offhand), the
duplicate offhand-only rows, offhand validity per 1H candidate, the compare dialog baring
untouched slots, the stray card margin, the picker slot, copy/label width, and the data items
(Summon Heretic stub, Crystal Infused Javelin APS, six spliced item corrections reverted) were
fixed; the engine-side multi-skill ranking test was added separately.
