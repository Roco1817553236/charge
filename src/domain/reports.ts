import type { Category, Transaction } from './models'

export interface PeriodTotals {
  expenseMinor: number
  incomeMinor: number
  balanceMinor: number
  count: number
}

export interface DailyTotal {
  day: number
  expenseMinor: number
  incomeMinor: number
}

export interface CategoryTotal {
  categoryId: string
  name: string
  color: string
  expenseMinor: number
  percentage: number
}

export type ExpenseSubcategoryTotal = CategoryTotal

export interface ExpenseCategoryTotal extends CategoryTotal {
  subcategoryBreakdown: ExpenseSubcategoryTotal[]
}

export interface ExpensePeriodReport {
  expenseMinor: number
  count: number
  categoryBreakdown: ExpenseCategoryTotal[]
}

export interface ExpensePeriodComparison {
  current: ExpensePeriodReport
  previous: ExpensePeriodReport
  expenseChangeMinor: number
  expenseChangeRate: number | null
  currentLabel: string
  previousLabel: string
}

const SUBCATEGORY_CHART_PALETTE = [
  '#2563EB',
  '#F97316',
  '#16A34A',
  '#DC2626',
  '#7C3AED',
  '#0891B2',
  '#DB2777',
  '#CA8A04',
  '#4F46E5',
  '#059669',
  '#EA580C',
  '#9333EA',
] as const

const UNCLASSIFIED_CHART_COLOR = '#64748B'
const MISSING_SUBCATEGORY_CHART_COLOR = '#94A3B8'

function subcategoryChartColor(index: number): string {
  if (index < SUBCATEGORY_CHART_PALETTE.length) return SUBCATEGORY_CHART_PALETTE[index]!
  const generatedIndex = index - SUBCATEGORY_CHART_PALETTE.length
  const hue = (17 + generatedIndex * 137.508) % 360
  const lightness = 44 + (Math.floor(generatedIndex / SUBCATEGORY_CHART_PALETTE.length) % 2) * 14
  return `hsl(${hue.toFixed(3)} 72% ${lightness}%)`
}

