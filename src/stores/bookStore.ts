import { defineStore } from 'pinia'
import type { AddTransactionInput, SaveCategoryInput } from '../data/localRepository'
import { LocalRepository } from '../data/localRepository'
import type {
  BookSettings,
  Category,
  LedgerSnapshot,
  Transaction,
  TransactionType,
} from '../domain/models'
import { parseAmountToMinor } from '../domain/money'
import { findDuplicateTransactions, findLatestBookkeepingTimestamp } from '../domain/quickEntry'

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
}

export interface ToastMessage {
  message: string
  action?: 'undo-delete' | 'undo-save'
}

let repository: BookRepository = new LocalRepository()

export function setBookRepository(value: BookRepository): void {
  repository = value
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
      monthComparisonMode: 'to-date' as BookSettings['monthComparisonMode'],
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
  getters: {
    latestBookkeepingTimestamp: (state): string | null => findLatestBookkeepingTimestamp(state.transactions),
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
      const [categories, transactions, settings] = await Promise.all([
        repository.listCategories(undefined, true),
        repository.listTransactions(),
        repository.getBookSettings(),
      ])
      this.categories = categories
      this.transactions = transactions
      this.monthComparisonMode = settings.monthComparisonMode
    },

    async updateMonthComparisonMode(mode: BookSettings['monthComparisonMode']): Promise<void> {
      if (this.monthComparisonMode === mode) return
      this.error = null
      try {
        const settings = await repository.updateMonthComparisonMode(mode)
        this.monthComparisonMode = settings.monthComparisonMode
      } catch (error) {
        this.error = userMessage(error, '保存统计口径失败')
        throw error
      }
    },

    updateDraft(draft: EntryDraft): void {
      this.draft = { ...draft }
      this.persistEntryState()
    },

    previewDuplicateEntry(draft?: EntryDraft): Transaction[] {
      const candidate = draft ?? this.draft
      let amountMinor: number
      try {
        amountMinor = parseAmountToMinor(candidate.amount)
      } catch {
        return []
      }
      return findDuplicateTransactions(this.transactions, {
        type: candidate.type,
        amountMinor,
        occurredLocalDate: candidate.date,
      }, this.editingTransactionId)
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

    async restoreSnapshot(snapshot: LedgerSnapshot): Promise<void> {
      this.error = null
      try {
        await repository.replaceWithBackup(snapshot)
        await this.refresh()
        this.toast = { message: '备份已作为新的账本版本恢复到本机' }
      } catch (error) {
        this.error = userMessage(error, '备份恢复失败')
        throw error
      }
    },

    clearToast(): void {
      this.toast = null
    },
  },
})
