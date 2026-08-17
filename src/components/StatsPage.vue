<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Category, Transaction } from '../domain/models'
import { formatMinor } from '../domain/money'
import { buildAnnualComparison, compareMonthPeriods } from '../domain/reports'

const props = withDefaults(defineProps<{
  transactions: Transaction[]
  categories: Category[]
  asOfDate: string
  monthComparisonMode?: 'to-date' | 'full-month'
}>(), { monthComparisonMode: 'to-date' })
const emit = defineEmits<{
  'update:monthComparisonMode': [mode: 'to-date' | 'full-month']
}>()

const view = ref<'month' | 'year'>('month')
const selectedMonth = ref(props.asOfDate.slice(0, 7))
const selectedCategoryId = ref<string | null>(null)
const currentMonthMode = ref<'to-date' | 'full-month'>(props.monthComparisonMode)
watch(() => props.monthComparisonMode, (mode) => { currentMonthMode.value = mode })

const isCurrentMonth = computed(() => selectedMonth.value === props.asOfDate.slice(0, 7))
const comparisonMode = computed(() => isCurrentMonth.value ? currentMonthMode.value : 'full-month' as const)
const monthComparison = computed(() => compareMonthPeriods(
  props.transactions,
  props.categories,
  selectedMonth.value,
  props.asOfDate,
  comparisonMode.value,
))
const selectedYear = computed(() => Number(selectedMonth.value.slice(0, 4)))
const annual = computed(() => buildAnnualComparison(props.transactions, props.categories, selectedYear.value, props.asOfDate))
const categoryMap = computed(() => new Map(props.categories.map((category) => [category.id, category])))
const categoryComparisonRows = computed(() => {
  const current = new Map(monthComparison.value.current.categoryBreakdown.map((row) => [row.categoryId, row]))
  const previous = new Map(monthComparison.value.previous.categoryBreakdown.map((row) => [row.categoryId, row]))
  return [...new Set([...current.keys(), ...previous.keys()])]
    .map((id) => {
      const currentRow = current.get(id)
      const previousRow = previous.get(id)
      const currentMinor = currentRow?.expenseMinor ?? 0
      const previousMinor = previousRow?.expenseMinor ?? 0
      return {
        id,
        name: currentRow?.name ?? previousRow?.name ?? '已删除分类',
        currentMinor,
        previousMinor,
        changeMinor: currentMinor - previousMinor,
      }
    })
    .sort((left, right) => Math.abs(right.changeMinor) - Math.abs(left.changeMinor))
})

