import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UpgradeCompareModal } from './UpgradeCompareModal'
import { applyBareChanges, changedSlots, compareInventories, displaySlots, pickerSlotFor } from './lib/upgradeCompare'
import { computeBuildSummary, type BuildSummary } from './lib/diff'
import type { BuildPerformanceDeps } from '../../utils/build/buildPerformance'
import type { Inventory } from '../../types'
import type { UpgradeSuggestion } from './lib/upgradeAdvisor'

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type DiffModule = typeof import('./lib/diff')

vi.mock('./lib/diff', async (importOriginal) => {
  const original = await importOriginal<DiffModule>()
  return { ...original, computeBuildSummary: vi.fn() }
})

const mockSummary = vi.mocked(computeBuildSummary)

const SWORD = 'base_sword_short_sword'
const GREAT_AXE = 'base_melee_giant_axe'
const SHIELD = 'shields_normal_buckler'

function bare(baseId: string) {
  return { baseId, affixes: [], socketCount: 0, socketed: [], socketTypes: [] }
}

function makeDeps(inventory: Inventory): BuildPerformanceDeps {
  return {
    classId: 'amazon',
    level: 50,
    allocatedAttrs: {},
    inventory,
    skillRanks: {},
    subskillRanks: {},
    activeAuraId: null,
    activeBuffs: {},
    customStats: [],
    allocatedTreeNodes: new Set(),
    treeSocketed: {},
    activeSkillIds: ['skill-1'],
    enemyConditions: {},
    playerConditions: {},
    skillProjectiles: {},
    enemyResistances: {},
    procToggles: {},
    killsPerSec: 0,
  }
}

function summary(dps: number, itemBaseId: string | null): BuildSummary {
  return {
    stats: {},
    statsCombined: {},
    attributes: {},
    rankBonuses: {},
    damage: null,
    hitDpsMin: dps,
    hitDpsMax: dps,
    combinedDpsMin: dps,
    combinedDpsMax: dps,
    activeSkillName: 'Multishot',
    itemBaseId,
    itemName: itemBaseId,
    itemRarity: 'common',
    itemSockets: 0,
    itemSocketsMax: 0,
  } as unknown as BuildSummary
}

const TWO_HANDED: UpgradeSuggestion = {
  slot: 'weapon',
  slotName: 'Weapon',
  kind: 'two_handed',
  currentBaseName: 'Short Sword',
  bestBaseId: GREAT_AXE,
  bestBaseName: 'Giant Axe',
  gainPct: 25,
  currentScore: 100,
  bestScore: 125,
  changes: [
    { slot: 'weapon', baseId: GREAT_AXE },
    { slot: 'offhand', baseId: null },
  ],
}

beforeEach(() => {
  mockSummary.mockReset()
  mockSummary.mockImplementation(async (inventory) =>
    summary(inventory.weapon?.baseId === GREAT_AXE ? 125 : 100, inventory.weapon?.baseId ?? null),
  )
})

describe('applyBareChanges / affectedSlots', () => {
  it('swaps slots for bare bases and removes nulls', () => {
    const inv = applyBareChanges({ weapon: bare(SWORD), offhand: bare(SHIELD) }, TWO_HANDED.changes)
    expect(inv.weapon?.baseId).toBe(GREAT_AXE)
    expect(inv.offhand).toBeUndefined()
  })

  it('lists weapon then offhand for weapon-family suggestions', () => {
    expect(changedSlots(TWO_HANDED)).toEqual(['weapon', 'offhand'])
    expect(displaySlots(TWO_HANDED)).toEqual(['weapon', 'offhand'])
    const ring = { ...TWO_HANDED, kind: 'slot' as const, slot: 'ring_1' as const, changes: [{ slot: 'ring_1' as const, baseId: 'x' }] }
    expect(changedSlots(ring)).toEqual(['ring_1'])
    expect(displaySlots(ring)).toEqual(['ring_1'])
  })

  it('keeps an untouched offhand as equipped (with its affixes) on both sides and opens the picker on the first changed slot', () => {
    const affixedShield = { ...bare(SHIELD), affixes: [{ affixId: 'a', tier: 1, roll: 1 }] }
    const weaponOnly: UpgradeSuggestion = { ...TWO_HANDED, kind: 'one_hand_shield', bestBaseId: SWORD, changes: [{ slot: 'weapon', baseId: SWORD }] }
    const { before, after } = compareInventories({ weapon: { ...bare(GREAT_AXE), stars: 3 }, offhand: affixedShield }, weaponOnly)
    expect(before.weapon).toEqual(bare(GREAT_AXE))
    expect(before.offhand).toBe(affixedShield)
    expect(after.offhand).toBe(affixedShield)
    expect(after.weapon?.baseId).toBe(SWORD)
    expect(displaySlots(weaponOnly)).toEqual(['weapon', 'offhand'])
    const offhandOnly: UpgradeSuggestion = { ...weaponOnly, changes: [{ slot: 'offhand', baseId: SHIELD }] }
    expect(pickerSlotFor(offhandOnly)).toBe('offhand')
    expect(pickerSlotFor(weaponOnly)).toBe('weapon')
  })
})

describe('<UpgradeCompareModal>', () => {
  it('shows both sides, the verdict, and wires Switch / picker / close', async () => {
    const onSwitch = vi.fn()
    const onPick = vi.fn()
    const onClose = vi.fn()
    render(
      <UpgradeCompareModal
        suggestion={TWO_HANDED}
        deps={makeDeps({ weapon: bare(SWORD), offhand: bare(SHIELD) })}
        onSwitch={onSwitch}
        onPickSlot={onPick}
        onClose={onClose}
      />,
    )
    expect(await screen.findByText('Upgrade')).toBeInTheDocument()
    expect(screen.getByText('Current')).toBeInTheDocument()
    expect(screen.getByText('Recommended')).toBeInTheDocument()
    // the recommended side drops the offhand
    expect(screen.getByText(/offhand · empty/i)).toBeInTheDocument()
    // before = bare current bases, after = suggestion applied
    const [beforeInv, afterInv] = mockSummary.mock.calls.map((c) => c[0])
    expect(beforeInv?.weapon?.baseId).toBe(SWORD)
    expect(beforeInv?.offhand?.baseId).toBe(SHIELD)
    expect(afterInv?.weapon?.baseId).toBe(GREAT_AXE)
    expect(afterInv?.offhand).toBeUndefined()

    await userEvent.click(screen.getByRole('button', { name: /switch to this/i }))
    expect(onSwitch).toHaveBeenCalledWith(TWO_HANDED.changes)
    await userEvent.click(screen.getByRole('button', { name: /open slot picker/i }))
    expect(onPick).toHaveBeenCalledWith('weapon')
    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
