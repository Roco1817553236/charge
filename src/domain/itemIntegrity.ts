import type { LedgerSnapshot } from './models'

export function isItemSnapshotIntegrityValid(snapshot: LedgerSnapshot): boolean {
  if (snapshot.schemaVersion < 2) return true
  if (!snapshot.itemCategories || !snapshot.items || !snapshot.itemCosts) return false

  const categoryIds = new Set(snapshot.itemCategories.filter((item) => !item.deletedAt).map((item) => item.id))
  const itemMap = new Map(snapshot.items.map((item) => [item.id, item]))
  const transactionMap = new Map(snapshot.transactions.map((item) => [item.id, item]))

  for (const item of snapshot.items) {
    if (!categoryIds.has(item.categoryId)) return false
    if (item.sourceTransactionId && transactionMap.get(item.sourceTransactionId)?.type !== 'expense') return false
  }

  for (const cost of snapshot.itemCosts) {
    const item = itemMap.get(cost.itemId)
    if (!item || cost.occurredLocalDate < item.purchaseLocalDate ||
      (item.retiredLocalDate && cost.occurredLocalDate > item.retiredLocalDate)) return false
    if (cost.sourceTransactionId && transactionMap.get(cost.sourceTransactionId)?.type !== 'expense') return false
  }

  for (const item of snapshot.items) {
    let total = item.purchaseAmountMinor
    for (const cost of snapshot.itemCosts) {
      if (cost.itemId !== item.id || cost.deletedAt) continue
      total += cost.amountMinor
      if (!Number.isSafeInteger(total)) return false
    }
  }
  return true
}

export function assertItemSnapshotIntegrity(snapshot: LedgerSnapshot, message: string): void {
  if (!isItemSnapshotIntegrityValid(snapshot)) throw new Error(message)
}
