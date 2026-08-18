import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BookkeepingDatabase,
  prepareDurableMigrationBackup,
  readDurableMigrationBackup,
} from '../../src/data/database'
import { createDefaultCategories } from '../../src/domain/categories'
import { mergeSnapshots } from '../../src/domain/snapshots'

const dbName = 'bookkeeping-migration-test'
const secondaryDbName = `${dbName}-secondary`

function createLegacyDefaultCategories() {
  return createDefaultCategories('ignored', 'ignored').map((item) =>
    item.parentId !== null && item.name === '晚餐' ? { ...item, name: '外卖' } : item,
  )
}

describe('database migrations', () => {
  afterEach(async () => {
    await Dexie.delete(dbName)
    await Dexie.delete(`${dbName}-migration-safety`)
    await Dexie.delete(secondaryDbName)
  })

  it('backs up schema v1 data and adds safe generation defaults in one upgrade transaction', async () => {
    const legacy = new Dexie(dbName)
    legacy.version(1).stores({
      transactions: 'id, occurredLocalDate, type, categoryId, subcategoryId, updatedAt, deletedAt',
      categories: 'id, type, parentId, status, sortOrder, [type+parentId+status]',
      settings: 'id', deviceStates: 'id', syncMetadata: 'id', conflicts: 'id, entityId, createdAt, resolvedAt',
    })
    await legacy.open()
    const genesis = { counter: 1, deviceId: 'system-defaults-v1', clock: { 'system-defaults-v1': 1 } }
    await legacy.table('settings').put({
      id: 'book', currency: 'CNY', monthComparisonMode: 'to-date', revision: genesis,
      updatedAt: '2026-08-14T00:00:00.000Z',
    })
    await legacy.table('syncMetadata').put({ id: 'sync', pending: true, status: 'local' })
    legacy.close()

    const upgraded = new BookkeepingDatabase(dbName)
    await upgraded.open()

    expect(upgraded.verno).toBe(2)
    expect((await upgraded.settings.get('book'))?.bookEpoch).toEqual(genesis)
    expect((await upgraded.syncMetadata.get('sync'))?.changeGeneration).toBe(0)
    const backup = await upgraded.migrationBackups.get('v1-to-v2')
    expect(backup?.snapshot.settings.id).toBe('book')
    expect(backup?.fromVersion).toBe(1)
    upgraded.close()
  })

  it('keeps a verified v1 snapshot in an independent database before the upgrade starts', async () => {
    const legacy = new Dexie(dbName)
    legacy.version(1).stores({
      transactions: 'id, occurredLocalDate, type, categoryId, subcategoryId, updatedAt, deletedAt',
      categories: 'id, type, parentId, status, sortOrder, [type+parentId+status]',
      settings: 'id', deviceStates: 'id', syncMetadata: 'id', conflicts: 'id, entityId, createdAt, resolvedAt',
    })
    await legacy.open()
    await legacy.table('settings').put({
      id: 'book', currency: 'CNY', monthComparisonMode: 'to-date',
      revision: { counter: 1, deviceId: 'legacy-a' }, updatedAt: '2026-01-01T00:00:00.000Z',
    })
    legacy.close()

    await prepareDurableMigrationBackup(dbName)
    await Dexie.delete(dbName)

    const backup = await readDurableMigrationBackup(dbName)
    expect(backup?.snapshot.settings.revision.deviceId).toBe('legacy-a')
    expect(backup?.fromVersion).toBe(1)
  })

  it('normalizes untouched defaults from two real legacy databases so their first merge has no conflicts', async () => {
    const createLegacy = async (name: string, deviceId: string) => {
      const legacy = new Dexie(name)
      legacy.version(1).stores({
        transactions: 'id, occurredLocalDate, type, categoryId, subcategoryId, updatedAt, deletedAt',
        categories: 'id, type, parentId, status, sortOrder, [type+parentId+status]',
        settings: 'id', deviceStates: 'id', syncMetadata: 'id', conflicts: 'id, entityId, createdAt, resolvedAt',
      })
      await legacy.open()
      const legacyCategories = createLegacyDefaultCategories().map((item) => ({
        ...item,
        revision: { counter: item.revision.counter, deviceId },
        createdAt: `2026-01-0${deviceId === 'legacy-a' ? '1' : '2'}T00:00:00.000Z`,
        updatedAt: `2026-01-0${deviceId === 'legacy-a' ? '1' : '2'}T00:00:00.000Z`,
      }))
      await legacy.table('categories').bulkPut(legacyCategories)
      await legacy.table('settings').put({
        id: 'book', currency: 'CNY', monthComparisonMode: 'to-date',
        revision: { counter: 1, deviceId }, updatedAt: '2026-01-01T00:00:00.000Z',
      })
      legacy.close()

      const upgraded = new BookkeepingDatabase(name)
      await upgraded.open()
      const settings = (await upgraded.settings.get('book'))!
      const snapshot = {
        schemaVersion: 1,
        exportedAt: '2026-08-14T00:00:00.000Z',
        transactions: await upgraded.transactions.toArray(),
        categories: await upgraded.categories.toArray(),
        settings,
        devices: await upgraded.deviceStates.toArray(),
        conflicts: await upgraded.conflicts.toArray(),
      }
      upgraded.close()
      return snapshot
    }

    const first = await createLegacy(dbName, 'legacy-a')
    const second = await createLegacy(secondaryDbName, 'legacy-b')
    const merged = mergeSnapshots(first, second, '2026-08-14T01:00:00.000Z')

    expect(merged.conflicts).toHaveLength(0)
    expect(merged.categories).toEqual(createLegacyDefaultCategories())
  })
})
