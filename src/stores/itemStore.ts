import { defineStore } from 'pinia'
import {
  LocalRepository,
  type SaveItemCategoryInput,
  type SaveItemCostInput,
  type SaveItemInput,
} from '../data/localRepository'
import type { ItemCategory, ItemCost, OwnedItem, Transaction } from '../domain/models'

export interface ItemRepository {
  initialize(): Promise<void>
  listItemCategories(includeArchived?: boolean): Promise<ItemCategory[]>
  listItems(includeDeleted?: boolean): Promise<OwnedItem[]>
  listItemCosts(itemId?: string, includeDeleted?: boolean): Promise<ItemCost[]>
  listTransactions(filters?: { includeDeleted?: boolean }): Promise<Transaction[]>
  saveItem(input: SaveItemInput): Promise<OwnedItem>
  saveItemCost(input: SaveItemCostInput): Promise<ItemCost>
  retireItem(id: string, retiredLocalDate: string): Promise<OwnedItem>
  restoreItemUse(id: string): Promise<OwnedItem>
  softDeleteItem(id: string): Promise<OwnedItem>
  restoreItem(id: string): Promise<OwnedItem>
  softDeleteItemCost(id: string): Promise<ItemCost>
  restoreItemCost(id: string): Promise<ItemCost>
  saveItemCategory(input: SaveItemCategoryInput): Promise<ItemCategory>
  removeItemCategory(id: string): Promise<'delete' | 'archive'>
}

let repository: ItemRepository = new LocalRepository()

export function setItemRepository(value: ItemRepository): void {
  repository = value
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export const useItemStore = defineStore('items', {
  state: () => ({
    categories: [] as ItemCategory[],
    items: [] as OwnedItem[],
    costs: [] as ItemCost[],
    transactions: [] as Transaction[],
    initialized: false,
    loading: false,
    saving: false,
    toast: null as { message: string; action?: 'undo-delete' | 'undo-retire' } | null,
    error: null as string | null,
    lastDelete: null as { type: 'item' | 'cost'; id: string } | null,
    lastRetiredId: null as string | null,
  }),
  actions: {
    async initialize(): Promise<void> {
      if (this.initialized || this.loading) return
      this.loading = true
      this.error = null
      try {
        await repository.initialize()
        await this.refresh()
        this.initialized = true
      } catch (error) {
        this.error = errorMessage(error, '物品数据初始化失败')
        throw error
      } finally {
        this.loading = false
      }
    },

    async refresh(): Promise<void> {
      const [categories, items, costs, transactions] = await Promise.all([
        repository.listItemCategories(true),
        repository.listItems(),
        repository.listItemCosts(),
        repository.listTransactions(),
      ])
      this.categories = categories
      this.items = items
      this.costs = costs
      this.transactions = transactions.filter((item) => item.type === 'expense' && !item.deletedAt)
    },

    async saveItem(input: SaveItemInput): Promise<void> {
      this.saving = true
      this.error = null
      try {
        await repository.saveItem(input)
        await this.refresh()
        this.toast = { message: '物品已保存' }
      } catch (error) {
        this.error = errorMessage(error, '物品保存失败')
        throw error
      } finally {
        this.saving = false
      }
    },

    async saveCost(input: SaveItemCostInput): Promise<void> {
      this.saving = true
      this.error = null
      try {
        await repository.saveItemCost(input)
        await this.refresh()
        this.toast = { message: input.type === 'repair' ? '维修费用已保存' : '配件费用已保存' }
      } catch (error) {
        this.error = errorMessage(error, '追加成本保存失败')
        throw error
      } finally {
        this.saving = false
      }
    },

    async retire(id: string, date: string): Promise<void> {
      await repository.retireItem(id, date)
      this.lastRetiredId = id
      await this.refresh()
      this.toast = { message: '物品已停用', action: 'undo-retire' }
    },

    async restoreUse(id: string): Promise<void> {
      await repository.restoreItemUse(id)
      await this.refresh()
      this.toast = { message: '物品已恢复使用' }
    },

    async undoLastRetire(): Promise<void> {
      if (!this.lastRetiredId) return
      await repository.restoreItemUse(this.lastRetiredId)
      this.lastRetiredId = null
      await this.refresh()
      this.toast = { message: '已撤销停用' }
    },

    async deleteItem(id: string): Promise<void> {
      await repository.softDeleteItem(id)
      this.lastDelete = { type: 'item', id }
      await this.refresh()
      this.toast = { message: '物品已删除', action: 'undo-delete' }
    },

    async deleteCost(id: string): Promise<void> {
      await repository.softDeleteItemCost(id)
      this.lastDelete = { type: 'cost', id }
      await this.refresh()
      this.toast = { message: '追加成本已删除', action: 'undo-delete' }
    },

    async undoLastDelete(): Promise<void> {
      if (!this.lastDelete) return
      if (this.lastDelete.type === 'item') await repository.restoreItem(this.lastDelete.id)
      else await repository.restoreItemCost(this.lastDelete.id)
      this.lastDelete = null
      await this.refresh()
      this.toast = { message: '已撤销删除' }
    },

    async saveCategory(input: SaveItemCategoryInput): Promise<void> {
      await repository.saveItemCategory(input)
      await this.refresh()
      this.toast = { message: '物品分类已保存' }
    },

    async removeCategory(id: string): Promise<void> {
      const policy = await repository.removeItemCategory(id)
      await this.refresh()
      this.toast = { message: policy === 'archive' ? '物品分类已归档' : '物品分类已删除' }
    },
  },
})