const trendPoints = computed(() => {
  const days = monthComparison.value.current.days
  const max = Math.max(1, ...days.map((day) => Math.max(day.expenseMinor, day.incomeMinor)))
  const points = (type: 'expenseMinor' | 'incomeMinor') => days.map((day, index) => {
    const x = days.length === 1 ? 0 : (index / (days.length - 1)) * 100
    const y = 42 - (day[type] / max) * 38
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
  return { expense: points('expenseMinor'), income: points('incomeMinor') }
})

const donutBackground = computed(() => {
  const rows = monthComparison.value.current.categoryBreakdown
  if (rows.length === 0) return 'conic-gradient(var(--line) 0 100%)'
  let offset = 0
  const segments = rows.map((row) => {
    const start = offset
    offset += row.percentage * 100
    return `${row.color} ${start.toFixed(2)}% ${offset.toFixed(2)}%`
  })
  return `conic-gradient(${segments.join(', ')})`
})

const childBreakdown = computed(() => {
  if (!selectedCategoryId.value) return []
  const monthPrefix = selectedMonth.value
  const endDate = comparisonMode.value === 'to-date' ? props.asOfDate : `${monthPrefix}-31`
  const children = props.categories.filter((category) => category.parentId === selectedCategoryId.value)
  return children.map((category) => ({
    ...category,
    amountMinor: props.transactions
      .filter((transaction) =>
        !transaction.deletedAt &&
        transaction.type === 'expense' &&
        transaction.subcategoryId === category.id &&
        transaction.occurredLocalDate.startsWith(monthPrefix) &&
        transaction.occurredLocalDate <= endDate,
      )
      .reduce((sum, transaction) => sum + transaction.amountMinor, 0),
  })).filter((category) => category.amountMinor > 0).sort((left, right) => right.amountMinor - left.amountMinor)
})

const annualMax = computed(() => Math.max(1, ...annual.value.months.flatMap((month) => [
  month.expenseMinor,
  month.incomeMinor,
  month.previousExpenseMinor,
  month.previousIncomeMinor,
])))

function rateLabel(rate: number | null): string {
  if (rate === null) return '上期无数据'
  const value = Math.abs(rate * 100).toFixed(rate === 0 ? 0 : 1)
  return `${rate > 0 ? '↑' : rate < 0 ? '↓' : '—'} ${value}%`
}

function setComparisonMode(mode: 'to-date' | 'full-month'): void {
  currentMonthMode.value = mode
  emit('update:monthComparisonMode', mode)
}

function changeMonth(offset: number): void {
  const [year, month] = selectedMonth.value.split('-').map(Number)
  const next = new Date(Date.UTC(year!, month! - 1 + offset, 1))
  selectedMonth.value = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`
  selectedCategoryId.value = null
}

function monthTitle(value: string): string {
  const [year, month] = value.split('-')
  return `${year} 年 ${Number(month)} 月`
}
</script>

<template>
  <section class="stats-page" aria-labelledby="stats-title">
    <header class="page-header">
      <div>
        <p class="eyebrow">INSIGHTS</p>
        <h1 id="stats-title">统计</h1>
      </div>
      <div class="view-switch">
        <button data-testid="stats-month" type="button" :class="{ active: view === 'month' }" @click="view = 'month'">月度</button>
        <button data-testid="stats-year" type="button" :class="{ active: view === 'year' }" @click="view = 'year'">年度</button>
      </div>
    </header>

    <template v-if="view === 'month'">
      <div class="period-nav">
        <button type="button" aria-label="上个月" @click="changeMonth(-1)">‹</button>
        <div><strong>{{ monthTitle(selectedMonth) }}</strong><span>{{ monthComparison.currentLabel }}</span></div>
        <button type="button" aria-label="下个月" @click="changeMonth(1)">›</button>
      </div>

      <div v-if="isCurrentMonth" class="comparison-mode" aria-label="当前月比较口径">
        <button data-testid="comparison-to-date" type="button" :class="{ active: currentMonthMode === 'to-date' }" @click="setComparisonMode('to-date')">本月至今 / 上月同期</button>
        <button data-testid="comparison-full-month" type="button" :class="{ active: currentMonthMode === 'full-month' }" @click="setComparisonMode('full-month')">完整月份</button>
      </div>

      <div class="metric-grid">
        <article class="metric primary">
          <span>支出</span>
          <strong>{{ formatMinor(monthComparison.current.expenseMinor) }}</strong>
          <small>较{{ monthComparison.previousLabel }} {{ rateLabel(monthComparison.expenseChangeRate) }}</small>
        </article>
        <article class="metric">
          <span>收入</span>
          <strong>{{ formatMinor(monthComparison.current.incomeMinor) }}</strong>
          <small>较{{ monthComparison.previousLabel }} {{ rateLabel(monthComparison.incomeChangeRate) }}</small>
        </article>
        <article class="metric">
          <span>结余</span>
          <strong :class="{ positive: monthComparison.current.balanceMinor >= 0 }">{{ formatMinor(monthComparison.current.balanceMinor) }}</strong>
          <small>{{ monthComparison.current.count }} 笔流水</small>
        </article>
      </div>

      <article class="period-comparison" aria-label="月度收支对比">
        <header><strong>{{ monthComparison.currentLabel }}与{{ monthComparison.previousLabel }}</strong><span>同口径金额</span></header>
        <div><span>{{ monthComparison.previousLabel }}支出</span><b>{{ formatMinor(monthComparison.previous.expenseMinor) }}</b></div>
        <div><span>{{ monthComparison.previousLabel }}收入</span><b>{{ formatMinor(monthComparison.previous.incomeMinor) }}</b></div>
        <div><span>{{ monthComparison.previousLabel }}结余</span><b>{{ formatMinor(monthComparison.previous.balanceMinor) }}</b></div>
      </article>

      <article class="chart-card trend-card">
        <header><div><strong>每日趋势</strong><span>支出与收入走势</span></div><div class="legend"><i class="expense" />支出<i class="income" />收入</div></header>
        <svg viewBox="0 0 100 46" preserveAspectRatio="none" role="img" aria-label="每日收支趋势">
          <line v-for="y in [8, 20, 32, 44]" :key="y" x1="0" :y1="y" x2="100" :y2="y" class="grid-line" />
          <polyline :points="trendPoints.expense" class="expense-line" />
          <polyline :points="trendPoints.income" class="income-line" />
        </svg>
      </article>

      <article class="chart-card category-card">
        <header><div><strong>支出去向</strong><span>点击大类查看明细</span></div></header>
        <div v-if="monthComparison.current.categoryBreakdown.length" class="category-layout">
          <div class="donut" :style="{ background: donutBackground }"><span><strong>{{ monthComparison.current.categoryBreakdown.length }}</strong>类</span></div>
          <div class="breakdown-list">
            <button
              v-for="row in monthComparison.current.categoryBreakdown"
              :key="row.categoryId"
              :data-testid="`category-breakdown-${row.categoryId}`"
              type="button"
              :class="{ active: selectedCategoryId === row.categoryId }"
              @click="selectedCategoryId = selectedCategoryId === row.categoryId ? null : row.categoryId"
            >
              <i :style="{ background: row.color }" /><span>{{ row.name }}</span><strong>{{ formatMinor(row.expenseMinor) }}</strong><small>{{ (row.percentage * 100).toFixed(1) }}%</small>
            </button>
          </div>
        </div>
        <div v-else class="chart-empty">这个月还没有支出数据</div>
        <div v-if="selectedCategoryId" class="drilldown">
          <strong>{{ categoryMap.get(selectedCategoryId)?.name }} · 二级分类</strong>
          <div v-if="childBreakdown.length">
            <span v-for="child in childBreakdown" :key="child.id"><em>{{ child.name }}</em><b>{{ formatMinor(child.amountMinor) }}</b></span>
          </div>
          <p v-else>该大类没有二级分类流水</p>
        </div>
      </article>
      <article v-if="categoryComparisonRows.length" class="chart-card category-change-card">
        <header><div><strong>分类变化</strong><span>{{ monthComparison.currentLabel }} vs {{ monthComparison.previousLabel }}</span></div></header>
        <div class="category-change-list">
          <span v-for="row in categoryComparisonRows" :key="row.id">
            <em>{{ row.name }}</em>
            <small>{{ formatMinor(row.previousMinor) }} → {{ formatMinor(row.currentMinor) }}</small>
            <b :class="{ positive: row.changeMinor <= 0 }">{{ row.changeMinor > 0 ? '+' : '' }}{{ formatMinor(row.changeMinor) }}</b>
          </span>
        </div>
      </article>
    </template>

    <template v-else>
      <div class="annual-heading"><div><strong>{{ selectedYear }} 年</strong><span>今年至今 vs 去年同期</span></div></div>
      <div class="metric-grid annual-metrics">
        <article class="metric primary"><span>今年至今支出</span><strong>{{ formatMinor(annual.currentYear.expenseMinor) }}</strong><small>{{ annual.currentYear.count }} 笔</small></article>
        <article class="metric"><span>今年至今收入</span><strong>{{ formatMinor(annual.currentYear.incomeMinor) }}</strong><small>同期口径</small></article>
        <article class="metric"><span>今年至今结余</span><strong>{{ formatMinor(annual.currentYear.balanceMinor) }}</strong><small>收入减支出</small></article>
        <article class="metric"><span>去年同期支出</span><strong>{{ formatMinor(annual.previousYear.expenseMinor) }}</strong><small>同比基准</small></article>
        <article class="metric"><span>去年同期收入</span><strong>{{ formatMinor(annual.previousYear.incomeMinor) }}</strong><small>同比基准</small></article>
        <article class="metric"><span>去年同期结余</span><strong>{{ formatMinor(annual.previousYear.balanceMinor) }}</strong><small>同比基准</small></article>
      </div>

      <article class="projection-summary">
        <span>{{ annual.projection.label }}</span>
        <div><small>预计支出</small><strong>{{ formatMinor(annual.projection.expenseMinor) }}</strong></div>
        <div><small>预计收入</small><strong>{{ formatMinor(annual.projection.incomeMinor) }}</strong></div>
        <div><small>预计结余</small><strong>{{ formatMinor(annual.projection.balanceMinor) }}</strong></div>
      </article>

      <article class="chart-card annual-chart">
        <header><div><strong>12 个月趋势</strong><span>今年与去年同期逐月并列</span></div><div class="legend"><i class="expense" />今年<i class="previous" />去年</div></header>
        <div class="bar-chart" role="img" aria-label="十二个月收支趋势">
          <div v-for="month in annual.months" :key="month.month" class="bar-column">
            <div class="bars">
              <i class="expense-bar" :style="{ height: `${Math.max(2, month.expenseMinor / annualMax * 100)}%` }" />
              <i class="income-bar" :style="{ height: `${Math.max(2, month.incomeMinor / annualMax * 100)}%` }" />
              <i class="previous-expense-bar" :style="{ height: `${Math.max(2, month.previousExpenseMinor / annualMax * 100)}%` }" />
              <i class="previous-income-bar" :style="{ height: `${Math.max(2, month.previousIncomeMinor / annualMax * 100)}%` }" />
            </div>
            <span>{{ month.month }}月</span>
          </div>
        </div>
        <ul class="sr-only" aria-label="年度逐月收支文字摘要">
          <li v-for="month in annual.months" :key="`summary-${month.month}`">
            {{ month.month }}月：今年支出 {{ formatMinor(month.expenseMinor) }}，去年支出 {{ formatMinor(month.previousExpenseMinor) }}；今年收入 {{ formatMinor(month.incomeMinor) }}，去年收入 {{ formatMinor(month.previousIncomeMinor) }}
          </li>
        </ul>
      </article>

      <article class="projection-note">
        <span>i</span><div><strong>关于年度预测</strong><p>预测依据今年已过天数线性推算，只用于观察趋势，不代表预算承诺。</p></div>
      </article>
    </template>
  </section>
</template>

<style scoped>
.stats-page { width: 100%; max-width: 900px; margin: 0 auto; padding: 24px 20px 120px; }
.page-header { display: flex; align-items: end; justify-content: space-between; margin-bottom: 18px; }
.eyebrow { margin: 0 0 4px; color: var(--accent); font-size: 11px; font-weight: 800; letter-spacing: .18em; }
h1 { margin: 0; color: var(--ink); font-size: clamp(28px, 7vw, 38px); letter-spacing: -.05em; }
.view-switch { display: flex; gap: 3px; padding: 3px; border-radius: 12px; background: var(--surface-2); }
.view-switch button { padding: 8px 11px; border: 0; border-radius: 9px; background: transparent; color: var(--muted); font-size: 12px; font-weight: 750; }
.view-switch button.active { background: var(--surface); color: var(--ink); box-shadow: var(--shadow-soft); }
.period-nav { display: grid; grid-template-columns: 36px 1fr 36px; align-items: center; margin-bottom: 14px; }
.period-nav button { width: 34px; height: 34px; border: 1px solid var(--line); border-radius: 11px; background: var(--surface); color: var(--muted); font-size: 24px; }
.period-nav > div { display: grid; gap: 2px; text-align: center; }
.period-nav strong, .annual-heading strong { color: var(--ink); font-size: 15px; }
.period-nav span, .annual-heading span { color: var(--muted); font-size: 11px; }
.comparison-mode { display: flex; width: fit-content; gap: 3px; margin: -4px auto 14px; padding: 3px; border-radius: 11px; background: var(--surface-2); }.comparison-mode button { padding: 7px 10px; border: 0; border-radius: 8px; background: transparent; color: var(--muted); font-size: 9px; font-weight: 750; }.comparison-mode button.active { background: var(--surface); color: var(--ink); box-shadow: var(--shadow-soft); }
.metric-grid { display: grid; grid-template-columns: 1.25fr 1fr; gap: 10px; margin-bottom: 14px; }
.metric { display: grid; gap: 6px; min-width: 0; padding: 16px; border: 1px solid var(--line); border-radius: 20px; background: var(--surface); box-shadow: var(--shadow-soft); }
.metric:first-child { grid-row: span 2; align-content: center; }
.metric span { color: var(--muted); font-size: 11px; font-weight: 700; }
.metric strong { color: var(--ink); font: 750 clamp(22px, 6vw, 34px)/1 var(--font-display); letter-spacing: -.045em; }
.metric small { color: var(--muted); font-size: 10px; }
.metric.primary { border-color: color-mix(in srgb, var(--accent) 22%, var(--line)); background: linear-gradient(145deg, color-mix(in srgb, var(--accent) 9%, var(--surface)), var(--surface)); }
.metric .positive { color: var(--positive); }
.period-comparison { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 14px; padding: 13px; border: 1px solid var(--line); border-radius: 17px; background: var(--surface); }.period-comparison header { display: flex; grid-column: 1 / -1; align-items: baseline; justify-content: space-between; }.period-comparison header strong { color: var(--ink); font-size: 11px; }.period-comparison header span { color: var(--muted); font-size: 9px; }.period-comparison > div { display: grid; gap: 3px; }.period-comparison span { color: var(--muted); font-size: 9px; }.period-comparison b { color: var(--ink); font-size: 12px; }
.chart-card { margin-top: 14px; padding: 17px; border: 1px solid var(--line); border-radius: 22px; background: var(--surface); box-shadow: var(--shadow-soft); }
.chart-card > header { display: flex; align-items: start; justify-content: space-between; margin-bottom: 15px; }
.chart-card header > div:first-child { display: grid; gap: 3px; }
.chart-card header strong { color: var(--ink); font-size: 14px; }
.chart-card header span { color: var(--muted); font-size: 10px; }
.legend { display: flex; align-items: center; gap: 5px; color: var(--muted); font-size: 9px; }
.legend i { width: 7px; height: 7px; margin-left: 4px; border-radius: 50%; }
.legend .expense { background: var(--accent); }.legend .income { background: var(--positive); }.legend .previous { border: 1px solid var(--muted); background: transparent; }
.trend-card svg { width: 100%; height: 145px; overflow: visible; }
.grid-line { stroke: var(--line); stroke-width: .35; }
.expense-line, .income-line { fill: none; stroke-width: 1.8; vector-effect: non-scaling-stroke; }
.expense-line { stroke: var(--accent); }.income-line { stroke: var(--positive); }
.category-layout { display: grid; grid-template-columns: 112px 1fr; align-items: center; gap: 18px; }
.donut { position: relative; width: 108px; height: 108px; border-radius: 50%; }
.donut::after { position: absolute; inset: 20px; border-radius: 50%; background: var(--surface); content: ''; }
.donut span { position: absolute; z-index: 1; inset: 0; display: grid; place-content: center; color: var(--muted); font-size: 9px; text-align: center; }
.donut strong { color: var(--ink); font-size: 17px; }
.breakdown-list { display: grid; min-width: 0; gap: 3px; }
.breakdown-list button { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto auto; align-items: center; gap: 7px; padding: 7px; border: 0; border-radius: 9px; background: transparent; color: var(--ink); font-size: 11px; text-align: left; }
.breakdown-list button.active, .breakdown-list button:hover { background: var(--surface-2); }
.breakdown-list i { width: 7px; height: 7px; border-radius: 50%; }.breakdown-list span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.breakdown-list strong { font-size: 10px; }.breakdown-list small { color: var(--muted); font-size: 9px; }
.drilldown { margin-top: 14px; padding: 12px; border-radius: 14px; background: var(--surface-2); }
.drilldown > strong { color: var(--ink); font-size: 11px; }.drilldown > div { display: grid; gap: 6px; margin-top: 9px; }.drilldown span { display: flex; justify-content: space-between; color: var(--muted); font-size: 11px; }.drilldown em { font-style: normal; }.drilldown b { color: var(--ink); }.drilldown p { margin: 7px 0 0; color: var(--muted); font-size: 10px; }
.category-change-list { display: grid; gap: 5px; }.category-change-list > span { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 9px; padding: 7px 0; border-bottom: 1px solid var(--line); }.category-change-list > span:last-child { border-bottom: 0; }.category-change-list em { color: var(--ink); font-size: 11px; font-style: normal; }.category-change-list small { color: var(--muted); font-size: 9px; }.category-change-list b { color: var(--danger); font-size: 10px; }.category-change-list b.positive { color: var(--positive); }
.chart-empty { padding: 40px 0; color: var(--muted); font-size: 12px; text-align: center; }
.annual-heading { display: flex; margin: 0 0 14px; }.annual-heading > div { display: grid; gap: 2px; }
.annual-metrics { grid-template-columns: repeat(3, 1fr); }.annual-metrics .metric { grid-row: auto; }.annual-metrics .metric strong { font-size: clamp(18px, 4vw, 28px); }.metric.estimate { border-style: dashed; }
.projection-summary { display: grid; grid-template-columns: 1.2fr repeat(3, 1fr); align-items: center; gap: 10px; padding: 14px; border: 1px dashed var(--accent); border-radius: 18px; background: var(--accent-soft); }.projection-summary > span { color: var(--accent-strong); font-size: 10px; font-weight: 800; }.projection-summary div { display: grid; gap: 3px; }.projection-summary small { color: var(--muted); font-size: 8px; }.projection-summary strong { color: var(--ink); font-size: 12px; }
.bar-chart { display: grid; grid-template-columns: repeat(12, 1fr); gap: 4px; height: 210px; }
.bar-column { display: grid; grid-template-rows: 1fr auto; gap: 6px; min-width: 0; }.bars { display: flex; align-items: end; justify-content: center; gap: 1px; min-height: 0; border-bottom: 1px solid var(--line); }.bars i { width: min(6px, 23%); min-height: 2px; border-radius: 4px 4px 1px 1px; }.expense-bar { background: var(--accent); }.income-bar { background: var(--positive); }.previous-expense-bar { border: 1px solid var(--accent); background: color-mix(in srgb, var(--accent) 15%, transparent); }.previous-income-bar { border: 1px solid var(--positive); background: color-mix(in srgb, var(--positive) 15%, transparent); }.bar-column > span { color: var(--muted); font-size: 8px; text-align: center; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); clip-path: inset(50%); white-space: nowrap; }
.projection-note { display: flex; gap: 10px; margin-top: 14px; padding: 14px; border-radius: 17px; background: var(--accent-soft); color: var(--accent-strong); }.projection-note > span { display: grid; flex: 0 0 24px; height: 24px; place-items: center; border-radius: 50%; background: var(--accent); color: white; font-weight: 800; }.projection-note strong { font-size: 11px; }.projection-note p { margin: 3px 0 0; font-size: 10px; line-height: 1.5; opacity: .8; }
@media (min-width: 700px) { .stats-page { padding-top: 36px; } .metric-grid { grid-template-columns: repeat(3, 1fr); }.metric:first-child { grid-row: auto; }.trend-card svg { height: 210px; }.category-layout { grid-template-columns: 160px 1fr; }.donut { width: 140px; height: 140px; }.donut::after { inset: 27px; } }
@media (max-width: 520px) { .annual-metrics { grid-template-columns: 1fr 1fr; }.projection-summary { grid-template-columns: 1fr 1fr; }.projection-summary > span { grid-column: 1 / -1; }.bar-chart { gap: 2px; }.bar-column > span { font-size: 7px; }.category-layout { grid-template-columns: 92px 1fr; gap: 12px; }.donut { width: 88px; height: 88px; }.donut::after { inset: 17px; } }
</style>
