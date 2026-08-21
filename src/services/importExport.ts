import type {
  BookSettings,
  Category,
  ConflictRecord,
  DeviceState,
  ItemCategory,
  ItemCost,
  LedgerSnapshot,
  OwnedItem,
  Revision,
  Transaction,
} from '../domain/models'
import {
  createEncryptedVault,
  decryptVault,
  type EncryptedVaultEnvelope,
} from '../security/cryptoVault'

export const MAX_BACKUP_FILE_BYTES = 16 * 1024 * 1024
const utf8Encoder = new TextEncoder()

function exceedsBackupFileLimit(content: string): boolean {
  return utf8Encoder.encode(content).byteLength > MAX_BACKUP_FILE_BYTES
}

export function exportPlainJson(snapshot: LedgerSnapshot): string {
  return JSON.stringify(snapshot, null, 2)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isRevision(value: unknown): value is Revision {
  if (!isRecord(value) || !Number.isSafeInteger(value.counter) || Number(value.counter) < 0 ||
    typeof value.deviceId !== 'string' || value.deviceId.length === 0) return false
  if (value.clock === undefined) return true
  return isRecord(value.clock) && Object.values(value.clock).every(
    (counter) => Number.isSafeInteger(counter) && Number(counter) >= 0,
  )
}

function isValidLocalDate(value: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)?.slice(1).map(Number)
  if (!parts) return false
  const [year, month, day] = parts
  if (!year || year < 1 || year > 9999 || !month || month < 1 || month > 12 || !day) return false
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function isValidLocalTime(value: string): boolean {
  const parts = /^(\d{2}):(\d{2})$/.exec(value)?.slice(1).map(Number)
  return Boolean(parts && parts[0]! <= 23 && parts[1]! <= 59)
}

function isTransaction(value: unknown): value is Transaction {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && (value.type === 'expense' || value.type === 'income') &&
    Number.isSafeInteger(value.amountMinor) && Number(value.amountMinor) > 0 && value.currency === 'CNY' &&
    typeof value.categoryId === 'string' && (value.subcategoryId === null || typeof value.subcategoryId === 'string') &&
    typeof value.occurredLocalDate === 'string' && isValidLocalDate(value.occurredLocalDate) &&
    typeof value.occurredLocalTime === 'string' && isValidLocalTime(value.occurredLocalTime) &&
    typeof value.timeZone === 'string' && typeof value.note === 'string' && [...value.note].length <= 500 &&
    typeof value.createdAt === 'string' && typeof value.updatedAt === 'string' && isRevision(value.revision) &&
    (value.deletedAt === undefined || typeof value.deletedAt === 'string') &&
    (value.deleteRevision === undefined || isRevision(value.deleteRevision))
}

function isCategory(value: unknown): value is Category {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && (value.type === 'expense' || value.type === 'income') &&
    (value.parentId === null || typeof value.parentId === 'string') && typeof value.name === 'string' &&
    typeof value.icon === 'string' && typeof value.color === 'string' && Number.isSafeInteger(value.sortOrder) &&
    typeof value.isPinned === 'boolean' && (value.status === 'active' || value.status === 'archived') &&
    isRevision(value.revision) && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string' &&
    (value.isSystemDefault === undefined || typeof value.isSystemDefault === 'boolean') &&
    (value.deletedAt === undefined || typeof value.deletedAt === 'string') &&
    (value.deleteRevision === undefined || isRevision(value.deleteRevision))
}

function isItemCategory(value: unknown): value is ItemCategory {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && typeof value.name === 'string' && [...value.name].length <= 40 &&
    typeof value.icon === 'string' && typeof value.color === 'string' && Number.isSafeInteger(value.sortOrder) &&
    (value.status === 'active' || value.status === 'archived') && isRevision(value.revision) &&
    typeof value.createdAt === 'string' && typeof value.updatedAt === 'string' &&
    (value.isSystemDefault === undefined || typeof value.isSystemDefault === 'boolean') &&
    (value.deletedAt === undefined || typeof value.deletedAt === 'string') &&
    (value.deleteRevision === undefined || isRevision(value.deleteRevision))
}

function isOwnedItem(value: unknown): value is OwnedItem {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && typeof value.categoryId === 'string' &&
    typeof value.name === 'string' && [...value.name].length > 0 && [...value.name].length <= 100 &&
    typeof value.icon === 'string' && typeof value.note === 'string' && [...value.note].length <= 500 &&
    Number.isSafeInteger(value.purchaseAmountMinor) && Number(value.purchaseAmountMinor) >= 0 &&
    typeof value.purchaseLocalDate === 'string' && isValidLocalDate(value.purchaseLocalDate) &&
    typeof value.startedLocalDate === 'string' && isValidLocalDate(value.startedLocalDate) &&
    value.purchaseLocalDate <= value.startedLocalDate &&
    (value.retiredLocalDate === undefined || (
      typeof value.retiredLocalDate === 'string' && isValidLocalDate(value.retiredLocalDate) &&
      value.retiredLocalDate >= value.startedLocalDate
    )) &&
    (value.sourceTransactionId === null || typeof value.sourceTransactionId === 'string') &&
    isRevision(value.revision) && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string' &&
    (value.deletedAt === undefined || typeof value.deletedAt === 'string') &&
    (value.deleteRevision === undefined || isRevision(value.deleteRevision))
}

function isItemCost(value: unknown): value is ItemCost {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && typeof value.itemId === 'string' &&
    (value.type === 'repair' || value.type === 'accessory') &&
    Number.isSafeInteger(value.amountMinor) && Number(value.amountMinor) > 0 &&
    typeof value.occurredLocalDate === 'string' && isValidLocalDate(value.occurredLocalDate) &&
    typeof value.note === 'string' && [...value.note].length <= 500 &&
    (value.sourceTransactionId === null || typeof value.sourceTransactionId === 'string') &&
    isRevision(value.revision) && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string' &&
    (value.deletedAt === undefined || typeof value.deletedAt === 'string') &&
    (value.deleteRevision === undefined || isRevision(value.deleteRevision))
}

function isSettings(value: unknown): value is BookSettings {
  return isRecord(value) && value.id === 'book' && value.currency === 'CNY' &&
    (value.monthComparisonMode === 'to-date' || value.monthComparisonMode === 'full-month') &&
    isRevision(value.revision) && (value.bookEpoch === undefined || isRevision(value.bookEpoch)) &&
    typeof value.updatedAt === 'string'
}

function isDeviceState(value: unknown): value is DeviceState {
  return isRecord(value) && typeof value.id === 'string' && Number.isSafeInteger(value.logicalCounter) &&
    Number(value.logicalCounter) >= 0 && (value.lastSyncAt === undefined || typeof value.lastSyncAt === 'string') &&
    (value.retiredAt === undefined || typeof value.retiredAt === 'string')
}

function isConflict(value: unknown): value is ConflictRecord {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.entityId !== 'string' ||
    typeof value.createdAt !== 'string' || (value.resolvedAt !== undefined && typeof value.resolvedAt !== 'string')) return false
  if (value.entityType === 'transaction') return isTransaction(value.localValue) && isTransaction(value.remoteValue)
  if (value.entityType === 'category') return isCategory(value.localValue) && isCategory(value.remoteValue)
  return false
}

