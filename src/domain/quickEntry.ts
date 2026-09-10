import type { Category, Transaction, TransactionType } from './models'

export interface DuplicateTransactionKey {
  type: TransactionType
  amountMinor: number
  occurredLocalDate: string
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

  const targetName = amountMinor === undefined || amountMinor <= 800
    ? '早餐'
    : amountMinor <= 1300 ? '晚餐' : '正餐'
  return children.find((category) => category.name === targetName)?.id ?? fallback
}
