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
  it('shows monthly income, expense, balance and stacked root/child breakdowns', () => {
    const wrapper = mount(StatsPage, { props: { transactions, categories, asOfDate: '2026-08-14' } })

    expect(wrapper.text()).toContain('本月至今')
    expect(wrapper.text()).toContain('¥40.00')
    expect(wrapper.text()).toContain('较上月同期')
    expect(wrapper.get('[data-testid="stats-current-income"]').text()).toContain('¥100.00')
    expect(wrapper.get('[data-testid="stats-current-income"]').get('strong').classes()).toContain('income-value')
    expect(wrapper.get('[data-testid="stats-current-expense"]').text()).toContain('¥40.00')
    expect(wrapper.get('[data-testid="stats-current-expense"]').get('strong').classes()).toContain('expense-value')
    expect(wrapper.get('[data-testid="stats-current-balance"]').text()).toContain('¥60.00')
    expect(wrapper.get('[data-testid="stats-current-balance"]').get('strong').classes()).toContain('income-value')
    expect(wrapper.get('[data-testid="stats-income-change"]').text()).toContain('+¥100.00')
    expect(wrapper.get('[data-testid="stats-expense-change"]').text()).toContain('+¥20.00')
    expect(wrapper.get('[data-testid="stats-balance-change"]').text()).toContain('+¥80.00')
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

  it('keeps cashflow totals visible when a period contains only income', () => {
    const wrapper = mount(StatsPage, {
      props: { transactions: [tx('income-only', '2026-08-05', 10000, 'income', 'salary')], categories, asOfDate: '2026-08-14' },
    })

    expect(wrapper.get('[data-testid="stats-current-income"]').text()).toContain('¥100.00')
    expect(wrapper.get('[data-testid="stats-current-expense"]').text()).toContain('¥0.00')
    expect(wrapper.get('[data-testid="stats-current-balance"]').text()).toContain('¥100.00')
    expect(wrapper.text()).toContain('这个期间还没有支出数据')
  })

  it('shows a negative balance when a period contains only expense', () => {
    const wrapper = mount(StatsPage, {
      props: { transactions: [tx('expense-only', '2026-08-05', 2500, 'expense', 'food')], categories, asOfDate: '2026-08-14' },
    })

    expect(wrapper.get('[data-testid="stats-current-income"]').text()).toContain('¥0.00')
    expect(wrapper.get('[data-testid="stats-current-expense"]').text()).toContain('¥25.00')
    expect(wrapper.get('[data-testid="stats-current-balance"]').text()).toContain('-¥25.00')
    expect(wrapper.get('[data-testid="stats-current-balance"]').get('strong').classes()).toContain('expense-value')
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

  it('opens and closes the selected subcategory transactions inline', async () => {
    const wrapper = mount(StatsPage, { props: { transactions, categories, asOfDate: '2026-08-14' } })
    const lunch = wrapper.get('[data-testid="expense-subcategory-lunch"]')

    expect(wrapper.find('[data-testid="expense-subcategory-details"]').exists()).toBe(false)
    expect(lunch.element.tagName).toBe('BUTTON')
    expect(lunch.attributes('aria-pressed')).toBe('false')

    await lunch.trigger('click')

    const details = wrapper.get('[data-testid="expense-subcategory-details"]')
    expect(lunch.attributes('aria-pressed')).toBe('true')
    expect(details.text()).toContain('正餐流水')
    expect(details.text()).toContain('本月至今')
    expect(details.text()).toContain('1 笔')
    expect(details.text()).toContain('¥30.00')
    expect(details.text()).toContain('2026-08-10')
    expect(details.text()).toContain('12:00')
    expect(details.text()).toContain('无备注')

    await lunch.trigger('click')

    expect(wrapper.find('[data-testid="expense-subcategory-details"]').exists()).toBe(false)
    expect(lunch.attributes('aria-pressed')).toBe('false')

    await lunch.trigger('click')
    await wrapper.get('[data-testid="expense-subcategory-details-close"]').trigger('click')

    expect(wrapper.find('[data-testid="expense-subcategory-details"]').exists()).toBe(false)
    expect(lunch.attributes('aria-pressed')).toBe('false')
  })

  it('links the expanded details and restores focus to its subcategory control when closed', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const wrapper = mount(StatsPage, {
      attachTo: host,
      props: { transactions, categories, asOfDate: '2026-08-14' },
    })

    try {
      const lunch = wrapper.get('[data-testid="expense-subcategory-lunch"]')
      await lunch.trigger('click')
      expect(lunch.attributes('aria-controls')).toBe('expense-subcategory-details')

      const close = wrapper.get('[data-testid="expense-subcategory-details-close"]')
      const closeElement = close.element as HTMLElement
      closeElement.focus()
      await close.trigger('click')

      expect(document.activeElement).toBe(lunch.element)
    } finally {
      wrapper.unmount()
      host.remove()
    }
  })

  it('clears an expanded subcategory when another root category is selected', async () => {
    const wrapper = mount(StatsPage, { props: { transactions, categories, asOfDate: '2026-08-14' } })

    await wrapper.get('[data-testid="expense-subcategory-lunch"]').trigger('click')
    expect(wrapper.find('[data-testid="expense-subcategory-details"]').exists()).toBe(true)

    await wrapper.get('[data-testid="expense-category-transport"]').trigger('click')
    expect(wrapper.find('[data-testid="expense-subcategory-details"]').exists()).toBe(false)

    await wrapper.get('[data-testid="expense-category-food"]').trigger('click')
    expect(wrapper.find('[data-testid="expense-subcategory-details"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="expense-subcategory-lunch"]').attributes('aria-pressed')).toBe('false')
  })

  it('clears an expanded subcategory when the selected period no longer contains it', async () => {
    const periodTransactions = [
      tx('august-lunch', '2026-08-10', 3000, 'expense', 'food', 'lunch'),
      tx('july-unclassified', '2026-07-10', 2000, 'expense', 'food'),
    ]
    const wrapper = mount(StatsPage, {
      props: { transactions: periodTransactions, categories, asOfDate: '2026-08-14' },
    })

    await wrapper.get('[data-testid="expense-subcategory-lunch"]').trigger('click')
    await wrapper.get('button[aria-label="上个月"]').trigger('click')
    expect(wrapper.find('[data-testid="expense-subcategory-details"]').exists()).toBe(false)

    await wrapper.get('button[aria-label="下个月"]').trigger('click')
    expect(wrapper.find('[data-testid="expense-subcategory-details"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="expense-subcategory-lunch"]').attributes('aria-pressed')).toBe('false')
  })

  it('replaces the inline details when a sibling subcategory is selected', async () => {
    const breakfast: Category = {
      id: 'breakfast', type: 'expense', parentId: 'food', name: '早餐', icon: '🥣', color: '#F59E0B',
      sortOrder: 1, isPinned: false, status: 'active', revision, createdAt: now, updatedAt: now,
    }
    const siblingTransactions = [
      tx('lunch-row', '2026-08-10', 3000, 'expense', 'food', 'lunch'),
      tx('breakfast-row', '2026-08-11', 1500, 'expense', 'food', 'breakfast'),
    ]
    const wrapper = mount(StatsPage, {
      props: { transactions: siblingTransactions, categories: [...categories, breakfast], asOfDate: '2026-08-14' },
    })

    const lunch = wrapper.get('[data-testid="expense-subcategory-lunch"]')
    const breakfastRow = wrapper.get('[data-testid="expense-subcategory-breakfast"]')
    await lunch.trigger('click')
    await breakfastRow.trigger('click')

    const details = wrapper.get('[data-testid="expense-subcategory-details"]')
    expect(details.text()).toContain('早餐流水')
    expect(details.text()).toContain('¥15.00')
    expect(wrapper.find('[data-testid="expense-subcategory-transaction-breakfast-row"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="expense-subcategory-transaction-lunch-row"]').exists()).toBe(false)
    expect(lunch.attributes('aria-pressed')).toBe('false')
    expect(breakfastRow.attributes('aria-pressed')).toBe('true')
  })

  it('keeps expanded details when the same subcategory exists in a historical month', async () => {
    const wrapper = mount(StatsPage, { props: { transactions, categories, asOfDate: '2026-08-14' } })

    await wrapper.get('[data-testid="expense-subcategory-lunch"]').trigger('click')
    await wrapper.get('button[aria-label="上个月"]').trigger('click')

    const details = wrapper.get('[data-testid="expense-subcategory-details"]')
    expect(details.text()).toContain('2026 年 7 月')
    expect(details.text()).toContain('1 笔')
    expect(details.text()).toContain('¥20.00')
    expect(wrapper.find('[data-testid="expense-subcategory-transaction-expense-previous"]').exists()).toBe(true)
  })

  it('lets the current month switch from to-date to complete-month expense data', async () => {
    const wrapper = mount(StatsPage, { props: { transactions, categories, asOfDate: '2026-08-14' } })
    expect(wrapper.text()).toContain('¥40.00')

    await wrapper.get('[data-testid="comparison-full-month"]').trigger('click')

    expect(wrapper.text()).toContain('本月完整数据')
    expect(wrapper.text()).toContain('¥90.00')
    expect(wrapper.emitted('update:monthComparisonMode')?.at(-1)).toEqual(['full-month'])
  })

  it('refreshes expanded transactions when the monthly comparison mode changes', async () => {
    const wrapper = mount(StatsPage, { props: { transactions, categories, asOfDate: '2026-08-14' } })

    await wrapper.get('[data-testid="expense-subcategory-lunch"]').trigger('click')
    expect(wrapper.get('[data-testid="expense-subcategory-details"]').text()).toContain('1 笔')
    expect(wrapper.find('[data-testid="expense-subcategory-transaction-food-current-future"]').exists()).toBe(false)

    await wrapper.get('[data-testid="comparison-full-month"]').trigger('click')

    const details = wrapper.get('[data-testid="expense-subcategory-details"]')
    expect(details.text()).toContain('本月完整数据')
    expect(details.text()).toContain('2 笔')
    expect(details.text()).toContain('¥80.00')
    expect(wrapper.find('[data-testid="expense-subcategory-transaction-food-current-future"]').exists()).toBe(true)
  })

  it('switches to an annual cashflow view and uses complete historical years', async () => {
    const wrapper = mount(StatsPage, { props: { transactions, categories, asOfDate: '2026-08-14' } })

    await wrapper.get('[data-testid="stats-year"]').trigger('click')
    expect(wrapper.text()).toContain('2026 年至今')
    expect(wrapper.text()).toContain('2025 年同期')
    expect(wrapper.text()).toContain('¥60.00')
    expect(wrapper.get('[data-testid="stats-current-income"]').text()).toContain('¥100.00')
    expect(wrapper.get('[data-testid="stats-current-balance"]').text()).toContain('¥40.00')
    expect(wrapper.text()).not.toContain('年度预测')
    expect(wrapper.text()).not.toContain('12 个月趋势')

    await wrapper.get('button[aria-label="上一年"]').trigger('click')
    expect(wrapper.text()).toContain('2025 年')
    expect(wrapper.text()).toContain('¥100.00')
  })

  it('refreshes an expanded subcategory with the annual period when the view changes', async () => {
    const wrapper = mount(StatsPage, { props: { transactions, categories, asOfDate: '2026-08-14' } })

    await wrapper.get('[data-testid="expense-subcategory-lunch"]').trigger('click')
    await wrapper.get('[data-testid="stats-year"]').trigger('click')

    const details = wrapper.get('[data-testid="expense-subcategory-details"]')
    expect(details.text()).toContain('2026 年至今')
    expect(details.text()).toContain('2 笔')
    expect(details.text()).toContain('¥50.00')
    expect(wrapper.find('[data-testid="expense-subcategory-transaction-expense-previous"]').exists()).toBe(true)
  })

  it('keeps expanded details and refreshes them when the selected year changes', async () => {
    const wrapper = mount(StatsPage, { props: { transactions, categories, asOfDate: '2026-08-14' } })

    await wrapper.get('[data-testid="expense-subcategory-lunch"]').trigger('click')
    await wrapper.get('[data-testid="stats-year"]').trigger('click')
    await wrapper.get('button[aria-label="上一年"]').trigger('click')

    const details = wrapper.get('[data-testid="expense-subcategory-details"]')
    expect(details.text()).toContain('2025 年')
    expect(details.text()).toContain('1 笔')
    expect(details.text()).toContain('¥40.00')
    expect(wrapper.find('[data-testid="expense-subcategory-transaction-expense-last-year"]').exists()).toBe(true)
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
