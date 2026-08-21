import { describe, expect, it } from 'vitest'
import type { ItemCategory, LedgerSnapshot, OwnedItem } from '../../src/domain/models'
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

    const merged = mergeSnapshots(first, second, '2026-08-14T01:00:00.000Z')
    expect(merged.settings).toEqual(mergeSnapshots(second, first, '2026-08-14T01:00:00.000Z').settings)
    expect(merged.schemaVersion).toBe(1)
    expect(merged.itemCategories).toBeUndefined()
  })

  it('merges schema v2 item entities instead of dropping the remote item tables', () => {
    const epoch = { counter: 1, deviceId: 'system-defaults-v1', clock: { 'system-defaults-v1': 1 } }
    const local = { ...snapshot('', epoch), schemaVersion: 2, itemCategories: [], items: [], itemCosts: [] }
    const itemCategory: ItemCategory = {
      id: 'digital', name: '数码', icon: '💻', color: '#6366F1', sortOrder: 0, status: 'active',
      revision: { counter: 1, deviceId: 'device-b' }, createdAt: local.exportedAt, updatedAt: local.exportedAt,
    }
    const item: OwnedItem = {
      id: 'phone', categoryId: 'digital', name: '手机', icon: '📱', note: '', purchaseAmountMinor: 100,
      purchaseLocalDate: '2026-08-01', startedLocalDate: '2026-08-01', sourceTransactionId: null,
      revision: { counter: 2, deviceId: 'device-b' }, createdAt: local.exportedAt, updatedAt: local.exportedAt,
    }
    const remote = { ...snapshot('', epoch), schemaVersion: 2, itemCategories: [itemCategory], items: [item], itemCosts: [] }

    const merged = mergeSnapshots(local, remote, '2026-08-21T00:00:00.000Z')

    expect(merged.schemaVersion).toBe(2)
    expect(merged.itemCategories).toEqual([itemCategory])
    expect(merged.items).toEqual([item])
  })
})
