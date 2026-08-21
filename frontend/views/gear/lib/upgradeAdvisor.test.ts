import { beforeEach, describe, expect, it, vi } from 'vitest'
import { scanForUpgrades } from './upgradeAdvisor'
import { rankSlotItemsNative } from '../../../utils/calc/bridge'
import { pickerItemsForSlot } from '../pickerItems'
import { getItem } from '@data'
import type { BuildPerformanceDeps } from '../../../utils/build/buildPerformance'
import type { ItemBase } from '../../../types'

vi.mock('../../../utils/calc/bridge', () => ({
  rankSlotItemsNative: vi.fn(),
}))
vi.mock('../pickerItems', () => ({
  pickerItemsForSlot: vi.fn(),
}))
vi.mock('@data', () => ({
  gameConfig: {
    slots: [
      { key: 'helm', name: 'Helm', group: 'armor' },
      { key: 'weapon', name: 'Weapon', group: 'weapons' },
      { key: 'offhand', name: 'Offhand', group: 'weapons' },
      { key: 'boots', name: 'Boots', group: 'armor' },
      { key: 'gloves', name: 'Gloves', group: 'armor' },
      { key: 'belt', name: 'Belt', group: 'armor' },
      { key: 'ring', name: 'Ring', group: 'jewelry' },
      { key: 'amulet', name: 'Amulet', group: 'jewelry' },
      { key: 'charm_1', name: 'Charm 1', group: 'charms' },
    ],
  },
  getItem: vi.fn(),
  incarnationNodeInfo: {},
}))

const mockRank = vi.mocked(rankSlotItemsNative)
const mockPicker = vi.mocked(pickerItemsForSlot)
const mockGetItem = vi.mocked(getItem)

function makeDeps(overrides: Partial<BuildPerformanceDeps> = {}): BuildPerformanceDeps {
  return {
    classId: 'amazon',
    level: 50,
    allocatedAttrs: {},
    inventory: {},
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
    ...overrides,
  }
}

type Inv = BuildPerformanceDeps['inventory']
const inv = (entries: Record<string, string>): Inv =>
  Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, { baseId: v }])) as Inv

/** Item db used by the weapon-family tests. */
const ITEMS: Record<string, Partial<ItemBase>> = {
  sword_1h: { id: 'sword_1h', name: 'Short Sword', slot: 'weapon', baseType: 'Sword', twoHanded: false },
  sword_1h_best: { id: 'sword_1h_best', name: 'Grandfather', slot: 'weapon', baseType: 'Sword', twoHanded: false },
  axe_2h: { id: 'axe_2h', name: 'Great Axe', slot: 'weapon', baseType: 'Axe', twoHanded: true },
  shield_a: { id: 'shield_a', name: 'Buckler', slot: 'offhand', baseType: 'Shield' },
  shield_b: { id: 'shield_b', name: 'Tower Shield', slot: 'offhand', baseType: 'Shield' },
  dagger_off: { id: 'dagger_off', name: 'Offhand Dagger', slot: 'weapon', baseType: 'Dagger', twoHanded: false },
}
function useItemDb() {
  mockGetItem.mockImplementation((id: string) => ITEMS[id] as ItemBase | undefined)
  mockPicker.mockImplementation((slot) =>
    slot === 'weapon'
      ? [
          { id: 'sword_1h', name: 'Short Sword' },
          { id: 'sword_1h_best', name: 'Grandfather' },
          { id: 'axe_2h', name: 'Great Axe' },
        ]
      : slot === 'offhand'
        ? [
            { id: 'shield_a', name: 'Buckler' },
            { id: 'shield_b', name: 'Tower Shield' },
            { id: 'dagger_off', name: 'Offhand Dagger' },
          ]
        : [
            { id: 'base_a', name: 'Base A' },
            { id: 'base_b', name: 'Base B' },
          ],
  )
}

