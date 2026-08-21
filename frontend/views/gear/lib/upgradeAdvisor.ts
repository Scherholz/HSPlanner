import { gameConfig, getItem } from '@data'
import { rankSlotItemsNative } from '../../../utils/calc/bridge'
import { canOffhand } from '../../../utils/tree/dualWield'
import { pickerItemsForSlot } from '../pickerItems'
import type { BuildPerformanceDeps } from '../../../utils/build/buildPerformance'
import type { PickerRow } from '../PickerModal'
import type { ItemBase, SlotDef, SlotKey } from '../../../types'

export type UpgradeKind = 'slot' | 'two_handed' | 'one_hand_shield' | 'dual_wield'

/** One inventory edit the suggestion applies; `baseId: null` unequips the slot. */
export interface UpgradeChange {
  slot: SlotKey
  baseId: string | null
}

export interface UpgradeSuggestion {
  slot: SlotKey
  slotName: string
  kind: UpgradeKind
  currentBaseName: string
  bestBaseId: string
  bestBaseName: string
  /** one_hand_shield / dual_wield: the offhand paired with the one-hander. */
  offhandBaseName?: string
  gainPct: number
  currentScore: number
  bestScore: number
  changes: UpgradeChange[]
}

export interface UpgradeScanResult {
  emptySlots: { slot: SlotKey; slotName: string }[]
  upgrades: UpgradeSuggestion[]
}

export const UPGRADE_MIN_GAIN_PCT = 2
export const UPGRADE_MAX_COUNT = 5

type Scores = Record<string, number>

function nameOf(rows: PickerRow[], id: string): string {
  return rows.find((r) => r.id === id)?.name ?? getItem(id)?.name ?? id
}

function bestOf(scores: Scores, ids: Iterable<string>): { id: string; score: number } | null {
  let bestId: string | null = null
  let bestScore = 0
  for (const id of ids) {
    const score = scores[id] ?? 0
    if (score > bestScore) {
      bestScore = score
      bestId = id
    }
  }
  return bestId === null ? null : { id: bestId, score: bestScore }
}

function gainOf(current: number, best: number): number {
  return (best / current - 1) * 100
}

function withBare(
  inventory: BuildPerformanceDeps['inventory'],
  slot: SlotKey,
  baseId: string | null,
): BuildPerformanceDeps['inventory'] {
  const next = { ...inventory }
  if (baseId === null) delete next[slot]
  else next[slot] = { baseId, affixes: [], socketCount: 0, socketed: [], socketTypes: [] }
  return next
}

function evaluateSlot(
  slot: SlotDef,
  scores: Scores,
  rows: PickerRow[],
  currentBaseId: string,
): UpgradeSuggestion | null {
  const best = bestOf(scores, rows.map((r) => r.id))
  if (!best) return null
  const currentScore = scores[currentBaseId] ?? 0
  if (currentScore <= 0 || best.id === currentBaseId) return null
  const gainPct = gainOf(currentScore, best.score)
  if (gainPct <= UPGRADE_MIN_GAIN_PCT) return null
  return {
    slot: slot.key,
    slotName: slot.name,
    kind: 'slot',
    currentBaseName: nameOf(rows, currentBaseId),
    bestBaseId: best.id,
    bestBaseName: nameOf(rows, best.id),
    gainPct,
    currentScore,
    bestScore: best.score,
    changes: [{ slot: slot.key, baseId: best.id }],
  }
}

/**
 * Weapon slot: rank one-handers with the current offhand kept and two-handers
 * with the offhand removed (unless the tree lets it stay), then pair the best
 * one-hander with the best offhand for it. Returns up to two options — one per
 * family — so the user can weigh 2H against 1H + shield.
 */
