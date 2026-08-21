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

/** The slots a suggestion touches, weapon first so the cards line up. */
export function affectedSlots(s: UpgradeSuggestion): SlotKey[] {
  const slots = new Set<SlotKey>([s.slot, ...s.changes.map((c) => c.slot)])
  if (s.kind !== 'slot') slots.add('offhand')
  return [...slots].toSorted((a, b) => (a === 'weapon' ? -1 : b === 'weapon' ? 1 : 0))
}
