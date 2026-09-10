import { describe, expect, it } from 'vitest'
import type { Category, Transaction } from '../../src/domain/models'
import {
  findDuplicateTransactions,
  findLatestBookkeepingTimestamp,
  formatLastBookkeepingTime,
  suggestSubcategory,
} from '../../src/domain/quickEntry'

const baseTransaction: Transaction = {
  id: 'tx-1',
  type: 'expense',
  amountMinor: 800,
  currency: 'CNY',
  categoryId: 'food',
  subcategoryId: 'breakfast',
  occurredLocalDate: '2026-09-10',
  occurredLocalTime: '08:00',
  timeZone: 'Asia/Shanghai',
  note: '',
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
  revision: { counter: 1, deviceId: 'device-a' },
}

const categories: Category[] = [
  { id: 'food', type: 'expense', parentId: null, name: '餐饮', icon: '🍜', color: '#f60', sortOrder: 0, isPinned: true, status: 'active', revision: { counter: 1, deviceId: 'a' }, createdAt: '', updatedAt: '' },
  { id: 'breakfast', type: 'expense', parentId: 'food', name: '早餐', icon: '🍜', color: '#f60', sortOrder: 0, isPinned: false, status: 'active', revision: { counter: 1, deviceId: 'a' }, createdAt: '', updatedAt: '' },
  { id: 'main-meal', type: 'expense', parentId: 'food', name: '正餐', icon: '🍜', color: '#f60', sortOrder: 1, isPinned: false, status: 'active', revision: { counter: 1, deviceId: 'a' }, createdAt: '', updatedAt: '' },
  { id: 'dinner', type: 'expense', parentId: 'food', name: '晚餐', icon: '🍜', color: '#f60', sortOrder: 2, isPinned: false, status: 'active', revision: { counter: 1, deviceId: 'a' }, createdAt: '', updatedAt: '' },
]

describe('quick entry domain rules', () => {
  it('finds the latest valid updatedAt among active transactions', () => {
    const rows: Transaction[] = [
      baseTransaction,
      { ...baseTransaction, id: 'tx-2', updatedAt: '2026-09-10T03:00:00.000Z' },
      { ...baseTransaction, id: 'tx-3', updatedAt: 'not-a-date' },
      { ...baseTransaction, id: 'tx-4', updatedAt: '2026-09-10T04:00:00.000Z', deletedAt: '2026-09-10T05:00:00.000Z' },
    ]

    expect(findLatestBookkeepingTimestamp(rows)).toBe('2026-09-10T03:00:00.000Z')
    expect(findLatestBookkeepingTimestamp(rows.map((row) => ({ ...row, deletedAt: 'deleted' })))).toBeNull()
  })

  it('formats the latest bookkeeping timestamp relative to the local calendar', () => {
    const now = new Date(2026, 8, 10, 16, 0)
    expect(formatLastBookkeepingTime(new Date(2026, 8, 10, 14, 32).toISOString(), now)).toBe('最后记账：今天 14:32')
    expect(formatLastBookkeepingTime(new Date(2026, 8, 9, 8, 5).toISOString(), now)).toBe('最后记账：昨天 08:05')
    expect(formatLastBookkeepingTime(new Date(2026, 7, 18, 9, 6).toISOString(), now)).toBe('最后记账：8月18日 09:06')
    expect(formatLastBookkeepingTime(new Date(2025, 11, 31, 23, 59).toISOString(), now)).toBe('最后记账：2025年12月31日 23:59')
    expect(formatLastBookkeepingTime(null, now)).toBe('暂无记账')
    expect(formatLastBookkeepingTime('invalid', now)).toBe('暂无记账')
  })

  it('matches duplicates by type, amount and local date while ignoring time and classification', () => {
    const rows: Transaction[] = [
      baseTransaction,
      { ...baseTransaction, id: 'tx-2', occurredLocalTime: '23:59', categoryId: 'travel', subcategoryId: null },
      { ...baseTransaction, id: 'tx-3', type: 'income' },
      { ...baseTransaction, id: 'tx-4', amountMinor: 801 },
      { ...baseTransaction, id: 'tx-5', occurredLocalDate: '2026-09-09' },
      { ...baseTransaction, id: 'tx-6', deletedAt: '2026-09-10T01:00:00.000Z' },
    ]

    const duplicates = findDuplicateTransactions(rows, {
      type: 'expense', amountMinor: 800, occurredLocalDate: '2026-09-10',
    })
    expect(duplicates.map((row) => row.id)).toEqual(['tx-2', 'tx-1'])
    expect(findDuplicateTransactions(rows, {
      type: 'expense', amountMinor: 800, occurredLocalDate: '2026-09-10',
    }, 'tx-1').map((row) => row.id)).toEqual(['tx-2'])
  })

  it.each([
    [undefined, 'breakfast'],
    [800, 'breakfast'],
    [801, 'dinner'],
    [1300, 'dinner'],
    [1301, 'main-meal'],
  ])('suggests the dining subcategory for %s minor units', (amountMinor, expected) => {
    expect(suggestSubcategory(categories, categories[0]!, amountMinor)).toBe(expected)
  })

  it('uses the first active child for ordinary or incomplete custom categories', () => {
    const renamed = categories.map((category) => category.id === 'food' ? { ...category, name: '吃饭' } : category)
    expect(suggestSubcategory(renamed, renamed[0]!, 1500)).toBe('breakfast')

    const archivedBreakfast = categories.map((category) => category.id === 'breakfast' ? { ...category, status: 'archived' as const } : category)
    expect(suggestSubcategory(archivedBreakfast, archivedBreakfast[0]!, 500)).toBe('main-meal')
  })
})
