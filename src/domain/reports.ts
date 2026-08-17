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
