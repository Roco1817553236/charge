import type { Category, Transaction, TransactionType } from './models'

export interface DuplicateTransactionKey {
  type: TransactionType
  amountMinor: number
  occurredLocalDate: string
}

export interface DuplicateEntryKey extends DuplicateTransactionKey {
  categoryId: string
  subcategoryId: string | null
}

export type MealSlot = '早餐' | '正餐' | '晚餐'

export interface DuplicatePreview {
  transactions: Transaction[]
  amountDuplicateCount: number
  mealSlot: MealSlot | null
  mealDuplicateCount: number
}

export function findLatestBookkeepingTimestamp(transactions: Transaction[]): string | null {
  let latest: { value: string; time: number } | null = null
  for (const transaction of transactions) {
    if (transaction.deletedAt) continue
    const time = Date.parse(transaction.updatedAt)
    if (!Number.isFinite(time) || (latest && time <= latest.time)) continue
    latest = { value: transaction.updatedAt, time }
  }
  return latest?.value ?? null
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function localDayNumber(value: Date): number {
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86_400_000
}

export function formatLastBookkeepingTime(timestamp: string | null, now = new Date()): string {
  if (!timestamp) return '暂无记账'
  const value = new Date(timestamp)
  if (!Number.isFinite(value.getTime())) return '暂无记账'

  const time = `${pad2(value.getHours())}:${pad2(value.getMinutes())}`
  const dayDifference = localDayNumber(now) - localDayNumber(value)
  if (dayDifference === 0) return `最后记账：今天 ${time}`
  if (dayDifference === 1) return `最后记账：昨天 ${time}`
  if (value.getFullYear() === now.getFullYear()) {
    return `最后记账：${value.getMonth() + 1}月${value.getDate()}日 ${time}`
  }
  return `最后记账：${value.getFullYear()}年${value.getMonth() + 1}月${value.getDate()}日 ${time}`
}

export function findDuplicateTransactions(
  transactions: Transaction[],
  key: DuplicateTransactionKey,
  excludedId?: string | null,
): Transaction[] {
  return transactions
    .filter((transaction) =>
      !transaction.deletedAt &&
      transaction.id !== excludedId &&
      transaction.type === key.type &&
      transaction.amountMinor === key.amountMinor &&
      transaction.occurredLocalDate === key.occurredLocalDate,
    )
    .sort((left, right) =>
      `${right.occurredLocalDate}T${right.occurredLocalTime}`.localeCompare(
        `${left.occurredLocalDate}T${left.occurredLocalTime}`,
      ),
    )
}

function resolveMealSlot(
  categories: Category[],
  type: TransactionType,
  categoryId: string,
  subcategoryId: string | null,
): MealSlot | null {
  if (type !== 'expense' || !subcategoryId) return null
  const root = categories.find((category) =>
    !category.deletedAt && category.id === categoryId && category.parentId === null && category.type === 'expense',
  )
  if (root?.name !== '餐饮') return null
  const child = categories.find((category) =>
    !category.deletedAt && category.id === subcategoryId && category.parentId === root.id && category.type === 'expense',
  )
  if (!child) return null
  if (child.name === '早餐') return '早餐'
  if (child.name === '晚餐') return '晚餐'
  if (child.name === '正餐' || child.name === '午餐' || child.name === '中餐') return '正餐'
  return null
}

export function previewDuplicateTransactions(
  transactions: Transaction[],
  categories: Category[],
  key: DuplicateEntryKey,
  excludedId?: string | null,
): DuplicatePreview {
  const amountDuplicates = findDuplicateTransactions(transactions, key, excludedId)
  const mealSlot = resolveMealSlot(categories, key.type, key.categoryId, key.subcategoryId)
  const mealDuplicates = mealSlot
    ? transactions.filter((transaction) =>
        !transaction.deletedAt &&
        transaction.id !== excludedId &&
        transaction.type === 'expense' &&
        transaction.occurredLocalDate === key.occurredLocalDate &&
        resolveMealSlot(
          categories,
          transaction.type,
          transaction.categoryId,
          transaction.subcategoryId,
        ) === mealSlot,
      )
    : []
  const merged = new Map<string, Transaction>()
  for (const transaction of [...amountDuplicates, ...mealDuplicates]) merged.set(transaction.id, transaction)
  const mergedTransactions = [...merged.values()].sort((left, right) =>
    `${right.occurredLocalDate}T${right.occurredLocalTime}`.localeCompare(
      `${left.occurredLocalDate}T${left.occurredLocalTime}`,
    ),
  )
  return {
    transactions: mergedTransactions,
    amountDuplicateCount: amountDuplicates.length,
    mealSlot,
    mealDuplicateCount: mealDuplicates.length,
  }
}

function nextLocalCalendarDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return value

  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(year, month - 1, day)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return value
  date.setUTCDate(date.getUTCDate() + 1)
  const nextYear = date.getUTCFullYear()
  if (nextYear > 9999) return value
  return `${String(nextYear).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

export function nextDraftDateAfterAdd(transactions: Transaction[], savedDate: string): string {
  const activeCount = transactions.filter((transaction) =>
    !transaction.deletedAt && transaction.occurredLocalDate === savedDate,
  ).length
  return activeCount >= 3 ? nextLocalCalendarDate(savedDate) : savedDate
}

export function suggestSubcategory(
  categories: Category[],
  root: Category,
  amountMinor?: number,
): string | null {
  const children = categories
    .filter((category) =>
      category.parentId === root.id &&
      category.type === root.type &&
      category.status === 'active' &&
      !category.deletedAt,
    )
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'zh-CN'))
  const fallback = children[0]?.id ?? null
  if (root.type !== 'expense' || root.name !== '餐饮') return fallback
  if (amountMinor === undefined) return fallback

  const targetName = amountMinor <= 800 ? '早餐'
    : amountMinor <= 1300 ? '晚餐' : '正餐'
  return children.find((category) => category.name === targetName)?.id ?? fallback
}
