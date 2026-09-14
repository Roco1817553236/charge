<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { Category, Transaction } from '../domain/models'
import { formatMinor } from '../domain/money'
import {
  buildExpenseSubcategoryDetails,
  compareExpenseMonthPeriods,
  compareExpenseYearPeriods,
  type ExpenseCategoryTotal,
  type ExpenseStatsPeriod,
} from '../domain/reports'

const props = withDefaults(defineProps<{
  transactions: Transaction[]
  categories: Category[]
  asOfDate: string
  monthComparisonMode?: 'to-date' | 'full-month'
}>(), { monthComparisonMode: 'to-date' })

const emit = defineEmits<{
  'update:monthComparisonMode': [mode: 'to-date' | 'full-month']
  edit: [transaction: Transaction]
}>()

const view = ref<'month' | 'year'>('month')
const selectedMonth = ref(props.asOfDate.slice(0, 7))
const selectedYear = ref(Number(props.asOfDate.slice(0, 4)))
const selectedCategoryId = ref<string | null>(null)
const selectedSubcategoryId = ref<string | null>(null)
const subcategoryButtonElements = new Map<string, HTMLButtonElement>()
const currentMonthMode = ref<'to-date' | 'full-month'>(props.monthComparisonMode)

watch(() => props.monthComparisonMode, (mode) => { currentMonthMode.value = mode })

const isCurrentMonth = computed(() => selectedMonth.value === props.asOfDate.slice(0, 7))
const monthMode = computed(() => isCurrentMonth.value ? currentMonthMode.value : 'full-month' as const)
const comparison = computed(() => view.value === 'month'
  ? compareExpenseMonthPeriods(
      props.transactions,
      props.categories,
      selectedMonth.value,
      props.asOfDate,
      monthMode.value,
    )
  : compareExpenseYearPeriods(
      props.transactions,
      props.categories,
      selectedYear.value,
      props.asOfDate,
    ))

watch(
  () => comparison.value.current.categoryBreakdown,
  (rows) => {
    if (rows.length === 0) {
      selectedCategoryId.value = null
      return
    }
    if (!rows.some((row) => row.categoryId === selectedCategoryId.value)) {
      selectedCategoryId.value = rows[0]!.categoryId
    }
  },
  { immediate: true },
)

watch(selectedCategoryId, () => {
  selectedSubcategoryId.value = null
})

const selectedCategory = computed<ExpenseCategoryTotal | null>(() =>
  comparison.value.current.categoryBreakdown.find((row) => row.categoryId === selectedCategoryId.value) ?? null,
)

watch(
  () => selectedCategory.value?.subcategoryBreakdown.map((row) => row.categoryId) ?? [],
  (categoryIds) => {
    if (selectedSubcategoryId.value && !categoryIds.includes(selectedSubcategoryId.value)) {
      selectedSubcategoryId.value = null
    }
  },
)

const selectedSubcategory = computed(() =>
  selectedCategory.value?.subcategoryBreakdown.find((row) => row.categoryId === selectedSubcategoryId.value) ?? null,
)

const statsPeriod = computed<ExpenseStatsPeriod>(() => view.value === 'month'
  ? {
      view: 'month',
      yearMonth: selectedMonth.value,
      asOfDate: props.asOfDate,
      mode: monthMode.value,
    }
  : { view: 'year', year: selectedYear.value, asOfDate: props.asOfDate })

const selectedSubcategoryDetails = computed(() => {
  if (!selectedCategory.value || !selectedSubcategory.value) return null
  return buildExpenseSubcategoryDetails(
    props.transactions,
    props.categories,
    statsPeriod.value,
    selectedCategory.value.categoryId,
    selectedSubcategory.value.categoryId,
  )
})

const detailsPeriodLabel = computed(() => view.value === 'month'
  ? `${monthTitle(selectedMonth.value)} · ${comparison.value.currentLabel}`
  : comparison.value.currentLabel)