async function evaluateWeapon(
  deps: BuildPerformanceDeps,
  slot: SlotDef,
  rows: PickerRow[],
  currentBaseId: string,
): Promise<UpgradeSuggestion[]> {
  const currentBase = getItem(currentBaseId)
  const offhand = deps.inventory.offhand
  const offhandBase = offhand ? getItem(offhand.baseId) : undefined
  const offhandSlot = gameConfig.slots.find((s) => s.key === 'offhand')

  const oneHand: string[] = []
  const twoHandKeep: string[] = []
  const twoHandDrop: string[] = []
  for (const row of rows) {
    const base = getItem(row.id)
    if (!base?.twoHanded) {
      oneHand.push(row.id)
      continue
    }
    if (offhandBase && canOffhand(offhandBase, base, deps.allocatedTreeNodes)) twoHandKeep.push(row.id)
    else twoHandDrop.push(row.id)
  }

  // Baseline: the current weapon base, bare, in the current inventory.
  const currentIsTwoHanded = !!currentBase?.twoHanded
  const keepIds = [...new Set([...oneHand, ...twoHandKeep, ...(currentIsTwoHanded ? [] : [currentBaseId])])]
  const dropIds = [...new Set([...twoHandDrop, ...(currentIsTwoHanded ? [currentBaseId] : [])])]
  const depsNoOffhand: BuildPerformanceDeps = offhand
    ? { ...deps, inventory: withBare(deps.inventory, 'offhand', null) }
    : deps
  const keepScores = keepIds.length > 0 ? await rankSlotItemsNative(deps, slot.key, keepIds) : {}
  const dropScores = dropIds.length > 0 ? await rankSlotItemsNative(depsNoOffhand, slot.key, dropIds) : {}
  const scores: Scores = { ...dropScores, ...keepScores }
  // The current base sits in exactly one group; take it from there.
  const currentScore = currentIsTwoHanded && offhand === undefined
    ? (dropScores[currentBaseId] ?? keepScores[currentBaseId] ?? 0)
    : (keepScores[currentBaseId] ?? dropScores[currentBaseId] ?? 0)
  if (currentScore <= 0) return []

  const out: UpgradeSuggestion[] = []

  // --- Two-handed option ---
  const bestTwo = bestOf(scores, [...twoHandKeep, ...twoHandDrop])
  if (bestTwo && bestTwo.id !== currentBaseId) {
    const dropsOffhand = offhand !== undefined && twoHandDrop.includes(bestTwo.id)
    out.push({
      slot: slot.key,
      slotName: slot.name,
      kind: 'two_handed',
      currentBaseName: nameOf(rows, currentBaseId),
      bestBaseId: bestTwo.id,
      bestBaseName: nameOf(rows, bestTwo.id),
      gainPct: gainOf(currentScore, bestTwo.score),
      currentScore,
      bestScore: bestTwo.score,
      changes: [
        { slot: slot.key, baseId: bestTwo.id },
        ...(dropsOffhand ? [{ slot: 'offhand' as SlotKey, baseId: null }] : []),
      ],
    })
  }

  // --- One-hand + shield (and, when it wins, dual wield) options ---
  const bestOne = bestOf(scores, oneHand)
  if (bestOne && offhandSlot) {
    const oneBase = getItem(bestOne.id)
    const accepts = (i: ItemBase) => canOffhand(i, oneBase, deps.allocatedTreeNodes)
    const offhandRows = pickerItemsForSlot('offhand', oneBase ? accepts : undefined)
    const offhandIds = [
      ...new Set([...offhandRows.map((r) => r.id), ...(offhand ? [offhand.baseId] : [])]),
    ]
    let offhandScores: Scores = {}
    if (offhandIds.length > 0) {
      const withOne: BuildPerformanceDeps = {
        ...deps,
        inventory: withBare(deps.inventory, slot.key, bestOne.id),
      }
      offhandScores = await rankSlotItemsNative(withOne, 'offhand', offhandIds)
    }
    const isShield = (id: string) => getItem(id)?.baseType === 'Shield'
    const shieldIds = offhandIds.filter(isShield)
    const bestShield = bestOf(offhandScores, shieldIds)
    const bestAny = bestOf(offhandScores, offhandIds)
    const currentOffhandId = offhand?.baseId ?? null

    const pairOption = (
      kind: UpgradeKind,
      offhandPick: { id: string; score: number } | null,
    ): UpgradeSuggestion | null => {
      const offhandId = offhandPick?.id ?? currentOffhandId
      const pairScore = offhandPick?.score ?? bestOne.score
      const sameWeapon = bestOne.id === currentBaseId
      const sameOffhand = offhandId === currentOffhandId
      if (sameWeapon && sameOffhand) return null
      const changes: UpgradeChange[] = []
      if (!sameWeapon) changes.push({ slot: slot.key, baseId: bestOne.id })
      if (!sameOffhand) changes.push({ slot: 'offhand', baseId: offhandId })
      return {
        slot: slot.key,
        slotName: slot.name,
        kind,
        currentBaseName: nameOf(rows, currentBaseId),
        bestBaseId: bestOne.id,
        bestBaseName: nameOf(rows, bestOne.id),
        offhandBaseName: offhandId ? nameOf(offhandRows, offhandId) : undefined,
        gainPct: gainOf(currentScore, pairScore),
        currentScore,
        bestScore: pairScore,
        changes,
      }
    }

    // Shield pairing is always offered (the user asked for it explicitly); a
    // dual-wield pairing is added only when a weapon offhand clearly beats it.
    const shieldOption = pairOption('one_hand_shield', bestShield ?? (bestAny && isShield(bestAny.id) ? bestAny : null))
    if (shieldOption) out.push(shieldOption)
    if (bestAny && !isShield(bestAny.id)) {
      const shieldScore = bestShield?.score ?? 0
      if (bestAny.score > shieldScore * (1 + UPGRADE_MIN_GAIN_PCT / 100)) {
        const dual = pairOption('dual_wield', bestAny)
        if (dual) out.push(dual)
      }
    }
  }

  // Keep both options only when at least one of them is a real upgrade.
  return out.some((s) => s.gainPct > UPGRADE_MIN_GAIN_PCT) ? out : []
}

