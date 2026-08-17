export type TransactionType = 'expense' | 'income'

export interface Revision {
  counter: number
  deviceId: string
  clock?: Record<string, number>
}

export interface Transaction {
  id: string
  type: TransactionType
  amountMinor: number
  currency: 'CNY'
  categoryId: string
  subcategoryId: string | null
  occurredLocalDate: string
  occurredLocalTime: string
  timeZone: string
  note: string
  createdAt: string
  updatedAt: string
  revision: Revision
  deletedAt?: string
  deleteRevision?: Revision
}

export type CategoryStatus = 'active' | 'archived'

export interface Category {
  id: string
  type: TransactionType
  parentId: string | null
  name: string
  icon: string
  color: string
  sortOrder: number
  isPinned: boolean
  status: CategoryStatus
  revision: Revision
  createdAt: string
  updatedAt: string
  isSystemDefault?: boolean
  deletedAt?: string
  deleteRevision?: Revision
}

export interface BookSettings {
  id: 'book'
  currency: 'CNY'
  monthComparisonMode: 'to-date' | 'full-month'
  revision: Revision
  bookEpoch?: Revision
  updatedAt: string
}

export interface DeviceState {
  id: string
  logicalCounter: number
  lastSyncAt?: string
  retiredAt?: string
}

export interface SyncMetadata {
  id: 'sync'
  remoteEtag?: string
  lastSuccessAt?: string
  changeGeneration?: number
  pending: boolean
  status: 'local' | 'syncing' | 'synced' | 'attention'
  message?: string
}

export interface ConflictRecord {
  id: string
  entityType: 'transaction' | 'category'
  entityId: string
  localValue: Transaction | Category
  remoteValue: Transaction | Category
  createdAt: string
  resolvedAt?: string
}

export interface LedgerSnapshot {
  schemaVersion: number
  exportedAt: string
  transactions: Transaction[]
  categories: Category[]
  settings: BookSettings
  devices: DeviceState[]
  conflicts?: ConflictRecord[]
}
