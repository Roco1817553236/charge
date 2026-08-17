import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import StatsPage from '../../src/components/StatsPage.vue'
import type { Category, Transaction } from '../../src/domain/models'

const revision = { counter: 1, deviceId: 'a' }
const now = '2026-08-14T00:00:00.000Z'
const categories: Category[] = [
  { id: 'food', type: 'expense', parentId: null, name: '餐饮', icon: '🍜', color: '#F97316', sortOrder: 0, isPinned: true, status: 'active', revision, createdAt: now, updatedAt: now },
  { id: 'lunch', type: 'expense', parentId: 'food', name: '正餐', icon: '🍚', color: '#FB923C', sortOrder: 0, isPinned: false, status: 'active', revision, createdAt: now, updatedAt: now },
  { id: 'salary', type: 'income', parentId: null, name: '工资', icon: '💼', color: '#16A34A', sortOrder: 0, isPinned: false, status: 'active', revision, createdAt: now, updatedAt: now },
]
function tx(id: string, date: string, amountMinor: number, type: 'expense' | 'income', categoryId: string, subcategoryId: string | null = null): Transaction {
  return { id, type, amountMinor, currency: 'CNY', categoryId, subcategoryId, occurredLocalDate: date, occurredLocalTime: '12:00',
    timeZone: 'Asia/Shanghai', note: '', createdAt: now, updatedAt: now, revision }
}
const transactions = [
  tx('expense-current', '2026-08-10', 3000, 'expense', 'food', 'lunch'),
  tx('expense-current-future', '2026-08-20', 5000, 'expense', 'food', 'lunch'),
  tx('income-current', '2026-08-05', 10000, 'income', 'salary'),
  tx('expense-previous', '2026-07-10', 2000, 'expense', 'food', 'lunch'),
  tx('expense-last-year', '2025-08-10', 4000, 'expense', 'food', 'lunch'),
]

describe('StatsPage', () => {
  it('shows monthly totals, same-period comparison, trend, and category drilldown', async () => {
    const wrapper = mount(StatsPage, { props: { transactions, categories, asOfDate: '2026-08-14' } })
    expect(wrapper.text()).toContain('本月至今')
    expect(wrapper.text()).toContain('¥30.00')
    expect(wrapper.text()).toContain('较上月同期')
    expect(wrapper.text()).toContain('上月同期支出')
    expect(wrapper.find('[aria-label="每日收支趋势"]').exists()).toBe(true)

    await wrapper.get('[data-testid="category-breakdown-food"]').trigger('click')
    expect(wrapper.text()).toContain('正餐')
  })

  it('lets the current month switch between to-date and complete-month comparison', async () => {
    const wrapper = mount(StatsPage, { props: { transactions, categories, asOfDate: '2026-08-14' } })
    expect(wrapper.text()).toContain('¥30.00')
    await wrapper.get('[data-testid="comparison-full-month"]').trigger('click')
    expect(wrapper.text()).toContain('本月完整数据')
    expect(wrapper.text()).toContain('¥80.00')
    expect(wrapper.emitted('update:monthComparisonMode')?.at(-1)).toEqual(['full-month'])
  })

  it('switches to annual comparison and labels projections as estimates', async () => {
    const wrapper = mount(StatsPage, { props: { transactions, categories, asOfDate: '2026-08-14' } })
    await wrapper.get('[data-testid="stats-year"]').trigger('click')
    expect(wrapper.text()).toContain('今年至今')
    expect(wrapper.text()).toContain('去年同期')
    expect(wrapper.text()).toContain('今年至今收入')
    expect(wrapper.text()).toContain('今年至今结余')
    expect(wrapper.text()).toContain('去年同期收入')
    expect(wrapper.text()).toContain('去年同期结余')
    expect(wrapper.text()).toContain('年度预测 · 仅供参考')
    expect(wrapper.find('[aria-label="十二个月收支趋势"]').exists()).toBe(true)
    expect(wrapper.get('[aria-label="年度逐月收支文字摘要"]').text()).toContain('8月：今年支出 ¥30.00，去年支出 ¥40.00')
  })
})
