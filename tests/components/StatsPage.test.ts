import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import StatsPage from '../../src/components/StatsPage.vue'
import type { Category, Transaction } from '../../src/domain/models'

const revision = { counter: 1, deviceId: 'a' }
const now = '2026-08-14T00:00:00.000Z'
const categories: Category[] = [
  { id: 'food', type: 'expense', parentId: null, name: '餐饮', icon: '🍜', color: '#F97316', sortOrder: 0, isPinned: true, status: 'active', revision, createdAt: now, updatedAt: now },
  { id: 'lunch', type: 'expense', parentId: 'food', name: '正餐', icon: '🍚', color: '#FB923C', sortOrder: 0, isPinned: false, status: 'active', revision, createdAt: now, updatedAt: now },
  { id: 'transport', type: 'expense', parentId: null, name: '交通', icon: '🚇', color: '#0EA5E9', sortOrder: 1, isPinned: true, status: 'active', revision, createdAt: now, updatedAt: now },
  { id: 'bus', type: 'expense', parentId: 'transport', name: '公交', icon: '🚌', color: '#38BDF8', sortOrder: 0, isPinned: false, status: 'active', revision, createdAt: now, updatedAt: now },
  { id: 'salary', type: 'income', parentId: null, name: '工资', icon: '💼', color: '#16A34A', sortOrder: 0, isPinned: false, status: 'active', revision, createdAt: now, updatedAt: now },
]

function tx(id: string, date: string, amountMinor: number, type: 'expense' | 'income', categoryId: string, subcategoryId: string | null = null): Transaction {
  return { id, type, amountMinor, currency: 'CNY', categoryId, subcategoryId, occurredLocalDate: date, occurredLocalTime: '12:00',
    timeZone: 'Asia/Shanghai', note: '', createdAt: now, updatedAt: now, revision }
}

const transactions = [
  tx('food-current', '2026-08-10', 3000, 'expense', 'food', 'lunch'),
  tx('transport-current', '2026-08-11', 1000, 'expense', 'transport', 'bus'),
  tx('food-current-future', '2026-08-20', 5000, 'expense', 'food', 'lunch'),
  tx('income-current', '2026-08-05', 10000, 'income', 'salary'),
  tx('expense-previous', '2026-07-10', 2000, 'expense', 'food', 'lunch'),
  tx('expense-last-year', '2025-08-10', 4000, 'expense', 'food', 'lunch'),
  tx('expense-last-year-december', '2025-12-10', 6000, 'expense', 'transport', 'bus'),
]

describe('StatsPage', () => {
  it('focuses the monthly view on expense totals and stacked root/child breakdowns', () => {
    const wrapper = mount(StatsPage, { props: { transactions, categories, asOfDate: '2026-08-14' } })

    expect(wrapper.text()).toContain('本月至今')
    expect(wrapper.text()).toContain('¥40.00')
    expect(wrapper.text()).toContain('较上月同期')
    expect(wrapper.text()).not.toContain('收入')
    expect(wrapper.text()).not.toContain('结余')
    expect(wrapper.text()).not.toContain('每日趋势')

    const food = wrapper.get('[data-testid="expense-category-food"]')
    expect(food.text()).toContain('餐饮')
    expect(food.text()).toContain('¥30.00')
    expect(food.text()).toContain('75.0%')
    const lunch = wrapper.get('[data-testid="expense-subcategory-lunch"]')
    expect(lunch.text()).toContain('正餐')
    expect(lunch.text()).toContain('¥30.00')
    expect(lunch.text()).toContain('100.0%')
    expect(wrapper.find('[aria-label="支出大类占比图"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="餐饮小类占比图"]').exists()).toBe(true)
  })

  it('updates only the lower breakdown when another root category is selected', async () => {
    const wrapper = mount(StatsPage, { props: { transactions, categories, asOfDate: '2026-08-14' } })
    expect(wrapper.text()).toContain('餐饮 · 小类占比')

    await wrapper.get('[data-testid="expense-category-transport"]').trigger('click')

    expect(wrapper.text()).toContain('交通 · 小类占比')
    const bus = wrapper.get('[data-testid="expense-subcategory-bus"]')
    expect(bus.text()).toContain('¥10.00')
    expect(bus.text()).toContain('100.0%')
    expect(wrapper.find('[data-testid="expense-category-food"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="expense-category-transport"]').classes()).toContain('active')
  })

  it('lets the current month switch from to-date to complete-month expense data', async () => {
    const wrapper = mount(StatsPage, { props: { transactions, categories, asOfDate: '2026-08-14' } })
    expect(wrapper.text()).toContain('¥40.00')

    await wrapper.get('[data-testid="comparison-full-month"]').trigger('click')

    expect(wrapper.text()).toContain('本月完整数据')
    expect(wrapper.text()).toContain('¥90.00')
    expect(wrapper.emitted('update:monthComparisonMode')?.at(-1)).toEqual(['full-month'])
  })

  it('switches to an expense-only annual view and uses complete historical years', async () => {
    const wrapper = mount(StatsPage, { props: { transactions, categories, asOfDate: '2026-08-14' } })

    await wrapper.get('[data-testid="stats-year"]').trigger('click')
    expect(wrapper.text()).toContain('2026 年至今')
    expect(wrapper.text()).toContain('2025 年同期')
    expect(wrapper.text()).toContain('¥60.00')
    expect(wrapper.text()).not.toContain('年度预测')
    expect(wrapper.text()).not.toContain('12 个月趋势')

    await wrapper.get('button[aria-label="上一年"]').trigger('click')
    expect(wrapper.text()).toContain('2025 年')
    expect(wrapper.text()).toContain('¥100.00')
  })

  it('keeps a non-leading category selected when the next view still contains it', async () => {
    const wrapper = mount(StatsPage, { props: { transactions, categories, asOfDate: '2026-08-14' } })
    expect(wrapper.find('[data-testid="expense-subcategory-card"]').exists()).toBe(true)
    await wrapper.get('[data-testid="expense-category-transport"]').trigger('click')

    await wrapper.get('[data-testid="stats-year"]').trigger('click')

    expect(wrapper.find('[data-testid="expense-subcategory-card"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="expense-category-transport"]').classes()).toContain('active')
    expect(wrapper.text()).toContain('交通 · 小类占比')
  })

  it('shows a clear empty state when a period contains income but no expense', () => {
    const incomeOnly = [tx('income-only', '2026-08-05', 10000, 'income', 'salary')]
    const wrapper = mount(StatsPage, { props: { transactions: incomeOnly, categories, asOfDate: '2026-08-14' } })

    expect(wrapper.text()).toContain('这个期间还没有支出数据')
    expect(wrapper.find('[data-testid="expense-subcategory-card"]').exists()).toBe(false)
  })
})
