import { describe, expect, it } from 'vitest'
import type { LedgerSnapshot, Transaction } from '../../src/domain/models'
import { mergeSnapshots } from '../../src/domain/snapshots'

const now = '2026-08-14T00:00:00.000Z'
const epoch = { counter: 1, deviceId: 'system-defaults-v1', clock: { 'system-defaults-v1': 1 } }

function deviceSnapshot(deviceId: string, transactionId: string): LedgerSnapshot {
  const transaction: Transaction = {
    id: transactionId, type: 'expense', amountMinor: 100, currency: 'CNY', categoryId: 'food', subcategoryId: null,
    occurredLocalDate: '2026-08-14', occurredLocalTime: '12:00', timeZone: 'Asia/Shanghai', note: deviceId,
    createdAt: now, updatedAt: now, revision: { counter: 1, deviceId, clock: { [deviceId]: 1 } },
  }
  return {
    schemaVersion: 1, exportedAt: now, transactions: [transaction], categories: [],
    settings: { id: 'book', currency: 'CNY', monthComparisonMode: 'to-date', revision: epoch, bookEpoch: epoch, updatedAt: now },
    devices: [{ id: deviceId, logicalCounter: 1 }],
  }
}

describe('three-device synchronization', () => {
  it('converges three independent offline additions without conflicts or loss', () => {
    const a = deviceSnapshot('device-a', 'transaction-a')
    const b = deviceSnapshot('device-b', 'transaction-b')
    const c = deviceSnapshot('device-c', 'transaction-c')

    const cloudAfterB = mergeSnapshots(a, b, '2026-08-14T01:00:00.000Z')
    const cloudAfterC = mergeSnapshots(cloudAfterB, c, '2026-08-14T02:00:00.000Z')
    const convergedA = mergeSnapshots(a, cloudAfterC, '2026-08-14T03:00:00.000Z')

    expect(cloudAfterC.transactions.map((item) => item.id).sort()).toEqual([
      'transaction-a', 'transaction-b', 'transaction-c',
    ])
    expect(cloudAfterC.conflicts).toEqual([])
    expect(convergedA.transactions).toHaveLength(3)
    expect(convergedA.devices.map((device) => device.id).sort()).toEqual(['device-a', 'device-b', 'device-c'])
  })
})
