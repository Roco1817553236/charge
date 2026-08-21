import { compareRevision, mergeLedgerEntities } from './merge'
import { assertItemSnapshotIntegrity } from './itemIntegrity'
import type { BookSettings, ConflictRecord, DeviceState, LedgerSnapshot, Revision } from './models'

const GENESIS_BOOK_EPOCH = {
  counter: 1,
  deviceId: 'system-defaults-v1',
  clock: { 'system-defaults-v1': 1 },
}

function bookEpoch(settings: BookSettings) {
  return settings.bookEpoch ?? GENESIS_BOOK_EPOCH
}

function mergeSettings(local: BookSettings, remote: BookSettings): BookSettings {
  const relation = compareRevision(local.revision, remote.revision)
  if (relation === 'newer') return local
  if (relation === 'older') return remote
  const stableKey = (value: BookSettings): string => JSON.stringify({
    ...value,
    revision: {
      ...value.revision,
      clock: Object.fromEntries(Object.entries(value.revision.clock ?? {}).sort(([left], [right]) => left.localeCompare(right))),
    },
  })
  return stableKey(local) <= stableKey(remote) ? local : remote
}

function mergeDevices(local: DeviceState[], remote: DeviceState[]): DeviceState[] {
  const values = new Map<string, DeviceState>()
  for (const device of [...remote, ...local]) {
    const existing = values.get(device.id)
    if (!existing || device.logicalCounter > existing.logicalCounter) values.set(device.id, device)
  }
  return [...values.values()]
}

function mergeConflicts(...groups: Array<ConflictRecord[] | undefined>): ConflictRecord[] {
  const values = new Map<string, ConflictRecord>()
  groups.flatMap((group) => group ?? []).forEach((conflict) => {
    const existing = values.get(conflict.id)
    if (!existing) {
      values.set(conflict.id, conflict)
      return
    }
    if (existing.resolvedAt && !conflict.resolvedAt) return
    if (conflict.resolvedAt && (!existing.resolvedAt || conflict.resolvedAt > existing.resolvedAt)) {
      values.set(conflict.id, conflict)
      return
    }
    if (!existing.resolvedAt && !conflict.resolvedAt) values.set(conflict.id, conflict)
  })
  return [...values.values()]
}

function mergeRevisionedEntities<T extends { id: string; revision: Revision }>(local: T[] = [], remote: T[] = []): T[] {
  const values = new Map<string, T>()
  for (const candidate of [...remote, ...local]) {
    const existing = values.get(candidate.id)
    if (!existing) {
      values.set(candidate.id, candidate)
      continue
    }
    const relation = compareRevision(candidate.revision, existing.revision)
    if (relation === 'newer' || (relation !== 'older' && JSON.stringify(candidate) < JSON.stringify(existing))) {
      values.set(candidate.id, candidate)
    }
  }
  return [...values.values()]
}

export function mergeSnapshots(local: LedgerSnapshot, remote: LedgerSnapshot, now: string): LedgerSnapshot {
  const generationRelation = compareRevision(bookEpoch(local.settings), bookEpoch(remote.settings))
  if (generationRelation === 'newer' || generationRelation === 'older') {
    const selected = generationRelation === 'newer' ? local : remote
    const result = {
      ...selected,
      exportedAt: now,
      devices: mergeDevices(local.devices, remote.devices),
    }
    assertItemSnapshotIntegrity(result, '物品数据并发变更无法安全合并')
    return result
  }
  if (generationRelation === 'concurrent') {
    throw new Error('检测到两次并发的账本恢复，请先导出本机备份再选择要保留的版本')
  }
  const merged = mergeLedgerEntities(
    local.transactions,
    remote.transactions,
    local.categories,
    remote.categories,
    now,
  )
  const conflicts = mergeConflicts(local.conflicts, remote.conflicts, merged.conflicts)
  const schemaVersion = Math.max(local.schemaVersion, remote.schemaVersion)
  const result: LedgerSnapshot = {
    schemaVersion,
    exportedAt: now,
    transactions: merged.transactions,
    categories: merged.categories,
    settings: mergeSettings(local.settings, remote.settings),
    devices: mergeDevices(local.devices, remote.devices),
    conflicts,
    ...(schemaVersion >= 2 ? {
      itemCategories: mergeRevisionedEntities(local.itemCategories, remote.itemCategories),
      items: mergeRevisionedEntities(local.items, remote.items),
      itemCosts: mergeRevisionedEntities(local.itemCosts, remote.itemCosts),
    } : {}),
  }
  assertItemSnapshotIntegrity(result, '物品数据并发变更无法安全合并')
  return result
}
