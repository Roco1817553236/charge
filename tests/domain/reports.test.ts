import { describe, expect, it } from 'vitest'
import type { Category, Transaction } from '../../src/domain/models'
import {
  buildAnnualComparison,
  buildMonthlyReport,
  compareExpenseMonthPeriods,
  compareExpenseYearPeriods,
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

describe('expense-focused breakdown reports', () => {
  const expenseCategories: Category[] = [
    ...categories,
    {
      id: 'meal', type: 'expense', parentId: 'food', name: '正餐', icon: '🍚', color: '#fb923c', sortOrder: 0,
      isPinned: false, status: 'active', revision, createdAt: now, updatedAt: now,
    },
  ]
  const expenseTransactions: Transaction[] = [
    transaction('food-meal', '2026-08-10', 2000, 'expense', { categoryId: 'food', subcategoryId: 'meal' }),
    transaction('food-direct', '2026-08-11', 1000),
    transaction('transport-bus', '2026-08-12', 500, 'expense', { categoryId: 'food', subcategoryId: 'bus' }),
    transaction('future-current-month', '2026-08-20', 9000),
    transaction('ignored-income', '2026-08-05', 50000, 'income'),
    transaction('ignored-deleted', '2026-08-06', 70000, 'expense', { deletedAt: now, deleteRevision: revision }),
    transaction('previous-month', '2026-07-10', 1000),
    transaction('previous-year-to-date', '2025-08-10', 4000),
    transaction('previous-year-after-cutoff', '2025-08-20', 6000),
    transaction('previous-year-december', '2025-12-01', 7000, 'expense', { categoryId: 'transport' }),
    transaction('two-years-ago', '2024-01-01', 2000),
  ]

  it('builds a monthly expense-only hierarchy whose child totals reconcile with each root', () => {
    const report = compareExpenseMonthPeriods(
      expenseTransactions,
      expenseCategories,
      '2026-08',
      '2026-08-14',
      'to-date',
    )

    expect(report.current.expenseMinor).toBe(3500)
    expect(report.current.count).toBe(3)
    expect(report.previous.expenseMinor).toBe(1000)
    expect(report.expenseChangeMinor).toBe(2500)
    expect(report.expenseChangeRate).toBe(2.5)

    const food = report.current.categoryBreakdown.find((row) => row.categoryId === 'food')!
    expect(food.expenseMinor).toBe(3000)
    expect(food.percentage).toBeCloseTo(3000 / 3500)
    expect(food.subcategoryBreakdown.find((row) => row.categoryId === 'meal')).toMatchObject({
      name: '正餐', expenseMinor: 2000,
    })
    expect(food.subcategoryBreakdown.find((row) => row.name === '未细分类')).toMatchObject({
      expenseMinor: 1000,
    })
    expect(food.subcategoryBreakdown.reduce((sum, row) => sum + row.expenseMinor, 0)).toBe(food.expenseMinor)
    expect(food.subcategoryBreakdown.find((row) => row.categoryId === 'meal')?.percentage).toBeCloseTo(2 / 3)

    const transport = report.current.categoryBreakdown.find((row) => row.categoryId === 'transport')!
    expect(transport.expenseMinor).toBe(500)
    expect(transport.subcategoryBreakdown).toEqual([
      expect.objectContaining({ categoryId: 'bus', name: '公交', expenseMinor: 500, percentage: 1 }),
    ])
  })

  it('treats a tombstoned child category as missing and uses a neutral fallback', () => {
    const deletedChild: Category = {
      id: 'deleted-snack', type: 'expense', parentId: 'food', name: '旧零食', icon: '🍪', color: '#dc2626',
      sortOrder: 1, isPinned: false, status: 'archived', revision, createdAt: now, updatedAt: now,
      deletedAt: now, deleteRevision: revision,
    }
    const report = compareExpenseMonthPeriods(
      [transaction('deleted-child-expense', '2026-08-10', 800, 'expense', { categoryId: 'food', subcategoryId: deletedChild.id })],
      [...expenseCategories, deletedChild],
      '2026-08',
      '2026-08-14',
      'to-date',
    )

    expect(report.current.categoryBreakdown[0]).toMatchObject({ categoryId: 'food', name: '餐饮' })
    expect(report.current.categoryBreakdown[0]?.subcategoryBreakdown).toEqual([
      expect.objectContaining({ name: '已删除小类', color: '#94A3B8', expenseMinor: 800 }),
    ])
  })

  it('uses year-to-date for the current year and complete years for historical selections', () => {
    const current = compareExpenseYearPeriods(expenseTransactions, expenseCategories, 2026, '2026-08-14')
    expect(current.current.expenseMinor).toBe(4500)
    expect(current.previous.expenseMinor).toBe(4000)
    expect(current.currentLabel).toBe('2026 年至今')
    expect(current.previousLabel).toBe('2025 年同期')

    const historical = compareExpenseYearPeriods(expenseTransactions, expenseCategories, 2025, '2026-08-14')
    expect(historical.current.expenseMinor).toBe(17000)
    expect(historical.previous.expenseMinor).toBe(2000)
    expect(historical.currentLabel).toBe('2025 年')
    expect(historical.previousLabel).toBe('2024 年')
  })
})
