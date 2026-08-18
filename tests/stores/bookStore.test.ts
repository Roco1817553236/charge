import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Category, LedgerSnapshot, Transaction } from '../../src/domain/models'
import {
  setBookRepository,
  useBookStore,
  type BookRepository,
} from '../../src/stores/bookStore'

const now = '2026-08-14T00:00:00.000Z'
const revision = { counter: 1, deviceId: 'a' }
const category: Category = {
  id: 'food', type: 'expense', parentId: null, name: '餐饮', icon: '🍜', color: '#F97316', sortOrder: 0,
  isPinned: true, status: 'active', revision, createdAt: now, updatedAt: now,
}
const saved: Transaction = {
  id: 'tx-1', type: 'expense', amountMinor: 2580, currency: 'CNY', categoryId: 'food', subcategoryId: null,
  occurredLocalDate: '2026-08-14', occurredLocalTime: '12:30', timeZone: 'Asia/Shanghai', note: '午饭',
  createdAt: now, updatedAt: now, revision,
}

function fakeRepository(): BookRepository {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    listCategories: vi.fn().mockResolvedValue([category]),
    listTransactions: vi.fn().mockResolvedValue([]),
    getBookSettings: vi.fn().mockResolvedValue({
      id: 'book', currency: 'CNY', monthComparisonMode: 'to-date', revision, updatedAt: now,
    }),
    updateMonthComparisonMode: vi.fn().mockImplementation(async (mode) => ({
      id: 'book', currency: 'CNY', monthComparisonMode: mode, revision, updatedAt: now,
    })),
    addTransaction: vi.fn().mockResolvedValue(saved),
    updateTransaction: vi.fn().mockResolvedValue(saved),
    softDeleteTransaction: vi.fn().mockResolvedValue(saved),
    restoreTransaction: vi.fn().mockResolvedValue(saved),
    saveCategory: vi.fn().mockResolvedValue(category),
    removeCategory: vi.fn().mockResolvedValue('archive'),
    swapCategorySortOrders: vi.fn().mockResolvedValue(undefined),
    createSnapshot: vi.fn(),
    getMigrationRecoverySnapshot: vi.fn().mockResolvedValue(null),
    replaceWithBackup: vi.fn().mockResolvedValue(undefined),
  }
}

describe('book store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('initializes only local ledger state', async () => {
    const repository = fakeRepository()
    setBookRepository(repository)
    const store = useBookStore()
    await store.initialize()

    expect(repository.initialize).toHaveBeenCalledOnce()
    expect(store.categories).toEqual([category])
    expect(store.monthComparisonMode).toBe('to-date')
    expect('syncMetadata' in store).toBe(false)
    expect('syncOneDrive' in store).toBe(false)
    expect('backgroundSync' in store).toBe(false)
  })

  it('validates and saves a draft as integer fen, then resets the fast-entry fields', async () => {
    const repository = fakeRepository()
    setBookRepository(repository)
    const store = useBookStore()
    await store.initialize()
    store.updateDraft({
      type: 'expense', amount: '25.80', categoryId: 'food', subcategoryId: null,
      date: '2026-08-14', time: '12:30', note: '午饭',
    })

    await store.saveEntry()

    expect(repository.addTransaction).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 2580, categoryId: 'food' }))
    expect(store.draft.amount).toBe('')
    expect(store.toast?.message).toContain('已保存')
    expect(store.toast?.action).toBe('undo-save')

    await store.undoLastSave()
    expect(repository.softDeleteTransaction).toHaveBeenCalledWith(saved.id)
  })

  it('restores an editing draft identity after reload and updates instead of duplicating', async () => {
    const repository = fakeRepository()
    vi.mocked(repository.listTransactions).mockResolvedValue([saved])
    setBookRepository(repository)
    const first = useBookStore()
    await first.initialize()
    first.beginEdit(saved)

    expect(JSON.parse(localStorage.getItem('personal-bookkeeping-entry-draft') ?? '{}')).toMatchObject({
      editingTransactionId: saved.id,
    })

    setActivePinia(createPinia())
    const restored = useBookStore()
    await restored.initialize()
    expect(restored.editingTransactionId).toBe(saved.id)

    await restored.saveEntry()
    expect(repository.updateTransaction).toHaveBeenCalledWith(saved.id, expect.objectContaining({ note: '午饭' }))
    expect(repository.addTransaction).not.toHaveBeenCalled()
  })

  it('reorders sibling categories by swapping their stable sort positions', async () => {
    const repository = fakeRepository()
    const second = { ...category, id: 'life', name: '生活', sortOrder: 1 }
    vi.mocked(repository.listCategories).mockResolvedValue([category, second])
    setBookRepository(repository)
    const store = useBookStore()
    await store.initialize()

    await store.reorderCategory(category, 1)

    expect(repository.swapCategorySortOrders).toHaveBeenCalledWith('food', 'life')
  })

  it('edits historical rows under a subcategory current parent after that child was moved', async () => {
    const repository = fakeRepository()
    const life = { ...category, id: 'life', name: '生活', sortOrder: 1 }
    const child = { ...category, id: 'lunch', name: '正餐', parentId: 'life', isPinned: false }
    vi.mocked(repository.listCategories).mockResolvedValue([category, life, child])
    setBookRepository(repository)
    const store = useBookStore()
    await store.initialize()

    store.beginEdit({ ...saved, categoryId: 'food', subcategoryId: 'lunch' })
    expect(store.draft.categoryId).toBe('life')
    expect(store.draft.subcategoryId).toBe('lunch')
  })

  it('restores a JSON snapshot locally and refreshes the visible ledger', async () => {
    const repository = fakeRepository()
    const backup: LedgerSnapshot = {
      schemaVersion: 1,
      exportedAt: now,
      transactions: [saved],
      categories: [category],
      settings: { id: 'book', currency: 'CNY', monthComparisonMode: 'to-date', revision, updatedAt: now },
      devices: [{ id: 'a', logicalCounter: 1 }],
    }
    vi.mocked(repository.listTransactions).mockResolvedValueOnce([]).mockResolvedValueOnce([saved])
    setBookRepository(repository)
    const store = useBookStore()
    await store.initialize()

    await store.restoreSnapshot(backup)

    expect(repository.replaceWithBackup).toHaveBeenCalledWith(backup)
    expect(store.transactions).toEqual([saved])
    expect(store.toast?.message).toContain('恢复到本机')
  })
})
