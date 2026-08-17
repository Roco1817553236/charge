import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import CategoryManager from '../../src/components/CategoryManager.vue'
import type { Category, Transaction } from '../../src/domain/models'

const revision = { counter: 1, deviceId: 'a' }
const now = '2026-08-14T00:00:00.000Z'
const categories: Category[] = [
  { id: 'food', type: 'expense', parentId: null, name: '餐饮', icon: '🍜', color: '#F97316', sortOrder: 0, isPinned: true, status: 'active', revision, createdAt: now, updatedAt: now },
  { id: 'lunch', type: 'expense', parentId: 'food', name: '正餐', icon: '🍚', color: '#FB923C', sortOrder: 0, isPinned: false, status: 'active', revision, createdAt: now, updatedAt: now },
  { id: 'life', type: 'expense', parentId: null, name: '生活', icon: '💡', color: '#EAB308', sortOrder: 1, isPinned: true, status: 'active', revision, createdAt: now, updatedAt: now },
]
const transactions: Transaction[] = [{
  id: 'tx-1', type: 'expense', amountMinor: 2000, currency: 'CNY', categoryId: 'food', subcategoryId: 'lunch',
  occurredLocalDate: '2026-08-14', occurredLocalTime: '12:00', timeZone: 'Asia/Shanghai', note: '',
  createdAt: now, updatedAt: now, revision,
}]

describe('CategoryManager', () => {
  it('creates a custom root category with icon, color, and quick-entry pinning', async () => {
    const wrapper = mount(CategoryManager, { props: { categories, transactions } })
    await wrapper.get('[data-testid="add-root-category"]').trigger('click')
    await wrapper.get('input[aria-label="分类名称"]').setValue('宠物')
    await wrapper.get('input[aria-label="分类图标"]').setValue('🐾')
    await wrapper.get('input[aria-label="分类颜色"]').setValue('#8B5CF6')
    await wrapper.get('input[aria-label="固定到快速记账"]').setValue(true)
    await wrapper.get('[data-testid="category-form"]').trigger('submit')

    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({
      type: 'expense', parentId: null, name: '宠物', icon: '🐾', color: '#8b5cf6', isPinned: true,
    })
  })

  it('warns with the historical impact when moving a used subcategory', async () => {
    const wrapper = mount(CategoryManager, { props: { categories, transactions } })
    await wrapper.get('[data-testid="edit-category-lunch"]').trigger('click')
    await wrapper.get('select[aria-label="所属大类"]').setValue('life')
    expect(wrapper.text()).toContain('会影响 1 笔历史流水')
    await wrapper.get('[data-testid="category-form"]').trigger('submit')
    expect(wrapper.emitted('save')?.[0]?.[1]).toEqual({ affectedCount: 1, previousParentId: 'food' })
  })
})
