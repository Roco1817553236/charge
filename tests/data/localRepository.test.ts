import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalRepository } from '../../src/data/localRepository'
import { compareRevision } from '../../src/domain/merge'
import { mergeSnapshots } from '../../src/domain/snapshots'

const dbName = 'bookkeeping-repository-test'

describe('LocalRepository', () => {
  let repository: LocalRepository
  let tick = 0

  beforeEach(async () => {
    await Dexie.delete(dbName)
    repository = new LocalRepository(dbName, 'device-a', {
      now: () => new Date(Date.UTC(2026, 7, 14, 4, 0, tick++)).toISOString(),
      uuid: () => `tx-${tick}`,
      timeZone: () => 'Asia/Shanghai',
    })
    await repository.initialize()
  })

  afterEach(async () => {
    repository.close()
    await Dexie.delete(dbName)
  })

  it('seeds default categories exactly once', async () => {
    const first = await repository.listCategories('expense')
    await repository.initialize()
    const second = await repository.listCategories('expense')

    expect(first.length).toBeGreaterThan(10)
    expect(second).toHaveLength(first.length)
  })

  it('seeds independent item categories exactly once', async () => {
    const first = await repository.listItemCategories()
    await repository.initialize()
    const second = await repository.listItemCategories()

    expect(first.map((item) => item.name)).toEqual(['数码', '家电', '家居', '工具', '服饰', '运动', '其他'])
    expect(second).toEqual(first)
  })

  it('creates an item from an expense without modifying the source transaction', async () => {
    const expenseCategory = (await repository.listCategories('expense')).find((item) => item.parentId === null)!
    const source = await repository.addTransaction({
      type: 'expense', amountMinor: 629_900, categoryId: expenseCategory.id, subcategoryId: null,
      occurredLocalDate: '2026-08-01', occurredLocalTime: '12:00', note: '手机',
    })
    const sourceBefore = { ...source }
    const itemCategory = (await repository.listItemCategories())[0]!

    const saved = await repository.saveItem({
      categoryId: itemCategory.id, name: 'iPhone 12', icon: '📱', note: '自用',
      purchaseAmountMinor: source.amountMinor, purchaseLocalDate: source.occurredLocalDate,
      startedLocalDate: source.occurredLocalDate, sourceTransactionId: source.id,
    })

    expect(saved.sourceTransactionId).toBe(source.id)
    expect((await repository.listItems())[0]?.name).toBe('iPhone 12')
    expect(await repository.db.transactions.get(source.id)).toEqual(sourceBefore)
  })

  it('rejects an income source and invalid item date order', async () => {
    const incomeCategory = (await repository.listCategories('income')).find((item) => item.parentId === null)!
    const income = await repository.addTransaction({
      type: 'income', amountMinor: 100_000, categoryId: incomeCategory.id, subcategoryId: null,
      occurredLocalDate: '2026-08-01', occurredLocalTime: '12:00', note: '奖金',
    })
    const itemCategory = (await repository.listItemCategories())[0]!
    const base = {
      categoryId: itemCategory.id, name: '物品', icon: '◇', note: '', purchaseAmountMinor: 100,
      purchaseLocalDate: '2026-08-01', startedLocalDate: '2026-08-01', sourceTransactionId: null,
    }

    await expect(repository.saveItem({ ...base, sourceTransactionId: income.id })).rejects.toThrow('来源必须是支出流水')
    await expect(repository.saveItem({ ...base, startedLocalDate: '2026-07-31' })).rejects.toThrow('物品日期无效')
  })

  it('adds item costs, freezes retirement, and supports soft-delete undo', async () => {
    const itemCategory = (await repository.listItemCategories())[0]!
    const saved = await repository.saveItem({
      categoryId: itemCategory.id, name: '电脑', icon: '💻', note: '', purchaseAmountMinor: 100_000,
      purchaseLocalDate: '2026-08-01', startedLocalDate: '2026-08-01', sourceTransactionId: null,
    })
    const addedCost = await repository.saveItemCost({
      itemId: saved.id, type: 'repair', amountMinor: 20_000, occurredLocalDate: '2026-08-10',
      note: '换风扇', sourceTransactionId: null,
    })
    expect((await repository.listItemCosts(saved.id))[0]?.amountMinor).toBe(20_000)

    const retired = await repository.retireItem(saved.id, '2026-08-14')
    expect(retired.retiredLocalDate).toBe('2026-08-14')
    expect((await repository.restoreItemUse(saved.id)).retiredLocalDate).toBeUndefined()

    await repository.softDeleteItemCost(addedCost.id)
    expect(await repository.listItemCosts(saved.id)).toHaveLength(0)
    await repository.restoreItemCost(addedCost.id)
    expect(await repository.listItemCosts(saved.id)).toHaveLength(1)

    await repository.softDeleteItem(saved.id)
    expect(await repository.listItems()).toHaveLength(0)
    await repository.restoreItem(saved.id)
    expect(await repository.listItems()).toHaveLength(1)
  })

  it('archives a referenced item category and tombstones an unused one', async () => {
    const used = await repository.saveItemCategory({ name: '办公', icon: '🖥️', color: '#6366F1' })
    await repository.saveItem({
      categoryId: used.id, name: '显示器', icon: '🖥️', note: '', purchaseAmountMinor: 100_000,
      purchaseLocalDate: '2026-08-01', startedLocalDate: '2026-08-01', sourceTransactionId: null,
    })
    const unused = await repository.saveItemCategory({ name: '临时', icon: '◇', color: '#64748B' })

    expect(await repository.removeItemCategory(used.id)).toBe('archive')
    expect(await repository.removeItemCategory(unused.id)).toBe('delete')
    expect((await repository.listItemCategories(true)).find((item) => item.id === used.id)?.status).toBe('archived')
    expect((await repository.createSnapshot()).itemCategories?.find((item) => item.id === unused.id)?.deletedAt).toBeTruthy()
  })

  it('allows editing an item while keeping its archived category and deleted source reference', async () => {
    const expenseCategory = (await repository.listCategories('expense')).find((item) => item.parentId === null)!
    const source = await repository.addTransaction({
      type: 'expense', amountMinor: 100_000, categoryId: expenseCategory.id, subcategoryId: null,
      occurredLocalDate: '2026-08-01', occurredLocalTime: '12:00', note: '显示器',
    })
    const itemCategory = await repository.saveItemCategory({ name: '办公', icon: '🖥️', color: '#6366F1' })
    const saved = await repository.saveItem({
      categoryId: itemCategory.id, name: '显示器', icon: '🖥️', note: '', purchaseAmountMinor: 100_000,
      purchaseLocalDate: '2026-08-01', startedLocalDate: '2026-08-01', sourceTransactionId: source.id,
    })
    await repository.removeItemCategory(itemCategory.id)
    await repository.softDeleteTransaction(source.id)

    const edited = await repository.saveItem({
      id: saved.id, categoryId: itemCategory.id, name: saved.name, icon: saved.icon, note: '保留旧引用',
      purchaseAmountMinor: saved.purchaseAmountMinor, purchaseLocalDate: saved.purchaseLocalDate,
      startedLocalDate: saved.startedLocalDate, sourceTransactionId: source.id,
    })

    expect(edited.note).toBe('保留旧引用')
    expect(edited.sourceTransactionId).toBe(source.id)
  })

  it('rejects item edits that would invalidate existing costs or change a linked source to income', async () => {
    const expenseCategory = (await repository.listCategories('expense')).find((item) => item.parentId === null)!
    const incomeCategory = (await repository.listCategories('income')).find((item) => item.parentId === null)!
    const source = await repository.addTransaction({
      type: 'expense', amountMinor: 100_000, categoryId: expenseCategory.id, subcategoryId: null,
      occurredLocalDate: '2026-08-01', occurredLocalTime: '12:00', note: '电脑',
    })
    const itemCategory = (await repository.listItemCategories())[0]!
    const saved = await repository.saveItem({
      categoryId: itemCategory.id, name: '电脑', icon: '💻', note: '', purchaseAmountMinor: 100_000,
      purchaseLocalDate: '2026-08-01', startedLocalDate: '2026-08-01', sourceTransactionId: source.id,
    })
    await repository.saveItemCost({
      itemId: saved.id, type: 'repair', amountMinor: 100, occurredLocalDate: '2026-08-05', note: '', sourceTransactionId: null,
    })

    await expect(repository.saveItem({
      id: saved.id, categoryId: saved.categoryId, name: saved.name, icon: saved.icon, note: '',
      purchaseAmountMinor: saved.purchaseAmountMinor, purchaseLocalDate: '2026-08-10',
      startedLocalDate: '2026-08-10', sourceTransactionId: source.id,
    })).rejects.toThrow('已有追加成本日期超出物品使用范围')
    await expect(repository.retireItem(saved.id, '2026-08-04')).rejects.toThrow('已有追加成本日期超出物品使用范围')
    await expect(repository.updateTransaction(source.id, {
      type: 'income', categoryId: incomeCategory.id, subcategoryId: null,
    })).rejects.toThrow('已关联物品成本的流水必须保持为支出')

    await repository.softDeleteItem(saved.id)
    await expect(repository.updateTransaction(source.id, {
      type: 'income', categoryId: incomeCategory.id, subcategoryId: null,
    })).rejects.toThrow('已关联物品成本的流水必须保持为支出')
  })

  it('keeps deleted costs restorable when item dates change and revalidates before restore', async () => {
    const itemCategory = (await repository.listItemCategories())[0]!
    const saved = await repository.saveItem({
      categoryId: itemCategory.id, name: '可撤销成本物品', icon: '◇', note: '', purchaseAmountMinor: 100,
      purchaseLocalDate: '2026-08-01', startedLocalDate: '2026-08-01', sourceTransactionId: null,
    })
    const added = await repository.saveItemCost({
      itemId: saved.id, type: 'repair', amountMinor: 100, occurredLocalDate: '2026-08-05',
      note: '', sourceTransactionId: null,
    })
    await repository.softDeleteItemCost(added.id)

    await expect(repository.saveItem({
      id: saved.id, categoryId: saved.categoryId, name: saved.name, icon: saved.icon, note: '',
      purchaseAmountMinor: saved.purchaseAmountMinor, purchaseLocalDate: '2026-08-10',
      startedLocalDate: '2026-08-10', sourceTransactionId: null,
    })).rejects.toThrow('已有追加成本日期超出物品使用范围')

    await repository.db.items.update(saved.id, { purchaseLocalDate: '2026-08-10', startedLocalDate: '2026-08-10' })
    await expect(repository.restoreItemCost(added.id)).rejects.toThrow('追加成本日期无效')
  })

  it('rejects an added cost that would exceed safe integer precision', async () => {
    const itemCategory = (await repository.listItemCategories())[0]!
    const saved = await repository.saveItem({
      categoryId: itemCategory.id, name: '极端金额物品', icon: '◇', note: '',
      purchaseAmountMinor: Number.MAX_SAFE_INTEGER - 10, purchaseLocalDate: '2026-08-01',
      startedLocalDate: '2026-08-01', sourceTransactionId: null,
    })

    await expect(repository.saveItemCost({
      itemId: saved.id, type: 'repair', amountMinor: 20, occurredLocalDate: '2026-08-02',
      note: '', sourceTransactionId: null,
    })).rejects.toThrow('物品总成本过大')
  })

  it('rebases an item created after a sync checkpoint onto a newer restored generation', async () => {
    const checkpoint = await repository.createSyncCheckpoint()
    const itemCategory = (await repository.listItemCategories())[0]!
    const lateItem = await repository.saveItem({
      categoryId: itemCategory.id, name: '同步途中新增物品', icon: '◇', note: '', purchaseAmountMinor: 100,
      purchaseLocalDate: '2026-08-01', startedLocalDate: '2026-08-01', sourceTransactionId: null,
    })
    const remoteRevision = { counter: 2, deviceId: 'device-b', clock: { 'system-defaults-v1': 1, 'device-b': 2 } }
    const restored = {
      ...checkpoint.snapshot,
      itemCategories: checkpoint.snapshot.itemCategories ?? [],
      items: [],
      itemCosts: [],
      settings: { ...checkpoint.snapshot.settings, revision: remoteRevision, bookEpoch: remoteRevision },
    }

    await repository.applySyncedSnapshot(restored, [], checkpoint.snapshot)

    const preserved = (await repository.listItems()).find((item) => item.id === lateItem.id)
    expect(preserved?.name).toBe('同步途中新增物品')
    expect(preserved?.revision.counter).toBeGreaterThan(lateItem.revision.counter)
  })

  it('rebases the source expense required by an item created after a checkpoint', async () => {
    const expenseCategory = (await repository.listCategories('expense')).find((item) => item.parentId === null)!
    const source = await repository.addTransaction({
      type: 'expense', amountMinor: 100, categoryId: expenseCategory.id, subcategoryId: null,
      occurredLocalDate: '2026-08-01', occurredLocalTime: '12:00', note: '物品来源',
    })
    const checkpoint = await repository.createSyncCheckpoint()
    const itemCategory = (await repository.listItemCategories())[0]!
    const lateItem = await repository.saveItem({
      categoryId: itemCategory.id, name: '带来源的物品', icon: '◇', note: '', purchaseAmountMinor: 100,
      purchaseLocalDate: '2026-08-01', startedLocalDate: '2026-08-01', sourceTransactionId: source.id,
    })
    const remoteRevision = { counter: 2, deviceId: 'device-b', clock: { 'system-defaults-v1': 1, 'device-b': 2 } }
    const restored = {
      ...checkpoint.snapshot, transactions: [], items: [], itemCosts: [],
      itemCategories: checkpoint.snapshot.itemCategories ?? [],
      settings: { ...checkpoint.snapshot.settings, revision: remoteRevision, bookEpoch: remoteRevision },
    }

    await repository.applySyncedSnapshot(restored, [], checkpoint.snapshot)

    expect((await repository.listTransactions({ includeDeleted: true })).some((item) => item.id === source.id)).toBe(true)
    expect((await repository.listItems()).some((item) => item.id === lateItem.id)).toBe(true)
  })

  it('writes a valid transaction and increments the device logical revision', async () => {
    const root = (await repository.listCategories('expense')).find((item) => item.parentId === null)!
    const child = (await repository.listCategories('expense')).find((item) => item.parentId === root.id)!

    const saved = await repository.addTransaction({
      type: 'expense',
      amountMinor: 2580,
      categoryId: root.id,
      subcategoryId: child.id,
      occurredLocalDate: '2026-08-14',
      occurredLocalTime: '12:30',
      note: '午饭',
    })

    expect(saved.currency).toBe('CNY')
    expect(saved.timeZone).toBe('Asia/Shanghai')
    expect(saved.revision.deviceId).toBe('device-a')
    expect((await repository.listTransactions())[0]?.note).toBe('午饭')
    expect((await repository.getSyncMetadata()).pending).toBe(true)
  })

  it('rejects calendar-impossible dates and out-of-range local times', async () => {
    const root = (await repository.listCategories('expense')).find((item) => item.parentId === null)!
    const input = {
      type: 'expense' as const, amountMinor: 100, categoryId: root.id, subcategoryId: null,
      occurredLocalDate: '2026-02-30', occurredLocalTime: '12:30', note: '',
    }
    await expect(repository.addTransaction(input)).rejects.toThrow('日期无效')
    await expect(repository.addTransaction({
      ...input, occurredLocalDate: '2026-02-28', occurredLocalTime: '25:61',
    })).rejects.toThrow('时间无效')
  })

  it('filters ledger rows and supports soft-delete undo', async () => {
    const root = (await repository.listCategories('expense')).find((item) => item.parentId === null)!
    const august = await repository.addTransaction({
      type: 'expense', amountMinor: 1000, categoryId: root.id, subcategoryId: null,
      occurredLocalDate: '2026-08-14', occurredLocalTime: '12:30', note: '午饭',
    })
    await repository.addTransaction({
      type: 'expense', amountMinor: 2000, categoryId: root.id, subcategoryId: null,
      occurredLocalDate: '2026-07-14', occurredLocalTime: '12:30', note: '上月',
    })

    expect(await repository.listTransactions({ month: '2026-08', query: '午饭' })).toHaveLength(1)
    await repository.softDeleteTransaction(august.id)
    expect(await repository.listTransactions({ month: '2026-08' })).toHaveLength(0)
    expect(await repository.listTransactions({ includeDeleted: true, month: '2026-08' })).toHaveLength(1)

    await repository.restoreTransaction(august.id)
    expect(await repository.listTransactions({ month: '2026-08' })).toHaveLength(1)
  })

  it('edits a transaction without changing its identity', async () => {
    const root = (await repository.listCategories('expense')).find((item) => item.parentId === null)!
    const saved = await repository.addTransaction({
      type: 'expense', amountMinor: 1000, categoryId: root.id, subcategoryId: null,
      occurredLocalDate: '2026-08-14', occurredLocalTime: '12:30', note: '原备注',
    })

    const updated = await repository.updateTransaction(saved.id, { amountMinor: 1888, note: '新备注' })
    expect(updated.id).toBe(saved.id)
    expect(updated.amountMinor).toBe(1888)
    expect(updated.note).toBe('新备注')
    expect(updated.revision.counter).toBeGreaterThan(saved.revision.counter)
  })

  it('creates and customizes both category levels, archiving a referenced category', async () => {
    const root = await repository.saveCategory({
      type: 'expense', parentId: null, name: '宠物', icon: '🐾', color: '#8B5CF6', isPinned: true,
    })
    const child = await repository.saveCategory({
      type: 'expense', parentId: root.id, name: '猫粮', icon: '🐈', color: '#A78BFA', isPinned: false,
    })
    await repository.addTransaction({
      type: 'expense', amountMinor: 3000, categoryId: root.id, subcategoryId: child.id,
      occurredLocalDate: '2026-08-14', occurredLocalTime: '12:30', note: '',
    })

    const renamed = await repository.saveCategory({ ...child, name: '宠物食品' })
    expect(renamed.name).toBe('宠物食品')
    expect(await repository.removeCategory(child.id)).toBe('archive')
    expect((await repository.listCategories('expense')).some((item) => item.id === child.id)).toBe(false)
    expect((await repository.listCategories('expense', true)).find((item) => item.id === child.id)?.status).toBe('archived')
  })

  it('swaps sibling category positions atomically', async () => {
    const roots = (await repository.listCategories('expense')).filter((item) => item.parentId === null)
    const first = roots[0]!
    const second = roots[1]!

    await repository.swapCategorySortOrders(first.id, second.id)

    const updated = await repository.listCategories('expense')
    expect(updated.find((item) => item.id === first.id)?.sortOrder).toBe(second.sortOrder)
    expect(updated.find((item) => item.id === second.id)?.sortOrder).toBe(first.sortOrder)
  })

  it('keeps an unused category deletion as a syncable tombstone', async () => {
    const category = await repository.saveCategory({
      type: 'expense', parentId: null, name: '临时分类', icon: '◌', color: '#64748B', isPinned: false,
    })
    const beforeDelete = await repository.createSnapshot()

    expect(await repository.removeCategory(category.id)).toBe('delete')

    expect((await repository.listCategories(undefined, true)).some((item) => item.id === category.id)).toBe(false)
    const tombstone = (await repository.createSnapshot()).categories.find((item) => item.id === category.id)
    expect(tombstone?.deletedAt).toBeTruthy()
    expect(tombstone?.deleteRevision).toEqual(tombstone?.revision)
    const merged = mergeSnapshots(await repository.createSnapshot(), beforeDelete, '2026-08-14T06:00:00.000Z')
    expect(merged.categories.find((item) => item.id === category.id)?.deletedAt).toBeTruthy()
  })

  it('creates a complete portable snapshot', async () => {
    const snapshot = await repository.createSnapshot()
    expect(snapshot.schemaVersion).toBe(2)
    expect(snapshot.categories.length).toBeGreaterThan(0)
    expect(snapshot.itemCategories?.length).toBeGreaterThan(0)
    expect(snapshot.items).toEqual([])
    expect(snapshot.itemCosts).toEqual([])
    expect(snapshot.settings.id).toBe('book')
    expect(snapshot.devices).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'device-a' })]))
  })

  it('atomically applies a merged sync snapshot and metadata', async () => {
    const synced = await repository.createSnapshot()
    synced.transactions = []
    synced.settings = {
      ...synced.settings,
      monthComparisonMode: 'full-month',
      revision: { counter: 1, deviceId: 'settings-device', clock: { 'system-defaults-v1': 1, 'settings-device': 1 } },
    }
    const conflict = {
      id: 'conflict-1', entityType: 'transaction' as const, entityId: 'tx-1',
      localValue: {
        id: 'local', type: 'expense' as const, amountMinor: 1, currency: 'CNY' as const, categoryId: synced.categories[0]!.id,
        subcategoryId: null, occurredLocalDate: '2026-08-14', occurredLocalTime: '12:00', timeZone: 'Asia/Shanghai', note: '',
        createdAt: synced.exportedAt, updatedAt: synced.exportedAt, revision: { counter: 1, deviceId: 'a' },
      },
      remoteValue: {
        id: 'remote', type: 'expense' as const, amountMinor: 2, currency: 'CNY' as const, categoryId: synced.categories[0]!.id,
        subcategoryId: null, occurredLocalDate: '2026-08-14', occurredLocalTime: '12:00', timeZone: 'Asia/Shanghai', note: '',
        createdAt: synced.exportedAt, updatedAt: synced.exportedAt, revision: { counter: 1, deviceId: 'b' },
      },
      createdAt: synced.exportedAt,
    }

    await repository.applySyncedSnapshot(synced, [conflict])
    await repository.setSyncMetadata({ id: 'sync', pending: false, status: 'synced', remoteEtag: 'etag-1' })

    expect((await repository.createSnapshot()).settings.monthComparisonMode).toBe('full-month')
    expect(await repository.listConflicts()).toEqual([conflict])
    expect((await repository.getSyncMetadata()).remoteEtag).toBe('etag-1')
  })

  it('resolves a concurrent transaction conflict with a newly ordered local revision', async () => {
    const root = (await repository.listCategories('expense')).find((item) => item.parentId === null)!
    const saved = await repository.addTransaction({
      type: 'expense', amountMinor: 1000, categoryId: root.id, subcategoryId: null,
      occurredLocalDate: '2026-08-14', occurredLocalTime: '12:30', note: '本机版本',
    })
    const remote = { ...saved, note: '远端版本', revision: { counter: saved.revision.counter, deviceId: 'device-b' } }
    await repository.db.conflicts.put({
      id: 'conflict-tx', entityType: 'transaction', entityId: saved.id,
      localValue: saved, remoteValue: remote, createdAt: '2026-08-14T05:00:00.000Z',
    })

    await repository.resolveConflict('conflict-tx', 'remote')

    const resolved = (await repository.listTransactions()).find((item) => item.id === saved.id)!
    expect(resolved.note).toBe('远端版本')
    expect(resolved.revision.deviceId).toBe('device-a')
    expect(resolved.revision.counter).toBeGreaterThan(saved.revision.counter)
    expect(await repository.listConflicts()).toHaveLength(0)
  })

  it('creates a causally newer edit after observing a high-counter remote device', async () => {
    const snapshot = await repository.createSnapshot()
    const root = snapshot.categories.find((item) => item.type === 'expense' && item.parentId === null)!
    const remoteTransaction = {
      id: 'remote-tx', type: 'expense' as const, amountMinor: 1000, currency: 'CNY' as const,
      categoryId: root.id, subcategoryId: null, occurredLocalDate: '2026-08-14', occurredLocalTime: '12:00',
      timeZone: 'Asia/Shanghai', note: '远端原值', createdAt: snapshot.exportedAt, updatedAt: snapshot.exportedAt,
      revision: { counter: 100, deviceId: 'device-b', clock: { 'device-b': 100 } },
    }
    snapshot.transactions = [remoteTransaction]
    snapshot.devices = [{ id: 'device-b', logicalCounter: 100 }]
    await repository.applySyncedSnapshot(snapshot, [])

    const edited = await repository.updateTransaction(remoteTransaction.id, { note: '本机后续编辑' })

    expect(edited.revision.clock?.['device-b']).toBe(100)
    expect(compareRevision(edited.revision, remoteTransaction.revision)).toBe('newer')
  })

  it('never reuses the current device counter after restoring an older snapshot', async () => {
    const root = (await repository.listCategories('expense')).find((item) => item.parentId === null)!
    const add = (note: string) => repository.addTransaction({
      type: 'expense' as const, amountMinor: 1000, categoryId: root.id, subcategoryId: null,
      occurredLocalDate: '2026-08-14', occurredLocalTime: '12:30', note,
    })
    await add('第一笔')
    const latest = await add('第二笔')
    const oldSnapshot = await repository.createSnapshot()
    oldSnapshot.devices = oldSnapshot.devices.map((device) =>
      device.id === 'device-a' ? { ...device, logicalCounter: 0 } : device,
    )

    await repository.applySyncedSnapshot(oldSnapshot, [])
    const afterRestore = await add('恢复后新增')

    expect(afterRestore.revision.counter).toBeGreaterThan(latest.revision.counter)
  })

  it('preserves writes made after a sync checkpoint and keeps them pending', async () => {
    const checkpoint = await repository.createSyncCheckpoint()
    const root = (await repository.listCategories('expense')).find((item) => item.parentId === null)!
    const lateWrite = await repository.addTransaction({
      type: 'expense', amountMinor: 1880, categoryId: root.id, subcategoryId: null,
      occurredLocalDate: '2026-08-14', occurredLocalTime: '12:30', note: '同步途中新增',
    })

    const applied = await repository.applySyncedSnapshot(checkpoint.snapshot, checkpoint.snapshot.conflicts ?? [])
    const completion = await repository.completeSync({
      id: 'sync', remoteEtag: 'etag-new', pending: false, status: 'synced', message: '已同步',
    }, checkpoint.generation)

    expect((await repository.listTransactions()).some((item) => item.id === lateWrite.id)).toBe(true)
    expect(applied.unresolvedConflicts).toBe(0)
    expect(completion.pending).toBe(true)
    expect((await repository.getSyncMetadata()).pending).toBe(true)
  })

  it('rebases a write made during sync onto a newer restored book generation', async () => {
    const checkpoint = await repository.createSyncCheckpoint()
    const root = (await repository.listCategories('expense')).find((item) => item.parentId === null)!
    const lateWrite = await repository.addTransaction({
      type: 'expense', amountMinor: 2880, categoryId: root.id, subcategoryId: null,
      occurredLocalDate: '2026-08-14', occurredLocalTime: '12:31', note: '跨代际同步途中新增',
    })
    const restored = {
      ...checkpoint.snapshot,
      transactions: [],
      settings: {
        ...checkpoint.snapshot.settings,
        revision: { counter: 2, deviceId: 'device-b', clock: { 'system-defaults-v1': 1, 'device-b': 2 } },
        bookEpoch: { counter: 2, deviceId: 'device-b', clock: { 'system-defaults-v1': 1, 'device-b': 2 } },
      },
    }

    await repository.applySyncedSnapshot(restored, [], checkpoint.snapshot)

    const preserved = (await repository.listTransactions()).find((item) => item.id === lateWrite.id)
    expect(preserved?.note).toBe('跨代际同步途中新增')
    expect(preserved?.revision.counter).toBeGreaterThan(lateWrite.revision.counter)
    expect((await repository.getSyncMetadata()).pending).toBe(true)
  })

  it('revives a tombstoned category dependency for a write made during a generation change', async () => {
    const checkpoint = await repository.createSyncCheckpoint()
    const root = (await repository.listCategories('expense')).find((item) => item.parentId === null)!
    const lateWrite = await repository.addTransaction({
      type: 'expense', amountMinor: 3880, categoryId: root.id, subcategoryId: null,
      occurredLocalDate: '2026-08-14', occurredLocalTime: '12:32', note: '依赖被远端墓碑化的分类',
    })
    const remoteRevision = {
      counter: 2, deviceId: 'device-b', clock: { 'system-defaults-v1': 60, 'device-b': 2 },
    }
    const restored = {
      ...checkpoint.snapshot,
      transactions: [],
      categories: checkpoint.snapshot.categories.map((item) => item.id === root.id
        ? {
            ...item, status: 'archived' as const, deletedAt: '2026-08-14T01:00:00.000Z',
            deleteRevision: remoteRevision, revision: remoteRevision,
          }
        : item),
      settings: {
        ...checkpoint.snapshot.settings,
        revision: remoteRevision,
        bookEpoch: remoteRevision,
      },
    }

    await repository.applySyncedSnapshot(restored, [], checkpoint.snapshot)

    const snapshot = await repository.createSnapshot()
    const category = snapshot.categories.find((item) => item.id === root.id)
    expect(snapshot.transactions.some((item) => item.id === lateWrite.id)).toBe(true)
    expect(category?.deletedAt).toBeUndefined()
    expect(category?.status).toBe('active')
  })

  it('makes an explicit backup restore authoritative over the old cloud generation', async () => {
    const root = (await repository.listCategories('expense')).find((item) => item.parentId === null)!
    await repository.addTransaction({
      type: 'expense', amountMinor: 9900, categoryId: root.id, subcategoryId: null,
      occurredLocalDate: '2026-08-14', occurredLocalTime: '12:30', note: '恢复时应移除',
    })
    const oldCloud = await repository.createSnapshot()
    const backup = { ...oldCloud, transactions: [] }

    await repository.replaceWithBackup(backup)

    const restored = await repository.createSnapshot()
    const afterCloudMerge = mergeSnapshots(restored, oldCloud, '2026-08-14T07:00:00.000Z')
    expect(restored.transactions).toHaveLength(0)
    expect(afterCloudMerge.transactions).toHaveLength(0)
    expect((await repository.getSyncMetadata()).pending).toBe(true)
  })

  it('persists the monthly comparison preference as synchronized book settings', async () => {
    await repository.updateMonthComparisonMode('full-month')

    expect((await repository.getBookSettings()).monthComparisonMode).toBe('full-month')
    expect((await repository.getSyncMetadata()).pending).toBe(true)
    expect((await repository.createSnapshot()).settings.monthComparisonMode).toBe('full-month')
  })
})