export function isLedgerSnapshot(value: unknown): value is LedgerSnapshot {
  if (!isRecord(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2) || typeof value.exportedAt !== 'string') return false
  if (!Array.isArray(value.transactions) || !value.transactions.every(isTransaction)) return false
  if (!Array.isArray(value.categories) || !value.categories.every(isCategory)) return false
  if (!Array.isArray(value.devices) || !value.devices.every(isDeviceState) || !isSettings(value.settings)) return false
  if (value.conflicts !== undefined && (!Array.isArray(value.conflicts) || !value.conflicts.every(isConflict))) return false

  const transactions = value.transactions as Transaction[]
  const categories = value.categories as Category[]
  const devices = value.devices as DeviceState[]
  if (new Set(transactions.map((item) => item.id)).size !== transactions.length) return false
  if (new Set(categories.map((item) => item.id)).size !== categories.length) return false
  if (new Set(devices.map((item) => item.id)).size !== devices.length) return false
  const categoryMap = new Map(categories.map((item) => [item.id, item]))
  if (categories.some((category) => {
    if (category.parentId === null) return false
    const parent = categoryMap.get(category.parentId)
    return !parent || parent.parentId !== null || parent.type !== category.type
  })) return false
  if (transactions.some((transaction) => {
    const root = categoryMap.get(transaction.categoryId)
    if (!root || root.parentId !== null || root.type !== transaction.type) return true
    if (!transaction.subcategoryId) return false
    const child = categoryMap.get(transaction.subcategoryId)
    return !child || child.parentId !== root.id || child.type !== transaction.type
  })) return false
  if (value.schemaVersion === 1) {
    return value.itemCategories === undefined && value.items === undefined && value.itemCosts === undefined
  }

  if (!Array.isArray(value.itemCategories) || !value.itemCategories.every(isItemCategory)) return false
  if (!Array.isArray(value.items) || !value.items.every(isOwnedItem)) return false
  if (!Array.isArray(value.itemCosts) || !value.itemCosts.every(isItemCost)) return false
  const itemCategories = value.itemCategories as ItemCategory[]
  const items = value.items as OwnedItem[]
  const itemCosts = value.itemCosts as ItemCost[]
  if (new Set(itemCategories.map((item) => item.id)).size !== itemCategories.length) return false
  if (new Set(items.map((item) => item.id)).size !== items.length) return false
  if (new Set(itemCosts.map((item) => item.id)).size !== itemCosts.length) return false
  const itemCategoryIds = new Set(itemCategories.filter((item) => !item.deletedAt).map((item) => item.id))
  const itemMap = new Map(items.map((item) => [item.id, item]))
  const transactionMap = new Map(transactions.map((item) => [item.id, item]))
  if (items.some((item) => {
    if (!itemCategoryIds.has(item.categoryId)) return true
    if (!item.sourceTransactionId) return false
    return transactionMap.get(item.sourceTransactionId)?.type !== 'expense'
  })) return false
  if (itemCosts.some((cost) => {
    const item = itemMap.get(cost.itemId)
    if (!item || cost.occurredLocalDate < item.purchaseLocalDate ||
      (item.retiredLocalDate && cost.occurredLocalDate > item.retiredLocalDate)) return true
    if (!cost.sourceTransactionId) return false
    return transactionMap.get(cost.sourceTransactionId)?.type !== 'expense'
  })) return false
  if (items.some((item) => {
    let total = item.purchaseAmountMinor
    for (const cost of itemCosts) {
      if (cost.itemId !== item.id || cost.deletedAt) continue
      total += cost.amountMinor
      if (!Number.isSafeInteger(total)) return true
    }
    return false
  })) return false
  return true
}

