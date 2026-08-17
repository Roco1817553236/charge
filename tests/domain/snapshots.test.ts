import { describe, expect, it } from 'vitest'
import type { LedgerSnapshot } from '../../src/domain/models'
import { mergeSnapshots } from '../../src/domain/snapshots'

function snapshot(id: string, epoch: { counter: number; deviceId: string; clock: Record<string, number> }): LedgerSnapshot {
  const now = '2026-08-14T00:00:00.000Z'
  return {
    schemaVersion: 1,
    exportedAt: now,
    transactions: id ? [{
      id, type: 'expense', amountMinor: 100, currency: 'CNY', categoryId: 'food', subcategoryId: null,
      occurredLocalDate: '2026-08-14', occurredLocalTime: '12:00', timeZone: 'Asia/Shanghai', note: id,
      createdAt: now, updatedAt: now, revision: { counter: 1, deviceId: 'device-a', clock: { 'device-a': 1 } },
    }] : [],
    categories: [],
    settings: {
      id: 'book', currency: 'CNY', monthComparisonMode: 'to-date', revision: epoch, bookEpoch: epoch, updatedAt: now,
    },
    devices: [],
  }
}

describe('snapshot generations', () => {
  it('chooses the complete snapshot from a causally newer authoritative restore generation', () => {
    const oldCloud = snapshot('old-cloud-row', { counter: 1, deviceId: 'system-defaults-v1', clock: { 'system-defaults-v1': 1 } })
    const restored = snapshot('', {
      counter: 2, deviceId: 'device-a', clock: { 'system-defaults-v1': 1, 'device-a': 2 },
    })

    expect(mergeSnapshots(restored, oldCloud, '2026-08-14T01:00:00.000Z').transactions).toEqual([])
    expect(mergeSnapshots(oldCloud, restored, '2026-08-14T01:00:00.000Z').transactions).toEqual([])
  })

  it('converges concurrent synchronized statistics preferences deterministically', () => {
    const epoch = { counter: 1, deviceId: 'system-defaults-v1', clock: { 'system-defaults-v1': 1 } }
    const first = snapshot('', epoch)
    const second = snapshot('', epoch)
    first.settings = {
      ...first.settings,
      monthComparisonMode: 'to-date',
      revision: { counter: 2, deviceId: 'device-a', clock: { 'device-a': 2 } },
    }
    second.settings = {
      ...second.settings,
      monthComparisonMode: 'full-month',
      revision: { counter: 2, deviceId: 'device-b', clock: { 'device-b': 2 } },
    }

    expect(mergeSnapshots(first, second, '2026-08-14T01:00:00.000Z').settings).toEqual(
      mergeSnapshots(second, first, '2026-08-14T01:00:00.000Z').settings,
    )
  })
})
