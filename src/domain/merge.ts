import type { Category, ConflictRecord, Revision, Transaction } from './models'

export type RevisionRelation = 'newer' | 'older' | 'equal' | 'concurrent'

export function revisionClock(revision: Revision): Record<string, number> {
  const clock = { ...(revision.clock ?? {}) }
  clock[revision.deviceId] = Math.max(clock[revision.deviceId] ?? 0, revision.counter)
  return clock
}

export function compareRevision(local: Revision, remote: Revision): RevisionRelation {
  const localClock = revisionClock(local)
  const remoteClock = revisionClock(remote)
  const deviceIds = new Set([...Object.keys(localClock), ...Object.keys(remoteClock)])
  let localAhead = false
  let remoteAhead = false
  for (const deviceId of deviceIds) {
    const localCounter = localClock[deviceId] ?? 0
    const remoteCounter = remoteClock[deviceId] ?? 0
    if (localCounter > remoteCounter) localAhead = true
    if (remoteCounter > localCounter) remoteAhead = true
  }
  if (localAhead && !remoteAhead) return 'newer'
  if (remoteAhead && !localAhead) return 'older'
  if (!localAhead && !remoteAhead) return 'equal'
  return 'concurrent'
}

type VersionedEntity = Transaction | Category

function samePayload(left: VersionedEntity, right: VersionedEntity): boolean {
  const { revision: _leftRevision, ...leftPayload } = left
  const { revision: _rightRevision, ...rightPayload } = right
  return JSON.stringify(leftPayload) === JSON.stringify(rightPayload)
}

function conflictId(
  entityType: ConflictRecord['entityType'],
  entityId: string,
  left: Revision,
  right: Revision,
): string {
  const revisions = [left, right]
    .map((revision) => {
      const clock = Object.entries(revisionClock(revision))
        .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
        .map(([deviceId, counter]) => `${deviceId}:${counter}`)
        .join(',')
      return `${revision.counter}@${revision.deviceId}[${clock}]`
    })
    .sort()
    .join('-')
  return `conflict-${entityType}-${entityId}-${revisions}`
}

function mergeList<T extends VersionedEntity>(
  local: T[],
  remote: T[],
  entityType: ConflictRecord['entityType'],
  now: string,
): { values: T[]; conflicts: ConflictRecord[] } {
  const localMap = new Map(local.map((value) => [value.id, value]))
  const remoteMap = new Map(remote.map((value) => [value.id, value]))
  const ids = new Set([...localMap.keys(), ...remoteMap.keys()])
  const values: T[] = []
  const conflicts: ConflictRecord[] = []

  ids.forEach((id) => {
    const localValue = localMap.get(id)
    const remoteValue = remoteMap.get(id)
    if (!localValue) {
      values.push(remoteValue!)
      return
    }
    if (!remoteValue) {
      values.push(localValue)
      return
    }

    const relation = compareRevision(localValue.revision, remoteValue.revision)
    if (relation === 'newer' || relation === 'equal') {
      values.push(localValue)
      return
    }
    if (relation === 'older') {
      values.push(remoteValue)
      return
    }
    if (samePayload(localValue, remoteValue)) {
      values.push(localValue.revision.deviceId <= remoteValue.revision.deviceId ? localValue : remoteValue)
      return
    }

    values.push(localValue)
    conflicts.push({
      id: conflictId(entityType, id, localValue.revision, remoteValue.revision),
      entityType,
      entityId: id,
      localValue,
      remoteValue,
      createdAt: now,
    })
  })

  return { values, conflicts }
}

export function mergeLedgerEntities(
  localTransactions: Transaction[],
  remoteTransactions: Transaction[],
  localCategories: Category[],
  remoteCategories: Category[],
  now: string,
): { transactions: Transaction[]; categories: Category[]; conflicts: ConflictRecord[] } {
  const transactionResult = mergeList(localTransactions, remoteTransactions, 'transaction', now)
  const categoryResult = mergeList(localCategories, remoteCategories, 'category', now)
  return {
    transactions: transactionResult.values,
    categories: categoryResult.values,
    conflicts: [...transactionResult.conflicts, ...categoryResult.conflicts],
  }
}