export function parsePlainJson(content: string): LedgerSnapshot {
  try {
    if (exceedsBackupFileLimit(content)) throw new Error('oversized')
    const parsed: unknown = JSON.parse(content)
    if (!isLedgerSnapshot(parsed)) throw new Error('invalid')
    return parsed
  } catch {
    throw new Error('备份文件格式无效或版本不受支持')
  }
}

export async function exportEncryptedBackup(
  snapshot: LedgerSnapshot,
  password: string,
  options: { iterations?: number } = {},
): Promise<{ fileContent: string; recoveryKey: string }> {
  const { envelope, recoveryKey } = await createEncryptedVault(snapshot, password, options)
  return { fileContent: JSON.stringify(envelope, null, 2), recoveryKey }
}

export async function importEncryptedBackup(
  content: string,
  method: { password: string } | { recoveryKey: string },
): Promise<LedgerSnapshot> {
  let envelope: EncryptedVaultEnvelope
  try {
    if (exceedsBackupFileLimit(content)) throw new Error('oversized')
    envelope = JSON.parse(content) as EncryptedVaultEnvelope
  } catch {
    throw new Error('加密备份文件格式无效')
  }
  const snapshot = await decryptVault<unknown>(envelope, method)
  if (!isLedgerSnapshot(snapshot)) throw new Error('备份文件格式无效或版本不受支持')
  return snapshot
}
