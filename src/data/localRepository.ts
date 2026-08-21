import {
  categoryRemovalPolicy,
  createDefaultCategories,
  normalizeLegacyDefaultCategories,
  validateCategorySelection,
} from '../domain/categories'
import { createDefaultItemCategories } from '../domain/itemCategories'
import { assertItemSnapshotIntegrity } from '../domain/itemIntegrity'
import { compareRevision, revisionClock } from '../domain/merge'
import { mergeSnapshots } from '../domain/snapshots'
import type {
  BookSettings,
  Category,
  ConflictRecord,
  DeviceState,
  ItemCategory,
  ItemCost,
  ItemCostType,
  LedgerSnapshot,
  OwnedItem,
  Revision,
  SyncMetadata,
  Transaction,
  TransactionType,
} from '../domain/models'
import {
  BookkeepingDatabase,
  prepareDurableMigrationBackup,
  readDurableMigrationBackup,
} from './database'

export interface AddTransactionInput {
  type: TransactionType
  amountMinor: number
  categoryId: string
  subcategoryId: string | null
  occurredLocalDate: string
  occurredLocalTime: string
  note: string
}

export interface TransactionFilters {
  month?: string
  type?: TransactionType | 'all'
  categoryId?: string
  subcategoryId?: string
  query?: string
  includeDeleted?: boolean
}

export interface SaveCategoryInput {
  id?: string
  type: TransactionType
  parentId: string | null
  name: string
  icon: string
  color: string
  isPinned: boolean
  sortOrder?: number
  status?: Category['status']
}

export interface SaveItemCategoryInput {
  id?: string
  name: string
  icon: string
  color: string
  sortOrder?: number
  status?: ItemCategory['status']
}

export interface SaveItemInput {
  id?: string
  categoryId: string
  name: string
  icon: string
  note: string
  purchaseAmountMinor: number
  purchaseLocalDate: string
  startedLocalDate: string
  retiredLocalDate?: string
  sourceTransactionId: string | null
}

export interface SaveItemCostInput {
  id?: string
  itemId: string
  type: ItemCostType
  amountMinor: number
  occurredLocalDate: string
  note: string
  sourceTransactionId: string | null
}

interface RepositoryDependencies {
  now: () => string
  uuid: () => string
  timeZone: () => string
}

function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const defaultDependencies: RepositoryDependencies = {
  now: () => new Date().toISOString(),
  uuid: randomId,
  timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
}

export class LocalRepository {
  readonly db: BookkeepingDatabase
  private readonly dependencies: RepositoryDependencies
  private migrationRecoverySnapshot: LedgerSnapshot | null = null

  constructor(
    dbName = 'personal-bookkeeping',
    private readonly deviceId = getOrCreateDeviceId(),
    dependencies: Partial<RepositoryDependencies> = {},
  ) {
    this.db = new BookkeepingDatabase(dbName)
    this.dependencies = { ...defaultDependencies, ...dependencies }
  }

  async initialize(): Promise<void> {
    const migrationPrepared = await prepareDurableMigrationBackup(this.db.name)
    try {
      await this.db.open()
      await this.db.transaction(
        'rw',
        [this.db.categories, this.db.itemCategories, this.db.settings, this.db.deviceStates, this.db.syncMetadata],
        async () => {
          const now = this.dependencies.now()
          const existingCategories = await this.db.categories.toArray()
          if (existingCategories.length === 0) {
            const categories = createDefaultCategories(now, this.deviceId)
            await this.db.categories.bulkAdd(categories)
          } else {
            const normalized = normalizeLegacyDefaultCategories(existingCategories)
            const changed = normalized.filter((item, index) => item !== existingCategories[index])
            if (changed.length > 0) await this.db.categories.bulkPut(changed)
          }

          if ((await this.db.itemCategories.count()) === 0) {
            await this.db.itemCategories.bulkAdd(createDefaultItemCategories())
          }

          if (!(await this.db.deviceStates.get(this.deviceId))) {
            await this.db.deviceStates.put({ id: this.deviceId, logicalCounter: 0 })
          }

          if (!(await this.db.settings.get('book'))) {
            await this.db.settings.put(this.defaultBookSettings())
          }

          if (!(await this.db.syncMetadata.get('sync'))) {
            await this.db.syncMetadata.put({ id: 'sync', changeGeneration: 0, pending: false, status: 'local' })
          }
        },
      )
      await this.verifyStorageAfterMigration(migrationPrepared)
    } catch (error) {
      this.migrationRecoverySnapshot = (await readDurableMigrationBackup(this.db.name))?.snapshot ?? null
      throw error
    }
  }

  close(): void {
    this.db.close()
  }

