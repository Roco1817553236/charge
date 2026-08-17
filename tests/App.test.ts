import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import App from '../src/App.vue'
import type { Category, ConflictRecord, SyncMetadata, Transaction } from '../src/domain/models'
import { setBookRepository, type BookRepository } from '../src/stores/bookStore'

const now = '2026-08-14T00:00:00.000Z'
const category: Category = {
  id: 'food', type: 'expense', parentId: null, name: '餐饮', icon: '🍜', color: '#F97316', sortOrder: 0,
  isPinned: true, status: 'active', revision: { counter: 1, deviceId: 'a' }, createdAt: now, updatedAt: now,
}
const conflictedTransaction: Transaction = {
  id: 'tx-1', type: 'expense', amountMinor: 1880, currency: 'CNY', categoryId: 'food', subcategoryId: null,
  occurredLocalDate: '2026-08-14', occurredLocalTime: '12:30', timeZone: 'Asia/Shanghai', note: '本机午饭',
  createdAt: now, updatedAt: now, revision: { counter: 2, deviceId: 'device-a' },
}
const conflict: ConflictRecord = {
  id: 'conflict-1', entityType: 'transaction', entityId: 'tx-1', localValue: conflictedTransaction,
  remoteValue: { ...conflictedTransaction, note: '远端午饭', revision: { counter: 2, deviceId: 'device-b' } }, createdAt: now,
}

function repository(): BookRepository {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    listCategories: vi.fn().mockResolvedValue([category]),
    listTransactions: vi.fn().mockResolvedValue([]),
    getSyncMetadata: vi.fn().mockResolvedValue({ id: 'sync', pending: false, status: 'local' } satisfies SyncMetadata),
    getBookSettings: vi.fn().mockResolvedValue({
      id: 'book', currency: 'CNY', monthComparisonMode: 'to-date',
      revision: { counter: 1, deviceId: 'a' }, updatedAt: now,
    }),
    updateMonthComparisonMode: vi.fn(),
    addTransaction: vi.fn().mockImplementation(async (input) => ({ id: 'tx-1', currency: 'CNY', timeZone: 'Asia/Shanghai', createdAt: now, updatedAt: now, revision: { counter: 2, deviceId: 'a' }, ...input } as Transaction)),
    updateTransaction: vi.fn(), softDeleteTransaction: vi.fn(), restoreTransaction: vi.fn(),
    saveCategory: vi.fn(), removeCategory: vi.fn(), swapCategorySortOrders: vi.fn(), createSnapshot: vi.fn(), replaceWithBackup: vi.fn(),
    getMigrationRecoverySnapshot: vi.fn().mockResolvedValue(null),
    createSyncCheckpoint: vi.fn(), applySyncedSnapshot: vi.fn(), completeSync: vi.fn(),
    setSyncMetadata: vi.fn(), listConflicts: vi.fn().mockResolvedValue([]), resolveConflict: vi.fn(),
  }
}

describe('App', () => {
  it('starts on quick entry, saves locally, and keeps tab navigation available', async () => {
    const repo = repository()
    setBookRepository(repo)
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

    await wrapper.get('.sync-status').trigger('click')
    expect(wrapper.text()).toContain('设置与同步')
    expect(wrapper.text()).toContain('不需要自建服务器')
  })

  it('routes an explicit settings conflict choice back to the local repository', async () => {
    const repo = repository()
    vi.mocked(repo.listConflicts).mockResolvedValueOnce([conflict]).mockResolvedValue([])
    setBookRepository(repo)
    const wrapper = mount(App, { global: { plugins: [createPinia()] } })
    await flushPromises()

    await wrapper.get('.sync-status').trigger('click')
    await wrapper.get('[data-testid="conflict-remote-conflict-1"]').trigger('click')
    await flushPromises()

    expect(repo.resolveConflict).toHaveBeenCalledWith('conflict-1', 'remote')
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

    await wrapper.get('.sync-status').trigger('click')
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
})
