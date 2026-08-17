import { compareRevision, mergeLedgerEntities } from './merge'
import type { BookSettings, ConflictRecord, DeviceState, LedgerSnapshot } from './models'

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

export function mergeSnapshots(local: LedgerSnapshot, remote: LedgerSnapshot, now: string): LedgerSnapshot {
  const generationRelation = compareRevision(bookEpoch(local.settings), bookEpoch(remote.settings))
  if (generationRelation === 'newer' || generationRelation === 'older') {
    const selected = generationRelation === 'newer' ? local : remote
    return {
      ...selected,
      exportedAt: now,
      devices: mergeDevices(local.devices, remote.devices),
    }
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
  return {
    schemaVersion: 1,
    exportedAt: now,
    transactions: merged.transactions,
    categories: merged.categories,
    settings: mergeSettings(local.settings, remote.settings),
    devices: mergeDevices(local.devices, remote.devices),
    conflicts,
  }
}