export async function scanForUpgrades(
  deps: BuildPerformanceDeps,
  onProgress?: (done: number, total: number) => void,
): Promise<UpgradeScanResult> {
  if (deps.activeSkillIds.length === 0) return { emptySlots: [], upgrades: [] }

  const isTwoHanded = !!getItem(deps.inventory.weapon?.baseId ?? '')?.twoHanded
  const slots = gameConfig.slots.filter(
    (s) => !s.key.startsWith('charm_') && (s.key !== 'offhand' || !isTwoHanded),
  )
  const emptySlots: UpgradeScanResult['emptySlots'] = []
  const slotUpgrades: UpgradeSuggestion[] = []
  const weaponUpgrades: UpgradeSuggestion[] = []

  for (const [index, slot] of slots.entries()) {
    const rows = pickerItemsForSlot(slot.key)
    const currentBaseId = deps.inventory[slot.key]?.baseId

    if (currentBaseId === undefined) {
      onProgress?.(index + 1, slots.length)
      if (rows.length > 0) emptySlots.push({ slot: slot.key, slotName: slot.name })
      continue
    }

    if (slot.key === 'weapon') {
      weaponUpgrades.push(...(await evaluateWeapon(deps, slot, rows, currentBaseId)))
      onProgress?.(index + 1, slots.length)
      continue
    }

    const ids = [...new Set([...rows.map((r) => r.id), currentBaseId])]
    const scores = await rankSlotItemsNative(deps, slot.key, ids)
    onProgress?.(index + 1, slots.length)
    const suggestion = evaluateSlot(slot, scores, rows, currentBaseId)
    if (suggestion) slotUpgrades.push(suggestion)
  }

  const capped = slotUpgrades
    .toSorted((a, b) => b.gainPct - a.gainPct)
    .slice(0, UPGRADE_MAX_COUNT)
  return {
    emptySlots,
    upgrades: [...capped, ...weaponUpgrades].toSorted((a, b) => b.gainPct - a.gainPct),
  }
}
