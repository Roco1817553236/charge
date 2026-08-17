import { defineStore } from 'pinia'
import type { AddTransactionInput, SaveCategoryInput } from '../data/localRepository'
import { LocalRepository } from '../data/localRepository'
import type {
  Category,
  BookSettings,
  ConflictRecord,
  LedgerSnapshot,
  SyncMetadata,
  Transaction,
  TransactionType,
} from '../domain/models'
import { parseAmountToMinor } from '../domain/money'
import {
  decryptVault,
  decryptVaultWithSession,
  vaultRecoveryFingerprint,
  type EncryptedVaultEnvelope,
  type UnlockMethod,
  type VaultUnlockSession,
} from '../security/cryptoVault'
import { TrustedSessionStore, type TrustedSessionRepository } from '../security/trustedSession'
import { parsePlainJson } from '../services/importExport'
import type { MicrosoftAuth } from '../sync/microsoftAuth'
import { OneDriveSyncProvider, type CloudSnapshotInfo } from '../sync/oneDriveProvider'
import { SyncEngine, type SyncRepository, type SyncUnlockMethod } from '../sync/syncEngine'

export interface EntryDraft {
  type: TransactionType
  amount: string
  categoryId: string | null
  subcategoryId: string | null
  date: string
  time: string
  note: string
}

export interface BookRepository {
  initialize(): Promise<void>
  listCategories(type?: TransactionType, includeArchived?: boolean): Promise<Category[]>
  listTransactions(filters?: { includeDeleted?: boolean }): Promise<Transaction[]>
  getSyncMetadata(): Promise<SyncMetadata>
  getBookSettings(): Promise<BookSettings>
  updateMonthComparisonMode(mode: BookSettings['monthComparisonMode']): Promise<BookSettings>
  addTransaction(input: AddTransactionInput): Promise<Transaction>
  updateTransaction(id: string, changes: Partial<AddTransactionInput>): Promise<Transaction>
  softDeleteTransaction(id: string): Promise<Transaction>
  restoreTransaction(id: string): Promise<Transaction>
  saveCategory(input: SaveCategoryInput): Promise<Category>
  removeCategory(id: string): Promise<'delete' | 'archive'>
  swapCategorySortOrders(firstId: string, secondId: string): Promise<void>
  createSnapshot(): Promise<LedgerSnapshot>
  getMigrationRecoverySnapshot(): Promise<LedgerSnapshot | null>
  replaceWithBackup(snapshot: LedgerSnapshot): Promise<void>
  createSyncCheckpoint(): Promise<{ snapshot: LedgerSnapshot; generation: number }>
  applySyncedSnapshot(
    snapshot: LedgerSnapshot,
    conflicts: ConflictRecord[],
    checkpoint?: LedgerSnapshot,
  ): Promise<{ unresolvedConflicts: number }>
  completeSync(metadata: SyncMetadata, expectedGeneration: number): Promise<{ pending: boolean }>
  setSyncMetadata(metadata: SyncMetadata): Promise<void>
  listConflicts(): Promise<ConflictRecord[]>
  resolveConflict(conflictId: string, choice: 'local' | 'remote'): Promise<void>
}

export interface ToastMessage {
  message: string
  action?: 'undo-delete' | 'undo-save'
}

let repository: BookRepository = new LocalRepository()

export type OneDriveSyncRunner = (
  repository: BookRepository,
  clientId: string,
  method: SyncUnlockMethod,
  hooks: {
    onRecoveryKey: (recoveryKey: string, vaultFingerprint: string) => void | Promise<void>
    onRecoveryKeyConfirmed: (vaultFingerprint: string) => void | Promise<void>
    onRecoveryKeyInvalidated: (vaultFingerprint: string) => void | Promise<void>
    onRemoteVault: (vaultFingerprint: string) => void | Promise<void>
  },
) => Promise<{
  recoveryKey?: string
  recoveryFingerprint?: string
  conflicts: number
  pending: boolean
  session: VaultUnlockSession
}>

const authSessions = new Map<string, MicrosoftAuth>()
let activeSyncSession: { clientId: string; session: VaultUnlockSession } | null = null
let followUpSyncRequested = false
let backgroundRetryDelayMs = 1_000
let trustedSessionRepository: TrustedSessionRepository = new TrustedSessionStore()