beforeEach(() => {
  mockRank.mockReset()
  mockPicker.mockReset()
  mockPicker.mockReturnValue([
    { id: 'base_a', name: 'Base A' },
    { id: 'base_b', name: 'Base B' },
  ])
  mockGetItem.mockReset()
  mockGetItem.mockReturnValue(undefined)
})

describe('scanForUpgrades', () => {
  it('returns empty without a main skill and never calls the engine', async () => {
    const out = await scanForUpgrades(makeDeps({ activeSkillIds: [] }))
    expect(out.emptySlots).toHaveLength(0)
    expect(out.upgrades).toHaveLength(0)
    expect(mockRank).not.toHaveBeenCalled()
  })

  it('skips charm slots and does not rank empty slots', async () => {
    mockRank.mockResolvedValue({ base_a: 100, base_b: 120 })
    const deps = makeDeps({
      inventory: inv({ helm: 'base_a', boots: 'base_a', ring: 'base_a' }),
    })
    await scanForUpgrades(deps)
    const scannedSlots = mockRank.mock.calls.map((c) => c[1])
    expect(scannedSlots).toEqual(['helm', 'boots', 'ring'])
  })

  it('puts the empty slot in emptySlots and caps occupied upgrades at 5', async () => {
    mockRank.mockResolvedValue({ base_a: 100, base_b: 150 })
    const deps = makeDeps({
      inventory: inv({
        offhand: 'base_a',
        boots: 'base_a',
        gloves: 'base_a',
        belt: 'base_a',
        ring: 'base_a',
        amulet: 'base_a',
      }),
    })
    const out = await scanForUpgrades(deps)
    expect(out.emptySlots).toEqual([
      { slot: 'helm', slotName: 'Helm' },
      { slot: 'weapon', slotName: 'Weapon' },
    ])
    expect(out.upgrades).toHaveLength(5)
    expect(out.upgrades[0]?.gainPct).toBeCloseTo(50)
    expect(out.upgrades[0]?.kind).toBe('slot')
    expect(out.upgrades[0]?.changes).toEqual([{ slot: out.upgrades[0]?.slot, baseId: 'base_b' }])
  })

  it('omits occupied slots whose current base is already best', async () => {
    mockRank.mockResolvedValue({ base_a: 100, base_b: 101 })
    const deps = makeDeps({ inventory: inv({ helm: 'base_b' }) })
    const out = await scanForUpgrades(deps)
    expect(out.upgrades.find((s) => s.slot === 'helm')).toBeUndefined()
  })

  it('omits gains at or below the 2% threshold when a better base exists', async () => {
    mockRank.mockResolvedValue({ base_a: 100, base_b: 101.99 })
    const deps = makeDeps({
      inventory: inv({
        helm: 'base_a',
        offhand: 'base_a',
        boots: 'base_a',
        gloves: 'base_a',
        belt: 'base_a',
        ring: 'base_a',
        amulet: 'base_a',
      }),
    })
    const out = await scanForUpgrades(deps)
    expect(out.upgrades).toHaveLength(0)
    expect(out.emptySlots).toEqual([{ slot: 'weapon', slotName: 'Weapon' }])
  })

  it('names both sides of the swap on each suggestion', async () => {
    mockRank.mockResolvedValue({ base_a: 100, base_b: 150 })
    const out = await scanForUpgrades(makeDeps({ inventory: inv({ helm: 'base_a' }) }))
    expect(out.upgrades[0]).toMatchObject({
      currentBaseName: 'Base A',
      bestBaseName: 'Base B',
    })
  })

  it('falls back to the item db name when the current base is not a picker row', async () => {
    mockRank.mockResolvedValue({ base_x: 100, base_a: 90, base_b: 150 })
    mockGetItem.mockReturnValue({ name: 'Custom X' } as ReturnType<typeof getItem>)
    const out = await scanForUpgrades(makeDeps({ inventory: inv({ helm: 'base_x' }) }))
    expect(out.upgrades[0]?.currentBaseName).toBe('Custom X')
  })

  it('skips occupied slots whose current score is missing or non-positive', async () => {
    mockRank.mockResolvedValue({ base_a: 0, base_b: 120 })
    const out = await scanForUpgrades(makeDeps({ inventory: inv({ helm: 'base_a' }) }))
    expect(out.upgrades.find((s) => s.slot === 'helm')).toBeUndefined()
  })

  it('surfaces every empty slot uncapped, with no numeric upgrades and no engine calls', async () => {
    const out = await scanForUpgrades(makeDeps())
    expect(out.emptySlots).toHaveLength(8)
    expect(out.upgrades).toHaveLength(0)
    expect(mockRank).not.toHaveBeenCalled()
  })

  it('reports progress after each slot', async () => {
    mockRank.mockResolvedValue({ base_a: 100, base_b: 120 })
    const seen: Array<[number, number]> = []
    await scanForUpgrades(makeDeps({ inventory: inv({ helm: 'base_a' }) }), (done, total) =>
      seen.push([done, total]),
    )
    expect(seen).toEqual([
      [1, 8],
      [2, 8],
      [3, 8],
      [4, 8],
      [5, 8],
      [6, 8],
      [7, 8],
      [8, 8],
    ])
  })

  it('includes the current base in the ranked id list exactly once', async () => {
    mockRank.mockResolvedValue({ base_a: 100, base_b: 150 })
    await scanForUpgrades(makeDeps({ inventory: inv({ helm: 'base_a' }) }))
    const helmCall = mockRank.mock.calls.find((c) => c[1] === 'helm')
    expect(helmCall?.[2].filter((id) => id === 'base_a')).toHaveLength(1)
  })

  it('sorts occupied upgrades by gain descending, separately from empty slots', async () => {
    mockRank.mockImplementation(async (_deps, slot) =>
      slot === 'helm' ? { base_a: 100, base_b: 150 } : { base_a: 100, base_b: 110 },
    )
    const deps = makeDeps({
      inventory: inv({
        helm: 'base_a',
        offhand: 'base_b',
        gloves: 'base_a',
        belt: 'base_b',
        ring: 'base_b',
        amulet: 'base_b',
      }),
    })
    const out = await scanForUpgrades(deps)
    expect(out.emptySlots).toEqual([
      { slot: 'weapon', slotName: 'Weapon' },
      { slot: 'boots', slotName: 'Boots' },
    ])
    expect(out.upgrades.map((s) => s.slot)).toEqual(['helm', 'gloves'])
    expect(out.upgrades[0]?.gainPct ?? 0).toBeGreaterThan(out.upgrades[1]?.gainPct ?? 0)
  })

  it('skips the offhand slot when the equipped weapon is two-handed', async () => {
    useItemDb()
    mockRank.mockResolvedValue({ axe_2h: 100, sword_1h: 100, sword_1h_best: 100, shield_a: 100 })
    await scanForUpgrades(makeDeps({ inventory: inv({ weapon: 'axe_2h' }) }))
    const scannedSlots = mockRank.mock.calls.map((c) => c[1])
    // the weapon family scan ranks offhands for the best one-hander, but the
    // standalone offhand slot is not scanned while a two-hander is equipped
    expect(mockRank.mock.calls.filter((c) => c[1] === 'offhand' && c[0].inventory.weapon?.baseId === 'axe_2h')).toHaveLength(0)
    expect(scannedSlots.filter((s) => s === 'offhand').length).toBeLessThanOrEqual(1)
  })

  it('scans the offhand slot when the equipped weapon is one-handed', async () => {
    useItemDb()
    mockRank.mockResolvedValue({ sword_1h: 100, sword_1h_best: 130, axe_2h: 100, shield_a: 100, shield_b: 100 })
    await scanForUpgrades(makeDeps({ inventory: inv({ weapon: 'sword_1h', offhand: 'shield_a' }) }))
    // one standalone offhand scan with the equipped one-hander; the weapon
    // family's pairing scan runs with the best one-hander instead
    const standalone = mockRank.mock.calls.filter(
      (c) => c[1] === 'offhand' && c[0].inventory.weapon?.baseId === 'sword_1h',
    )
    expect(standalone).toHaveLength(1)
    const pairing = mockRank.mock.calls.filter(
      (c) => c[1] === 'offhand' && c[0].inventory.weapon?.baseId === 'sword_1h_best',
    )
    expect(pairing).toHaveLength(1)
  })

  describe('weapon family options', () => {
    beforeEach(() => useItemDb())

    it('ranks two-handers without the current offhand and one-handers with it, and offers both options', async () => {
      mockRank.mockImplementation(async (deps, slot, ids) => {
        if (slot === 'weapon' && !deps.inventory.offhand) {
          // 2H ranked with the shield removed
          return Object.fromEntries(ids.map((id) => [id, id === 'axe_2h' ? 180 : 0]))
        }
        if (slot === 'weapon') {
          // 1H ranked with the shield kept
          return { sword_1h: 100, sword_1h_best: 130 }
        }
        if (slot === 'offhand' && deps.inventory.weapon?.baseId === 'sword_1h_best') {
          return { shield_a: 140, shield_b: 160 }
        }
        return { shield_a: 100, shield_b: 101 }
      })
      const out = await scanForUpgrades(
        makeDeps({ inventory: inv({ weapon: 'sword_1h', offhand: 'shield_a' }) }),
      )
      const two = out.upgrades.find((s) => s.kind === 'two_handed')
      const one = out.upgrades.find((s) => s.kind === 'one_hand_shield')
      expect(two).toMatchObject({
        bestBaseId: 'axe_2h',
        bestBaseName: 'Great Axe',
        changes: [
          { slot: 'weapon', baseId: 'axe_2h' },
          { slot: 'offhand', baseId: null },
        ],
      })
      expect(two?.gainPct).toBeCloseTo(80)
      expect(one).toMatchObject({
        bestBaseId: 'sword_1h_best',
        offhandBaseName: 'Tower Shield',
        changes: [
          { slot: 'weapon', baseId: 'sword_1h_best' },
          { slot: 'offhand', baseId: 'shield_b' },
        ],
      })
      expect(one?.gainPct).toBeCloseTo(60)
      // the 2H call never carried the shield
      const twoHandCall = mockRank.mock.calls.find((c) => c[1] === 'weapon' && c[2].includes('axe_2h'))
      expect(twoHandCall?.[0].inventory.offhand).toBeUndefined()
      // sorted by gain with the 2H option first
      expect(out.upgrades.map((s) => s.kind)).toEqual(['two_handed', 'one_hand_shield'])
    })

    it('still lists the weaker family (with its gain) when only one family beats the current setup', async () => {
      mockRank.mockImplementation(async (deps, slot) => {
        if (slot === 'weapon' && !deps.inventory.offhand) return { axe_2h: 90 }
        if (slot === 'weapon') return { sword_1h: 100, sword_1h_best: 130 }
        return { shield_a: 135, shield_b: 120 }
      })
      const out = await scanForUpgrades(
        makeDeps({ inventory: inv({ weapon: 'sword_1h', offhand: 'shield_a' }) }),
      )
      const two = out.upgrades.find((s) => s.kind === 'two_handed')
      const one = out.upgrades.find((s) => s.kind === 'one_hand_shield')
      expect(two?.gainPct).toBeCloseTo(-10)
      expect(one).toMatchObject({ bestBaseId: 'sword_1h_best', offhandBaseName: 'Buckler' })
      expect(one?.changes).toEqual([{ slot: 'weapon', baseId: 'sword_1h_best' }])
      expect(one?.gainPct).toBeCloseTo(35)
    })

    it('offers nothing when neither family beats the current weapon by more than the threshold', async () => {
      mockRank.mockImplementation(async (deps, slot) => {
        if (slot === 'weapon' && !deps.inventory.offhand) return { axe_2h: 101 }
        if (slot === 'weapon') return { sword_1h: 100, sword_1h_best: 101 }
        return { shield_a: 101.5, shield_b: 90 }
      })
      const out = await scanForUpgrades(
        makeDeps({ inventory: inv({ weapon: 'sword_1h', offhand: 'shield_a' }) }),
      )
      expect(out.upgrades.filter((s) => s.slot === 'weapon')).toHaveLength(0)
    })

    it('with a two-hander equipped, pairs the best one-hander with the best offhand', async () => {
      mockRank.mockImplementation(async (deps, slot) => {
        if (slot === 'weapon') return { axe_2h: 100, sword_1h: 60, sword_1h_best: 70 }
        if (slot === 'offhand' && deps.inventory.weapon?.baseId === 'sword_1h_best')
          return { shield_a: 110, shield_b: 125 }
        return {}
      })
      const out = await scanForUpgrades(makeDeps({ inventory: inv({ weapon: 'axe_2h' }) }))
      const one = out.upgrades.find((s) => s.kind === 'one_hand_shield')
      expect(one).toMatchObject({
        currentBaseName: 'Great Axe',
        bestBaseId: 'sword_1h_best',
        offhandBaseName: 'Tower Shield',
        changes: [
          { slot: 'weapon', baseId: 'sword_1h_best' },
          { slot: 'offhand', baseId: 'shield_b' },
        ],
      })
      expect(one?.gainPct).toBeCloseTo(25)
      expect(out.upgrades.find((s) => s.kind === 'two_handed')).toBeUndefined()
    })

    it('adds a dual-wield option only when a weapon offhand clearly beats the best shield', async () => {
      mockRank.mockImplementation(async (deps, slot) => {
        if (slot === 'weapon' && !deps.inventory.offhand) return { axe_2h: 90 }
        if (slot === 'weapon') return { sword_1h: 100, sword_1h_best: 130 }
        if (slot === 'offhand' && deps.inventory.weapon?.baseId === 'sword_1h_best')
          return { shield_a: 140, shield_b: 150, dagger_off: 190 }
        return { shield_a: 100, shield_b: 90, dagger_off: 95 }
      })
      const out = await scanForUpgrades(
        makeDeps({ inventory: inv({ weapon: 'sword_1h', offhand: 'shield_a' }) }),
      )
      const shield = out.upgrades.find((s) => s.kind === 'one_hand_shield')
      const dual = out.upgrades.find((s) => s.kind === 'dual_wield')
      expect(shield).toMatchObject({ bestBaseId: 'sword_1h_best', offhandBaseName: 'Tower Shield' })
      expect(shield?.gainPct).toBeCloseTo(50)
      expect(dual).toMatchObject({
        bestBaseId: 'sword_1h_best',
        offhandBaseName: 'Offhand Dagger',
        changes: [
          { slot: 'weapon', baseId: 'sword_1h_best' },
          { slot: 'offhand', baseId: 'dagger_off' },
        ],
      })
      expect(dual?.gainPct).toBeCloseTo(90)
    })

    it('weapon options are not counted against the 5-row cap', async () => {
      mockRank.mockImplementation(async (deps, slot) => {
        if (slot === 'weapon' && !deps.inventory.offhand) return { axe_2h: 300 }
        if (slot === 'weapon') return { sword_1h: 100, sword_1h_best: 250 }
        if (slot === 'offhand') return { shield_a: 260, shield_b: 200 }
        return { base_a: 100, base_b: 150 }
      })
      const out = await scanForUpgrades(
        makeDeps({
          inventory: inv({
            weapon: 'sword_1h',
            offhand: 'shield_a',
            helm: 'base_a',
            boots: 'base_a',
            gloves: 'base_a',
            belt: 'base_a',
            ring: 'base_a',
            amulet: 'base_a',
          }),
        }),
      )
      expect(out.upgrades.filter((s) => s.kind === 'slot')).toHaveLength(5)
      expect(out.upgrades.filter((s) => s.slot === 'weapon')).toHaveLength(2)
    })
  })
})