function buildSubcategoryChartColors(categories: Category[]): Map<string, string> {
  const siblingsByRoot = new Map<string, Category[]>()
  categories.forEach((category) => {
    if (category.deletedAt || category.parentId === null) return
    const siblings = siblingsByRoot.get(category.parentId) ?? []
    siblings.push(category)
    siblingsByRoot.set(category.parentId, siblings)
  })

  const colors = new Map<string, string>()
  siblingsByRoot.forEach((siblings) => {
    siblings
      .sort((left, right) => left.sortOrder - right.sortOrder || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .forEach((category, index) => colors.set(category.id, subcategoryChartColor(index)))
  })
  return colors
}

export interface MonthlyReport extends PeriodTotals {
  yearMonth: string
  days: DailyTotal[]
  categoryBreakdown: CategoryTotal[]
}

export interface MonthComparison {
  current: MonthlyReport
  previous: MonthlyReport
  expenseChangeRate: number | null
  incomeChangeRate: number | null
  currentLabel: string
  previousLabel: string
}

export interface AnnualComparison {
  year: number
  currentYear: PeriodTotals
  previousYear: PeriodTotals
  months: Array<{
    month: number
    expenseMinor: number
    incomeMinor: number
    previousExpenseMinor: number
    previousIncomeMinor: number
  }>
  projection: {
    expenseMinor: number
    incomeMinor: number
    balanceMinor: number
    isEstimate: true
    label: '年度预测 · 仅供参考'
  }
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function activeTransactions(transactions: Transaction[]): Transaction[] {
  return transactions.filter((transaction) => !transaction.deletedAt)
}

function inRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end
}

function totalsFor(transactions: Transaction[]): PeriodTotals {
  const expenseMinor = transactions.reduce(
    (total, transaction) => total + (transaction.type === 'expense' ? transaction.amountMinor : 0),
    0,
  )
  const incomeMinor = transactions.reduce(
    (total, transaction) => total + (transaction.type === 'income' ? transaction.amountMinor : 0),
    0,
  )
  return {
    expenseMinor,
    incomeMinor,
    balanceMinor: incomeMinor - expenseMinor,
    count: transactions.length,
  }
}

function resolvedRootId(transaction: Transaction, categoryMap: Map<string, Category>): string {
  if (transaction.subcategoryId) {
    const child = categoryMap.get(transaction.subcategoryId)
    if (child?.parentId) return child.parentId
  }
  return transaction.categoryId
}

function buildExpenseReportBetween(
  transactions: Transaction[],
  categories: Category[],
  startDate: string,
  endDate: string,
): ExpensePeriodReport {
  const categoryMap = new Map(
    categories.filter((category) => !category.deletedAt).map((category) => [category.id, category]),
  )
  const subcategoryChartColors = buildSubcategoryChartColors(categories)
  const rows = activeTransactions(transactions).filter(
    (transaction) => transaction.type === 'expense' && inRange(transaction.occurredLocalDate, startDate, endDate),
  )
  const rootAmounts = new Map<string, number>()
  const childAmounts = new Map<string, Map<string, { name: string; color: string; expenseMinor: number }>>()

  rows.forEach((transaction) => {
    const selectedChild = transaction.subcategoryId ? categoryMap.get(transaction.subcategoryId) : undefined
    const hasCurrentParent = Boolean(selectedChild?.parentId)
    const rootId = hasCurrentParent ? selectedChild!.parentId! : transaction.categoryId
    const root = categoryMap.get(rootId)
    const childId = hasCurrentParent
      ? selectedChild!.id
      : transaction.subcategoryId
        ? `__missing__:${transaction.subcategoryId}`
        : `__unclassified__:${rootId}`
    const childName = hasCurrentParent
      ? selectedChild!.name
      : transaction.subcategoryId ? '已删除小类' : '未细分类'
    const childColor = hasCurrentParent
      ? subcategoryChartColors.get(selectedChild!.id) ?? MISSING_SUBCATEGORY_CHART_COLOR
      : transaction.subcategoryId ? MISSING_SUBCATEGORY_CHART_COLOR : UNCLASSIFIED_CHART_COLOR

    rootAmounts.set(rootId, (rootAmounts.get(rootId) ?? 0) + transaction.amountMinor)
    const children = childAmounts.get(rootId) ?? new Map()
    const currentChild = children.get(childId)
    children.set(childId, {
      name: currentChild?.name ?? childName,
      color: currentChild?.color ?? childColor,
      expenseMinor: (currentChild?.expenseMinor ?? 0) + transaction.amountMinor,
    })
    childAmounts.set(rootId, children)
  })

  const expenseMinor = rows.reduce((sum, transaction) => sum + transaction.amountMinor, 0)
  const categoryBreakdown = [...rootAmounts.entries()]
    .map(([categoryId, rootExpenseMinor]) => {
      const root = categoryMap.get(categoryId)
      const subcategoryBreakdown = [...(childAmounts.get(categoryId)?.entries() ?? [])]
        .map(([childId, child]) => ({
          categoryId: childId,
          name: child.name,
          color: child.color,
          expenseMinor: child.expenseMinor,
          percentage: rootExpenseMinor === 0 ? 0 : child.expenseMinor / rootExpenseMinor,
        }))
        .sort((left, right) => right.expenseMinor - left.expenseMinor)
      return {
        categoryId,
        name: root?.name ?? '已删除分类',
        color: root?.color ?? '#94A3B8',
        expenseMinor: rootExpenseMinor,
        percentage: expenseMinor === 0 ? 0 : rootExpenseMinor / expenseMinor,
        subcategoryBreakdown,
      }
    })
    .sort((left, right) => right.expenseMinor - left.expenseMinor)

  return { expenseMinor, count: rows.length, categoryBreakdown }
}

function buildMonthlyReportBetween(
  transactions: Transaction[],
  categories: Category[],
  yearMonth: string,
  startDate: string,
  endDate: string,
): MonthlyReport {
  const [year, month] = yearMonth.split('-').map(Number)
  const categoryMap = new Map(categories.map((category) => [category.id, category]))
  const rows = activeTransactions(transactions).filter((transaction) => inRange(transaction.occurredLocalDate, startDate, endDate))
  const totals = totalsFor(rows)
  const days: DailyTotal[] = Array.from({ length: daysInMonth(year!, month!) }, (_, index) => ({
    day: index + 1,
    expenseMinor: 0,
    incomeMinor: 0,
  }))
  const categoryAmounts = new Map<string, number>()

  rows.forEach((transaction) => {
    const day = Number(transaction.occurredLocalDate.slice(-2))
    const daily = days[day - 1]
    if (daily) {
      if (transaction.type === 'expense') daily.expenseMinor += transaction.amountMinor
      else daily.incomeMinor += transaction.amountMinor
    }
    if (transaction.type === 'expense') {
      const rootId = resolvedRootId(transaction, categoryMap)
      categoryAmounts.set(rootId, (categoryAmounts.get(rootId) ?? 0) + transaction.amountMinor)
    }
  })

  const categoryBreakdown = [...categoryAmounts.entries()]
    .map(([categoryId, expenseMinor]) => {
      const category = categoryMap.get(categoryId)
      return {
        categoryId,
        name: category?.name ?? '已删除分类',
        color: category?.color ?? '#94A3B8',
        expenseMinor,
        percentage: totals.expenseMinor === 0 ? 0 : expenseMinor / totals.expenseMinor,
      }
    })
    .sort((left, right) => right.expenseMinor - left.expenseMinor)

  return { yearMonth, ...totals, days, categoryBreakdown }
}

export function buildMonthlyReport(
  transactions: Transaction[],
  categories: Category[],
  yearMonth: string,
): MonthlyReport {
  const [year, month] = yearMonth.split('-').map(Number)
  const endDay = String(daysInMonth(year!, month!)).padStart(2, '0')
  return buildMonthlyReportBetween(transactions, categories, yearMonth, `${yearMonth}-01`, `${yearMonth}-${endDay}`)
}

function previousMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 2, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function changeRate(current: number, previous: number): number | null {
  if (previous === 0) return null
  return Math.round(((current - previous) / previous) * 10_000) / 10_000
}

function expenseComparison(
  current: ExpensePeriodReport,
  previous: ExpensePeriodReport,
  currentLabel: string,
  previousLabel: string,
): ExpensePeriodComparison {
  return {
    current,
    previous,
    expenseChangeMinor: current.expenseMinor - previous.expenseMinor,
    expenseChangeRate: changeRate(current.expenseMinor, previous.expenseMinor),
    currentLabel,
    previousLabel,
  }
}

export function compareExpenseMonthPeriods(
  transactions: Transaction[],
  categories: Category[],
  yearMonth: string,
  asOfDate: string,
  mode: 'to-date' | 'full-month',
): ExpensePeriodComparison {
  const previousYearMonth = previousMonth(yearMonth)
  const [currentYear, currentMonth] = yearMonth.split('-').map(Number)
  const [previousYear, previousMonthNumber] = previousYearMonth.split('-').map(Number)
  const requestedDay = Number(asOfDate.slice(-2))
  const currentCutoff = mode === 'to-date'
    ? Math.min(requestedDay, daysInMonth(currentYear!, currentMonth!))
    : daysInMonth(currentYear!, currentMonth!)
  const previousCutoff = mode === 'to-date'
    ? Math.min(requestedDay, daysInMonth(previousYear!, previousMonthNumber!))
    : daysInMonth(previousYear!, previousMonthNumber!)
  const current = buildExpenseReportBetween(
    transactions,
    categories,
    `${yearMonth}-01`,
    `${yearMonth}-${String(currentCutoff).padStart(2, '0')}`,
  )
  const previous = buildExpenseReportBetween(
    transactions,
    categories,
    `${previousYearMonth}-01`,
    `${previousYearMonth}-${String(previousCutoff).padStart(2, '0')}`,
  )
  return expenseComparison(
    current,
    previous,
    mode === 'to-date' ? '本月至今' : '本月完整数据',
    mode === 'to-date' ? '上月同期' : '上月完整数据',
  )
}

export function compareExpenseYearPeriods(
  transactions: Transaction[],
  categories: Category[],
  year: number,
  asOfDate: string,
): ExpensePeriodComparison {
  const asOfYear = Number(asOfDate.slice(0, 4))
  const isCurrentYear = year === asOfYear
  const monthDay = asOfDate.slice(5)
  const current = buildExpenseReportBetween(
    transactions,
    categories,
    `${year}-01-01`,
    isCurrentYear ? `${year}-${monthDay}` : `${year}-12-31`,
  )
  const previous = buildExpenseReportBetween(
    transactions,
    categories,
    `${year - 1}-01-01`,
    isCurrentYear ? `${year - 1}-${monthDay}` : `${year - 1}-12-31`,
  )
  return expenseComparison(
    current,
    previous,
    isCurrentYear ? `${year} 年至今` : `${year} 年`,
    isCurrentYear ? `${year - 1} 年同期` : `${year - 1} 年`,
  )
}

export function compareMonthPeriods(
  transactions: Transaction[],
  categories: Category[],
  yearMonth: string,
  asOfDate: string,
  mode: 'to-date' | 'full-month',
): MonthComparison {
  const previousYearMonth = previousMonth(yearMonth)
  const [currentYear, currentMonth] = yearMonth.split('-').map(Number)
  const [previousYear, previousMonthNumber] = previousYearMonth.split('-').map(Number)
  const requestedDay = Number(asOfDate.slice(-2))
  const currentCutoff = mode === 'to-date' ? Math.min(requestedDay, daysInMonth(currentYear!, currentMonth!)) : daysInMonth(currentYear!, currentMonth!)
  const previousCutoff = mode === 'to-date' ? Math.min(requestedDay, daysInMonth(previousYear!, previousMonthNumber!)) : daysInMonth(previousYear!, previousMonthNumber!)
  const current = buildMonthlyReportBetween(
    transactions,
    categories,
    yearMonth,
    `${yearMonth}-01`,
    `${yearMonth}-${String(currentCutoff).padStart(2, '0')}`,
  )
  const previous = buildMonthlyReportBetween(
    transactions,
    categories,
    previousYearMonth,
    `${previousYearMonth}-01`,
    `${previousYearMonth}-${String(previousCutoff).padStart(2, '0')}`,
  )

  return {
    current,
    previous,
    expenseChangeRate: changeRate(current.expenseMinor, previous.expenseMinor),
    incomeChangeRate: changeRate(current.incomeMinor, previous.incomeMinor),
    currentLabel: mode === 'to-date' ? '本月至今' : '本月完整数据',
    previousLabel: mode === 'to-date' ? '上月同期' : '上月完整数据',
  }
}

function dayOfYear(localDate: string): number {
  const [year, month, day] = localDate.split('-').map(Number)
  let elapsed = day!
  for (let currentMonth = 1; currentMonth < month!; currentMonth += 1) {
    elapsed += daysInMonth(year!, currentMonth)
  }
  return elapsed
}

export function buildAnnualComparison(
  transactions: Transaction[],
  _categories: Category[],
  year: number,
  asOfDate: string,
): AnnualComparison {
  const monthDay = asOfDate.slice(5)
  const currentStart = `${year}-01-01`
  const currentEnd = `${year}-${monthDay}`
  const previousStart = `${year - 1}-01-01`
  const previousEnd = `${year - 1}-${monthDay}`
  const active = activeTransactions(transactions)
  const currentRows = active.filter((transaction) => inRange(transaction.occurredLocalDate, currentStart, currentEnd))
  const previousRows = active.filter((transaction) => inRange(transaction.occurredLocalDate, previousStart, previousEnd))
  const currentYear = totalsFor(currentRows)
  const previousYear = totalsFor(previousRows)
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1
    const prefix = `${year}-${String(month).padStart(2, '0')}`
    const previousPrefix = `${year - 1}-${String(month).padStart(2, '0')}`
    const rows = currentRows.filter((transaction) => transaction.occurredLocalDate.startsWith(prefix))
    const previousMonthRows = previousRows.filter((transaction) => transaction.occurredLocalDate.startsWith(previousPrefix))
    const totals = totalsFor(rows)
    const previousTotals = totalsFor(previousMonthRows)
    return {
      month,
      expenseMinor: totals.expenseMinor,
      incomeMinor: totals.incomeMinor,
      previousExpenseMinor: previousTotals.expenseMinor,
      previousIncomeMinor: previousTotals.incomeMinor,
    }
  })

  const elapsedDays = Math.max(1, dayOfYear(asOfDate))
  const yearDays = daysInMonth(year, 2) === 29 ? 366 : 365
  const expenseMinor = Math.round((currentYear.expenseMinor * yearDays) / elapsedDays)
  const incomeMinor = Math.round((currentYear.incomeMinor * yearDays) / elapsedDays)

  return {
    year,
    currentYear,
    previousYear,
    months,
    projection: {
      expenseMinor,
      incomeMinor,
      balanceMinor: incomeMinor - expenseMinor,
      isEstimate: true,
      label: '年度预测 · 仅供参考',
    },
  }
}
