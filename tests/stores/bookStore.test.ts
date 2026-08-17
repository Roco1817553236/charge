import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Category, ConflictRecord, SyncMetadata, Transaction } from '../../src/domain/models'
import type { VaultUnlockSession } from '../../src/security/cryptoVault'
import type { TrustedSessionRepository } from '../../src/security/trustedSession'
import {
  setBookRepository,
  setOneDriveSyncRunner,
  setOneDriveSnapshotService,
  setTrustedSessionRepository,
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
const conflict: ConflictRecord = {
  id: 'conflict-1', entityType: 'transaction', entityId: saved.id,
  localValue: saved, remoteValue: { ...saved, note: '远端版本' }, createdAt: now,
}
const session = { key: { extractable: false } as CryptoKey } satisfies VaultUnlockSession

function fakeTrustedSessions(): TrustedSessionRepository {
  return {
    saveSession: vi.fn().mockResolvedValue(undefined),
    loadSession: vi.fn().mockResolvedValue(null),
    clearSession: vi.fn().mockResolvedValue(undefined),
    savePendingRecoveryKey: vi.fn().mockResolvedValue(undefined),
    confirmPendingRecoveryKey: vi.fn().mockResolvedValue(undefined),
    loadStagedRecoveryKey: vi.fn().mockResolvedValue(null),
    loadPendingRecoveryKey: vi.fn().mockResolvedValue(null),
    clearPendingRecoveryKey: vi.fn().mockResolvedValue(undefined),
  }
}

function fakeRepository(): BookRepository {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    listCategories: vi.fn().mockResolvedValue([category]),
    listTransactions: vi.fn().mockResolvedValue([]),
    getSyncMetadata: vi.fn().mockResolvedValue({ id: 'sync', pending: false, status: 'local' } satisfies SyncMetadata),
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
    createSyncCheckpoint: vi.fn(),
    applySyncedSnapshot: vi.fn(),
    completeSync: vi.fn(),
    setSyncMetadata: vi.fn(),
    listConflicts: vi.fn().mockResolvedValue([]),
    resolveConflict: vi.fn().mockResolvedValue(undefined),
  }
}

