import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.vue'
import type { Category, Transaction } from '../src/domain/models'
import { MAX_BACKUP_FILE_BYTES } from '../src/services/importExport'
import { setBookRepository, useBookStore, type BookRepository } from '../src/stores/bookStore'
import { setItemRepository, type ItemRepository } from '../src/stores/itemStore'

const now = '2026-08-14T00:00:00.000Z'
const category: Category = {
  id: 'food', type: 'expense', parentId: null, name: '餐饮', icon: '🍜', color: '#F97316', sortOrder: 0,
  isPinned: true, status: 'active', revision: { counter: 1, deviceId: 'a' }, createdAt: now, updatedAt: now,
}
const existingTransaction: Transaction = {
  id: 'existing-tx', type: 'expense', amountMinor: 1880, currency: 'CNY', categoryId: 'food', subcategoryId: null,
  occurredLocalDate: '2026-08-14', occurredLocalTime: '08:10', timeZone: 'Asia/Shanghai', note: '已有早餐',
  createdAt: now, updatedAt: now, revision: { counter: 1, deviceId: 'a' },
}
function repository(): BookRepository {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    listCategories: vi.fn().mockResolvedValue([category]),
    listTransactions: vi.fn().mockResolvedValue([]),
    getBookSettings: vi.fn().mockResolvedValue({
      id: 'book', currency: 'CNY', monthComparisonMode: 'to-date',
      revision: { counter: 1, deviceId: 'a' }, updatedAt: now,
    }),
    updateMonthComparisonMode: vi.fn(),
    addTransaction: vi.fn().mockImplementation(async (input) => ({ id: 'tx-1', currency: 'CNY', timeZone: 'Asia/Shanghai', createdAt: now, updatedAt: now, revision: { counter: 2, deviceId: 'a' }, ...input } as Transaction)),
    updateTransaction: vi.fn(), softDeleteTransaction: vi.fn(), restoreTransaction: vi.fn(),
    saveCategory: vi.fn(), removeCategory: vi.fn(), swapCategorySortOrders: vi.fn(), createSnapshot: vi.fn(), replaceWithBackup: vi.fn(),
    getMigrationRecoverySnapshot: vi.fn().mockResolvedValue(null),
  }
}

function itemRepository(): ItemRepository {
  return {
    initialize: vi.fn().mockResolvedValue(undefined), listItemCategories: vi.fn().mockResolvedValue([]),
    listItems: vi.fn().mockResolvedValue([]), listItemCosts: vi.fn().mockResolvedValue([]), listTransactions: vi.fn().mockResolvedValue([]),
    saveItem: vi.fn(), saveItemCost: vi.fn(), retireItem: vi.fn(), restoreItemUse: vi.fn(), softDeleteItem: vi.fn(),
    restoreItem: vi.fn(), softDeleteItemCost: vi.fn(), restoreItemCost: vi.fn(), saveItemCategory: vi.fn(), removeItemCategory: vi.fn(),
  }
}

