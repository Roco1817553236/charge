import { describe, expect, it } from 'vitest'
import {
  categoryRemovalPolicy,
  createDefaultCategories,
  getSubcategoryMoveImpact,
  moveSubcategory,
  normalizeLegacyDefaultCategories,
  validateCategorySelection,
} from '../../src/domain/categories'
import type { Category, Transaction } from '../../src/domain/models'

const revision = { counter: 1, deviceId: 'device-a' }

function category(overrides: Partial<Category> & Pick<Category, 'id' | 'name'>): Category {
  const { id, name, ...rest } = overrides
  return {
    id,
    name,
    type: 'expense',
    parentId: null,
    icon: 'circle',
    color: '#6366F1',
    sortOrder: 0,
    isPinned: false,
    status: 'active',
    revision,
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    ...rest,
  }
}

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    type: 'expense',
    amountMinor: 1200,
    currency: 'CNY',
    categoryId: 'food',
    subcategoryId: 'lunch',
    occurredLocalDate: '2026-08-14',
    occurredLocalTime: '12:00',
    timeZone: 'Asia/Shanghai',
    note: '',
    createdAt: '2026-08-14T04:00:00.000Z',
    updatedAt: '2026-08-14T04:00:00.000Z',
    revision,
    ...overrides,
  }
}

describe('default categories', () => {
  it('provides two-level expense and income defaults with no more than six pinned roots', () => {
    const categories = createDefaultCategories('2026-08-14T00:00:00.000Z', 'device-a')
    const roots = categories.filter((item) => item.parentId === null)

    expect(roots.filter((item) => item.type === 'expense').map((item) => item.name)).toEqual([
      '餐饮',
      '生活缴费',
      '交通出行',
      '购物',
      '居住',
      '医疗健康',
      '娱乐休闲',
      '学习',
      '人情往来',
      '其他',
    ])
    expect(roots.some((item) => item.type === 'income' && item.name === '工资')).toBe(true)
    expect(roots.filter((item) => item.type === 'expense' && item.isPinned)).toHaveLength(6)
    expect(categories.every((item) => item.parentId === null || roots.some((root) => root.id === item.parentId))).toBe(true)

    const food = roots.find((item) => item.type === 'expense' && item.name === '餐饮')
    expect(categories.filter((item) => item.parentId === food?.id).map((item) => item.name)).toEqual([
      '早餐',
      '正餐',
      '晚餐',
      '零食饮料',
    ])
  })

  it('uses one stable genesis payload on every newly joined device', () => {
    const firstDevice = createDefaultCategories('2026-08-14T00:00:00.000Z', 'device-a')
    const laterDevice = createDefaultCategories('2026-09-01T00:00:00.000Z', 'device-b')

    expect(laterDevice).toEqual(firstDevice)
  })

  it('normalizes untouched legacy defaults but preserves a customized default', () => {
    const canonical = createDefaultCategories('ignored', 'ignored')
    const legacy = canonical.map((item) => ({
      ...item,
      revision: { counter: item.revision.counter, deviceId: 'legacy-device' },
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    }))
    legacy[0] = { ...legacy[0]!, name: '我改过的餐饮' }

    const normalized = normalizeLegacyDefaultCategories(legacy)

    expect(normalized[0]?.name).toBe('我改过的餐饮')
    expect(normalized[0]?.revision.deviceId).toBe('legacy-device')
    expect(normalized[1]).toEqual(canonical[1])
  })

  it('preserves the old 外卖 name in an existing book instead of migrating it to 晚餐', () => {
    const legacy = createDefaultCategories('ignored', 'ignored')
    const legacyTakeoutIndex = legacy.findIndex((item) => item.parentId !== null && item.name === '晚餐')
    expect(legacyTakeoutIndex).toBeGreaterThanOrEqual(0)

    legacy[legacyTakeoutIndex] = {
      ...legacy[legacyTakeoutIndex]!,
      name: '外卖',
      revision: { counter: 99, deviceId: 'existing-book' },
      updatedAt: '2026-08-17T00:00:00.000Z',
    }

    const normalized = normalizeLegacyDefaultCategories(legacy)

    expect(normalized[legacyTakeoutIndex]?.name).toBe('外卖')
    expect(normalized[legacyTakeoutIndex]?.revision.deviceId).toBe('existing-book')
  })
})

describe('category rules', () => {
  const food = category({ id: 'food', name: '餐饮' })
  const transport = category({ id: 'transport', name: '交通' })
  const lunch = category({ id: 'lunch', name: '正餐', parentId: 'food' })
  const archived = category({ id: 'archived', name: '旧分类', parentId: 'food', status: 'archived' })
  const categories = [food, transport, lunch, archived]

  it('accepts an active root and matching active child', () => {
    expect(() => validateCategorySelection(categories, 'expense', 'food', 'lunch')).not.toThrow()
  })

  it('rejects mismatched or archived selections for a new transaction', () => {
    expect(() => validateCategorySelection(categories, 'expense', 'transport', 'lunch')).toThrow('二级分类不属于所选大类')
    expect(() => validateCategorySelection(categories, 'expense', 'food', 'archived')).toThrow('该分类已归档')
  })

  it('only physically deletes categories that have never been referenced', () => {
    expect(categoryRemovalPolicy('lunch', [transaction()])).toBe('archive')
    expect(categoryRemovalPolicy('unused', [transaction()])).toBe('delete')
  })

  it('reports historical impact and requires confirmation before moving a used child', () => {
    expect(getSubcategoryMoveImpact('lunch', [transaction(), transaction({ id: 'tx-2', subcategoryId: null })])).toBe(1)
    expect(() => moveSubcategory(categories, 'lunch', 'transport', [transaction()], false, '2026-08-14T01:00:00.000Z')).toThrow(
      '移动会影响 1 笔历史流水',
    )

    const moved = moveSubcategory(categories, 'lunch', 'transport', [transaction()], true, '2026-08-14T01:00:00.000Z')
    expect(moved.find((item) => item.id === 'lunch')?.parentId).toBe('transport')
  })
})