describe('book store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    setTrustedSessionRepository(fakeTrustedSessions())
    setOneDriveSnapshotService({ list: vi.fn().mockResolvedValue([]), read: vi.fn() })
  })

  it('initializes from the local-first repository', async () => {
    const repository = fakeRepository()
    setBookRepository(repository)
    const store = useBookStore()
    await store.initialize()

    expect(repository.initialize).toHaveBeenCalledOnce()
    expect(store.categories).toEqual([category])
    expect(store.syncMetadata.status).toBe('local')
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

  it('wires a user-authorized OneDrive session and exposes the first-sync recovery key', async () => {
    const repository = fakeRepository()
    const trusted = fakeTrustedSessions()
    vi.mocked(trusted.loadPendingRecoveryKey).mockResolvedValue('recovery-key')
    const runner = vi.fn().mockImplementation(async (_repository, _clientId, _method, hooks) => {
      await hooks.onRecoveryKey('recovery-key', 'vault-fingerprint')
      await hooks.onRecoveryKeyConfirmed('vault-fingerprint')
      return {
        recoveryKey: 'recovery-key', recoveryFingerprint: 'vault-fingerprint',
        conflicts: 0, pending: false, session,
      }
    })
    setBookRepository(repository)
    setOneDriveSyncRunner(runner)
    setTrustedSessionRepository(trusted)
    const store = useBookStore()
    await store.initialize()

    await store.syncOneDrive('client-id', { password: '这是一个足够长的同步密码' }, true)

    expect(runner).toHaveBeenCalledWith(
      repository,
      'client-id',
      { password: '这是一个足够长的同步密码' },
      expect.objectContaining({ onRecoveryKey: expect.any(Function) }),
    )
    expect(trusted.savePendingRecoveryKey).toHaveBeenCalledWith('client-id', 'recovery-key', 'vault-fingerprint')
    expect(trusted.confirmPendingRecoveryKey).toHaveBeenCalledWith('client-id', 'vault-fingerprint')
    expect(trusted.saveSession).toHaveBeenCalledWith('client-id', session)
    expect(store.newRecoveryKey).toBe('recovery-key')
    expect(localStorage.getItem('personal-bookkeeping-ms-client-id')).toBe('client-id')

    store.updateDraft({ type: 'expense', amount: '8.00', categoryId: 'food', subcategoryId: null, date: '2026-08-14', time: '12:30', note: '' })
    await store.saveEntry()
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(2))
    expect(runner.mock.calls[1]?.[2]).toEqual({ session })
  })

  it('confirms an upload-ambiguous staged key when the next sync sees the matching vault fingerprint', async () => {
    const repository = fakeRepository()
    const trusted = fakeTrustedSessions()
    vi.mocked(trusted.loadStagedRecoveryKey).mockResolvedValue({
      recoveryKey: 'recovered-after-restart', vaultFingerprint: 'matching-fingerprint', confirmed: false,
    })
    const runner = vi.fn().mockImplementation(async (_repository, _clientId, _method, hooks) => {
      await hooks.onRemoteVault('matching-fingerprint')
      return { conflicts: 0, pending: false, session }
    })
    setBookRepository(repository)
    setOneDriveSyncRunner(runner)
    setTrustedSessionRepository(trusted)
    const store = useBookStore()
    await store.initialize()

    await store.syncOneDrive('client-id', { password: '这是一个足够长的同步密码' })

    expect(trusted.confirmPendingRecoveryKey).toHaveBeenCalledWith('client-id', 'matching-fingerprint')
    expect(store.newRecoveryKey).toBe('recovered-after-restart')
  })

  it('preserves an upload-ambiguous recovery key when a different remote fingerprint appears', async () => {
    const repository = fakeRepository()
    const trusted = fakeTrustedSessions()
    vi.mocked(trusted.loadStagedRecoveryKey).mockResolvedValue({
      recoveryKey: 'unique-local-recovery-key', vaultFingerprint: 'local-fingerprint', confirmed: false,
    })
    const runner = vi.fn().mockImplementation(async (_repository, _clientId, _method, hooks) => {
      await hooks.onRemoteVault('different-remote-fingerprint')
      return { conflicts: 0, pending: false, session }
    })
    setBookRepository(repository)
    setOneDriveSyncRunner(runner)
    setTrustedSessionRepository(trusted)
    const store = useBookStore()
    await store.initialize()

    await expect(store.syncOneDrive('client-id', { password: '这是一个足够长的同步密码' })).rejects.toThrow('恢复密钥')
    expect(trusted.clearPendingRecoveryKey).not.toHaveBeenCalled()
  })

  it('immediately runs a follow-up pass when data changed during synchronization', async () => {
    const repository = fakeRepository()
    const runner = vi.fn()
      .mockResolvedValueOnce({ conflicts: 0, pending: true, session })
      .mockResolvedValueOnce({ conflicts: 0, pending: false, session })
    setBookRepository(repository)
    setOneDriveSyncRunner(runner)
    const store = useBookStore()
    await store.initialize()

    await store.syncOneDrive('client-id', { password: '这是一个足够长的同步密码' })

    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(2))
  })

  it('queues background synchronization after category, delete, undo, conflict, and restore mutations', async () => {
    const repository = fakeRepository()
    const runner = vi.fn().mockResolvedValue({ conflicts: 0, pending: false, session })
    setBookRepository(repository)
    setOneDriveSyncRunner(runner)
    const store = useBookStore()
    await store.initialize()
    await store.syncOneDrive('client-id', { password: '这是一个足够长的同步密码' })
    runner.mockClear()

    await store.saveCategory({ type: 'expense', parentId: null, name: '宠物', icon: '🐾', color: '#8B5CF6', isPinned: false })
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1))
    await store.deleteTransaction(saved)
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(2))
    await store.undoDelete()
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(3))
    await store.resolveConflict(conflict, 'local')
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(4))
    await store.restoreSnapshot({
      schemaVersion: 1, exportedAt: now, transactions: [], categories: [category],
      settings: { id: 'book', currency: 'CNY', monthComparisonMode: 'to-date', revision, updatedAt: now },
      devices: [],
    })
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(5))
    expect(repository.replaceWithBackup).toHaveBeenCalledOnce()
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

  it('edits historical rows under a subcategory’s current parent after that child was moved', async () => {
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

  it('applies an explicit conflict choice and refreshes the visible ledger', async () => {
    const repository = fakeRepository()
    vi.mocked(repository.listConflicts).mockResolvedValueOnce([conflict]).mockResolvedValue([])
    setBookRepository(repository)
    const store = useBookStore()
    await store.initialize()

    await store.resolveConflict(conflict, 'remote')

    expect(repository.resolveConflict).toHaveBeenCalledWith('conflict-1', 'remote')
    expect(store.conflicts).toEqual([])
    expect(store.toast?.message).toContain('远端版本')
  })

  it('lists and restores an encrypted OneDrive snapshot with the active trusted key', async () => {
    const repository = fakeRepository()
    const backup = {
      schemaVersion: 1 as const, exportedAt: now, transactions: [], categories: [category],
      settings: { id: 'book' as const, currency: 'CNY' as const, monthComparisonMode: 'to-date' as const, revision, updatedAt: now },
      devices: [],
    }
    const snapshots = {
      list: vi.fn().mockResolvedValue([{ id: 'snapshot-1', name: 'vault-1.json', createdAt: now }]),
      read: vi.fn().mockResolvedValue(backup),
    }
    const runner = vi.fn().mockResolvedValue({ conflicts: 0, pending: false, session })
    setBookRepository(repository)
    setOneDriveSyncRunner(runner)
    setOneDriveSnapshotService(snapshots)
    const store = useBookStore()
    await store.initialize()
    await store.syncOneDrive('client-id', { password: '这是一个足够长的同步密码' })

    await store.refreshCloudSnapshots()
    expect(store.cloudSnapshots).toHaveLength(1)
    await store.restoreCloudSnapshot('snapshot-1')

    expect(snapshots.read).toHaveBeenCalledWith('client-id', { session }, 'snapshot-1')
    expect(repository.replaceWithBackup).toHaveBeenCalledWith(backup)
  })

  it('can restore a cloud snapshot with a password when the main vault has no active session', async () => {
    const repository = fakeRepository()
    const backup = {
      schemaVersion: 1 as const, exportedAt: now, transactions: [], categories: [category],
      settings: { id: 'book' as const, currency: 'CNY' as const, monthComparisonMode: 'to-date' as const, revision, updatedAt: now },
      devices: [],
    }
    const snapshots = {
      list: vi.fn().mockResolvedValue([{ id: 'snapshot-1', name: 'vault-1.json', createdAt: now }]),
      read: vi.fn().mockResolvedValue(backup),
    }
    setBookRepository(repository)
    setOneDriveSnapshotService(snapshots)
    const store = useBookStore()
    await store.initialize()
    store.syncClientId = 'client-id'

    await store.refreshCloudSnapshots()
    await store.restoreCloudSnapshot('snapshot-1', { password: '这是一个足够长的同步密码' })

    expect(snapshots.read).toHaveBeenCalledWith(
      'client-id',
      { password: '这是一个足够长的同步密码' },
      'snapshot-1',
    )
    expect(repository.replaceWithBackup).toHaveBeenCalledWith(backup)
  })
})