async function ensureMicrosoftAuth(clientId: string, interactive: boolean): Promise<MicrosoftAuth> {
  let auth = authSessions.get(clientId)
  if (!auth) {
    const { MicrosoftAuth: MicrosoftAuthClient } = await import('../sync/microsoftAuth')
    const redirectUri = window.location.href.split('#')[0]!
    auth = new MicrosoftAuthClient(clientId, redirectUri)
    await auth.initialize()
    authSessions.set(clientId, auth)
  }
  if (!auth.currentAccount) {
    if (!interactive) throw new Error('Microsoft 登录已过期，请在设置中重新登录')
    await auth.signIn()
  }
  return auth
}

async function remoteRecoveryFingerprint(clientId: string, recoveryKey: string): Promise<string | null> {
  const auth = await ensureMicrosoftAuth(clientId, false)
  const remote = await new OneDriveSyncProvider(() => auth.getAccessToken(false)).download()
  if (!remote) return null
  if (remote.content.length > 16 * 1024 * 1024) throw new Error('远端加密账本超过安全大小上限')
  let envelope: EncryptedVaultEnvelope
  try {
    envelope = JSON.parse(remote.content) as EncryptedVaultEnvelope
  } catch {
    throw new Error('远端加密账本格式无效')
  }
  const fingerprint = await vaultRecoveryFingerprint(envelope)
  const payload = await decryptVault<unknown>(envelope, { recoveryKey })
  parsePlainJson(JSON.stringify(payload))
  return fingerprint
}

export interface OneDriveSnapshotService {
  list(clientId: string): Promise<CloudSnapshotInfo[]>
  read(clientId: string, method: SyncUnlockMethod, snapshotId: string): Promise<LedgerSnapshot>
}

const defaultOneDriveSnapshotService: OneDriveSnapshotService = {
  async list(clientId) {
    const auth = await ensureMicrosoftAuth(clientId, true)
    return new OneDriveSyncProvider(() => auth.getAccessToken()).listSnapshots()
  },
  async read(clientId, method, snapshotId) {
    const auth = await ensureMicrosoftAuth(clientId, true)
    const content = await new OneDriveSyncProvider(() => auth.getAccessToken()).downloadSnapshot(snapshotId)
    let envelope: EncryptedVaultEnvelope
    try {
      envelope = JSON.parse(content) as EncryptedVaultEnvelope
    } catch {
      throw new Error('云端快照格式无效')
    }
    const value = 'session' in method
      ? await decryptVaultWithSession<unknown>(envelope, method.session)
      : await decryptVault<unknown>(envelope, method)
    return parsePlainJson(JSON.stringify(value))
  },
}
let oneDriveSnapshotService: OneDriveSnapshotService = defaultOneDriveSnapshotService

const defaultOneDriveSyncRunner: OneDriveSyncRunner = async (bookRepository, clientId, method, hooks) => {
  const auth = await ensureMicrosoftAuth(clientId, !('session' in method))
  const provider = new OneDriveSyncProvider(() => auth!.getAccessToken(!('session' in method)))
  const engine = new SyncEngine(bookRepository as SyncRepository, provider, {
    onRecoveryKey: hooks.onRecoveryKey,
    onRecoveryKeyConfirmed: hooks.onRecoveryKeyConfirmed,
    onRecoveryKeyInvalidated: hooks.onRecoveryKeyInvalidated,
    onRemoteVault: hooks.onRemoteVault,
  })
  return engine.sync(method)
}

let oneDriveSyncRunner: OneDriveSyncRunner = defaultOneDriveSyncRunner

export function setBookRepository(value: BookRepository): void {
  repository = value
}

export function setOneDriveSyncRunner(value: OneDriveSyncRunner): void {
  oneDriveSyncRunner = value
  activeSyncSession = null
  followUpSyncRequested = false
  backgroundRetryDelayMs = 1_000
}

export function setTrustedSessionRepository(value: TrustedSessionRepository): void {
  trustedSessionRepository = value
  activeSyncSession = null
  followUpSyncRequested = false
  backgroundRetryDelayMs = 1_000
}

export function setOneDriveSnapshotService(value: OneDriveSnapshotService): void {
  oneDriveSnapshotService = value
}

