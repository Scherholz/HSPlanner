import type { EquippedItem, Inventory, SlotKey } from '../../../types'
import type { UpgradeChange, UpgradeSuggestion } from './upgradeAdvisor'

function bare(baseId: string): EquippedItem {
  return { baseId, affixes: [], socketCount: 0, socketed: [], socketTypes: [] }
}

/** Inventory with the given slots swapped for bare bases (null = emptied). */
export function applyBareChanges(inventory: Inventory, changes: UpgradeChange[]): Inventory {
  const next: Inventory = { ...inventory }
  for (const c of changes) {
    if (c.baseId === null) delete next[c.slot]
    else next[c.slot] = bare(c.baseId)
  }
  return next
}

/** The slots a suggestion actually changes, weapon first so the cards line up. */
export function changedSlots(s: UpgradeSuggestion): SlotKey[] {
  const slots = new Set<SlotKey>(s.changes.map((c) => c.slot))
  if (slots.size === 0) slots.add(s.slot)
  return [...slots].toSorted((a, b) => (a === 'weapon' ? -1 : b === 'weapon' ? 1 : 0))
}

/** Slots shown in the compare cards: the changed ones plus the offhand for context on weapon options. */
export function displaySlots(s: UpgradeSuggestion): SlotKey[] {
  const slots = changedSlots(s)
  if (s.kind !== 'slot' && !slots.includes('offhand')) slots.push('offhand')
  return slots
}

/** The slot the picker should open for a suggestion: the first changed slot. */
export function pickerSlotFor(s: UpgradeSuggestion): SlotKey {
  return s.changes[0]?.slot ?? s.slot
}

/**
 * Before/after inventories on the same footing as the scan's gain%: only the
 * slots the suggestion changes are bared on the before side; everything else
 * stays exactly as equipped on both sides.
 */
export function compareInventories(inventory: Inventory, s: UpgradeSuggestion): { before: Inventory; after: Inventory } {
  const before = applyBareChanges(
    inventory,
    changedSlots(s)
      .filter((slot) => inventory[slot])
      .map((slot) => ({ slot, baseId: inventory[slot]!.baseId })),
  )
  return { before, after: applyBareChanges(before, s.changes) }
}
