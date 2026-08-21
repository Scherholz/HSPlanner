import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UpgradeAdvisor } from './UpgradeAdvisor'
import { scanForUpgrades } from './lib/upgradeAdvisor'
import { useBuildPerformanceDeps } from '../../hooks/useBuildPerformanceDeps'
import { useBuild } from '../../store/build'
import type { BuildPerformanceDeps } from '../../utils/build/buildPerformance'
import type { UpgradeScanResult } from './lib/upgradeAdvisor'
import type { UpgradeCompareModal as RealModal } from './UpgradeCompareModal'

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type AdvisorModule = typeof import('./lib/upgradeAdvisor')

vi.mock('./lib/upgradeAdvisor', async (importOriginal) => {
  const original = await importOriginal<AdvisorModule>()
  return { ...original, scanForUpgrades: vi.fn() }
})
vi.mock('../../hooks/useBuildPerformanceDeps', () => ({
  useBuildPerformanceDeps: vi.fn(),
}))
// The compare dialog has its own tests; stub it to a Switch/Close pair here.
vi.mock('./UpgradeCompareModal', () => ({
  UpgradeCompareModal: ({
    suggestion,
    onSwitch,
    onPickSlot,
    onClose,
  }: Parameters<typeof RealModal>[0]) => (
    <div data-testid="compare-modal">
      <span>compare: {suggestion.bestBaseName}</span>
      <button type="button" onClick={() => onSwitch(suggestion.changes)}>
        Switch to this
      </button>
      <button type="button" onClick={() => onPickSlot(suggestion.slot)}>
        Open slot picker
      </button>
      <button type="button" onClick={onClose}>
        Close compare
      </button>
    </div>
  ),
}))

const mockScan = vi.mocked(scanForUpgrades)
const mockUseDeps = vi.mocked(useBuildPerformanceDeps)
const initialState = useBuild.getState()

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

const EMPTY_RESULT: UpgradeScanResult = { emptySlots: [], upgrades: [] }

// Real base ids so Switch can equip through the store.
const SWORD = 'base_sword_short_sword'
const GREAT_AXE = 'base_melee_giant_axe'
const SHIELD = 'shields_normal_buckler'

const SUGGESTIONS: UpgradeScanResult = {
  emptySlots: [{ slot: 'helmet', slotName: 'Helm' }],
  upgrades: [
    {
      slot: 'weapon',
      slotName: 'Weapon',
      kind: 'two_handed',
      currentBaseName: 'Short Sword',
      bestBaseId: GREAT_AXE,
      bestBaseName: 'Great Axe',
      gainPct: 23.4,
      currentScore: 100,
      bestScore: 123.4,
      changes: [
        { slot: 'weapon', baseId: GREAT_AXE },
        { slot: 'offhand', baseId: null },
      ],
    },
    {
      slot: 'weapon',
      slotName: 'Weapon',
      kind: 'one_hand_shield',
      currentBaseName: 'Short Sword',
      bestBaseId: SWORD,
      bestBaseName: 'Short Sword',
      offhandBaseName: 'Buckler',
      gainPct: 12,
      currentScore: 100,
      bestScore: 112,
      changes: [{ slot: 'offhand', baseId: SHIELD }],
    },
    {
      slot: 'ring_1',
      slotName: 'Ring',
      kind: 'slot',
      currentBaseName: 'Manald Heal',
      bestBaseId: 'base_d',
      bestBaseName: 'Nagelring',
      gainPct: 2.3,
      currentScore: 100,
      bestScore: 102.3,
      changes: [{ slot: 'ring_1', baseId: 'base_d' }],
    },
  ],
}

beforeEach(() => {
  mockScan.mockReset()
  mockUseDeps.mockReset()
  mockUseDeps.mockReturnValue(makeDeps())
  useBuild.setState(initialState, true)
})

async function scan() {
  await userEvent.click(screen.getByRole('button', { name: /scan for upgrades/i }))
}