function userMessage(error: unknown, fallback: string): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return '浏览器存储空间不足，未能完整保存。请先导出备份并清理设备空间。'
  }
  if (error && typeof error === 'object' && 'name' in error && error.name === 'QuotaExceededError') {
    return '浏览器存储空间不足，未能完整保存。请先导出备份并清理设备空间。'
  }
  return error instanceof Error ? error.message : fallback
}

function initialClientId(): string {
  try {
    return import.meta.env.VITE_MS_CLIENT_ID || localStorage.getItem('personal-bookkeeping-ms-client-id') || ''
  } catch {
    return import.meta.env.VITE_MS_CLIENT_ID || ''
  }
}

function localDateTime(date = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return { date: `${value('year')}-${value('month')}-${value('day')}`, time: `${value('hour')}:${value('minute')}` }
}

function emptyDraft(type: TransactionType = 'expense'): EntryDraft {
  const now = localDateTime()
  return { type, amount: '', categoryId: null, subcategoryId: null, date: now.date, time: now.time, note: '' }
}

function restoredEntryState(): { draft: EntryDraft; editingTransactionId: string | null } {
  try {
    const stored = localStorage.getItem('personal-bookkeeping-entry-draft')
    if (!stored) return { draft: emptyDraft(), editingTransactionId: null }
    const parsed = JSON.parse(stored) as Partial<EntryDraft> & {
      draft?: Partial<EntryDraft>
      editingTransactionId?: unknown
    }
    const candidate = parsed.draft ?? parsed
    if ((candidate.type !== 'expense' && candidate.type !== 'income') || typeof candidate.amount !== 'string') {
      return { draft: emptyDraft(), editingTransactionId: null }
    }
    return {
      draft: { ...emptyDraft(candidate.type), ...candidate },
      editingTransactionId: typeof parsed.editingTransactionId === 'string' ? parsed.editingTransactionId : null,
    }
  } catch {
    return { draft: emptyDraft(), editingTransactionId: null }
  }
}

