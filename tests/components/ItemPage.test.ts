import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ItemPage from '../../src/components/ItemPage.vue'
import type { ItemCategory, ItemCost, OwnedItem, Transaction } from '../../src/domain/models'

const now = '2026-08-21T00:00:00.000Z'
const revision = { counter: 1, deviceId: 'a' }
const categories: ItemCategory[] = [
  { id: 'digital', name: '数码', icon: '💻', color: '#6366F1', sortOrder: 0, status: 'active', revision, createdAt: now, updatedAt: now },
  { id: 'home', name: '家居', icon: '🏠', color: '#F59E0B', sortOrder: 1, status: 'active', revision, createdAt: now, updatedAt: now },
  { id: 'old', name: '旧分类', icon: '◇', color: '#64748B', sortOrder: 2, status: 'archived', revision, createdAt: now, updatedAt: now },
]
const items: OwnedItem[] = [
  { id: 'phone', categoryId: 'digital', name: '手机', icon: '📱', note: '', purchaseAmountMinor: 100_000,
    purchaseLocalDate: '2026-08-01', startedLocalDate: '2026-08-01', sourceTransactionId: null,
    revision, createdAt: now, updatedAt: now },
  { id: 'chair', categoryId: 'home', name: '椅子', icon: '🪑', note: '', purchaseAmountMinor: 60_000,
    purchaseLocalDate: '2026-08-01', startedLocalDate: '2026-08-01', retiredLocalDate: '2026-08-10', sourceTransactionId: null,
    revision, createdAt: now, updatedAt: now },
]
const costs: ItemCost[] = [
  { id: 'battery', itemId: 'phone', type: 'repair', amountMinor: 20_000, occurredLocalDate: '2026-08-10', note: '换电池',
    sourceTransactionId: null, revision, createdAt: now, updatedAt: now },
]
const transactions: Transaction[] = [{
  id: 'tx-phone', type: 'expense', amountMinor: 629_900, currency: 'CNY', categoryId: 'shopping', subcategoryId: null,
  occurredLocalDate: '2026-08-08', occurredLocalTime: '12:00', timeZone: 'Asia/Shanghai', note: '新手机',
  revision, createdAt: now, updatedAt: now,
}]

function wrapper() {
  return mount(ItemPage, {
    props: { categories, items, costs, transactions, asOfDate: '2026-08-21', saving: false },
    global: { stubs: { teleport: true } },
  })
}

describe('ItemPage', () => {
  it('shows active-item summary and filters retired items by status and category', async () => {
    const view = wrapper()
    expect(view.get('[data-testid="item-count"]').text()).toContain('1')
    expect(view.text()).toContain('手机')
    expect(view.text()).not.toContain('椅子')

    await view.get('[data-testid="item-status-filter"]').setValue('retired')
    expect(view.text()).toContain('椅子')
    expect(view.text()).not.toContain('手机')

    await view.get('[data-testid="item-category-filter"]').setValue('digital')
    expect(view.find('[data-testid="item-empty"]').exists()).toBe(true)
  })

  it('expands one item inline with its repair and total cost details', async () => {
    const view = wrapper()
    await view.get('[data-testid="item-card-phone"]').trigger('click')

    expect(view.get('[data-testid="item-details-phone"]').text()).toContain('换电池')
    expect(view.get('[data-testid="item-details-phone"]').text()).toContain('¥1,200.00')
  })

  it('offers source-ledger and manual creation, then emits a manual item', async () => {
    const view = wrapper()
    await view.get('[data-testid="add-item"]').trigger('click')
    expect(view.text()).toContain('从支出流水创建')
    expect(view.text()).toContain('手动添加物品')

    await view.get('[data-testid="add-item-manual"]').trigger('click')
    await view.get('[data-testid="item-name-input"]').setValue('键盘')
    await view.get('[data-testid="item-amount-input"]').setValue('399.00')
    await view.get('[data-testid="item-category-input"]').setValue('digital')
    await view.get('[data-testid="item-purchase-date-input"]').setValue('2026-08-01')
    await view.get('[data-testid="item-start-date-input"]').setValue('2026-08-02')
    await view.get('[data-testid="item-form"]').trigger('submit')

    expect(view.emitted('save-item')?.[0]?.[0]).toMatchObject({
      name: '键盘', purchaseAmountMinor: 39_900, categoryId: 'digital', sourceTransactionId: null,
    })
  })

  it('prefills an item from an existing expense transaction', async () => {
    const view = wrapper()
    await view.get('[data-testid="add-item"]').trigger('click')
    await view.get('[data-testid="add-item-source"]').trigger('click')
    await view.get('[data-testid="item-source-input"]').setValue('tx-phone')

    expect((view.get('[data-testid="item-amount-input"]').element as HTMLInputElement).value).toBe('6299.00')
    expect((view.get('[data-testid="item-purchase-date-input"]').element as HTMLInputElement).value).toBe('2026-08-08')
  })

  it('preserves the retirement date when editing a retired item', async () => {
    const view = wrapper()
    await view.get('[data-testid="item-status-filter"]').setValue('retired')
    await view.get('[data-testid="item-card-chair"]').trigger('click')
    expect(view.get('[data-testid="item-details-chair"]').text()).toContain('停用日期2026-08-10')
    const edit = view.get('[data-testid="item-details-chair"]').findAll('button').find((button) => button.text() === '编辑')!
    await edit.trigger('click')
    await view.get('[data-testid="item-form"]').trigger('submit')

    expect(view.emitted('save-item')?.[0]?.[0]).toMatchObject({ id: 'chair', retiredLocalDate: '2026-08-10' })
  })

  it('restores an archived item category from the category manager', async () => {
    const view = wrapper()
    await view.get('button[aria-label="管理物品分类"]').trigger('click')
    const row = view.findAll('.category-row').find((entry) => entry.text().includes('旧分类'))!
    await row.get('button').trigger('click')

    expect(view.emitted('save-category')?.[0]?.[0]).toMatchObject({ id: 'old', status: 'active' })
  })

  it('warns but allows reuse when a source transaction is already linked', async () => {
    const view = mount(ItemPage, {
      props: {
        categories, costs, transactions, asOfDate: '2026-08-21', saving: false,
        items: [{ ...items[0]!, sourceTransactionId: 'tx-phone' }, items[1]!],
      },
      global: { stubs: { teleport: true } },
    })
    await view.get('[data-testid="add-item"]').trigger('click')
    await view.get('[data-testid="add-item-source"]').trigger('click')
    await view.get('[data-testid="item-source-input"]').setValue('tx-phone')

    expect(view.text()).toContain('已经关联 1 件物品，仍可继续创建')
  })

  it('keeps the item and marks a missing source transaction', async () => {
    const view = mount(ItemPage, {
      props: {
        categories, costs, transactions: [], asOfDate: '2026-08-21', saving: false,
        items: [{ ...items[0]!, sourceTransactionId: 'deleted-source' }],
      },
      global: { stubs: { teleport: true } },
    })
    await view.get('[data-testid="item-card-phone"]').trigger('click')

    expect(view.get('[data-testid="item-details-phone"]').text()).toContain('来源流水已删除')
  })
})