function donutBackground(rows: Array<{ color: string; percentage: number }>): string {
  if (rows.length === 0) return 'conic-gradient(var(--line) 0 100%)'
  let offset = 0
  const segments = rows.map((row) => {
    const start = offset
    offset += row.percentage * 100
    return `${row.color} ${start.toFixed(2)}% ${offset.toFixed(2)}%`
  })
  return `conic-gradient(${segments.join(', ')})`
}

const categoryDonutBackground = computed(() => donutBackground(comparison.value.current.categoryBreakdown))
const subcategoryDonutBackground = computed(() => donutBackground(selectedCategory.value?.subcategoryBreakdown ?? []))

function percentageLabel(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function rateLabel(rate: number | null, emptyLabel: string): string {
  if (rate === null) return emptyLabel
  if (rate === 0) return '持平 0%'
  return `${rate > 0 ? '增加' : '减少'} ${Math.abs(rate * 100).toFixed(1)}%`
}

function signedAmount(value: number): string {
  return `${value > 0 ? '+' : ''}${formatMinor(value)}`
}

function semanticValueClass(value: number, positiveClass = 'income-value', negativeClass = 'expense-value'): string {
  if (value > 0) return positiveClass
  if (value < 0) return negativeClass
  return 'neutral-value'
}

function setComparisonMode(mode: 'to-date' | 'full-month'): void {
  currentMonthMode.value = mode
  emit('update:monthComparisonMode', mode)
}

function toggleSubcategoryDetails(categoryId: string): void {
  selectedSubcategoryId.value = selectedSubcategoryId.value === categoryId ? null : categoryId
}

function setSubcategoryButtonRef(categoryId: string, element: unknown): void {
  if (element instanceof HTMLButtonElement) subcategoryButtonElements.set(categoryId, element)
  else subcategoryButtonElements.delete(categoryId)
}

async function closeSubcategoryDetails(): Promise<void> {
  const control = selectedSubcategoryId.value
    ? subcategoryButtonElements.get(selectedSubcategoryId.value)
    : undefined
  selectedSubcategoryId.value = null
  await nextTick()
  control?.focus()
}

function setView(nextView: 'month' | 'year'): void {
  if (view.value === nextView) return
  view.value = nextView
}

function changeMonth(offset: number): void {
  const [year, month] = selectedMonth.value.split('-').map(Number)
  const next = new Date(Date.UTC(year!, month! - 1 + offset, 1))
  selectedMonth.value = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`
}

function changeYear(offset: number): void {
  selectedYear.value += offset
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
        <h1 id="stats-title" tabindex="-1">收支统计</h1>
      </div>
      <div class="view-switch">
        <button data-testid="stats-month" type="button" :class="{ active: view === 'month' }" @click="setView('month')">月度</button>
        <button data-testid="stats-year" type="button" :class="{ active: view === 'year' }" @click="setView('year')">年度</button>
      </div>
    </header>

    <div v-if="view === 'month'" class="period-nav">
      <button type="button" aria-label="上个月" @click="changeMonth(-1)">‹</button>
      <div><strong>{{ monthTitle(selectedMonth) }}</strong><span>{{ comparison.currentLabel }}</span></div>
      <button type="button" aria-label="下个月" @click="changeMonth(1)">›</button>
    </div>
    <div v-else class="period-nav">
      <button type="button" aria-label="上一年" @click="changeYear(-1)">‹</button>
      <div><strong>{{ selectedYear }} 年</strong><span>{{ comparison.currentLabel }} / {{ comparison.previousLabel }}</span></div>
      <button type="button" aria-label="下一年" @click="changeYear(1)">›</button>
    </div>

    <div v-if="view === 'month' && isCurrentMonth" class="comparison-mode" aria-label="当前月比较口径">
      <button data-testid="comparison-to-date" type="button" :class="{ active: currentMonthMode === 'to-date' }" @click="setComparisonMode('to-date')">本月至今 / 上月同期</button>
      <button data-testid="comparison-full-month" type="button" :class="{ active: currentMonthMode === 'full-month' }" @click="setComparisonMode('full-month')">完整月份</button>
    </div>

    <div class="cashflow-summary">
      <article data-testid="stats-current-income" class="cashflow-card income">
        <span>{{ comparison.currentLabel }}收入</span>
        <strong class="income-value">{{ formatMinor(comparison.current.incomeMinor) }}</strong>
        <small>{{ comparison.current.incomeCount }} 笔收入</small>
      </article>
      <article data-testid="stats-current-expense" class="cashflow-card expense">
        <span>{{ comparison.currentLabel }}支出</span>
        <strong class="expense-value">{{ formatMinor(comparison.current.expenseMinor) }}</strong>
        <small>{{ comparison.current.count }} 笔支出</small>
      </article>
      <article data-testid="stats-current-balance" class="cashflow-card balance">
        <span>{{ comparison.currentLabel }}结余</span>
        <strong :class="semanticValueClass(comparison.current.balanceMinor)">{{ formatMinor(comparison.current.balanceMinor) }}</strong>
        <small>收入 − 支出</small>
      </article>
    </div>

    <div class="cashflow-changes" :aria-label="`较${comparison.previousLabel}变化`">
      <article data-testid="stats-income-change" class="change-card">
        <span>收入变化</span>
        <strong :class="semanticValueClass(comparison.incomeChangeMinor)">{{ signedAmount(comparison.incomeChangeMinor) }}</strong>
        <small>较{{ comparison.previousLabel }} <b class="income-value">{{ formatMinor(comparison.previous.incomeMinor) }}</b> · {{ rateLabel(comparison.incomeChangeRate, '上期无收入') }}</small>
      </article>
      <article data-testid="stats-expense-change" class="change-card">
        <span>支出变化</span>
        <strong :class="semanticValueClass(comparison.expenseChangeMinor, 'expense-value', 'income-value')">{{ signedAmount(comparison.expenseChangeMinor) }}</strong>
        <small>较{{ comparison.previousLabel }} <b class="expense-value">{{ formatMinor(comparison.previous.expenseMinor) }}</b> · {{ rateLabel(comparison.expenseChangeRate, '上期无支出') }}</small>
      </article>
      <article data-testid="stats-balance-change" class="change-card">
        <span>结余变化</span>
        <strong :class="semanticValueClass(comparison.balanceChangeMinor)">{{ signedAmount(comparison.balanceChangeMinor) }}</strong>
        <small>较{{ comparison.previousLabel }}结余 <b :class="semanticValueClass(comparison.previous.balanceMinor)">{{ formatMinor(comparison.previous.balanceMinor) }}</b></small>
      </article>
    </div>

    <template v-if="comparison.current.categoryBreakdown.length">
      <article class="chart-card" data-testid="expense-category-card">
        <header><div><strong>大类占比</strong><span>点击大类切换下方明细</span></div></header>
        <div class="category-layout">
          <div
            class="donut"
            role="img"
            aria-label="支出大类占比图"
            :style="{ background: categoryDonutBackground }"
          >
            <span><strong class="expense-value">{{ formatMinor(comparison.current.expenseMinor) }}</strong><small>全部支出</small></span>
          </div>
          <div class="breakdown-list">
            <button
              v-for="row in comparison.current.categoryBreakdown"
              :key="row.categoryId"
              :data-testid="`expense-category-${row.categoryId}`"
              type="button"
              :class="{ active: selectedCategoryId === row.categoryId }"
              :aria-pressed="selectedCategoryId === row.categoryId"
              @click="selectedCategoryId = row.categoryId"
            >
              <i :style="{ background: row.color }" />
              <span>{{ row.name }}</span>
              <strong class="expense-value">{{ formatMinor(row.expenseMinor) }}</strong>
              <small>{{ percentageLabel(row.percentage) }}</small>
            </button>
          </div>
        </div>
      </article>

      <div v-if="selectedCategory" class="breakdown-connector">
        <span>{{ selectedCategory.name }}</span>的小类明细
      </div>

      <article v-if="selectedCategory" class="chart-card subcategory-card" data-testid="expense-subcategory-card">
        <header><div><strong>{{ selectedCategory.name }} · 小类占比</strong><span>占{{ selectedCategory.name }}支出</span></div></header>
        <div class="category-layout">
          <div
            class="donut"
            role="img"
            :aria-label="`${selectedCategory.name}小类占比图`"
            :style="{ background: subcategoryDonutBackground }"
          >
            <span><strong class="expense-value">{{ formatMinor(selectedCategory.expenseMinor) }}</strong><small>{{ selectedCategory.name }}合计</small></span>
          </div>
          <div class="breakdown-list subcategory-list">
            <button
              v-for="row in selectedCategory.subcategoryBreakdown"
              :key="row.categoryId"
              :data-testid="`expense-subcategory-${row.categoryId}`"
              type="button"
              class="breakdown-row"
              :ref="(element) => setSubcategoryButtonRef(row.categoryId, element)"
              :class="{ active: selectedSubcategoryId === row.categoryId }"
              :aria-pressed="selectedSubcategoryId === row.categoryId"
              :aria-controls="selectedSubcategoryId === row.categoryId ? 'expense-subcategory-details' : undefined"
              @click="toggleSubcategoryDetails(row.categoryId)"
            >
              <i :style="{ background: row.color }" />
              <span>{{ row.name }}</span>
              <strong class="expense-value">{{ formatMinor(row.expenseMinor) }}</strong>
              <small>{{ percentageLabel(row.percentage) }}</small>
            </button>
          </div>
        </div>
      </article>

      <div v-if="selectedSubcategory" class="breakdown-connector details-connector">
        <span>{{ selectedSubcategory.name }}</span>的账单流水
      </div>

      <article
        v-if="selectedSubcategory && selectedSubcategoryDetails"
        id="expense-subcategory-details"
        class="chart-card subcategory-details"
        data-testid="expense-subcategory-details"
      >
        <header class="details-header">
          <div>
            <strong>{{ selectedSubcategory.name }}流水</strong>
            <span>
              {{ detailsPeriodLabel }} · {{ selectedSubcategoryDetails.count }} 笔 ·
              <b class="expense-value">{{ formatMinor(selectedSubcategoryDetails.expenseMinor) }}</b>
            </span>
          </div>
          <button
            type="button"
            data-testid="expense-subcategory-details-close"
            :aria-label="`收起${selectedSubcategory.name}流水`"
            @click="closeSubcategoryDetails"
          >收起</button>
        </header>
        <div class="subcategory-transaction-list">
          <button
            v-for="transaction in selectedSubcategoryDetails.transactions"
            :key="transaction.id"
            :data-testid="`expense-subcategory-transaction-${transaction.id}`"
            class="subcategory-transaction"
            type="button"
            :aria-label="`编辑 ${transaction.occurredLocalDate} ${selectedCategory?.name ?? '未知大类'} ${selectedSubcategory.name} ${transaction.note || '无备注'} ${formatMinor(transaction.amountMinor)}`"
            @click="emit('edit', transaction)"
          >
            <time :datetime="`${transaction.occurredLocalDate}T${transaction.occurredLocalTime}`">
              {{ transaction.occurredLocalDate }}
              <small>{{ transaction.occurredLocalTime }}</small>
            </time>
            <span class="transaction-note" :aria-label="transaction.note || '无备注'">
              {{ transaction.note || '无备注' }}
            </span>
            <strong class="expense-value">-{{ formatMinor(transaction.amountMinor) }}</strong>
            <span class="edit-hint" aria-hidden="true">编辑 ›</span>
          </button>
        </div>
      </article>
    </template>

    <div v-else class="chart-empty">
      <span>◌</span>
      <strong>这个期间还没有支出数据</strong>
      <p>记下一笔支出后，这里会显示大类和小类去向。</p>
    </div>
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
.period-nav strong { color: var(--ink); font-size: 15px; }
.period-nav span { color: var(--muted); font-size: 10px; }
.comparison-mode { display: flex; width: fit-content; gap: 3px; margin: -4px auto 14px; padding: 3px; border-radius: 11px; background: var(--surface-2); }
.comparison-mode button { padding: 7px 10px; border: 0; border-radius: 8px; background: transparent; color: var(--muted); font-size: 9px; font-weight: 750; }
.comparison-mode button.active { background: var(--surface); color: var(--ink); box-shadow: var(--shadow-soft); }
.cashflow-summary, .cashflow-changes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; }
.cashflow-summary { margin-bottom: 9px; }
.cashflow-changes { margin-bottom: 14px; }
.cashflow-card, .change-card { display: grid; min-width: 0; gap: 5px; padding: 14px; border: 1px solid var(--line); border-radius: 18px; background: var(--surface); box-shadow: var(--shadow-soft); }
.cashflow-card span, .change-card span { color: var(--muted); font-size: 10px; font-weight: 700; }
.cashflow-card strong { color: var(--ink); font: 750 clamp(18px, 4.5vw, 29px)/1.1 var(--font-display); letter-spacing: -.045em; overflow-wrap: anywhere; }
.cashflow-card small, .change-card small { overflow: hidden; color: var(--muted); font-size: 8px; line-height: 1.4; text-overflow: ellipsis; }
.cashflow-card.expense { border-color: color-mix(in srgb, var(--expense-color) 22%, var(--line)); background: linear-gradient(145deg, var(--expense-soft), var(--surface)); }
.cashflow-card.income { border-color: color-mix(in srgb, var(--income-color) 22%, var(--line)); background: linear-gradient(145deg, var(--income-soft), var(--surface)); }
.change-card { padding: 11px 13px; border-radius: 15px; box-shadow: none; }
.change-card strong { color: var(--ink); font-size: clamp(14px, 3.5vw, 20px); line-height: 1.15; overflow-wrap: anywhere; }
.change-card small b, .details-header span b { font: inherit; }
.income-value { color: var(--income-color) !important; }
.expense-value { color: var(--expense-color) !important; }
.neutral-value { color: var(--ink) !important; }
.chart-card { margin-top: 14px; padding: 17px; border: 1px solid var(--line); border-radius: 22px; background: var(--surface); box-shadow: var(--shadow-soft); }
.chart-card > header { display: flex; align-items: start; justify-content: space-between; margin-bottom: 15px; }
.chart-card header > div { display: grid; gap: 3px; }
.chart-card header strong { color: var(--ink); font-size: 14px; }
.chart-card header span { color: var(--muted); font-size: 10px; }
.category-layout { display: grid; grid-template-columns: 124px minmax(0, 1fr); align-items: center; gap: 18px; }
.donut { position: relative; width: 120px; height: 120px; border-radius: 50%; }
.donut::after { position: absolute; inset: 24px; border-radius: 50%; background: var(--surface); content: ''; }
.donut span { position: absolute; z-index: 1; inset: 0; display: grid; place-content: center; color: var(--muted); font-size: 8px; text-align: center; }
.donut strong { overflow: hidden; max-width: 82px; color: var(--ink); font-size: 13px; text-overflow: ellipsis; }
.breakdown-list { display: grid; min-width: 0; gap: 3px; }
.breakdown-list button, .breakdown-row { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto auto; align-items: center; gap: 7px; padding: 8px 7px; border: 0; border-radius: 9px; background: transparent; color: var(--ink); font-size: 11px; text-align: left; }
.breakdown-list button.active, .breakdown-list button:hover { background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--line); }
.breakdown-list i { width: 7px; height: 7px; border-radius: 50%; }
.breakdown-list span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.breakdown-list strong { font-size: 10px; }
.breakdown-list small { color: var(--muted); font-size: 9px; font-weight: 700; }
.breakdown-connector { display: flex; align-items: center; justify-content: center; gap: 4px; margin: 12px 0 -2px; color: var(--muted); font-size: 9px; }
.breakdown-connector::before, .breakdown-connector::after { width: 48px; height: 1px; background: var(--line); content: ''; }
.breakdown-connector span { color: var(--accent-strong); font-weight: 800; }
.subcategory-card { margin-top: 12px; }
.subcategory-list .breakdown-row { cursor: pointer; }
.details-connector { margin-top: 12px; }
.subcategory-details { margin-top: 12px; }
.details-header { gap: 12px; }
.details-header > button { flex: 0 0 auto; padding: 7px 10px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface-2); color: var(--accent-strong); font-size: 10px; font-weight: 750; }
.subcategory-transaction-list { display: grid; }
.subcategory-transaction { display: grid; width: 100%; grid-template-columns: 92px minmax(0, 1fr) auto auto; align-items: center; gap: 10px; min-width: 0; min-height: 44px; padding: 11px 2px; border: 0; border-top: 1px solid var(--line); outline: none; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.subcategory-transaction:hover { background: color-mix(in srgb, var(--accent) 4%, transparent); }
.subcategory-transaction:focus-visible { border-radius: 10px; box-shadow: inset 0 0 0 2px var(--accent); }
.subcategory-transaction time { display: grid; gap: 2px; color: var(--ink); font-size: 10px; font-weight: 700; }
.subcategory-transaction time small { color: var(--muted); font-size: 9px; font-weight: 600; }
.transaction-note { overflow: hidden; color: var(--ink); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.subcategory-transaction > strong { font-size: 11px; white-space: nowrap; }
.edit-hint { color: var(--accent); font-size: 9px; font-weight: 750; white-space: nowrap; }
.chart-empty { display: grid; min-height: 240px; place-content: center; place-items: center; gap: 7px; margin-top: 14px; padding: 28px; border: 1px dashed var(--line); border-radius: 22px; background: var(--surface); color: var(--muted); text-align: center; }
.chart-empty > span { font-size: 34px; }.chart-empty strong { color: var(--ink); font-size: 13px; }.chart-empty p { margin: 0; font-size: 10px; }
@media (min-width: 700px) { .stats-page { padding-top: 36px; }.category-layout { grid-template-columns: 160px minmax(0, 1fr); }.donut { width: 145px; height: 145px; }.donut::after { inset: 29px; } }
@media (max-width: 520px) { .cashflow-summary, .cashflow-changes { grid-template-columns: 1fr; }.cashflow-card, .change-card { padding: 10px 9px; border-radius: 14px; }.cashflow-card span, .change-card span { font-size: 9px; }.cashflow-card strong { font-size: clamp(18px, 5.5vw, 23px); }.cashflow-card small, .change-card small { font-size: 8px; }.category-layout { grid-template-columns: 96px minmax(0, 1fr); gap: 10px; }.donut { width: 92px; height: 92px; }.donut::after { inset: 18px; }.donut strong { max-width: 62px; font-size: 10px; }.breakdown-list button, .breakdown-row { grid-template-columns: 7px minmax(36px, 1fr) auto auto; gap: 4px; padding: 7px 3px; font-size: 9px; }.breakdown-list strong, .breakdown-list small { font-size: 8px; }.subcategory-transaction { grid-template-columns: 78px minmax(0, 1fr) auto auto; gap: 6px; }.subcategory-transaction time, .transaction-note, .subcategory-transaction > strong, .edit-hint { font-size: 9px; } }
@media (max-width: 400px) { .cashflow-card strong, .change-card strong { font-size: 20px; } }
</style>
