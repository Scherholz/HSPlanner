import { useEffect, useRef, useState } from 'react'
import {
  scanForUpgrades,
  type UpgradeChange,
  type UpgradeScanResult,
  type UpgradeSuggestion,
} from './lib/upgradeAdvisor'
import { makeEquippedItem } from './lib/itemEdits'
import { UpgradeCompareModal } from './UpgradeCompareModal'
import { useBuildPerformanceDeps } from '../../hooks/useBuildPerformanceDeps'
import { useBuild } from '../../store/build'
import type { SlotKey } from '../../types'

const ADVISOR_TITLE =
  'Compares bare item bases via engine DPS: your current base vs the best base for the slot. Weapons get a two-handed and a one-hand + shield option (and, when it wins, dual wield). Click an upgrade row to compare side by side and switch.'

const GAIN_PCT_DECIMAL_THRESHOLD = 10

function formatGainPct(gainPct: number): string {
  const abs = Math.abs(gainPct)
  const value = abs < GAIN_PCT_DECIMAL_THRESHOLD ? abs.toFixed(1) : Math.round(abs).toString()
  return `${gainPct < 0 ? '−' : '+'}${value}%`
}

const EMPTY_SLOTS_PREVIEW_COUNT = 3

function formatEmptySlotNames(
  emptySlots: UpgradeScanResult['emptySlots'],
): string {
  const names = emptySlots
    .slice(0, EMPTY_SLOTS_PREVIEW_COUNT)
    .map((s) => s.slotName)
  const remaining = emptySlots.length - EMPTY_SLOTS_PREVIEW_COUNT
  return remaining > 0
    ? `${names.join(', ')}, +${remaining} more`
    : names.join(', ')
}

function suggestionLabel(s: UpgradeSuggestion): string {
  if (s.kind === 'two_handed') return `${s.slotName} · 2H`
  if (s.kind === 'one_hand_shield') return `${s.slotName} · 1H + shield`
  if (s.kind === 'dual_wield') return `${s.slotName} · dual wield`
  return s.slotName
}

function suggestionDetail(s: UpgradeSuggestion): string {
  const target = s.offhandBaseName
    ? `${s.bestBaseName} + ${s.offhandBaseName}`
    : s.bestBaseName
  return `${s.currentBaseName} → ${target}`
}

interface AdvisorRowProps {
  label: string
  detail: string
  value: string
  valueClassName: string
  onClick: () => void
}

function AdvisorRow({
  label,
  detail,
  value,
  valueClassName,
  onClick,
}: AdvisorRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[3px] border border-border-2 px-3 py-2 text-left hover:border-accent-deep/60"
      style={{
        background:
          'linear-gradient(180deg, var(--color-panel-2), color-mix(in srgb, var(--color-bg) 70%, transparent))',
      }}
    >
      <span className="w-44 shrink-0 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-text">
        {detail}
      </span>
      <span
        className={`shrink-0 font-mono text-[12px] tabular-nums ${valueClassName}`}
      >
        {value}
      </span>
    </button>
  )
}

interface UpgradeAdvisorProps {
  onPickSlot: (slot: SlotKey) => void
}

type ScanState =
  | { phase: 'idle' }
  | { phase: 'scanning'; done: number; total: number }
  | { phase: 'done'; result: UpgradeScanResult }
  | { phase: 'error' }

