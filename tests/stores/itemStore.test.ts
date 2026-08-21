import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ItemCategory, ItemCost, OwnedItem, Transaction } from '../../src/domain/models'
import { setItemRepository, useItemStore, type ItemRepository } from '../../src/stores/itemStore'

const revision = { counter: 1, deviceId: 'device-a' }
const category: ItemCategory = {
  id: 'digital', name: '数码', icon: '💻', color: '#6366F1', sortOrder: 0, status: 'active', revision,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
}
const item: OwnedItem = {
  id: 'phone', categoryId: 'digital', name: '手机', icon: '📱', note: '', purchaseAmountMinor: 629_900,
  purchaseLocalDate: '2026-08-01', startedLocalDate: '2026-08-01', sourceTransactionId: null, revision,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
}
const cost: ItemCost = {
  id: 'battery', itemId: 'phone', type: 'repair', amountMinor: 49_900, occurredLocalDate: '2026-08-10',
  note: '换电池', sourceTransactionId: null, revision, createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
}

function repository(): ItemRepository {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    listItemCategories: vi.fn().mockResolvedValue([category]),
    listItems: vi.fn().mockResolvedValue([item]),
    listItemCosts: vi.fn().mockResolvedValue([cost]),
    listTransactions: vi.fn().mockResolvedValue([] as Transaction[]),
    saveItem: vi.fn().mockResolvedValue(item), saveItemCost: vi.fn().mockResolvedValue(cost),
    retireItem: vi.fn().mockResolvedValue({ ...item, retiredLocalDate: '2026-08-21' }),
    restoreItemUse: vi.fn().mockResolvedValue(item),
    softDeleteItem: vi.fn().mockResolvedValue({ ...item, deletedAt: '2026-08-21T00:00:00.000Z' }),
    restoreItem: vi.fn().mockResolvedValue(item),
    softDeleteItemCost: vi.fn().mockResolvedValue({ ...cost, deletedAt: '2026-08-21T00:00:00.000Z' }),
    restoreItemCost: vi.fn().mockResolvedValue(cost),
    saveItemCategory: vi.fn().mockResolvedValue(category), removeItemCategory: vi.fn().mockResolvedValue('archive'),
  }
}

describe('itemStore', () => {
  let repo: ItemRepository

  beforeEach(() => {
    setActivePinia(createPinia())
    repo = repository()
    setItemRepository(repo)
  })

  it('initializes and loads every item-cost collection', async () => {
    const store = useItemStore()
    await store.initialize()

    expect(store.categories).toEqual([category])
    expect(store.items).toEqual([item])
    expect(store.costs).toEqual([cost])
    expect(repo.initialize).toHaveBeenCalledOnce()
  })

  it('saves an item and refreshes the visible data', async () => {
    const store = useItemStore()
    await store.saveItem({
      categoryId: category.id, name: '手机', icon: '📱', note: '', purchaseAmountMinor: 629_900,
      purchaseLocalDate: '2026-08-01', sourceTransactionId: null,
    })

    expect(repo.saveItem).toHaveBeenCalled()
    expect(store.toast?.message).toBe('物品已保存')
    expect(repo.listItems).toHaveBeenCalled()
  })

  it('undoes the latest item or cost deletion', async () => {
    const store = useItemStore()
    await store.deleteItem(item.id)
    await store.undoLastDelete()
    expect(repo.restoreItem).toHaveBeenCalledWith(item.id)

    await store.deleteCost(cost.id)
    await store.undoLastDelete()
    expect(repo.restoreItemCost).toHaveBeenCalledWith(cost.id)
  })

  it('offers an immediate undo after retiring an item', async () => {
    const store = useItemStore()
    await store.retire(item.id, '2026-08-21')
    expect(store.toast).toMatchObject({ message: '物品已停用', action: 'undo-retire' })

    await store.undoLastRetire()
    expect(repo.restoreItemUse).toHaveBeenCalledWith(item.id)
  })
})
