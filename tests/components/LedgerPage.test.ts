import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import LedgerPage from '../../src/components/LedgerPage.vue'
import type { Category, Transaction } from '../../src/domain/models'

const revision = { counter: 1, deviceId: 'a' }
const now = '2026-08-14T00:00:00.000Z'
const categories: Category[] = [
  { id: 'food', type: 'expense', parentId: null, name: '餐饮', icon: '🍜', color: '#F97316', sortOrder: 0, isPinned: true, status: 'active', revision, createdAt: now, updatedAt: now },
  { id: 'lunch-category', type: 'expense', parentId: 'food', name: '正餐', icon: '🍚', color: '#FB923C', sortOrder: 0, isPinned: false, status: 'active', revision, createdAt: now, updatedAt: now },
  { id: 'salary', type: 'income', parentId: null, name: '工资', icon: '💼', color: '#16A34A', sortOrder: 0, isPinned: false, status: 'active', revision, createdAt: now, updatedAt: now },
]
const transactions: Transaction[] = [
  { id: 'lunch', type: 'expense', amountMinor: 2580, currency: 'CNY', categoryId: 'food', subcategoryId: 'lunch-category',
    occurredLocalDate: '2026-08-14', occurredLocalTime: '12:30', timeZone: 'Asia/Shanghai', note: '工作餐', createdAt: now, updatedAt: now, revision },
  { id: 'pay', type: 'income', amountMinor: 100000, currency: 'CNY', categoryId: 'salary', subcategoryId: null,
    occurredLocalDate: '2026-08-13', occurredLocalTime: '09:00', timeZone: 'Asia/Shanghai', note: '八月工资', createdAt: now, updatedAt: now, revision },
]

describe('LedgerPage', () => {
  it('groups rows by date and filters them by keyword', async () => {
    const wrapper = mount(LedgerPage, { props: { transactions, categories, initialMonth: '2026-08' } })
    expect(wrapper.text()).toContain('8月14日')
    expect(wrapper.text()).toContain('工作餐')
    expect(wrapper.text()).toContain('¥25.80')
    expect(wrapper.text()).toContain('八月工资')

    await wrapper.get('[data-testid="ledger-search"]').setValue('工作餐')
    expect(wrapper.text()).toContain('工作餐')
    expect(wrapper.text()).not.toContain('八月工资')
  })

  it('filters by a second-level category after selecting its parent', async () => {
    const wrapper = mount(LedgerPage, { props: { transactions, categories, initialMonth: '2026-08' } })
    await wrapper.get('select[aria-label="筛选大类"]').setValue('food')
    const childFilter = wrapper.get('select[aria-label="筛选二级分类"]')
    expect(childFilter.text()).toContain('正餐')
    await childFilter.setValue('lunch-category')
    expect(wrapper.text()).toContain('工作餐')
    expect(wrapper.text()).not.toContain('八月工资')
  })

  it('exposes edit, duplicate, and soft-delete actions for a row', async () => {
    const wrapper = mount(LedgerPage, { props: { transactions, categories, initialMonth: '2026-08' } })
    await wrapper.get('[data-testid="actions-lunch"]').trigger('click')
    await wrapper.get('[data-testid="edit-lunch"]').trigger('click')
    await wrapper.get('[data-testid="actions-lunch"]').trigger('click')
    await wrapper.get('[data-testid="duplicate-lunch"]').trigger('click')
    await wrapper.get('[data-testid="actions-lunch"]').trigger('click')
    await wrapper.get('[data-testid="delete-lunch"]').trigger('click')

    expect(wrapper.emitted('edit')?.[0]?.[0]).toMatchObject({ id: 'lunch' })
    expect(wrapper.emitted('duplicate')?.[0]?.[0]).toMatchObject({ id: 'lunch' })
    expect(wrapper.emitted('delete')?.[0]?.[0]).toMatchObject({ id: 'lunch' })
  })
})