  async listCategories(type?: TransactionType, includeArchived = false): Promise<Category[]> {
    const categories = await this.db.categories.toArray()
    return categories
      .filter((category) => !category.deletedAt)
      .filter((category) => (!type || category.type === type) && (includeArchived || category.status === 'active'))
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'zh-CN'))
  }

  async listItemCategories(includeArchived = false): Promise<ItemCategory[]> {
    const categories = await this.db.itemCategories.toArray()
    return categories
      .filter((category) => !category.deletedAt && (includeArchived || category.status === 'active'))
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'zh-CN'))
  }

  async saveItemCategory(input: SaveItemCategoryInput): Promise<ItemCategory> {
    return this.db.transaction(
      'rw',
      [this.db.itemCategories, this.db.items, this.db.deviceStates, this.db.syncMetadata],
      async () => {
        const name = input.name.trim()
        if (!name || [...name].length > 40) throw new Error('物品分类名称需为 1 至 40 个字符')
        const categories = await this.db.itemCategories.toArray()
        const duplicate = categories.some((category) =>
          !category.deletedAt && category.id !== input.id && category.name.localeCompare(name, 'zh-CN', { sensitivity: 'accent' }) === 0)
        if (duplicate) throw new Error('物品分类名称已存在')
        const existing = input.id ? await this.db.itemCategories.get(input.id) : undefined
        if (input.id && (!existing || existing.deletedAt)) throw new Error('物品分类不存在')
        const now = this.dependencies.now()
        const revision = await this.nextRevision(existing ? [existing.revision] : [])
        const saved: ItemCategory = {
          id: existing?.id ?? this.dependencies.uuid(),
          name,
          icon: input.icon.trim() || '◇',
          color: input.color,
          sortOrder: input.sortOrder ?? existing?.sortOrder ?? categories.filter((item) => !item.deletedAt).length,
          status: input.status ?? existing?.status ?? 'active',
          revision,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          ...(existing?.isSystemDefault === undefined ? {} : { isSystemDefault: existing.isSystemDefault }),
        }
        await this.db.itemCategories.put(saved)
        await this.markPending()
        return saved
      },
    )
  }

  async removeItemCategory(id: string): Promise<'delete' | 'archive'> {
    return this.db.transaction(
      'rw',
      [this.db.itemCategories, this.db.items, this.db.deviceStates, this.db.syncMetadata],
      async () => {
        const category = await this.db.itemCategories.get(id)
        if (!category || category.deletedAt) throw new Error('物品分类不存在')
        const revision = await this.nextRevision([category.revision])
        const now = this.dependencies.now()
        const referenced = (await this.db.items.where('categoryId').equals(id).count()) > 0
        if (referenced) {
          await this.db.itemCategories.put({ ...category, status: 'archived', updatedAt: now, revision })
          await this.markPending()
          return 'archive'
        }
        await this.db.itemCategories.put({
          ...category, updatedAt: now, revision, deletedAt: now, deleteRevision: revision,
        })
        await this.markPending()
        return 'delete'
      },
    )
  }

  async listItems(includeDeleted = false): Promise<OwnedItem[]> {
    return (await this.db.items.toArray())
      .filter((item) => includeDeleted || !item.deletedAt)
      .sort((left, right) => right.startedLocalDate.localeCompare(left.startedLocalDate) || left.name.localeCompare(right.name, 'zh-CN'))
  }

  async saveItem(input: SaveItemInput): Promise<OwnedItem> {
    return this.db.transaction(
      'rw',
      [
        this.db.items, this.db.itemCosts, this.db.itemCategories, this.db.transactions,
        this.db.deviceStates, this.db.syncMetadata,
      ],
      async () => {
        const existing = input.id ? await this.db.items.get(input.id) : undefined
        if (input.id && (!existing || existing.deletedAt)) throw new Error('物品不存在')
        const category = await this.db.itemCategories.get(input.categoryId)
        const keepsExistingCategory = Boolean(existing && existing.categoryId === input.categoryId)
        if (!category || category.deletedAt || (category.status !== 'active' && !keepsExistingCategory)) {
          throw new Error('请选择有效的物品分类')
        }
        await this.validateExpenseSource(
          input.sourceTransactionId,
          Boolean(existing && existing.sourceTransactionId === input.sourceTransactionId),
        )
        this.validateItemInput(input)
        if (existing) {
          const endDate = input.retiredLocalDate ?? this.currentLocalDate()
          const existingCosts = await this.db.itemCosts.where('itemId').equals(existing.id).toArray()
          const invalidCost = existingCosts
            .some((cost) => (
              cost.occurredLocalDate < input.purchaseLocalDate || cost.occurredLocalDate > endDate
            ))
          if (invalidCost) throw new Error('已有追加成本日期超出物品使用范围')
          this.ensureSafeItemTotal(input.purchaseAmountMinor, existingCosts)
        }
        const now = this.dependencies.now()
        const revision = await this.nextRevision(existing ? [existing.revision] : [])
        const saved: OwnedItem = {
          id: existing?.id ?? this.dependencies.uuid(),
          categoryId: input.categoryId,
          name: input.name.trim(),
          icon: input.icon.trim() || category.icon,
          note: input.note.trim(),
          purchaseAmountMinor: input.purchaseAmountMinor,
          purchaseLocalDate: input.purchaseLocalDate,
          startedLocalDate: input.startedLocalDate,
          ...(input.retiredLocalDate ? { retiredLocalDate: input.retiredLocalDate } : {}),
          sourceTransactionId: input.sourceTransactionId,
          revision,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        }
        await this.db.items.put(saved)
        await this.markPending()
        return saved
      },
    )
  }

  async listItemCosts(itemId?: string, includeDeleted = false): Promise<ItemCost[]> {
    const costs = itemId
      ? await this.db.itemCosts.where('itemId').equals(itemId).toArray()
      : await this.db.itemCosts.toArray()
    return costs
      .filter((cost) => includeDeleted || !cost.deletedAt)
      .sort((left, right) => right.occurredLocalDate.localeCompare(left.occurredLocalDate) || right.createdAt.localeCompare(left.createdAt))
  }

  async saveItemCost(input: SaveItemCostInput): Promise<ItemCost> {
    return this.db.transaction(
      'rw',
      [this.db.itemCosts, this.db.items, this.db.transactions, this.db.deviceStates, this.db.syncMetadata],
      async () => {
        const item = await this.db.items.get(input.itemId)
        if (!item || item.deletedAt) throw new Error('物品不存在')
        const existing = input.id ? await this.db.itemCosts.get(input.id) : undefined
        if (input.id && (!existing || existing.deletedAt)) throw new Error('追加成本不存在')
        if (input.type !== 'repair' && input.type !== 'accessory') throw new Error('追加成本类型无效')
        if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error('金额无效')
        if (!this.isValidLocalDate(input.occurredLocalDate)) throw new Error('追加成本日期无效')
        const endDate = item.retiredLocalDate ?? this.currentLocalDate()
        if (input.occurredLocalDate < item.purchaseLocalDate || input.occurredLocalDate > endDate) {
          throw new Error('追加成本日期无效')
        }
        if ([...input.note].length > 500) throw new Error('备注最多 500 个字符')
        await this.validateExpenseSource(
          input.sourceTransactionId,
          Boolean(existing && existing.sourceTransactionId === input.sourceTransactionId),
        )
        const otherCosts = (await this.db.itemCosts.where('itemId').equals(item.id).toArray())
          .filter((cost) => !cost.deletedAt && cost.id !== existing?.id)
        this.ensureSafeItemTotal(item.purchaseAmountMinor, [...otherCosts, { amountMinor: input.amountMinor }])
        const now = this.dependencies.now()
        const revision = await this.nextRevision(existing ? [existing.revision] : [])
        const saved: ItemCost = {
          id: existing?.id ?? this.dependencies.uuid(),
          itemId: item.id,
          type: input.type,
          amountMinor: input.amountMinor,
          occurredLocalDate: input.occurredLocalDate,
          note: input.note.trim(),
          sourceTransactionId: input.sourceTransactionId,
          revision,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        }
        await this.db.itemCosts.put(saved)
        await this.markPending()
        return saved
      },
    )
  }

  async retireItem(id: string, retiredLocalDate: string): Promise<OwnedItem> {
    const item = await this.requireItem(id)
    return this.saveItem({ ...item, retiredLocalDate })
  }

  async restoreItemUse(id: string): Promise<OwnedItem> {
    const item = await this.requireItem(id)
    const { retiredLocalDate: _retiredLocalDate, ...active } = item
    return this.saveItem(active)
  }

  async softDeleteItem(id: string): Promise<OwnedItem> {
    return this.db.transaction('rw', [this.db.items, this.db.deviceStates, this.db.syncMetadata], async () => {
      const item = await this.requireItem(id)
      const now = this.dependencies.now()
      const revision = await this.nextRevision([item.revision])
      const deleted = { ...item, updatedAt: now, revision, deletedAt: now, deleteRevision: revision }
      await this.db.items.put(deleted)
      await this.markPending()
      return deleted
    })
  }

  async restoreItem(id: string): Promise<OwnedItem> {
    return this.db.transaction('rw', [this.db.items, this.db.deviceStates, this.db.syncMetadata], async () => {
      const item = await this.requireItem(id, true)
      const { deletedAt: _deletedAt, deleteRevision: _deleteRevision, ...rest } = item
      const restored = { ...rest, updatedAt: this.dependencies.now(), revision: await this.nextRevision([item.revision]) }
      await this.db.items.put(restored)
      await this.markPending()
      return restored
    })
  }

  async softDeleteItemCost(id: string): Promise<ItemCost> {
    return this.db.transaction('rw', [this.db.itemCosts, this.db.deviceStates, this.db.syncMetadata], async () => {
      const cost = await this.requireItemCost(id)
      const now = this.dependencies.now()
      const revision = await this.nextRevision([cost.revision])
      const deleted = { ...cost, updatedAt: now, revision, deletedAt: now, deleteRevision: revision }
      await this.db.itemCosts.put(deleted)
      await this.markPending()
      return deleted
    })
  }

  async restoreItemCost(id: string): Promise<ItemCost> {
    return this.db.transaction('rw', [
      this.db.itemCosts, this.db.items, this.db.transactions, this.db.deviceStates, this.db.syncMetadata,
    ], async () => {
      const cost = await this.requireItemCost(id, true)
      const item = await this.db.items.get(cost.itemId)
      if (!item || item.deletedAt) throw new Error('物品不存在')
      const endDate = item.retiredLocalDate ?? this.currentLocalDate()
      if (cost.occurredLocalDate < item.purchaseLocalDate || cost.occurredLocalDate > endDate) {
        throw new Error('追加成本日期无效')
      }
      await this.validateExpenseSource(cost.sourceTransactionId, true)
      const otherCosts = (await this.db.itemCosts.where('itemId').equals(item.id).toArray())
        .filter((candidate) => !candidate.deletedAt && candidate.id !== cost.id)
      this.ensureSafeItemTotal(item.purchaseAmountMinor, [...otherCosts, { amountMinor: cost.amountMinor }])
      const { deletedAt: _deletedAt, deleteRevision: _deleteRevision, ...rest } = cost
      const restored = { ...rest, updatedAt: this.dependencies.now(), revision: await this.nextRevision([cost.revision]) }
      await this.db.itemCosts.put(restored)
      await this.markPending()
      return restored
    })
  }

  async addTransaction(input: AddTransactionInput): Promise<Transaction> {
    return this.db.transaction(
      'rw',
      [this.db.transactions, this.db.categories, this.db.deviceStates, this.db.syncMetadata],
      async () => {
        this.validateTransactionInput(input)
        const categories = await this.db.categories.toArray()
        validateCategorySelection(categories, input.type, input.categoryId, input.subcategoryId)
        const now = this.dependencies.now()
        const revision = await this.nextRevision()
        const transaction: Transaction = {
          id: this.dependencies.uuid(),
          ...input,
          note: input.note.trim(),
          currency: 'CNY',
          timeZone: this.dependencies.timeZone(),
          createdAt: now,
          updatedAt: now,
          revision,
        }
        await this.db.transactions.add(transaction)
        await this.markPending()
        return transaction
      },
    )
  }

  async listTransactions(filters: TransactionFilters = {}): Promise<Transaction[]> {
    const normalizedQuery = filters.query?.trim().toLocaleLowerCase('zh-CN')
    const rows = await this.db.transactions.toArray()
    return rows
      .filter((transaction) => filters.includeDeleted || !transaction.deletedAt)
      .filter((transaction) => !filters.month || transaction.occurredLocalDate.startsWith(filters.month))
      .filter((transaction) => !filters.type || filters.type === 'all' || transaction.type === filters.type)
      .filter((transaction) => !filters.categoryId || transaction.categoryId === filters.categoryId)
      .filter((transaction) => !filters.subcategoryId || transaction.subcategoryId === filters.subcategoryId)
      .filter((transaction) => !normalizedQuery || transaction.note.toLocaleLowerCase('zh-CN').includes(normalizedQuery))
      .sort((left, right) =>
        `${right.occurredLocalDate}T${right.occurredLocalTime}`.localeCompare(
          `${left.occurredLocalDate}T${left.occurredLocalTime}`,
        ),
      )
  }

  async updateTransaction(id: string, changes: Partial<AddTransactionInput>): Promise<Transaction> {
    return this.db.transaction(
      'rw',
      [
        this.db.transactions, this.db.categories, this.db.items, this.db.itemCosts,
        this.db.deviceStates, this.db.syncMetadata,
      ],
      async () => {
        const existing = await this.requireTransaction(id)
        if (existing.deletedAt) throw new Error('已删除的流水不能编辑')
        const mergedInput: AddTransactionInput = {
          type: changes.type ?? existing.type,
          amountMinor: changes.amountMinor ?? existing.amountMinor,
          categoryId: changes.categoryId ?? existing.categoryId,
          subcategoryId: changes.subcategoryId === undefined ? existing.subcategoryId : changes.subcategoryId,
          occurredLocalDate: changes.occurredLocalDate ?? existing.occurredLocalDate,
          occurredLocalTime: changes.occurredLocalTime ?? existing.occurredLocalTime,
          note: changes.note ?? existing.note,
        }
        this.validateTransactionInput(mergedInput)
        validateCategorySelection(
          await this.db.categories.toArray(),
          mergedInput.type,
          mergedInput.categoryId,
          mergedInput.subcategoryId,
        )
        if (mergedInput.type !== 'expense') {
          const [linkedItem, linkedCost] = await Promise.all([
            this.db.items.filter((item) => item.sourceTransactionId === id).first(),
            this.db.itemCosts.filter((cost) => cost.sourceTransactionId === id).first(),
          ])
          if (linkedItem || linkedCost) throw new Error('已关联物品成本的流水必须保持为支出')
        }
        const updated: Transaction = {
          ...existing,
          ...mergedInput,
          note: mergedInput.note.trim(),
          updatedAt: this.dependencies.now(),
          revision: await this.nextRevision([existing.revision]),
        }
        await this.db.transactions.put(updated)
        await this.markPending()
        return updated
      },
    )
  }

  async saveCategory(input: SaveCategoryInput): Promise<Category> {
    return this.db.transaction(
      'rw',
      [this.db.categories, this.db.deviceStates, this.db.syncMetadata],
      async () => {
        const name = input.name.trim()
        if (name.length === 0 || [...name].length > 20) throw new Error('分类名称需要 1–20 个字符')
        const categories = await this.db.categories.toArray()
        const existing = input.id ? categories.find((category) => category.id === input.id && !category.deletedAt) : undefined
        if (input.id && !existing) throw new Error('分类不存在')
        if (input.parentId) {
          const parent = categories.find((category) => category.id === input.parentId && !category.deletedAt)
          if (!parent || parent.parentId !== null || parent.type !== input.type || parent.status !== 'active') {
            throw new Error('二级分类必须属于同类型的有效大类')
          }
        }
        const duplicate = categories.some(
          (category) =>
            category.id !== input.id &&
            !category.deletedAt &&
            category.type === input.type &&
            category.parentId === input.parentId &&
            category.status === 'active' &&
            category.name === name,
        )
        if (duplicate) throw new Error('同一级下已存在同名分类')

        const siblings = categories.filter(
          (category) => category.type === input.type && category.parentId === input.parentId,
        )
        const now = this.dependencies.now()
        const saved: Category = {
          id: existing?.id ?? this.dependencies.uuid(),
          type: input.type,
          parentId: input.parentId,
          name,
          icon: input.icon || '●',
          color: /^#[\dA-Fa-f]{6}$/.test(input.color) ? input.color : '#6366F1',
          sortOrder: input.sortOrder ?? existing?.sortOrder ?? siblings.length,
          isPinned: input.parentId === null && input.isPinned,
          status: input.status ?? existing?.status ?? 'active',
          revision: await this.nextRevision(existing ? [existing.revision] : []),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          isSystemDefault: existing?.isSystemDefault ?? false,
        }
        await this.db.categories.put(saved)
        await this.markPending()
        return saved
      },
    )
  }

  async removeCategory(id: string): Promise<'delete' | 'archive'> {
    return this.db.transaction(
      'rw',
      [this.db.categories, this.db.transactions, this.db.deviceStates, this.db.syncMetadata],
      async () => {
        const category = await this.db.categories.get(id)
        if (!category) throw new Error('分类不存在')
        const transactions = await this.db.transactions.toArray()
        const children = (await this.db.categories.toArray()).filter((item) => item.parentId === id && !item.deletedAt)
        const childReferenced = children.some(
          (child) => categoryRemovalPolicy(child.id, transactions) === 'archive',
        )
        const policy = childReferenced ? 'archive' : categoryRemovalPolicy(id, transactions)
        if (policy === 'delete') {
          const now = this.dependencies.now()
          const tombstones: Category[] = []
          for (const item of [category, ...children]) {
            const revision = await this.nextRevision([item.revision])
            tombstones.push({ ...item, updatedAt: now, revision, deletedAt: now, deleteRevision: revision })
          }
          await this.db.categories.bulkPut(tombstones)
        } else {
          const now = this.dependencies.now()
          const revision = await this.nextRevision([category, ...children].map((item) => item.revision))
          await this.db.categories.bulkPut(
            [category, ...children].map((item) => ({ ...item, status: 'archived' as const, updatedAt: now, revision })),
          )
        }
        await this.markPending()
        return policy
      },
    )
  }

  async swapCategorySortOrders(firstId: string, secondId: string): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.db.categories, this.db.deviceStates, this.db.syncMetadata],
      async () => {
        const [first, second] = await Promise.all([
          this.db.categories.get(firstId),
          this.db.categories.get(secondId),
        ])
        if (!first || !second || first.deletedAt || second.deletedAt) throw new Error('分类不存在')
        if (first.type !== second.type || first.parentId !== second.parentId) throw new Error('只能调整同一级分类的顺序')
        const now = this.dependencies.now()
        const firstRevision = await this.nextRevision([first.revision])
        const secondRevision = await this.nextRevision([second.revision])
        await this.db.categories.bulkPut([
          { ...first, sortOrder: second.sortOrder, updatedAt: now, revision: firstRevision },
          { ...second, sortOrder: first.sortOrder, updatedAt: now, revision: secondRevision },
        ])
        await this.markPending()
      },
    )
  }

  async createSnapshot(): Promise<LedgerSnapshot> {
    return this.db.transaction(
      'r',
      [
        this.db.transactions, this.db.categories, this.db.itemCategories, this.db.items, this.db.itemCosts,
        this.db.settings, this.db.deviceStates, this.db.conflicts,
      ],
      () => this.readSnapshot(),
    )
  }

  async getMigrationRecoverySnapshot(): Promise<LedgerSnapshot | null> {
    if (this.migrationRecoverySnapshot) return structuredClone(this.migrationRecoverySnapshot)
    const backup = await readDurableMigrationBackup(this.db.name)
    return backup ? structuredClone(backup.snapshot) : null
  }

  async getBookSettings(): Promise<BookSettings> {
    return (await this.db.settings.get('book')) ?? this.defaultBookSettings()
  }

  async updateMonthComparisonMode(mode: BookSettings['monthComparisonMode']): Promise<BookSettings> {
    return this.db.transaction(
      'rw',
      [this.db.settings, this.db.deviceStates, this.db.syncMetadata],
      async () => {
        if (mode !== 'to-date' && mode !== 'full-month') throw new Error('月度比较口径无效')
        const current = (await this.db.settings.get('book')) ?? this.defaultBookSettings()
        if (current.monthComparisonMode === mode) return current
        const updated: BookSettings = {
          ...current,
          monthComparisonMode: mode,
          updatedAt: this.dependencies.now(),
          revision: await this.nextRevision([current.revision]),
        }
        await this.db.settings.put(updated)
        await this.markPending()
        return updated
      },
    )
  }

  async createSyncCheckpoint(): Promise<{ snapshot: LedgerSnapshot; generation: number }> {
    return this.db.transaction(
      'r',
      [
        this.db.transactions,
        this.db.categories,
        this.db.itemCategories,
        this.db.items,
        this.db.itemCosts,
        this.db.settings,
        this.db.deviceStates,
        this.db.conflicts,
        this.db.syncMetadata,
      ],
      async () => {
        const [snapshot, metadata] = await Promise.all([
          this.readSnapshot(),
          this.db.syncMetadata.get('sync'),
        ])
        return { snapshot, generation: metadata?.changeGeneration ?? 0 }
      },
    )
  }

  private async readSnapshot(): Promise<LedgerSnapshot> {
    const [transactions, categories, itemCategories, items, itemCosts, settings, devices, conflicts] = await Promise.all([
      this.db.transactions.toArray(),
      this.db.categories.toArray(),
      this.db.itemCategories.toArray(),
      this.db.items.toArray(),
      this.db.itemCosts.toArray(),
      this.db.settings.get('book'),
      this.db.deviceStates.toArray(),
      this.db.conflicts.toArray(),
    ])
    return {
      schemaVersion: 2,
      exportedAt: this.dependencies.now(),
      transactions,
      categories,
      settings: settings ?? this.defaultBookSettings(),
      devices,
      conflicts,
      itemCategories,
      items,
      itemCosts,
    }
  }

  async applySyncedSnapshot(
    snapshot: LedgerSnapshot,
    conflicts: ConflictRecord[],
    checkpoint?: LedgerSnapshot,
  ): Promise<{ unresolvedConflicts: number }> {
    return this.db.transaction(
      'rw',
      [
        this.db.transactions,
        this.db.categories,
        this.db.itemCategories,
        this.db.items,
        this.db.itemCosts,
        this.db.settings,
        this.db.deviceStates,
        this.db.conflicts,
      ],
      async () => {
        const current = await this.readSnapshot()
        let merged = mergeSnapshots(current, { ...snapshot, conflicts }, this.dependencies.now())
        if (
          checkpoint &&
          compareRevision(this.snapshotEpoch(checkpoint), this.snapshotEpoch(snapshot)) !== 'equal' &&
          compareRevision(this.snapshotEpoch(current), this.snapshotEpoch(checkpoint)) === 'equal'
        ) {
          merged = await this.rebasePostCheckpointChanges(checkpoint, current, merged)
        }
        assertItemSnapshotIntegrity(merged, '物品数据并发变更无法安全合并')
        const deviceMap = new Map<string, DeviceState>()
        const rememberDevice = (device: DeviceState): void => {
          const existing = deviceMap.get(device.id)
          if (!existing || device.logicalCounter > existing.logicalCounter) deviceMap.set(device.id, device)
        }
        merged.devices.forEach(rememberDevice)
        ;(await this.db.deviceStates.toArray()).forEach(rememberDevice)
        const rememberRevision = (revision: Revision | undefined): void => {
          if (!revision) return
          for (const [deviceId, logicalCounter] of Object.entries(revisionClock(revision))) {
            if (deviceId.startsWith('system-')) continue
            const existing = deviceMap.get(deviceId)
            if (!existing || logicalCounter > existing.logicalCounter) {
              deviceMap.set(deviceId, { ...(existing ?? { id: deviceId }), logicalCounter })
            }
          }
        }
        merged.transactions.forEach((item) => {
          rememberRevision(item.revision)
          rememberRevision(item.deleteRevision)
        })
        merged.categories.forEach((item) => {
          rememberRevision(item.revision)
          rememberRevision(item.deleteRevision)
        })
        ;(merged.itemCategories ?? []).forEach((item) => {
          rememberRevision(item.revision)
          rememberRevision(item.deleteRevision)
        })
        ;(merged.items ?? []).forEach((item) => {
          rememberRevision(item.revision)
          rememberRevision(item.deleteRevision)
        })
        ;(merged.itemCosts ?? []).forEach((item) => {
          rememberRevision(item.revision)
          rememberRevision(item.deleteRevision)
        })
        rememberRevision(merged.settings.revision)
        ;(merged.conflicts ?? []).forEach((conflict) => {
          rememberRevision(conflict.localValue.revision)
          rememberRevision(conflict.remoteValue.revision)
        })
        if (!deviceMap.has(this.deviceId)) deviceMap.set(this.deviceId, { id: this.deviceId, logicalCounter: 0 })
        const devices = [...deviceMap.values()]
        await Promise.all([
          this.db.transactions.clear(),
          this.db.categories.clear(),
          this.db.itemCategories.clear(),
          this.db.items.clear(),
          this.db.itemCosts.clear(),
          this.db.settings.clear(),
          this.db.deviceStates.clear(),
          this.db.conflicts.clear(),
        ])
        await this.db.transactions.bulkPut(merged.transactions)
        await this.db.categories.bulkPut(merged.categories)
        await this.db.itemCategories.bulkPut(merged.itemCategories ?? createDefaultItemCategories())
        await this.db.items.bulkPut(merged.items ?? [])
        await this.db.itemCosts.bulkPut(merged.itemCosts ?? [])
        await this.db.settings.put(merged.settings)
        await this.db.deviceStates.bulkPut(devices)
        if ((merged.conflicts?.length ?? 0) > 0) await this.db.conflicts.bulkPut(merged.conflicts!)
        return { unresolvedConflicts: (merged.conflicts ?? []).filter((conflict) => !conflict.resolvedAt).length }
      },
    )
  }

  async listConflicts(): Promise<ConflictRecord[]> {
    return (await this.db.conflicts.toArray())
      .filter((conflict) => !conflict.resolvedAt)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  async resolveConflict(conflictId: string, choice: 'local' | 'remote'): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.conflicts,
        this.db.transactions,
        this.db.categories,
        this.db.deviceStates,
        this.db.syncMetadata,
      ],
      async () => {
        const conflict = await this.db.conflicts.get(conflictId)
        if (!conflict || conflict.resolvedAt) throw new Error('同步冲突不存在或已处理')

        const selected = choice === 'local' ? conflict.localValue : conflict.remoteValue
        const now = this.dependencies.now()
        const revision = await this.nextRevision([conflict.localValue.revision, conflict.remoteValue.revision])

        if (conflict.entityType === 'transaction') {
          const transaction = selected as Transaction
          const { deletedAt, deleteRevision: _deleteRevision, ...rest } = transaction
          const resolved: Transaction = deletedAt
            ? { ...rest, id: conflict.entityId, updatedAt: now, revision, deletedAt, deleteRevision: revision }
            : { ...rest, id: conflict.entityId, updatedAt: now, revision }
          await this.db.transactions.put(resolved)
        } else {
          const category = selected as Category
          const { deletedAt, deleteRevision: _deleteRevision, ...rest } = category
          const resolved: Category = deletedAt
            ? { ...rest, id: conflict.entityId, updatedAt: now, revision, deletedAt, deleteRevision: revision }
            : { ...rest, id: conflict.entityId, updatedAt: now, revision }
          await this.db.categories.put(resolved)
        }

        await this.db.conflicts.put({ ...conflict, resolvedAt: now })
        await this.markPending()
      },
    )
  }

  async setSyncMetadata(metadata: SyncMetadata): Promise<void> {
    await this.db.transaction('rw', this.db.syncMetadata, async () => {
      const current = await this.db.syncMetadata.get('sync')
      await this.db.syncMetadata.put({
        ...current,
        ...metadata,
        changeGeneration: current?.changeGeneration ?? metadata.changeGeneration ?? 0,
        pending: Boolean(current?.pending || metadata.pending),
      })
    })
  }

  async completeSync(metadata: SyncMetadata, expectedGeneration: number): Promise<{ pending: boolean }> {
    return this.db.transaction('rw', this.db.syncMetadata, async () => {
      const current = (await this.db.syncMetadata.get('sync')) ?? {
        id: 'sync' as const,
        changeGeneration: 0,
        pending: false,
        status: 'local' as const,
      }
      const currentGeneration = current.changeGeneration ?? 0
      const changedDuringSync = currentGeneration !== expectedGeneration
      const message = changedDuringSync && metadata.status !== 'attention'
        ? '本机有新更改，继续同步'
        : metadata.message
      const completed: SyncMetadata = {
        ...current,
        ...metadata,
        changeGeneration: currentGeneration,
        pending: changedDuringSync ? true : metadata.pending,
        status: changedDuringSync && metadata.status !== 'attention' ? 'local' : metadata.status,
        ...(message === undefined ? {} : { message }),
      }
      await this.db.syncMetadata.put(completed)
      return { pending: completed.pending }
    })
  }

  async replaceWithBackup(snapshot: LedgerSnapshot): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.transactions,
        this.db.categories,
        this.db.itemCategories,
        this.db.items,
        this.db.itemCosts,
        this.db.settings,
        this.db.deviceStates,
        this.db.conflicts,
        this.db.syncMetadata,
      ],
      async () => {
        const current = await this.readSnapshot()
        const observed: Revision[] = []
        const rememberSnapshotRevisions = (value: LedgerSnapshot): void => {
          value.transactions.forEach((item) => {
            observed.push(item.revision)
            if (item.deleteRevision) observed.push(item.deleteRevision)
          })
          value.categories.forEach((item) => {
            observed.push(item.revision)
            if (item.deleteRevision) observed.push(item.deleteRevision)
          })
          ;(value.itemCategories ?? []).forEach((item) => {
            observed.push(item.revision)
            if (item.deleteRevision) observed.push(item.deleteRevision)
          })
          ;(value.items ?? []).forEach((item) => {
            observed.push(item.revision)
            if (item.deleteRevision) observed.push(item.deleteRevision)
          })
          ;(value.itemCosts ?? []).forEach((item) => {
            observed.push(item.revision)
            if (item.deleteRevision) observed.push(item.deleteRevision)
          })
          observed.push(value.settings.revision)
          if (value.settings.bookEpoch) observed.push(value.settings.bookEpoch)
        }
        rememberSnapshotRevisions(current)
        rememberSnapshotRevisions(snapshot)
        const epoch = await this.nextRevision(observed)
        const restored: LedgerSnapshot = {
          ...snapshot,
          schemaVersion: 2,
          exportedAt: this.dependencies.now(),
          itemCategories: snapshot.itemCategories ?? createDefaultItemCategories(),
          items: snapshot.items ?? [],
          itemCosts: snapshot.itemCosts ?? [],
          settings: {
            ...snapshot.settings,
            revision: epoch,
            bookEpoch: epoch,
            updatedAt: this.dependencies.now(),
          },
        }
        const deviceMap = new Map<string, DeviceState>()
        for (const device of [...current.devices, ...snapshot.devices, ...(await this.db.deviceStates.toArray())]) {
          const existing = deviceMap.get(device.id)
          if (!existing || device.logicalCounter > existing.logicalCounter) deviceMap.set(device.id, device)
        }
        for (const [id, counter] of Object.entries(revisionClock(epoch))) {
          if (id.startsWith('system-')) continue
          const existing = deviceMap.get(id)
          if (!existing || counter > existing.logicalCounter) {
            deviceMap.set(id, { ...(existing ?? { id }), logicalCounter: counter })
          }
        }
        await Promise.all([
          this.db.transactions.clear(),
          this.db.categories.clear(),
          this.db.itemCategories.clear(),
          this.db.items.clear(),
          this.db.itemCosts.clear(),
          this.db.settings.clear(),
          this.db.deviceStates.clear(),
          this.db.conflicts.clear(),
        ])
        await this.db.transactions.bulkPut(restored.transactions)
        await this.db.categories.bulkPut(restored.categories)
        await this.db.itemCategories.bulkPut(restored.itemCategories!)
        await this.db.items.bulkPut(restored.items!)
        await this.db.itemCosts.bulkPut(restored.itemCosts!)
        await this.db.settings.put(restored.settings)
        await this.db.deviceStates.bulkPut([...deviceMap.values()])
        if ((restored.conflicts?.length ?? 0) > 0) await this.db.conflicts.bulkPut(restored.conflicts!)
        await this.markPending()
      },
    )
  }

  async softDeleteTransaction(id: string): Promise<Transaction> {
    return this.db.transaction('rw', [this.db.transactions, this.db.deviceStates, this.db.syncMetadata], async () => {
      const transaction = await this.requireTransaction(id)
      const now = this.dependencies.now()
      const revision = await this.nextRevision([transaction.revision])
      const deleted: Transaction = {
        ...transaction,
        updatedAt: now,
        revision,
        deletedAt: now,
        deleteRevision: revision,
      }
      await this.db.transactions.put(deleted)
      await this.markPending()
      return deleted
    })
  }

  async restoreTransaction(id: string): Promise<Transaction> {
    return this.db.transaction('rw', [this.db.transactions, this.db.deviceStates, this.db.syncMetadata], async () => {
      const transaction = await this.requireTransaction(id)
      const now = this.dependencies.now()
      const revision = await this.nextRevision([transaction.revision])
      const { deletedAt: _deletedAt, deleteRevision: _deleteRevision, ...rest } = transaction
      const restored: Transaction = { ...rest, updatedAt: now, revision }
      await this.db.transactions.put(restored)
      await this.markPending()
      return restored
    })
  }

  async getSyncMetadata(): Promise<SyncMetadata> {
    return (await this.db.syncMetadata.get('sync')) ?? {
      id: 'sync', changeGeneration: 0, pending: false, status: 'local',
    }
  }

  private validateTransactionInput(input: AddTransactionInput): void {
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error('金额无效')
    const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.occurredLocalDate)?.slice(1).map(Number)
    if (!dateParts) throw new Error('日期无效')
    const [year, month, day] = dateParts
    const lastDay = month && month >= 1 && month <= 12 ? new Date(Date.UTC(year!, month, 0)).getUTCDate() : 0
    if (!year || year < 1 || year > 9999 || !month || !day || day > lastDay) throw new Error('日期无效')
    const timeParts = /^(\d{2}):(\d{2})$/.exec(input.occurredLocalTime)?.slice(1).map(Number)
    if (!timeParts || timeParts[0]! > 23 || timeParts[1]! > 59) throw new Error('时间无效')
    if ([...input.note].length > 500) throw new Error('备注最多 500 个字符')
  }

  private validateItemInput(input: SaveItemInput): void {
    const name = input.name.trim()
    if (!name || [...name].length > 100) throw new Error('物品名称需为 1 至 100 个字符')
    if (!Number.isSafeInteger(input.purchaseAmountMinor) || input.purchaseAmountMinor < 0) throw new Error('金额无效')
    if ([...input.note].length > 500) throw new Error('备注最多 500 个字符')
    const today = this.currentLocalDate()
    if (
      !this.isValidLocalDate(input.purchaseLocalDate) ||
      !this.isValidLocalDate(input.startedLocalDate) ||
      input.purchaseLocalDate > input.startedLocalDate ||
      input.startedLocalDate > today ||
      (input.retiredLocalDate && (
        !this.isValidLocalDate(input.retiredLocalDate) ||
        input.retiredLocalDate < input.startedLocalDate ||
        input.retiredLocalDate > today
      ))
    ) throw new Error('物品日期无效')
  }

  private ensureSafeItemTotal(purchaseAmountMinor: number, costs: Array<{ amountMinor: number; deletedAt?: string }>): void {
    let total = purchaseAmountMinor
    for (const cost of costs) {
      if (cost.deletedAt) continue
      total += cost.amountMinor
      if (!Number.isSafeInteger(total)) throw new Error('物品总成本过大')
    }
  }

  private isValidLocalDate(value: string): boolean {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)?.slice(1).map(Number)
    if (!parts) return false
    const [year, month, day] = parts
    const lastDay = month && month >= 1 && month <= 12 ? new Date(Date.UTC(year!, month, 0)).getUTCDate() : 0
    return Boolean(year && year >= 1 && year <= 9999 && month && day && day <= lastDay)
  }

  private currentLocalDate(): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.dependencies.timeZone(), year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(this.dependencies.now()))
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
    return `${value('year')}-${value('month')}-${value('day')}`
  }

  private async validateExpenseSource(id: string | null, allowUnavailable = false): Promise<void> {
    if (!id) return
    const source = await this.db.transactions.get(id)
    if (!source || source.deletedAt) {
      if (allowUnavailable) return
      throw new Error('来源流水不存在')
    }
    if (source.type !== 'expense') throw new Error('来源必须是支出流水')
  }

  private async requireItem(id: string, includeDeleted = false): Promise<OwnedItem> {
    const item = await this.db.items.get(id)
    if (!item || (!includeDeleted && item.deletedAt)) throw new Error('物品不存在')
    return item
  }

  private async requireItemCost(id: string, includeDeleted = false): Promise<ItemCost> {
    const cost = await this.db.itemCosts.get(id)
    if (!cost || (!includeDeleted && cost.deletedAt)) throw new Error('追加成本不存在')
    return cost
  }

  private async nextRevision(observed: Revision[] = []): Promise<Revision> {
    const states = await this.db.deviceStates.toArray()
    const state = states.find((item) => item.id === this.deviceId) ?? { id: this.deviceId, logicalCounter: 0 }
    const clock: Record<string, number> = Object.fromEntries(
      states.map((item) => [item.id, item.logicalCounter]),
    )
    for (const revision of observed) {
      for (const [deviceId, counter] of Object.entries(revisionClock(revision))) {
        clock[deviceId] = Math.max(clock[deviceId] ?? 0, counter)
      }
    }
    const nextCounter = Math.max(state.logicalCounter, clock[this.deviceId] ?? 0) + 1
    const next: DeviceState = { ...state, logicalCounter: nextCounter }
    await this.db.deviceStates.put(next)
    clock[this.deviceId] = nextCounter
    return { counter: nextCounter, deviceId: this.deviceId, clock }
  }

  private async markPending(): Promise<void> {
    const metadata = await this.getSyncMetadata()
    await this.db.syncMetadata.put({
      ...metadata,
      changeGeneration: (metadata.changeGeneration ?? 0) + 1,
      pending: true,
      status: 'local',
      message: '本机已保存',
    })
  }

  private async requireTransaction(id: string): Promise<Transaction> {
    const transaction = await this.db.transactions.get(id)
    if (!transaction) throw new Error('流水不存在')
    return transaction
  }

  private async verifyStorageAfterMigration(compareWithLegacyBackup: boolean): Promise<void> {
    const backup = compareWithLegacyBackup ? await readDurableMigrationBackup(this.db.name) : undefined
    await this.db.transaction('rw', [
      this.db.transactions,
      this.db.categories,
      this.db.settings,
      this.db.deviceStates,
      this.db.syncMetadata,
      this.db.conflicts,
    ], async () => {
      const [settings, metadata, transactions, categories, devices, conflicts] = await Promise.all([
        this.db.settings.get('book'),
        this.db.syncMetadata.get('sync'),
        this.db.transactions.toArray(),
        this.db.categories.toArray(),
        this.db.deviceStates.toArray(),
        this.db.conflicts.toArray(),
      ])
      if (!settings || !metadata) throw new Error('数据库迁移自检失败，旧版数据仍保留在迁移备份中')
      if (backup) {
        const sameIds = <T extends { id: string }>(actual: T[], expected: T[]): boolean =>
          actual.map((item) => item.id).sort().join('\n') === expected.map((item) => item.id).sort().join('\n')
        const containsIds = <T extends { id: string }>(actual: T[], expected: T[]): boolean => {
          const actualIds = new Set(actual.map((item) => item.id))
          return expected.every((item) => actualIds.has(item.id))
        }
        if (
          !sameIds(transactions, backup.snapshot.transactions) ||
          !sameIds(categories, backup.snapshot.categories) ||
          !containsIds(devices, backup.snapshot.devices) ||
          !sameIds(conflicts, backup.snapshot.conflicts ?? [])
        ) throw new Error('数据库迁移完整性自检失败，旧版数据仍保留在独立救援备份中')
      }
      await Promise.all([this.db.settings.put(settings), this.db.syncMetadata.put(metadata)])
      const verified = await this.db.settings.get('book')
      if (!verified || verified.id !== 'book') throw new Error('数据库迁移读写自检失败')
    })
  }

  private snapshotEpoch(snapshot: LedgerSnapshot): Revision {
    return snapshot.settings.bookEpoch ?? {
      counter: 1,
      deviceId: 'system-defaults-v1',
      clock: { 'system-defaults-v1': 1 },
    }
  }

  private async rebasePostCheckpointChanges(
    checkpoint: LedgerSnapshot,
    current: LedgerSnapshot,
    target: LedgerSnapshot,
  ): Promise<LedgerSnapshot> {
    const now = this.dependencies.now()
    const baseTransactions = new Map(checkpoint.transactions.map((item) => [item.id, item]))
    const baseCategories = new Map(checkpoint.categories.map((item) => [item.id, item]))
    const baseItemCategories = new Map((checkpoint.itemCategories ?? []).map((item) => [item.id, item]))
    const baseItems = new Map((checkpoint.items ?? []).map((item) => [item.id, item]))
    const baseItemCosts = new Map((checkpoint.itemCosts ?? []).map((item) => [item.id, item]))
    const changedTransactionIds = new Set(current.transactions.filter((item) => {
      const before = baseTransactions.get(item.id)
      return !before || compareRevision(item.revision, before.revision) !== 'equal'
    }).map((item) => item.id))
    const changedCategoryIds = new Set(
      current.categories
        .filter((item) => {
          const before = baseCategories.get(item.id)
          return !before || compareRevision(item.revision, before.revision) !== 'equal'
        })
        .map((item) => item.id),
    )
    const currentItemCategories = new Map((current.itemCategories ?? []).map((item) => [item.id, item]))
    const currentItems = new Map((current.items ?? []).map((item) => [item.id, item]))
    const changedItemCategoryIds = new Set(
      (current.itemCategories ?? []).filter((item) => {
        const before = baseItemCategories.get(item.id)
        return !before || compareRevision(item.revision, before.revision) !== 'equal'
      }).map((item) => item.id),
    )
    const changedItemIds = new Set(
      (current.items ?? []).filter((item) => {
        const before = baseItems.get(item.id)
        return !before || compareRevision(item.revision, before.revision) !== 'equal'
      }).map((item) => item.id),
    )
    const changedItemCostIds = new Set((current.itemCosts ?? []).filter((item) => {
      const before = baseItemCosts.get(item.id)
      return !before || compareRevision(item.revision, before.revision) !== 'equal'
    }).map((item) => item.id))

    if (
      checkpoint.transactions.some((item) => !current.transactions.some((candidate) => candidate.id === item.id)) ||
      checkpoint.categories.some((item) => !current.categories.some((candidate) => candidate.id === item.id)) ||
      (checkpoint.itemCategories ?? []).some((item) => !(current.itemCategories ?? []).some((candidate) => candidate.id === item.id)) ||
      (checkpoint.items ?? []).some((item) => !(current.items ?? []).some((candidate) => candidate.id === item.id)) ||
      (checkpoint.itemCosts ?? []).some((item) => !(current.itemCosts ?? []).some((candidate) => candidate.id === item.id))
    ) {
      throw new Error('同步期间检测到无法安全重放的本机替换，请先导出本机备份后重试')
    }

    const currentCategories = new Map(current.categories.map((item) => [item.id, item]))
    const targetCategories = new Map(target.categories.map((item) => [item.id, item]))
    const rememberRequiredCategory = (id: string | null): void => {
      let currentId = id
      while (currentId) {
        const category = currentCategories.get(currentId)
        if (!category) break
        const targetCategory = targetCategories.get(currentId)
        if (
          !targetCategory ||
          targetCategory.deletedAt ||
          targetCategory.status !== 'active' ||
          targetCategory.type !== category.type ||
          targetCategory.parentId !== category.parentId
        ) changedCategoryIds.add(currentId)
        currentId = category.parentId
      }
    }
    changedItemCostIds.forEach((id) => {
      const cost = (current.itemCosts ?? []).find((item) => item.id === id)
      if (cost) changedItemIds.add(cost.itemId)
    })
    changedItemIds.forEach((id) => {
      const item = currentItems.get(id)
      if (item) changedItemCategoryIds.add(item.categoryId)
    })
    ;(current.itemCosts ?? []).forEach((cost) => {
      if (changedItemIds.has(cost.itemId)) changedItemCostIds.add(cost.id)
    })
    const changedItemCosts = (current.itemCosts ?? []).filter((item) => changedItemCostIds.has(item.id))
    changedItemIds.forEach((id) => {
      const sourceId = currentItems.get(id)?.sourceTransactionId
      if (sourceId) changedTransactionIds.add(sourceId)
    })
    changedItemCosts.forEach((cost) => {
      if (cost.sourceTransactionId) changedTransactionIds.add(cost.sourceTransactionId)
    })
    const changedTransactions = current.transactions.filter((item) => changedTransactionIds.has(item.id))
    changedTransactions.forEach((item) => {
      rememberRequiredCategory(item.categoryId)
      rememberRequiredCategory(item.subcategoryId)
    })

    const observedTarget: Revision[] = [
      this.snapshotEpoch(target),
      ...target.devices.map((device) => ({
        counter: device.logicalCounter,
        deviceId: device.id,
        clock: { [device.id]: device.logicalCounter },
      })),
    ]
    const categories = new Map(target.categories.map((item) => [item.id, item]))
    for (const id of changedCategoryIds) {
      const item = currentCategories.get(id)
      if (!item) continue
      const targetValue = categories.get(id)
      const revision = await this.nextRevision([
        ...observedTarget,
        item.revision,
        ...(targetValue ? [targetValue.revision] : []),
      ])
      const { deleteRevision: _deleteRevision, ...rest } = item
      categories.set(id, item.deletedAt
        ? { ...rest, updatedAt: now, revision, deleteRevision: revision }
        : { ...rest, updatedAt: now, revision })
    }

    const transactions = new Map(target.transactions.map((item) => [item.id, item]))
    for (const item of changedTransactions) {
      const targetValue = transactions.get(item.id)
      const revision = await this.nextRevision([
        ...observedTarget,
        item.revision,
        ...(targetValue ? [targetValue.revision] : []),
      ])
      const { deleteRevision: _deleteRevision, ...rest } = item
      transactions.set(item.id, item.deletedAt
        ? { ...rest, updatedAt: now, revision, deleteRevision: revision }
        : { ...rest, updatedAt: now, revision })
    }

    const itemCategories = new Map((target.itemCategories ?? []).map((item) => [item.id, item]))
    for (const id of changedItemCategoryIds) {
      const item = currentItemCategories.get(id)
      if (!item) continue
      const targetValue = itemCategories.get(id)
      const revision = await this.nextRevision([
        ...observedTarget, item.revision, ...(targetValue ? [targetValue.revision] : []),
      ])
      const { deleteRevision: _deleteRevision, ...rest } = item
      itemCategories.set(id, item.deletedAt
        ? { ...rest, updatedAt: now, revision, deleteRevision: revision }
        : { ...rest, updatedAt: now, revision })
    }

    const items = new Map((target.items ?? []).map((item) => [item.id, item]))
    for (const id of changedItemIds) {
      const item = currentItems.get(id)
      if (!item) continue
      const targetValue = items.get(id)
      const revision = await this.nextRevision([
        ...observedTarget, item.revision, ...(targetValue ? [targetValue.revision] : []),
      ])
      const { deleteRevision: _deleteRevision, ...rest } = item
      items.set(id, item.deletedAt
        ? { ...rest, updatedAt: now, revision, deleteRevision: revision }
        : { ...rest, updatedAt: now, revision })
    }

    const itemCosts = new Map((target.itemCosts ?? []).map((item) => [item.id, item]))
    for (const item of changedItemCosts) {
      const targetValue = itemCosts.get(item.id)
      const revision = await this.nextRevision([
        ...observedTarget, item.revision, ...(targetValue ? [targetValue.revision] : []),
      ])
      const { deleteRevision: _deleteRevision, ...rest } = item
      itemCosts.set(item.id, item.deletedAt
        ? { ...rest, updatedAt: now, revision, deleteRevision: revision }
        : { ...rest, updatedAt: now, revision })
    }

    let settings = target.settings
    if (compareRevision(current.settings.revision, checkpoint.settings.revision) !== 'equal') {
      const revision = await this.nextRevision([
        ...observedTarget,
        current.settings.revision,
        target.settings.revision,
      ])
      settings = {
        ...current.settings,
        bookEpoch: this.snapshotEpoch(target),
        updatedAt: now,
        revision,
      }
    }

    const baseConflicts = new Map((checkpoint.conflicts ?? []).map((item) => [item.id, item]))
    const mergedConflicts = new Map((target.conflicts ?? []).map((item) => [item.id, item]))
    for (const conflict of current.conflicts ?? []) {
      const before = baseConflicts.get(conflict.id)
      if (!before || JSON.stringify(before) !== JSON.stringify(conflict)) mergedConflicts.set(conflict.id, conflict)
    }

    return {
      ...target,
      exportedAt: now,
      transactions: [...transactions.values()],
      categories: [...categories.values()],
      itemCategories: [...itemCategories.values()],
      items: [...items.values()],
      itemCosts: [...itemCosts.values()],
      settings,
      conflicts: [...mergedConflicts.values()],
    }
  }

  private defaultBookSettings(): BookSettings {
    const genesisDeviceId = 'system-defaults-v1'
    return {
      id: 'book',
      currency: 'CNY',
      monthComparisonMode: 'to-date',
      revision: { counter: 1, deviceId: genesisDeviceId, clock: { [genesisDeviceId]: 1 } },
      bookEpoch: { counter: 1, deviceId: genesisDeviceId, clock: { [genesisDeviceId]: 1 } },
      updatedAt: '2026-08-14T00:00:00.000Z',
    }
  }
}

function getOrCreateDeviceId(): string {
  const storageKey = 'personal-bookkeeping-device-id'
  try {
    const existing = localStorage.getItem(storageKey)
    if (existing) return existing
    const id = randomId()
    localStorage.setItem(storageKey, id)
    return id
  } catch {
    return randomId()
  }
}