export const useBookStore = defineStore('book', {
  state: () => {
    const entry = restoredEntryState()
    return {
      categories: [] as Category[],
      transactions: [] as Transaction[],
      conflicts: [] as ConflictRecord[],
      cloudSnapshots: [] as CloudSnapshotInfo[],
      syncMetadata: { id: 'sync', pending: false, status: 'local', message: '仅保存在本机' } as SyncMetadata,
      monthComparisonMode: 'to-date' as BookSettings['monthComparisonMode'],
      syncClientId: initialClientId(),
      syncing: false,
      loadingCloudSnapshots: false,
      newRecoveryKey: null as string | null,
      migrationRecoveryAvailable: false,
      draft: entry.draft,
      pageIndex: 0,
      initialized: false,
      loading: false,
      saving: false,
      editingTransactionId: entry.editingTransactionId,
      lastDeletedId: null as string | null,
      lastSavedId: null as string | null,
      toast: null as ToastMessage | null,
      error: null as string | null,
    }
  },
  actions: {
    async initialize(): Promise<void> {
      if (this.initialized || this.loading) return
      this.loading = true
      this.error = null
      try {
        await repository.initialize()
        await this.refresh()
        if (
          this.editingTransactionId &&
          !this.transactions.some((transaction) => transaction.id === this.editingTransactionId && !transaction.deletedAt)
        ) {
          this.editingTransactionId = null
          this.draft = emptyDraft(this.draft.type)
          this.persistEntryState()
          this.error = '原编辑流水已不存在，已取消该编辑草稿以避免重复记账'
        }
        if (this.syncClientId) {
          try {
            const [session, pendingRecoveryKey, stagedRecoveryKey] = await Promise.all([
              trustedSessionRepository.loadSession(this.syncClientId),
              trustedSessionRepository.loadPendingRecoveryKey(this.syncClientId),
              trustedSessionRepository.loadStagedRecoveryKey(this.syncClientId),
            ])
            if (pendingRecoveryKey) this.newRecoveryKey = pendingRecoveryKey
            if (stagedRecoveryKey && !stagedRecoveryKey.confirmed) {
              try {
                const fingerprint = await remoteRecoveryFingerprint(
                  this.syncClientId,
                  stagedRecoveryKey.recoveryKey,
                )
                if (fingerprint === stagedRecoveryKey.vaultFingerprint) {
                  await trustedSessionRepository.confirmPendingRecoveryKey(this.syncClientId, fingerprint)
                  this.newRecoveryKey = stagedRecoveryKey.recoveryKey
                } else if (fingerprint) {
                  await trustedSessionRepository.savePendingRecoveryKey(
                    this.syncClientId,
                    stagedRecoveryKey.recoveryKey,
                    fingerprint,
                  )
                  await trustedSessionRepository.confirmPendingRecoveryKey(this.syncClientId, fingerprint)
                  this.newRecoveryKey = stagedRecoveryKey.recoveryKey
                }
              } catch {
                // No interactive login during startup; the next explicit sync will reconcile the fingerprint.
              }
            }
            if (session) {
              activeSyncSession = { clientId: this.syncClientId, session }
              void this.backgroundSync()
            }
          } catch {
            this.error = '无法读取可信设备密钥，请重新输入同步密码'
          }
        }
        this.initialized = true
      } catch (error) {
        try {
          this.migrationRecoveryAvailable = Boolean(await repository.getMigrationRecoverySnapshot())
        } catch {
          this.migrationRecoveryAvailable = false
        }
        this.error = error instanceof Error ? error.message : '本地账本初始化失败'
        throw error
      } finally {
        this.loading = false
      }
    },

    async refresh(): Promise<void> {
      const [categories, transactions, syncMetadata, conflicts, settings] = await Promise.all([
        repository.listCategories(undefined, true),
        repository.listTransactions(),
        repository.getSyncMetadata(),
        repository.listConflicts(),
        repository.getBookSettings(),
      ])
      this.categories = categories
      this.transactions = transactions
      this.syncMetadata = syncMetadata
      this.conflicts = conflicts
      this.monthComparisonMode = settings.monthComparisonMode
    },

    async updateMonthComparisonMode(mode: BookSettings['monthComparisonMode']): Promise<void> {
      if (this.monthComparisonMode === mode) return
      this.error = null
      try {
        const settings = await repository.updateMonthComparisonMode(mode)
        this.monthComparisonMode = settings.monthComparisonMode
        if (activeSyncSession) void this.backgroundSync()
      } catch (error) {
        this.error = userMessage(error, '保存统计口径失败')
        throw error
      }
    },

    updateDraft(draft: EntryDraft): void {
      this.draft = { ...draft }
      this.persistEntryState()
    },

    persistEntryState(): void {
      try {
        localStorage.setItem('personal-bookkeeping-entry-draft', JSON.stringify({
          draft: this.draft,
          editingTransactionId: this.editingTransactionId,
        }))
      } catch {
        // Draft persistence is best-effort; the in-memory draft remains available.
      }
    },

    async saveEntry(): Promise<void> {
      if (!this.draft.categoryId) throw new Error('请选择分类')
      this.saving = true
      this.error = null
      try {
        const input: AddTransactionInput = {
          type: this.draft.type,
          amountMinor: parseAmountToMinor(this.draft.amount),
          categoryId: this.draft.categoryId,
          subcategoryId: this.draft.subcategoryId,
          occurredLocalDate: this.draft.date,
          occurredLocalTime: this.draft.time,
          note: this.draft.note,
        }
        let savedTransaction: Transaction | null = null
        if (this.editingTransactionId) await repository.updateTransaction(this.editingTransactionId, input)
        else savedTransaction = await repository.addTransaction(input)
        const wasEditing = Boolean(this.editingTransactionId)
        this.lastSavedId = savedTransaction?.id ?? null
        this.editingTransactionId = null
        this.updateDraft(emptyDraft(this.draft.type))
        await this.refresh()
        this.toast = wasEditing
          ? { message: '流水已更新' }
          : { message: '本机已保存，可继续记账', action: 'undo-save' }
        if (activeSyncSession) void this.backgroundSync()
      } catch (error) {
        this.error = userMessage(error, '保存失败')
        throw error
      } finally {
        this.saving = false
      }
    },

    beginEdit(transaction: Transaction): void {
      const currentChild = transaction.subcategoryId
        ? this.categories.find((category) => category.id === transaction.subcategoryId)
        : undefined
      this.editingTransactionId = transaction.id
      this.updateDraft({
        type: transaction.type,
        amount: (transaction.amountMinor / 100).toFixed(2),
        categoryId: currentChild?.parentId ?? transaction.categoryId,
        subcategoryId: transaction.subcategoryId,
        date: transaction.occurredLocalDate,
        time: transaction.occurredLocalTime,
        note: transaction.note,
      })
      this.pageIndex = 0
      this.toast = { message: '正在编辑流水，保存后会覆盖原记录' }
    },

    duplicateToDraft(transaction: Transaction): void {
      const now = localDateTime()
      const currentChild = transaction.subcategoryId
        ? this.categories.find((category) => category.id === transaction.subcategoryId)
        : undefined
      this.editingTransactionId = null
      this.updateDraft({
        type: transaction.type,
        amount: (transaction.amountMinor / 100).toFixed(2),
        categoryId: currentChild?.parentId ?? transaction.categoryId,
        subcategoryId: transaction.subcategoryId,
        date: now.date,
        time: now.time,
        note: transaction.note,
      })
      this.pageIndex = 0
      this.toast = { message: '已复制到记账页，确认后保存' }
    },

    async deleteTransaction(transaction: Transaction): Promise<void> {
      this.error = null
      try {
        await repository.softDeleteTransaction(transaction.id)
        this.lastDeletedId = transaction.id
        await this.refresh()
        this.toast = { message: '流水已删除', action: 'undo-delete' }
        if (activeSyncSession) void this.backgroundSync()
      } catch (error) {
        this.error = userMessage(error, '删除流水失败')
        throw error
      }
    },

    async undoLastSave(): Promise<void> {
      if (!this.lastSavedId) return
      this.error = null
      try {
        await repository.softDeleteTransaction(this.lastSavedId)
        this.lastSavedId = null
        await this.refresh()
        this.toast = { message: '已撤销刚才保存的流水' }
        if (activeSyncSession) void this.backgroundSync()
      } catch (error) {
        this.error = userMessage(error, '撤销保存失败')
        throw error
      }
    },

    async undoDelete(): Promise<void> {
      if (!this.lastDeletedId) return
      this.error = null
      try {
        await repository.restoreTransaction(this.lastDeletedId)
        this.lastDeletedId = null
        await this.refresh()
        this.toast = { message: '已撤销删除' }
        if (activeSyncSession) void this.backgroundSync()
      } catch (error) {
        this.error = userMessage(error, '撤销删除失败')
        throw error
      }
    },

    async saveCategory(input: SaveCategoryInput): Promise<void> {
      this.error = null
      try {
        await repository.saveCategory(input)
        await this.refresh()
        this.toast = { message: input.id ? '分类已更新' : '分类已创建' }
        if (activeSyncSession) void this.backgroundSync()
      } catch (error) {
        this.error = userMessage(error, '保存分类失败')
        throw error
      }
    },

    async removeCategory(category: Category): Promise<void> {
      this.error = null
      try {
        const policy = await repository.removeCategory(category.id)
        await this.refresh()
        this.toast = { message: policy === 'archive' ? '分类已有流水，已安全归档' : '未使用的分类已删除' }
        if (activeSyncSession) void this.backgroundSync()
      } catch (error) {
        this.error = userMessage(error, '移除分类失败')
        throw error
      }
    },

    async reorderCategory(category: Category, direction: -1 | 1): Promise<void> {
      const siblings = this.categories
        .filter((item) => item.type === category.type && item.parentId === category.parentId && item.status === 'active')
        .sort((left, right) => left.sortOrder - right.sortOrder)
      const index = siblings.findIndex((item) => item.id === category.id)
      const neighbor = siblings[index + direction]
      if (index < 0 || !neighbor) return
      this.error = null
      try {
        await repository.swapCategorySortOrders(category.id, neighbor.id)
        await this.refresh()
        if (activeSyncSession) void this.backgroundSync()
      } catch (error) {
        this.error = userMessage(error, '调整分类顺序失败')
        throw error
      }
    },

    async createSnapshot(): Promise<LedgerSnapshot> {
      return repository.createSnapshot()
    },

    async getMigrationRecoverySnapshot(): Promise<LedgerSnapshot | null> {
      return repository.getMigrationRecoverySnapshot()
    },

    async syncOneDrive(clientId: string, method: UnlockMethod, rememberDevice = true): Promise<void> {
      const normalizedClientId = clientId.trim()
      if (!normalizedClientId) throw new Error('请输入 Microsoft 应用客户端 ID')
      this.syncClientId = normalizedClientId
      try {
        localStorage.setItem('personal-bookkeeping-ms-client-id', normalizedClientId)
      } catch {
        // The attempted account remains available in memory for snapshot recovery.
      }
      this.syncing = true
      this.error = null
      try {
        const result = await oneDriveSyncRunner(repository, normalizedClientId, method, {
          onRecoveryKey: async (recoveryKey, vaultFingerprint) => {
            await trustedSessionRepository.savePendingRecoveryKey(
              normalizedClientId,
              recoveryKey,
              vaultFingerprint,
            )
          },
          onRecoveryKeyConfirmed: async (vaultFingerprint) => {
            await trustedSessionRepository.confirmPendingRecoveryKey(normalizedClientId, vaultFingerprint)
            this.newRecoveryKey = (await trustedSessionRepository.loadPendingRecoveryKey(normalizedClientId)) ?? null
          },
          onRecoveryKeyInvalidated: async (vaultFingerprint) => {
            await trustedSessionRepository.clearPendingRecoveryKey(normalizedClientId, vaultFingerprint)
            this.newRecoveryKey = null
          },
          onRemoteVault: async (vaultFingerprint) => {
            const staged = await trustedSessionRepository.loadStagedRecoveryKey(normalizedClientId)
            if (!staged) return
            if (staged.vaultFingerprint === vaultFingerprint) {
              if (!staged.confirmed) {
                await trustedSessionRepository.confirmPendingRecoveryKey(normalizedClientId, vaultFingerprint)
              }
              this.newRecoveryKey = staged.recoveryKey
            } else {
              throw new Error('远端恢复密钥指纹与本机待确认密钥不一致；已保留本机密钥并停止同步')
            }
          },
        })
        activeSyncSession = { clientId: normalizedClientId, session: result.session }
        if (rememberDevice) await trustedSessionRepository.saveSession(normalizedClientId, result.session)
        else await trustedSessionRepository.clearSession(normalizedClientId)
        if (result.recoveryKey) {
          this.newRecoveryKey = await trustedSessionRepository.loadPendingRecoveryKey(normalizedClientId)
        }
        if (result.pending) followUpSyncRequested = true
        await this.refresh()
        this.toast = { message: result.conflicts > 0 ? `同步完成，有 ${result.conflicts} 个冲突待处理` : 'OneDrive 已同步' }
      } catch (error) {
        this.error = userMessage(error, 'OneDrive 同步失败')
        throw error
      } finally {
        this.syncing = false
        if (followUpSyncRequested && activeSyncSession) void this.backgroundSync()
      }
    },

    async backgroundSync(): Promise<void> {
      if (!activeSyncSession) return
      followUpSyncRequested = true
      if (this.syncing) return
      this.syncing = true
      try {
        let passes = 0
        while (activeSyncSession && followUpSyncRequested && passes < 3) {
          followUpSyncRequested = false
          const result = await oneDriveSyncRunner(
            repository,
            activeSyncSession.clientId,
            { session: activeSyncSession.session },
            {
              onRecoveryKey: async (recoveryKey, vaultFingerprint) => {
                await trustedSessionRepository.savePendingRecoveryKey(
                  activeSyncSession!.clientId,
                  recoveryKey,
                  vaultFingerprint,
                )
              },
              onRecoveryKeyConfirmed: async (vaultFingerprint) => {
                await trustedSessionRepository.confirmPendingRecoveryKey(activeSyncSession!.clientId, vaultFingerprint)
                this.newRecoveryKey = await trustedSessionRepository.loadPendingRecoveryKey(activeSyncSession!.clientId)
              },
              onRecoveryKeyInvalidated: async (vaultFingerprint) => {
                await trustedSessionRepository.clearPendingRecoveryKey(activeSyncSession!.clientId, vaultFingerprint)
                this.newRecoveryKey = null
              },
              onRemoteVault: async (vaultFingerprint) => {
                const clientId = activeSyncSession!.clientId
                const staged = await trustedSessionRepository.loadStagedRecoveryKey(clientId)
                if (!staged) return
                if (staged.vaultFingerprint === vaultFingerprint) {
                  if (!staged.confirmed) {
                    await trustedSessionRepository.confirmPendingRecoveryKey(clientId, vaultFingerprint)
                  }
                  this.newRecoveryKey = staged.recoveryKey
                } else {
                  throw new Error('远端恢复密钥指纹与本机待确认密钥不一致；已保留本机密钥并停止同步')
                }
              },
            },
          )
          activeSyncSession = { clientId: activeSyncSession.clientId, session: result.session }
          passes += 1
          if (result.pending) followUpSyncRequested = true
          await this.refresh()
        }
        if (!followUpSyncRequested) backgroundRetryDelayMs = 1_000
      } catch (error) {
        this.error = userMessage(error, '后台同步失败，本机数据仍安全保存')
        if (this.error.includes('重新登录 Microsoft')) {
          const clientId = activeSyncSession?.clientId
          activeSyncSession = null
          followUpSyncRequested = false
          if (clientId) void trustedSessionRepository.clearSession(clientId)
        } else {
          followUpSyncRequested = true
          backgroundRetryDelayMs = Math.min(Math.max(5_000, backgroundRetryDelayMs * 2), 300_000)
        }
      } finally {
        this.syncing = false
        if (followUpSyncRequested && activeSyncSession) {
          window.setTimeout(() => { void this.backgroundSync() }, backgroundRetryDelayMs)
        }
      }
    },

    async confirmRecoveryKeySaved(): Promise<void> {
      if (!this.syncClientId) return
      await trustedSessionRepository.clearPendingRecoveryKey(this.syncClientId)
      this.newRecoveryKey = null
      this.toast = { message: '恢复密钥已标记为妥善保存' }
    },

    async refreshCloudSnapshots(): Promise<void> {
      const clientId = activeSyncSession?.clientId ?? this.syncClientId.trim()
      if (!clientId) throw new Error('请先填写 Microsoft 应用客户端 ID 并登录')
      this.loadingCloudSnapshots = true
      this.error = null
      try {
        this.cloudSnapshots = await oneDriveSnapshotService.list(clientId)
      } catch (error) {
        this.error = userMessage(error, '无法读取云端快照')
        throw error
      } finally {
        this.loadingCloudSnapshots = false
      }
    },

    async restoreCloudSnapshot(snapshotId: string, unlockMethod?: UnlockMethod): Promise<void> {
      const clientId = activeSyncSession?.clientId ?? this.syncClientId.trim()
      const method: SyncUnlockMethod | undefined = unlockMethod ?? (
        activeSyncSession ? { session: activeSyncSession.session } : undefined
      )
      if (!clientId) throw new Error('请先填写 Microsoft 应用客户端 ID 并登录')
      if (!method) throw new Error('请输入同步密码或恢复密钥以解锁云端快照')
      this.error = null
      try {
        const snapshot = await oneDriveSnapshotService.read(
          clientId,
          method,
          snapshotId,
        )
        await repository.replaceWithBackup(snapshot)
        await this.refresh()
        this.toast = { message: '云端加密快照已恢复为新的账本版本' }
        if (activeSyncSession) void this.backgroundSync()
      } catch (error) {
        this.error = userMessage(error, '云端快照恢复失败')
        throw error
      }
    },

    async restoreSnapshot(snapshot: LedgerSnapshot): Promise<void> {
      this.error = null
      try {
        await repository.replaceWithBackup(snapshot)
        await this.refresh()
        this.toast = { message: '备份已作为新的账本版本恢复到本机' }
        if (activeSyncSession) void this.backgroundSync()
      } catch (error) {
        this.error = userMessage(error, '备份恢复失败')
        throw error
      }
    },

    async resolveConflict(conflict: ConflictRecord, choice: 'local' | 'remote'): Promise<void> {
      this.error = null
      try {
        await repository.resolveConflict(conflict.id, choice)
        await this.refresh()
        this.toast = { message: `已保留${choice === 'local' ? '本机版本' : '远端版本'}，等待同步` }
        if (activeSyncSession) void this.backgroundSync()
      } catch (error) {
        this.error = userMessage(error, '同步冲突处理失败')
        throw error
      }
    },

    clearToast(): void {
      this.toast = null
    },
  },
})