describe('App', () => {
  beforeEach(() => setItemRepository(itemRepository()))

  it('starts on quick entry, saves locally, and keeps tab navigation available', async () => {
    const repo = repository()
    const itemsRepo = itemRepository()
    setBookRepository(repo)
    setItemRepository(itemsRepo)
    const wrapper = mount(App, { global: { plugins: [createPinia()] } })
    await flushPromises()

    expect(wrapper.text()).toContain('记一笔')
    await wrapper.get('[data-testid="amount-input"]').setValue('18.80')
    await wrapper.get('[data-testid="category-food"]').trigger('click')
    await wrapper.get('[data-testid="save-entry"]').trigger('submit')
    await flushPromises()
    expect(repo.addTransaction).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 1880 }))
    expect(wrapper.text()).toContain('本机已保存')

    await wrapper.get('[data-testid="nav-ledger"]').trigger('click')
    expect(wrapper.get('[data-testid="nav-ledger"]').attributes('aria-current')).toBe('page')

    await wrapper.get('[data-testid="nav-items"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="nav-items"]').attributes('aria-current')).toBe('page')
    expect(wrapper.text()).toContain('物品日均')
    expect(itemsRepo.listTransactions).toHaveBeenCalledTimes(2)

    await wrapper.get('button[aria-label="打开设置与备份"]').trigger('click')
    expect(wrapper.text()).toContain('设置与备份')
    expect(wrapper.text()).toContain('数据仅保存在当前浏览器')
    expect(wrapper.text()).not.toContain('OneDrive')
  })

  it('warns about a same-type same-date same-amount entry and lets the user return or save once', async () => {
    const repo = repository()
    vi.mocked(repo.listTransactions).mockResolvedValue([existingTransaction])
    setBookRepository(repo)
    const wrapper = mount(App, { global: { plugins: [createPinia()] } })
    await flushPromises()

    await wrapper.get('[data-testid="amount-input"]').setValue('18.80')
    await wrapper.get('[data-testid="category-food"]').trigger('click')
    await wrapper.get('[data-testid="entry-details-toggle"]').trigger('click')
    await wrapper.get('input[aria-label="日期"]').setValue('2026-08-14')
    await wrapper.get('[data-testid="save-entry"]').trigger('submit')
    await flushPromises()

    const dialog = wrapper.get('[data-testid="duplicate-entry-dialog"]')
    expect(dialog.attributes('role')).toBe('dialog')
    expect(dialog.text()).toContain('疑似重复账单')
    expect(dialog.text()).toContain('餐饮')
    expect(dialog.text()).toContain('已有早餐')
    expect(repo.addTransaction).not.toHaveBeenCalled()

    await wrapper.get('[data-testid="duplicate-entry-cancel"]').trigger('click')
    expect(wrapper.find('[data-testid="duplicate-entry-dialog"]').exists()).toBe(false)
    expect((wrapper.get('[data-testid="amount-input"]').element as HTMLInputElement).value).toBe('18.80')

    await wrapper.get('[data-testid="save-entry"]').trigger('submit')
    await wrapper.get('[data-testid="duplicate-entry-confirm"]').trigger('click')
    expect(wrapper.get('[data-testid="duplicate-entry-confirm"]').attributes()).toHaveProperty('disabled')
    await wrapper.get('[data-testid="duplicate-entry-confirm"]').trigger('click')
    await flushPromises()

    expect(repo.addTransaction).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="duplicate-entry-dialog"]').exists()).toBe(false)
  })

  it('keeps a failed duplicate confirmation open and displays the save error inside it', async () => {
    const repo = repository()
    vi.mocked(repo.listTransactions).mockResolvedValue([existingTransaction])
    vi.mocked(repo.addTransaction).mockRejectedValue(new Error('本地空间不足，未能保存'))
    setBookRepository(repo)
    const wrapper = mount(App, { global: { plugins: [createPinia()] } })
    await flushPromises()

    await wrapper.get('[data-testid="amount-input"]').setValue('18.80')
    await wrapper.get('[data-testid="category-food"]').trigger('click')
    await wrapper.get('[data-testid="entry-details-toggle"]').trigger('click')
    await wrapper.get('input[aria-label="日期"]').setValue('2026-08-14')
    await wrapper.get('[data-testid="save-entry"]').trigger('submit')
    await wrapper.get('[data-testid="duplicate-entry-confirm"]').trigger('click')
    await flushPromises()

    const dialog = wrapper.get('[data-testid="duplicate-entry-dialog"]')
    expect(dialog.get('[role="alert"]').text()).toContain('本地空间不足，未能保存')
    expect(dialog.get('[data-testid="duplicate-entry-confirm"]').attributes()).not.toHaveProperty('disabled')
  })

  it('limits duplicate details to three rows and summarizes the remainder', async () => {
    const repo = repository()
    vi.mocked(repo.listTransactions).mockResolvedValue(Array.from({ length: 5 }, (_, index) => ({
      ...existingTransaction, id: `existing-${index}`, occurredLocalTime: `0${index}:00`,
    })))
    setBookRepository(repo)
    const wrapper = mount(App, { global: { plugins: [createPinia()] } })
    await flushPromises()

    await wrapper.get('[data-testid="amount-input"]').setValue('18.80')
    await wrapper.get('[data-testid="category-food"]').trigger('click')
    await wrapper.get('[data-testid="entry-details-toggle"]').trigger('click')
    await wrapper.get('input[aria-label="日期"]').setValue('2026-08-14')
    await wrapper.get('[data-testid="save-entry"]').trigger('submit')
    await flushPromises()

    const dialog = wrapper.get('[data-testid="duplicate-entry-dialog"]')
    expect(dialog.findAll('.duplicate-list article')).toHaveLength(3)
    expect(dialog.text()).toContain('另有 2 笔相同记录')
  })

  it('lets a delete undo notification be dismissed without restoring the transaction', async () => {
    const pinia = createPinia()
    setBookRepository(repository())
    const wrapper = mount(App, { global: { plugins: [pinia] } })
    await flushPromises()
    const store = useBookStore(pinia)
    const undoDelete = vi.spyOn(store, 'undoDelete')

    store.toast = { message: '流水已删除', action: 'undo-delete' }
    await nextTick()

    expect(wrapper.get('.toast-message').text()).toContain('撤销')
    await wrapper.get('button[aria-label="关闭提示"]').trigger('click')
    expect(wrapper.find('.toast-message').exists()).toBe(false)
    expect(undoDelete).not.toHaveBeenCalled()
  })

  it('routes the delete undo action and shows the restored confirmation', async () => {
    const pinia = createPinia()
    const repo = repository()
    setBookRepository(repo)
    const wrapper = mount(App, { global: { plugins: [pinia] } })
    await flushPromises()
    const store = useBookStore(pinia)

    store.lastDeletedId = 'tx-1'
    store.toast = { message: '流水已删除', action: 'undo-delete' }
    await nextTick()

    const undoButton = wrapper.get('.toast-message').findAll('button').find((button) => button.text() === '撤销')
    expect(undoButton).toBeDefined()
    await undoButton!.trigger('click')
    await flushPromises()

    expect(repo.restoreTransaction).toHaveBeenCalledWith('tx-1')
    expect(wrapper.get('.toast-message').text()).toContain('已撤销删除')
    expect(wrapper.get('button[aria-label="关闭提示"]').text()).toBe('×')
  })

  it('shows a close control beside the undo-save action', async () => {
    const pinia = createPinia()
    setBookRepository(repository())
    const wrapper = mount(App, { global: { plugins: [pinia] } })
    await flushPromises()
    const store = useBookStore(pinia)

    store.toast = { message: '本机已保存，可继续记账', action: 'undo-save' }
    await nextTick()

    const toast = wrapper.get('.toast-message')
    expect(toast.text()).toContain('撤销')
    expect(toast.get('button[aria-label="关闭提示"]').text()).toBe('×')
  })

  it('surfaces the independent migration rescue backup when initialization self-check fails', async () => {
    const repo = repository()
    vi.mocked(repo.initialize).mockRejectedValue(new Error('数据库迁移完整性自检失败'))
    vi.mocked(repo.getMigrationRecoverySnapshot).mockResolvedValue({
      schemaVersion: 1, exportedAt: now, transactions: [], categories: [category],
      settings: {
        id: 'book', currency: 'CNY', monthComparisonMode: 'to-date',
        revision: { counter: 1, deviceId: 'legacy' }, updatedAt: now,
      },
      devices: [],
    })
    setBookRepository(repo)
    const wrapper = mount(App, { global: { plugins: [createPinia()] } })
    await flushPromises()

    await wrapper.get('button[aria-label="打开设置与备份"]').trigger('click')
    const rescueButton = wrapper.get('[data-testid="export-migration-recovery"]')

    const readsBeforeDownload = vi.mocked(repo.getMigrationRecoverySnapshot).mock.calls.length
    const confirmDownload = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirmDownload)
    try {
      await rescueButton.trigger('click')
      await flushPromises()
      expect(confirmDownload).toHaveBeenCalledWith(expect.stringContaining('明文'))
      expect(repo.getMigrationRecoverySnapshot).toHaveBeenCalledTimes(readsBeforeDownload)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('never replaces the ledger for invalid, oversized, or cancelled imports', async () => {
    const repo = repository()
    setBookRepository(repo)
    const wrapper = mount(App, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.get('button[aria-label="打开设置与备份"]').trigger('click')
    const input = wrapper.get('input[type="file"]')

    const chooseFile = async (file: File): Promise<void> => {
      Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
      await input.trigger('change')
      await flushPromises()
    }

    await chooseFile(new File(['{}'], 'invalid.json', { type: 'application/json' }))
    expect(repo.replaceWithBackup).not.toHaveBeenCalled()

    const oversized = new File(['{}'], 'oversized.json', { type: 'application/json' })
    Object.defineProperty(oversized, 'size', { configurable: true, value: MAX_BACKUP_FILE_BYTES + 1 })
    await chooseFile(oversized)
    expect(repo.replaceWithBackup).not.toHaveBeenCalled()

    const confirmImport = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirmImport)
    try {
      await chooseFile(new File([JSON.stringify({
        schemaVersion: 1,
        exportedAt: now,
        transactions: [],
        categories: [category],
        settings: {
          id: 'book', currency: 'CNY', monthComparisonMode: 'to-date',
          revision: { counter: 1, deviceId: 'a' }, updatedAt: now,
        },
        devices: [{ id: 'a', logicalCounter: 1 }],
      })], 'valid.json', { type: 'application/json' }))
      expect(confirmImport).toHaveBeenCalledWith(expect.stringContaining('valid.json'))
      expect(repo.replaceWithBackup).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
