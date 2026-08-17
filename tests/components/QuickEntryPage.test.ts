import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import QuickEntryPage from '../../src/components/QuickEntryPage.vue'
import type { Category } from '../../src/domain/models'
import type { EntryDraft } from '../../src/stores/bookStore'

const base = {
  type: 'expense' as const,
  icon: '🍜', color: '#F97316', sortOrder: 0, isPinned: true, status: 'active' as const,
  createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z',
  revision: { counter: 1, deviceId: 'a' },
}
const categories: Category[] = [
  { ...base, id: 'food', parentId: null, name: '餐饮' },
  { ...base, id: 'lunch', parentId: 'food', name: '正餐', isPinned: false },
  { ...base, id: 'transport', parentId: null, name: '交通', icon: '🚇', color: '#0EA5E9', sortOrder: 1 },
]
const draft: EntryDraft = {
  type: 'expense', amount: '', categoryId: null, subcategoryId: null,
  date: '2026-08-14', time: '12:30', note: '',
}

describe('QuickEntryPage', () => {
  it('does not mistake root categories for subcategories before a root is selected', () => {
    const wrapper = mount(QuickEntryPage, { props: { categories, draft } })
    expect(wrapper.find('[aria-label="二级分类"]').exists()).toBe(false)
  })

  it('completes the amount-category-subcategory fast path and emits a save draft', async () => {
    const wrapper = mount(QuickEntryPage, { props: { categories, draft } })

    await wrapper.get('[data-testid="amount-input"]').setValue('25.80')
    await wrapper.get('[data-testid="category-food"]').trigger('click')
    expect(wrapper.text()).toContain('正餐')
    await wrapper.get('[data-testid="subcategory-lunch"]').trigger('click')
    await wrapper.get('[data-testid="save-entry"]').trigger('submit')

    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({
      type: 'expense', amount: '25.80', categoryId: 'food', subcategoryId: 'lunch',
    })
  })

  it('switches to income categories and keeps advanced fields available', async () => {
    const income = { ...base, id: 'salary', type: 'income' as const, parentId: null, name: '工资', icon: '💼' }
    const wrapper = mount(QuickEntryPage, { props: { categories: [...categories, income], draft } })

    await wrapper.get('[data-testid="type-income"]').trigger('click')
    expect(wrapper.find('[data-testid="category-salary"]').exists()).toBe(true)
    await wrapper.get('[data-testid="entry-details-toggle"]').trigger('click')
    expect(wrapper.find('input[aria-label="日期"]').exists()).toBe(true)
    expect(wrapper.find('textarea[aria-label="备注"]').exists()).toBe(true)
  })
})
