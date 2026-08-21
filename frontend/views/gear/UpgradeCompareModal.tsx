import { useMemo } from 'react'
import { getItem } from '@data'
import { ItemCard } from '../../components/ItemTooltip'
import { Modal } from '../../components/ui/Modal'
import { useCalcResult } from '../../hooks/useCalcResult'
import type { BuildPerformanceDeps } from '../../utils/build/buildPerformance'
import type { Inventory, SlotKey } from '../../types'
import { CompareSummary, DiffSection, VerdictBadge } from './CompareColumn'
import {
  attrDiffs,
  avgHitDiff,
  BUILD_STAT_KEYS,
  combinedDpsDiff,
  computeBuildSummary,
  computeVerdict,
  hitDpsDiff,
  pickStatDiffsByKeys,
  type BuildSummary,
  type StatDiff,
} from './lib/diff'
import type { UpgradeChange, UpgradeSuggestion } from './lib/upgradeAdvisor'
import { affectedSlots, applyBareChanges } from './lib/upgradeCompare'

const KIND_LABEL: Record<UpgradeSuggestion['kind'], string> = {
  slot: 'Base upgrade',
  two_handed: 'Two-handed option',
  one_hand_shield: 'One-hand + shield option',
  dual_wield: 'Dual-wield option',
}

function SideCards({
  title,
  inventory,
  slots,
  tone,
}: {
  title: string
  inventory: Inventory
  slots: SlotKey[]
  tone: 'before' | 'after'
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex items-center gap-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
        <span>{title}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="flex flex-col gap-2">
        {slots.map((slot) => {
          const eq = inventory[slot]
          const base = eq ? getItem(eq.baseId) : undefined
          if (!eq || !base) {
            return (
              <div
                key={slot}
                className="rounded-[3px] border border-dashed border-border-2 px-3 py-4 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-faint"
              >
                {slot} · empty
              </div>
            )
          }
          return (
            <ItemCard
              key={slot}
              equipped={eq}
              base={base}
              state={tone === 'after' ? 'selected' : 'equipped'}
              className="w-full text-[12px]"
            />
          )
        })}
      </div>
    </div>
  )
}

interface UpgradeCompareModalProps {
  suggestion: UpgradeSuggestion
  deps: BuildPerformanceDeps
  onSwitch: (changes: UpgradeChange[]) => void
  onPickSlot: (slot: SlotKey) => void
  onClose: () => void
}

export function UpgradeCompareModal({
  suggestion,
  deps,
  onSwitch,
  onPickSlot,
  onClose,
}: UpgradeCompareModalProps) {
  const slots = useMemo(() => affectedSlots(suggestion), [suggestion])

  // Before = the current bases, bare (same footing as the scan's gain%);
  // after = the suggestion applied on top of that.
  const beforeInventory = useMemo(
    () =>
      applyBareChanges(
        deps.inventory,
        slots
          .filter((s) => deps.inventory[s])
          .map((s) => ({ slot: s, baseId: deps.inventory[s]!.baseId })),
      ),
    [deps.inventory, slots],
  )
  const afterInventory = useMemo(
    () => applyBareChanges(beforeInventory, suggestion.changes),
    [beforeInventory, suggestion.changes],
  )
  const summaryDeps = useMemo(() => {
    const { inventory: _drop, ...rest } = deps
    void _drop
    return rest
  }, [deps])

  const summaries = useCalcResult<{ before: BuildSummary; after: BuildSummary } | null>(
    () =>
      Promise.all([
        computeBuildSummary(beforeInventory, suggestion.slot, summaryDeps),
        computeBuildSummary(afterInventory, suggestion.slot, summaryDeps),
      ]).then(([before, after]) => ({ before, after })),
    [beforeInventory, afterInventory, suggestion.slot, summaryDeps],
    null,
  )

  const verdict = summaries ? computeVerdict(summaries.before, summaries.after) : null
  const damageRows: StatDiff[] = summaries
    ? [
        hitDpsDiff(summaries.before, summaries.after),
        combinedDpsDiff(summaries.before, summaries.after),
        avgHitDiff(summaries.before, summaries.after),
      ].filter((d): d is StatDiff => d !== null)
    : []
  const buildRows: StatDiff[] = summaries
    ? [
        ...attrDiffs(summaries.before, summaries.after),
        ...pickStatDiffsByKeys(summaries.before, summaries.after, BUILD_STAT_KEYS),
      ]
    : []

  const gainLabel = `${suggestion.gainPct >= 0 ? '+' : ''}${suggestion.gainPct.toFixed(1)}%`

  return (
    <Modal
      onClose={onClose}
      panelClassName="w-[960px] max-w-[96vw] max-h-[92vh]"
      eyebrow={`Upgrade advisor · ${KIND_LABEL[suggestion.kind]}`}
      title={
        <span>
          {suggestion.currentBaseName}
          <span className="mx-2 text-faint">→</span>
          {suggestion.bestBaseName}
          {suggestion.offhandBaseName ? (
            <span className="text-muted"> + {suggestion.offhandBaseName}</span>
          ) : null}
        </span>
      }
      subtitle={`Engine DPS on bare bases: ${gainLabel} · affixes, sockets and stars are not carried over — move them afterwards.`}
      headerActions={verdict ? <VerdictBadge verdict={verdict} /> : null}
      dataTour="gear-upgrade-compare"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {summaries && <CompareSummary before={summaries.before} after={summaries.after} />}
        <div className="mt-4 flex items-start gap-4">
          <SideCards title="Current" inventory={beforeInventory} slots={slots} tone="before" />
          <SideCards title="Recommended" inventory={afterInventory} slots={slots} tone="after" />
        </div>
        {!summaries && (
          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
            Calculating compare…
          </p>
        )}
        {summaries && (
          <div className="mt-4">
            {damageRows.length > 0 && (
              <DiffSection
                title={
                  summaries.after.activeSkillName
                    ? `Active Skill · ${summaries.after.activeSkillName}`
                    : 'Active Skill'
                }
                diffs={damageRows}
              />
            )}
            <DiffSection title="Build Stats" diffs={buildRows} emptyHint="No build stat changes" />
          </div>
        )}
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-3">
        <button
          type="button"
          onClick={() => onPickSlot(suggestion.slot)}
          className="rounded-[3px] border border-border-2 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted hover:text-text"
        >
          Open slot picker
        </button>
        <button
          type="button"
          onClick={() => onSwitch(suggestion.changes)}
          className="rounded-[3px] border border-accent-deep/60 px-4 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-hot"
          style={{
            background: 'linear-gradient(180deg, rgba(58,46,24,0.8), rgba(42,36,24,0.6))',
          }}
        >
          Switch to this
        </button>
      </footer>
    </Modal>
  )
}