export function UpgradeAdvisor({ onPickSlot }: UpgradeAdvisorProps) {
  const deps = useBuildPerformanceDeps()
  const commitEquippedItem = useBuild((s) => s.commitEquippedItem)
  const [state, setState] = useState<ScanState>({ phase: 'idle' })
  const [compare, setCompare] = useState<UpgradeSuggestion | null>(null)
  const epochRef = useRef(0)
  const hasSkill = deps.activeSkillIds.length > 0

  useEffect(() => {
    epochRef.current += 1
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ phase: 'idle' })
    setCompare(null)
  }, [deps])

  const startScan = async () => {
    const epoch = epochRef.current
    setState({ phase: 'scanning', done: 0, total: 0 })
    try {
      const result = await scanForUpgrades(deps, (done, total) => {
        if (epochRef.current === epoch)
          setState({ phase: 'scanning', done, total })
      })
      if (epochRef.current === epoch) setState({ phase: 'done', result })
    } catch {
      if (epochRef.current === epoch) setState({ phase: 'error' })
    }
  }

  const applyChanges = (changes: UpgradeChange[]) => {
    for (const c of changes) {
      if (c.baseId === null) {
        commitEquippedItem(c.slot, null)
        continue
      }
      const item = makeEquippedItem(c.baseId)
      if (item) commitEquippedItem(c.slot, item)
    }
    setCompare(null)
  }

  const isEmpty =
    state.phase === 'done' &&
    state.result.emptySlots.length === 0 &&
    state.result.upgrades.length === 0

  return (
    <section
      data-tour="gear-upgrades"
      className="mb-4 rounded-md border border-border p-4"
      style={{
        background:
          'linear-gradient(180deg, var(--color-panel), color-mix(in srgb, var(--color-bg) 70%, transparent))',
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span
          title={ADVISOR_TITLE}
          className="flex cursor-help items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-accent-hot/70"
        >
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rotate-45 bg-accent-hot"
          />
          Upgrade advisor
        </span>
        <button
          type="button"
          disabled={!hasSkill || state.phase === 'scanning'}
          onClick={startScan}
          className="rounded-[3px] border border-accent-deep/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-hot disabled:opacity-40"
          style={{
            background:
              'linear-gradient(180deg, rgba(58,46,24,0.6), rgba(42,36,24,0.4))',
          }}
        >
          {state.phase === 'scanning'
            ? state.total === 0
              ? 'Scanning…'
              : `Scanning ${state.done}/${state.total}…`
            : 'Scan for upgrades'}
        </button>
      </div>

      {!hasSkill && (
        <p className="font-mono text-[12px] italic tracking-[0.04em] text-muted">
          select a main skill first
        </p>
      )}

      {hasSkill && state.phase === 'idle' && (
        <p className="font-mono text-[11px] tracking-[0.04em] text-faint">
          scan compares your bare item bases against the best base per slot — weapons get a
          two-handed and a one-hand + shield option (dual wield when it wins); click an upgrade
          row to compare and switch
        </p>
      )}

      {state.phase === 'error' && (
        <p className="font-mono text-[12px] italic tracking-[0.04em] text-muted">
          scan failed — try again
        </p>
      )}

      {isEmpty && (
        <p className="font-mono text-[12px] italic tracking-[0.04em] text-muted">
          no base upgrades found — your bases are optimal
        </p>
      )}

      {state.phase === 'done' && !isEmpty && (
        <ul className="space-y-1">
          {state.result.emptySlots.length > 0 && (
            <li>
              <AdvisorRow
                label={`Empty slots (${state.result.emptySlots.length})`}
                detail={formatEmptySlotNames(state.result.emptySlots)}
                value="fill first"
                valueClassName="text-stat-red"
                onClick={() => {
                  const firstEmpty = state.result.emptySlots[0]
                  if (firstEmpty) onPickSlot(firstEmpty.slot)
                }}
              />
            </li>
          )}
          {state.result.upgrades.map((s) => (
            <li key={`${s.slot}:${s.kind}`}>
              <AdvisorRow
                label={suggestionLabel(s)}
                detail={suggestionDetail(s)}
                value={formatGainPct(s.gainPct)}
                valueClassName={s.gainPct > 0 ? 'text-accent-hot' : 'text-muted'}
                onClick={() => setCompare(s)}
              />
            </li>
          ))}
        </ul>
      )}

      {compare && (
        <UpgradeCompareModal
          suggestion={compare}
          deps={deps}
          onSwitch={applyChanges}
          onPickSlot={(slot) => {
            setCompare(null)
            onPickSlot(slot)
          }}
          onClose={() => setCompare(null)}
        />
      )}
    </section>
  )
}
