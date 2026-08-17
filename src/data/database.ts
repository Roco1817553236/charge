import Dexie, { type EntityTable } from 'dexie'
import type {
  BookSettings,
  Category,
  ConflictRecord,
  DeviceState,
  LedgerSnapshot,
  SyncMetadata,
  Transaction,
} from '../domain/models'
import { normalizeLegacyDefaultCategories } from '../domain/categories'

export interface MigrationBackup {
  id: string
  fromVersion: number
  toVersion: number
  createdAt: string
  snapshot: LedgerSnapshot
}

class MigrationSafetyDatabase extends Dexie {
  backups!: EntityTable<MigrationBackup, 'id'>

  constructor(sourceName: string) {
    super(`${sourceName}-migration-safety`)
    this.version(1).stores({ backups: 'id, createdAt' })
  }
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法读取旧版数据库'))
  })
}

async function readLegacyV1Snapshot(name: string): Promise<LedgerSnapshot | null> {
  if (!(await Dexie.exists(name))) return null
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name)
    request.onerror = () => reject(request.error ?? new Error('无法打开旧版数据库'))
    request.onblocked = () => reject(new Error('旧版数据库仍被其他页面占用，请关闭其他窗口后重试'))
    request.onsuccess = () => {
      const database = request.result
      const requiredStores = ['transactions', 'categories', 'settings', 'deviceStates', 'syncMetadata', 'conflicts']
      if (
        database.objectStoreNames.contains('migrationBackups') ||
        requiredStores.some((store) => !database.objectStoreNames.contains(store))
      ) {
        database.close()
        resolve(null)
        return
      }
      const transaction = database.transaction(requiredStores, 'readonly')
      Promise.all([
        idbRequest(transaction.objectStore('transactions').getAll()) as Promise<Transaction[]>,
        idbRequest(transaction.objectStore('categories').getAll()) as Promise<Category[]>,
        idbRequest(transaction.objectStore('settings').get('book')) as Promise<BookSettings | undefined>,
        idbRequest(transaction.objectStore('deviceStates').getAll()) as Promise<DeviceState[]>,
        idbRequest(transaction.objectStore('conflicts').getAll()) as Promise<ConflictRecord[]>,
      ]).then(([transactions, categories, settings, devices, conflicts]) => {
        const now = new Date().toISOString()
        const fallbackRevision = { counter: 1, deviceId: 'system-defaults-v1', clock: { 'system-defaults-v1': 1 } }
        resolve({
          schemaVersion: 1,
          exportedAt: now,
          transactions,
          categories,
          settings: settings ?? {
            id: 'book', currency: 'CNY', monthComparisonMode: 'to-date',
            revision: fallbackRevision, updatedAt: now,
          },
          devices,
          conflicts,
        })
      }).catch(reject).finally(() => database.close())
    }
  })
}

export async function prepareDurableMigrationBackup(name: string): Promise<boolean> {
  const snapshot = await readLegacyV1Snapshot(name)
  if (!snapshot) return false
  const safety = new MigrationSafetyDatabase(name)
  try {
    const backup: MigrationBackup = {
      id: 'v1-to-v2',
      fromVersion: 1,
      toVersion: 2,
      createdAt: new Date().toISOString(),
      snapshot,
    }
    await safety.backups.put(backup)
    const verified = await safety.backups.get(backup.id)
    if (!verified || JSON.stringify(verified.snapshot) !== JSON.stringify(snapshot)) {
      throw new Error('迁移前本地备份校验失败，已停止升级')
    }
  } finally {
    safety.close()
  }
  return true
}

export async function readDurableMigrationBackup(name: string): Promise<MigrationBackup | undefined> {
  if (!(await Dexie.exists(`${name}-migration-safety`))) return undefined
  const safety = new MigrationSafetyDatabase(name)
  try {
    return await safety.backups.get('v1-to-v2')
  } finally {
    safety.close()
  }
}

export class BookkeepingDatabase extends Dexie {
  transactions!: EntityTable<Transaction, 'id'>
  categories!: EntityTable<Category, 'id'>
  settings!: EntityTable<BookSettings, 'id'>
  deviceStates!: EntityTable<DeviceState, 'id'>
  syncMetadata!: EntityTable<SyncMetadata, 'id'>
  conflicts!: EntityTable<ConflictRecord, 'id'>
  migrationBackups!: EntityTable<MigrationBackup, 'id'>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      transactions: 'id, occurredLocalDate, type, categoryId, subcategoryId, updatedAt, deletedAt',
      categories: 'id, type, parentId, status, sortOrder, [type+parentId+status]',
      settings: 'id',
      deviceStates: 'id',
      syncMetadata: 'id',
      conflicts: 'id, entityId, createdAt, resolvedAt',
    })
    this.version(2).stores({
      transactions: 'id, occurredLocalDate, type, categoryId, subcategoryId, updatedAt, deletedAt',
      categories: 'id, type, parentId, status, sortOrder, [type+parentId+status]',
      settings: 'id',
      deviceStates: 'id',
      syncMetadata: 'id',
      conflicts: 'id, entityId, createdAt, resolvedAt',
      migrationBackups: 'id, createdAt',
    }).upgrade(async (transaction) => {
      const now = new Date().toISOString()
      const genesis = {
        counter: 1,
        deviceId: 'system-defaults-v1',
        clock: { 'system-defaults-v1': 1 },
      }
      const [transactions, legacyCategories, settings, devices, metadata, conflicts] = await Promise.all([
        transaction.table('transactions').toArray() as Promise<Transaction[]>,
        transaction.table('categories').toArray() as Promise<Category[]>,
        transaction.table('settings').get('book') as Promise<BookSettings | undefined>,
        transaction.table('deviceStates').toArray() as Promise<DeviceState[]>,
        transaction.table('syncMetadata').get('sync') as Promise<SyncMetadata | undefined>,
        transaction.table('conflicts').toArray() as Promise<ConflictRecord[]>,
      ])
      const categories = normalizeLegacyDefaultCategories(legacyCategories)
      const normalizedSettings: BookSettings = settings
        ? { ...settings, bookEpoch: settings.bookEpoch ?? genesis }
        : {
            id: 'book', currency: 'CNY', monthComparisonMode: 'to-date',
            revision: genesis, bookEpoch: genesis, updatedAt: now,
          }
      await transaction.table('migrationBackups').put({
        id: 'v1-to-v2',
        fromVersion: 1,
        toVersion: 2,
        createdAt: now,
        snapshot: {
          schemaVersion: 1,
          exportedAt: now,
          transactions,
          categories: legacyCategories,
          settings: settings ?? normalizedSettings,
          devices,
          conflicts,
        },
      } satisfies MigrationBackup)
      if (categories.some((item, index) => item !== legacyCategories[index])) {
        await transaction.table('categories').bulkPut(categories)
      }
      await transaction.table('settings').put(normalizedSettings)
      await transaction.table('syncMetadata').put({
        ...(metadata ?? { id: 'sync', pending: false, status: 'local' }),
        changeGeneration: metadata?.changeGeneration ?? 0,
      } satisfies SyncMetadata)
    })
  }
}
