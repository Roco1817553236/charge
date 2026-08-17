import type {
  BookSettings,
  Category,
  ConflictRecord,
  DeviceState,
  LedgerSnapshot,
  Revision,
  Transaction,
} from '../domain/models'
import {
  createEncryptedVault,
  decryptVault,
  type EncryptedVaultEnvelope,
} from '../security/cryptoVault'

export const MAX_BACKUP_FILE_BYTES = 16 * 1024 * 1024

function csvCell(value: string): string {
  const safeValue = /^[\s\u0000-\u001F]*[=+@-]/u.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safeValue) ? `"${safeValue.replaceAll('"', '""')}"` : safeValue
}

function resolvedCategories(
  categoryMap: Map<string, Category>,
  categoryId: string,
  subcategoryId: string | null,
): { root: Category | undefined; child: Category | undefined } {
  const child = subcategoryId ? categoryMap.get(subcategoryId) : undefined
  const root = categoryMap.get(child?.parentId ?? categoryId)
  return { root, child }
}

export function exportLedgerCsv(snapshot: LedgerSnapshot): string {
  const categoryMap = new Map(snapshot.categories.map((category) => [category.id, category]))
  const header = ['日期', '时间', '类型', '金额（元）', '大类', '二级分类', '备注']
  const rows = snapshot.transactions
    .filter((transaction) => !transaction.deletedAt)
    .sort((left, right) =>
      `${left.occurredLocalDate}T${left.occurredLocalTime}`.localeCompare(
        `${right.occurredLocalDate}T${right.occurredLocalTime}`,
      ),
    )
    .map((transaction) => {
      const { root, child } = resolvedCategories(categoryMap, transaction.categoryId, transaction.subcategoryId)
      return [
        transaction.occurredLocalDate,
        transaction.occurredLocalTime,
        transaction.type === 'expense' ? '支出' : '收入',
        (transaction.amountMinor / 100).toFixed(2),
        root?.name ?? '未知分类',
        child?.name ?? '',
        transaction.note,
      ].map(csvCell).join(',')
    })
  return `\uFEFF${header.join(',')}\r\n${rows.join('\r\n')}`
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
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.exportedAt !== 'string') return false
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
  return true
}

export function parsePlainJson(content: string): LedgerSnapshot {
  try {
    if (content.length > MAX_BACKUP_FILE_BYTES) throw new Error('oversized')
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
    if (content.length > MAX_BACKUP_FILE_BYTES) throw new Error('oversized')
    envelope = JSON.parse(content) as EncryptedVaultEnvelope
  } catch {
    throw new Error('加密备份文件格式无效')
  }
  const snapshot = await decryptVault<unknown>(envelope, method)
  if (!isLedgerSnapshot(snapshot)) throw new Error('备份文件格式无效或版本不受支持')
  return snapshot
}