describe('<UpgradeAdvisor>', () => {
  it('starts idle with the scan button and no engine call', () => {
    render(<UpgradeAdvisor onPickSlot={() => {}} />)
    expect(screen.getByRole('button', { name: /scan for upgrades/i })).toBeEnabled()
    expect(mockScan).not.toHaveBeenCalled()
  })

  it('disables scanning without a main skill', () => {
    mockUseDeps.mockReturnValue(makeDeps({ activeSkillIds: [] }))
    render(<UpgradeAdvisor onPickSlot={() => {}} />)
    expect(screen.getByRole('button', { name: /scan for upgrades/i })).toBeDisabled()
    expect(screen.getByText(/select a main skill first/i)).toBeInTheDocument()
  })

  it('shows progress while scanning', async () => {
    let resolveScan: (v: UpgradeScanResult) => void = () => {}
    mockScan.mockImplementation((_deps, onProgress) => {
      onProgress?.(3, 12)
      return new Promise((resolve) => {
        resolveScan = resolve
      })
    })
    render(<UpgradeAdvisor onPickSlot={() => {}} />)
    await scan()
    expect(await screen.findByText(/scanning 3\/12/i)).toBeInTheDocument()
    resolveScan(SUGGESTIONS)
    await waitFor(() => expect(screen.getByText('Helm')).toBeInTheDocument())
  })

  it('shows a plain scanning label before the first progress update', async () => {
    let resolveScan: (v: UpgradeScanResult) => void = () => {}
    mockScan.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveScan = resolve
        }),
    )
    render(<UpgradeAdvisor onPickSlot={() => {}} />)
    await scan()
    expect(await screen.findByText(/^scanning…$/i)).toBeInTheDocument()
    expect(screen.queryByText(/scanning 0\/0/i)).not.toBeInTheDocument()
    resolveScan(EMPTY_RESULT)
  })

  it('renders both weapon options, slot upgrades with gain, and the empty-slot summary row', async () => {
    mockScan.mockResolvedValue(SUGGESTIONS)
    render(<UpgradeAdvisor onPickSlot={() => {}} />)
    await scan()
    expect(await screen.findByText('Empty slots (1)')).toBeInTheDocument()
    expect(screen.getByText('Helm')).toBeInTheDocument()
    expect(screen.getByText(/fill first/i)).toBeInTheDocument()
    expect(screen.getByText('Weapon · 2H')).toBeInTheDocument()
    expect(screen.getByText('Short Sword → Great Axe')).toBeInTheDocument()
    expect(screen.getByText('Weapon · 1H + shield')).toBeInTheDocument()
    expect(screen.getByText('Short Sword → Short Sword + Buckler')).toBeInTheDocument()
    expect(screen.getByText('Manald Heal → Nagelring')).toBeInTheDocument()
    expect(screen.getByText('+23%')).toBeInTheDocument()
    expect(screen.getByText('+12%')).toBeInTheDocument()
    expect(screen.getByText('+2.3%')).toBeInTheDocument()
  })

  it('routes the empty-slot row to the first empty slot', async () => {
    mockScan.mockResolvedValue(SUGGESTIONS)
    const onPick = vi.fn()
    render(<UpgradeAdvisor onPickSlot={onPick} />)
    await scan()
    await userEvent.click(await screen.findByText('Helm'))
    expect(onPick).toHaveBeenCalledWith('helmet')
  })

  it('opens the compare dialog when an upgrade row is clicked, and Switch applies the changes', async () => {
    mockScan.mockResolvedValue(SUGGESTIONS)
    useBuild.setState({
      inventory: {
        weapon: { baseId: SWORD, affixes: [], socketCount: 0, socketed: [], socketTypes: [] },
        offhand: { baseId: SHIELD, affixes: [], socketCount: 0, socketed: [], socketTypes: [] },
      },
    })
    render(<UpgradeAdvisor onPickSlot={() => {}} />)
    await scan()
    await userEvent.click(await screen.findByText('Weapon · 2H'))
    expect(screen.getByTestId('compare-modal')).toHaveTextContent('compare: Great Axe')
    await userEvent.click(screen.getByRole('button', { name: /switch to this/i }))
    const inv = useBuild.getState().inventory
    expect(inv.weapon?.baseId).toBe(GREAT_AXE)
    expect(inv.offhand).toBeUndefined()
    expect(screen.queryByTestId('compare-modal')).not.toBeInTheDocument()
  })

  it('Switch on the one-hand + shield option equips the shield', async () => {
    mockScan.mockResolvedValue(SUGGESTIONS)
    useBuild.setState({
      inventory: {
        weapon: { baseId: SWORD, affixes: [], socketCount: 0, socketed: [], socketTypes: [] },
      },
    })
    render(<UpgradeAdvisor onPickSlot={() => {}} />)
    await scan()
    await userEvent.click(await screen.findByText('Weapon · 1H + shield'))
    await userEvent.click(screen.getByRole('button', { name: /switch to this/i }))
    const inv = useBuild.getState().inventory
    expect(inv.weapon?.baseId).toBe(SWORD)
    expect(inv.offhand?.baseId).toBe(SHIELD)
  })

  it('the compare dialog can hand off to the slot picker', async () => {
    mockScan.mockResolvedValue(SUGGESTIONS)
    const onPick = vi.fn()
    render(<UpgradeAdvisor onPickSlot={onPick} />)
    await scan()
    await userEvent.click(await screen.findByText('Manald Heal → Nagelring'))
    await userEvent.click(screen.getByRole('button', { name: /open slot picker/i }))
    expect(onPick).toHaveBeenCalledWith('ring_1')
    expect(screen.queryByTestId('compare-modal')).not.toBeInTheDocument()
  })

  it('truncates the empty-slot summary to 3 names with a +K more suffix', async () => {
    mockScan.mockResolvedValue({
      emptySlots: [
        { slot: 'helmet', slotName: 'Helm' },
        { slot: 'boots', slotName: 'Boots' },
        { slot: 'gloves', slotName: 'Gloves' },
        { slot: 'belt', slotName: 'Belt' },
      ],
      upgrades: [],
    })
    render(<UpgradeAdvisor onPickSlot={() => {}} />)
    await scan()
    expect(await screen.findByText('Empty slots (4)')).toBeInTheDocument()
    expect(screen.getByText('Helm, Boots, Gloves, +1 more')).toBeInTheDocument()
  })

  it('shows the optimal message when scan finds nothing', async () => {
    mockScan.mockResolvedValue(EMPTY_RESULT)
    render(<UpgradeAdvisor onPickSlot={() => {}} />)
    await scan()
    expect(await screen.findByText(/no base upgrades found/i)).toBeInTheDocument()
  })

  it('clears results when the build changes', async () => {
    mockScan.mockResolvedValue(SUGGESTIONS)
    const { rerender } = render(<UpgradeAdvisor onPickSlot={() => {}} />)
    await scan()
    await screen.findByText('Helm')
    mockUseDeps.mockReturnValue(makeDeps({ level: 51 }))
    rerender(<UpgradeAdvisor onPickSlot={() => {}} />)
    await waitFor(() => expect(screen.queryByText('Helm')).not.toBeInTheDocument())
  })

  it('ignores results from a scan orphaned by a build change', async () => {
    let resolveScan: (v: UpgradeScanResult) => void = () => {}
    mockScan.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveScan = resolve
        }),
    )
    const { rerender } = render(<UpgradeAdvisor onPickSlot={() => {}} />)
    await scan()
    mockUseDeps.mockReturnValue(makeDeps({ level: 51 }))
    rerender(<UpgradeAdvisor onPickSlot={() => {}} />)
    resolveScan(SUGGESTIONS)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /scan for upgrades/i })).toBeEnabled(),
    )
    expect(screen.queryByText('Helm')).not.toBeInTheDocument()
  })

  it('shows the error state when the scan rejects and allows retry', async () => {
    mockScan.mockRejectedValue(new Error('bridge down'))
    render(<UpgradeAdvisor onPickSlot={() => {}} />)
    await scan()
    expect(await screen.findByText(/scan failed/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /scan for upgrades/i })).toBeEnabled()
  })
})
