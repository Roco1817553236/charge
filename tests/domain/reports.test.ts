import { describe, expect, it } from 'vitest'
import type { Category, Transaction } from '../../src/domain/models'
import {
  buildAnnualComparison,
  buildMonthlyReport,
  compareMonthPeriods,
  daysInMonth,
} from '../../src/domain/reports'

const revision = { counter: 1, deviceId: 'device-a' }
const now = '2026-08-14T00:00:00.000Z'
const categories: Category[] = [
  {
    id: 'food', type: 'expense', parentId: null, name: '餐饮', icon: '🍜', color: '#f97316', sortOrder: 0,
    isPinned: true, status: 'active', revision, createdAt: now, updatedAt: now,
  },
  {
    id: 'transport', type: 'expense', parentId: null, name: '交通', icon: '🚇', color: '#0ea5e9', sortOrder: 1,
    isPinned: true, status: 'active', revision, createdAt: now, updatedAt: now,
  },
  {
    id: 'bus', type: 'expense', parentId: 'transport', name: '公交', icon: '🚌', color: '#0ea5e9', sortOrder: 0,
    isPinned: false, status: 'active', revision, createdAt: now, updatedAt: now,
  },
  {
    id: 'salary', type: 'income', parentId: null, name: '工资', icon: '💼', color: '#16a34a', sortOrder: 0,
    isPinned: false, status: 'active', revision, createdAt: now, updatedAt: now,
  },
]

function transaction(id: string, date: string, amountMinor: number, type: 'expense' | 'income' = 'expense', extra: Partial<Transaction> = {}): Transaction {
  return {
    id,
    type,
    amountMinor,
    currency: 'CNY',
    categoryId: type === 'expense' ? 'food' : 'salary',
    subcategoryId: null,
    occurredLocalDate: date,
    occurredLocalTime: '12:00',
    timeZone: 'Asia/Shanghai',
    note: '',
    createdAt: `${date}T04:00:00.000Z`,
    updatedAt: `${date}T04:00:00.000Z`,
    revision,
    ...extra,
  }
}

const transactions: Transaction[] = [
  transaction('aug-1', '2026-08-01', 1000),
  transaction('aug-14', '2026-08-14', 2000),
  transaction('aug-20', '2026-08-20', 9000),
  transaction('aug-income', '2026-08-05', 10000, 'income'),
  transaction('moved-child', '2026-08-06', 300, 'expense', { categoryId: 'food', subcategoryId: 'bus' }),
  transaction('deleted', '2026-08-02', 99999, 'expense', { deletedAt: now, deleteRevision: revision }),
  transaction('jul-1', '2026-07-01', 500),
  transaction('jul-14', '2026-07-14', 1500),
  transaction('jul-20', '2026-07-20', 2000),
  transaction('last-year', '2025-08-10', 4000),
]

describe('monthly reports', () => {
  it('aggregates integer amounts, ignores soft-deleted rows and follows a moved child current parent', () => {
    const report = buildMonthlyReport(transactions, categories, '2026-08')

    expect(report.expenseMinor).toBe(12300)
    expect(report.incomeMinor).toBe(10000)
    expect(report.balanceMinor).toBe(-2300)
    expect(report.count).toBe(5)
    expect(report.days.find((day) => day.day === 14)?.expenseMinor).toBe(2000)
    expect(report.categoryBreakdown.find((row) => row.categoryId === 'transport')?.expenseMinor).toBe(300)
  })

  it('compares month-to-date with the same elapsed days of the previous month', () => {
    const comparison = compareMonthPeriods(transactions, categories, '2026-08', '2026-08-14', 'to-date')

    expect(comparison.current.expenseMinor).toBe(3300)
    expect(comparison.previous.expenseMinor).toBe(2000)
    expect(comparison.expenseChangeRate).toBe(0.65)
    expect(comparison.currentLabel).toBe('本月至今')
  })

  it('can compare complete calendar months', () => {
    const comparison = compareMonthPeriods(transactions, categories, '2026-08', '2026-08-14', 'full-month')
    expect(comparison.current.expenseMinor).toBe(12300)
    expect(comparison.previous.expenseMinor).toBe(4000)
    expect(comparison.currentLabel).toBe('本月完整数据')
  })
})

describe('annual reports', () => {
  it('compares year-to-date, returns twelve months and clearly separates its projection', () => {
    const report = buildAnnualComparison(transactions, categories, 2026, '2026-08-14')

    expect(report.currentYear.expenseMinor).toBe(7300)
    expect(report.previousYear.expenseMinor).toBe(4000)
    expect(report.months).toHaveLength(12)
    expect(report.months[7]?.expenseMinor).toBe(3300)
    expect(report.months[7]?.previousExpenseMinor).toBe(4000)
    expect(report.projection.isEstimate).toBe(true)
    expect(report.projection.expenseMinor).toBe(11790)
  })

  it('handles leap-year month length', () => {
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2025, 2)).toBe(28)
  })
})
