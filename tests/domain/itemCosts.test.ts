import { describe, expect, it } from 'vitest'
import type { ItemCost, OwnedItem } from '../../src/domain/models'
import { buildItemCostSummary, calculateItemMetrics } from '../../src/domain/itemCosts'

const revision = { counter: 1, deviceId: 'device-a' }

function item(overrides: Partial<OwnedItem> = {}): OwnedItem {
  return {
    id: 'item-1', categoryId: 'digital', name: '笔记本', icon: '💻', note: '',
    purchaseAmountMinor: 100_000, purchaseLocalDate: '2024-01-01', startedLocalDate: '2024-01-01',
    sourceTransactionId: null, revision, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function cost(overrides: Partial<ItemCost> = {}): ItemCost {
  return {
    id: 'cost-1', itemId: 'item-1', type: 'repair', amountMinor: 20_000,
    occurredLocalDate: '2024-01-02', note: '维修', sourceTransactionId: null,
    revision, createdAt: '2024-01-02T00:00:00.000Z', updatedAt: '2024-01-02T00:00:00.000Z',
    ...overrides,
  }
}

describe('item daily cost metrics', () => {
  it('counts the starting calendar day so a new item never divides by zero', () => {
    expect(calculateItemMetrics(item(), [], '2024-01-01')).toMatchObject({
      usageDays: 1,
      totalCostMinor: 100_000,
      dailyCostMinor: 100_000,
    })
  })

  it('always starts from the purchase date even for legacy data with a later start date', () => {
    const legacy = item({ purchaseLocalDate: '2024-01-01', startedLocalDate: '2024-01-10' })

    expect(calculateItemMetrics(legacy, [], '2024-01-10').usageDays).toBe(10)
  })

  it('uses calendar dates across leap day and freezes on the retirement date', () => {
    const retired = item({
      purchaseLocalDate: '2024-02-28', startedLocalDate: '2024-02-28', retiredLocalDate: '2024-03-01',
    })

    expect(calculateItemMetrics(retired, [], '2026-08-21').usageDays).toBe(3)
  })

  it('adds active repair and accessory costs while ignoring deleted costs', () => {
    const metrics = calculateItemMetrics(item(), [
      cost(),
      cost({ id: 'cost-2', type: 'accessory', amountMinor: 5_000 }),
      cost({ id: 'cost-3', amountMinor: 99_000, deletedAt: '2024-01-03T00:00:00.000Z' }),
    ], '2024-01-10')

    expect(metrics.usageDays).toBe(10)
    expect(metrics.totalCostMinor).toBe(125_000)
    expect(metrics.dailyCostMinor).toBe(12_500)
  })

  it('builds filtered totals from unrounded per-item values and excludes deleted items', () => {
    const rows = [
      item({ id: 'a', categoryId: 'digital', purchaseAmountMinor: 100, startedLocalDate: '2024-01-01' }),
      item({ id: 'b', categoryId: 'home', purchaseAmountMinor: 100, startedLocalDate: '2024-01-01', retiredLocalDate: '2024-01-02' }),
      item({ id: 'c', categoryId: 'digital', purchaseAmountMinor: 500, deletedAt: '2024-01-02T00:00:00.000Z' }),
    ]

    const active = buildItemCostSummary(rows, [], '2024-01-03', { status: 'active', categoryId: null })
    expect(active.itemCount).toBe(1)
    expect(active.totalCostMinor).toBe(100)
    expect(active.totalDailyMinor).toBeCloseTo(100 / 3)

    const retired = buildItemCostSummary(rows, [], '2024-01-03', { status: 'retired', categoryId: 'home' })
    expect(retired.itemCount).toBe(1)
    expect(retired.highestDailyMinor).toBe(50)
    expect(retired.lowestDailyMinor).toBe(50)
  })

  it('rejects invalid or future date ranges', () => {
    expect(() => calculateItemMetrics(item({ purchaseLocalDate: '2024-01-02' }), [], '2024-01-01')).toThrow('物品日期无效')
    expect(() => calculateItemMetrics(item({ retiredLocalDate: '2023-12-31' }), [], '2024-01-01')).toThrow('物品日期无效')
  })

  it('rejects a total cost that exceeds safe integer precision', () => {
    expect(() => calculateItemMetrics(
      item({ purchaseAmountMinor: Number.MAX_SAFE_INTEGER - 10 }),
      [cost({ amountMinor: 20 })],
      '2024-01-02',
    )).toThrow('物品总成本过大')
  })
})
