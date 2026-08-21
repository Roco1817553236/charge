import type { ItemCost, OwnedItem } from './models'

export interface ItemMetrics {
  usageDays: number
  totalCostMinor: number
  dailyCostMinor: number
}

export interface ItemCostSummary extends ItemMetrics {
  itemCount: number
  totalDailyMinor: number
  highestDailyMinor: number | null
  lowestDailyMinor: number | null
}

export interface ItemSummaryFilters {
  status: 'active' | 'retired' | 'all'
  categoryId: string | null
}

const DAY_MS = 86_400_000

function safeAddMinor(left: number, right: number): number {
  const total = left + right
  if (!Number.isSafeInteger(total)) throw new Error('物品总成本过大')
  return total
}

function calendarDay(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new Error('物品日期无效')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const value = new Date(Date.UTC(year, month - 1, day))
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) {
    throw new Error('物品日期无效')
  }
  return value.getTime() / DAY_MS
}

export function calculateItemMetrics(item: OwnedItem, costs: ItemCost[], asOfDate: string): ItemMetrics {
  const purchaseDay = calendarDay(item.purchaseLocalDate)
  const startDay = purchaseDay
  const asOfDay = calendarDay(asOfDate)
  const endDay = item.retiredLocalDate ? calendarDay(item.retiredLocalDate) : asOfDay
  if (startDay > asOfDay || endDay < startDay || endDay > asOfDay) {
    throw new Error('物品日期无效')
  }

  const usageDays = endDay - startDay + 1
  const additionalMinor = costs.reduce((total, cost) =>
    cost.itemId === item.id && !cost.deletedAt ? safeAddMinor(total, cost.amountMinor) : total, 0)
  const totalCostMinor = safeAddMinor(item.purchaseAmountMinor, additionalMinor)
  return { usageDays, totalCostMinor, dailyCostMinor: totalCostMinor / usageDays }
}

export function buildItemCostSummary(
  items: OwnedItem[],
  costs: ItemCost[],
  asOfDate: string,
  filters: ItemSummaryFilters,
): ItemCostSummary {
  const selected = items.filter((item) => {
    if (item.deletedAt) return false
    if (filters.categoryId && item.categoryId !== filters.categoryId) return false
    if (filters.status === 'active' && item.retiredLocalDate) return false
    if (filters.status === 'retired' && !item.retiredLocalDate) return false
    return true
  })
  const metrics = selected.map((item) => calculateItemMetrics(item, costs, asOfDate))
  const dailyValues = metrics.map((item) => item.dailyCostMinor)
  return {
    usageDays: metrics.reduce((total, item) => total + item.usageDays, 0),
    totalCostMinor: metrics.reduce((total, item) => safeAddMinor(total, item.totalCostMinor), 0),
    dailyCostMinor: metrics.reduce((total, item) => total + item.dailyCostMinor, 0),
    itemCount: metrics.length,
    totalDailyMinor: metrics.reduce((total, item) => total + item.dailyCostMinor, 0),
    highestDailyMinor: dailyValues.length > 0 ? Math.max(...dailyValues) : null,
    lowestDailyMinor: dailyValues.length > 0 ? Math.min(...dailyValues) : null,
  }
}
