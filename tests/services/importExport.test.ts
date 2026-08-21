import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LedgerSnapshot } from '../../src/domain/models'
import {
  exportEncryptedBackup,
  exportPlainJson,
  importEncryptedBackup,
  MAX_BACKUP_FILE_BYTES,
  parsePlainJson,
} from '../../src/services/importExport'

const v12PlainFixture = readFileSync(resolve(process.cwd(), 'tests/fixtures/v1.2-ledger-plain.json'), 'utf8')
const v12EncryptedFixture = readFileSync(resolve(process.cwd(), 'tests/fixtures/v1.2-ledger-encrypted.json'), 'utf8')
const v12Expected = JSON.parse(v12PlainFixture) as LedgerSnapshot
const v12Password = '  v1.2 backup password  '
const v12RecoveryKey = '2V1aFPEec3EK9N08n5ZHAsaznhP33nqln4ppvaijq70'
const encoder = new TextEncoder()

const snapshot: LedgerSnapshot = {
  schemaVersion: 1,
  exportedAt: '2026-08-14T00:00:00.000Z',
  transactions: [{
    id: 'tx-1', type: 'expense', amountMinor: 5800, currency: 'CNY', categoryId: 'food', subcategoryId: 'lunch',
    occurredLocalDate: '2026-08-14', occurredLocalTime: '12:30', timeZone: 'Asia/Shanghai', note: '午饭,"套餐"',
    createdAt: '2026-08-14T04:30:00.000Z', updatedAt: '2026-08-14T04:30:00.000Z',
    revision: { counter: 1, deviceId: 'a' },
  }],
  categories: [
    { id: 'food', type: 'expense', parentId: null, name: '餐饮', icon: '🍜', color: '#F97316', sortOrder: 0,
      isPinned: true, status: 'active', createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z',
      revision: { counter: 1, deviceId: 'a' } },
    { id: 'lunch', type: 'expense', parentId: 'food', name: '正餐', icon: '🍜', color: '#F97316', sortOrder: 0,
      isPinned: false, status: 'active', createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z',
      revision: { counter: 2, deviceId: 'a' } },
  ],
  settings: { id: 'book', currency: 'CNY', monthComparisonMode: 'to-date', updatedAt: '2026-08-14T00:00:00.000Z', revision: { counter: 2, deviceId: 'a' } },
  devices: [{ id: 'a', logicalCounter: 2 }],
}

const itemSnapshot: LedgerSnapshot = {
  ...snapshot,
  schemaVersion: 2,
  itemCategories: [{
    id: 'digital', name: '数码', icon: '💻', color: '#6366F1', sortOrder: 0, status: 'active',
    revision: { counter: 3, deviceId: 'a' }, createdAt: snapshot.exportedAt, updatedAt: snapshot.exportedAt,
  }],
  items: [{
    id: 'phone', categoryId: 'digital', name: '手机', icon: '📱', note: '', purchaseAmountMinor: 629_900,
    purchaseLocalDate: '2026-08-01', startedLocalDate: '2026-08-01', sourceTransactionId: 'tx-1',
    revision: { counter: 4, deviceId: 'a' }, createdAt: snapshot.exportedAt, updatedAt: snapshot.exportedAt,
  }],
  itemCosts: [{
    id: 'battery', itemId: 'phone', type: 'repair', amountMinor: 49_900, occurredLocalDate: '2026-08-10',
    note: '换电池', sourceTransactionId: null, revision: { counter: 5, deviceId: 'a' },
    createdAt: snapshot.exportedAt, updatedAt: snapshot.exportedAt,
  }],
}

describe('import and export', () => {
  it('round-trips a plain portable JSON backup after schema validation', () => {
    expect(parsePlainJson(exportPlainJson(snapshot))).toEqual(snapshot)
    expect(() => parsePlainJson('{"schemaVersion":99}')).toThrow('备份文件格式无效或版本不受支持')
  })

  it('rejects a structurally plausible backup with malformed ledger entities', () => {
    const malformed = JSON.parse(exportPlainJson(snapshot)) as Record<string, unknown>
    malformed.transactions = [{ ...snapshot.transactions[0]!, amountMinor: '58.00' }]

    expect(() => parsePlainJson(JSON.stringify(malformed))).toThrow('备份文件格式无效或版本不受支持')
  })

  it('rejects impossible dates and broken category references in imported backups', () => {
    const impossibleDate = {
      ...snapshot,
      transactions: [{ ...snapshot.transactions[0]!, occurredLocalDate: '2026-02-31' }],
    }
    const missingCategory = {
      ...snapshot,
      transactions: [{ ...snapshot.transactions[0]!, categoryId: 'missing', subcategoryId: null }],
    }

    expect(() => parsePlainJson(JSON.stringify(impossibleDate))).toThrow('备份文件格式无效或版本不受支持')
    expect(() => parsePlainJson(JSON.stringify(missingCategory))).toThrow('备份文件格式无效或版本不受支持')
  })

  it('round-trips the default encrypted JSON backup', async () => {
    const backup = await exportEncryptedBackup(snapshot, '足够长的备份同步密码', { iterations: 1_000 })
    expect(backup.fileContent).not.toContain('午饭')
    await expect(importEncryptedBackup(backup.fileContent, { password: '足够长的备份同步密码' })).resolves.toEqual(snapshot)
  })

  it('round-trips schema v2 item data in plain and encrypted backups', async () => {
    expect(parsePlainJson(exportPlainJson(itemSnapshot))).toEqual(itemSnapshot)
    const backup = await exportEncryptedBackup(itemSnapshot, '物品备份测试密码足够长', { iterations: 1_000 })
    await expect(importEncryptedBackup(backup.fileContent, { password: '物品备份测试密码足够长' })).resolves.toEqual(itemSnapshot)
  })

  it('rejects broken item category and item-cost references', () => {
    const missingItemCategory = {
      ...itemSnapshot,
      items: [{ ...itemSnapshot.items![0]!, categoryId: 'missing' }],
    }
    const missingItem = {
      ...itemSnapshot,
      itemCosts: [{ ...itemSnapshot.itemCosts![0]!, itemId: 'missing' }],
    }

    expect(() => parsePlainJson(JSON.stringify(missingItemCategory))).toThrow('备份文件格式无效或版本不受支持')
    expect(() => parsePlainJson(JSON.stringify(missingItem))).toThrow('备份文件格式无效或版本不受支持')

    const deletedCategory = {
      ...itemSnapshot,
      itemCategories: [{
        ...itemSnapshot.itemCategories![0]!, deletedAt: itemSnapshot.exportedAt,
        deleteRevision: itemSnapshot.itemCategories![0]!.revision,
      }],
    }
    expect(() => parsePlainJson(JSON.stringify(deletedCategory))).toThrow('备份文件格式无效或版本不受支持')

    const unsafeTotal = {
      ...itemSnapshot,
      items: [{ ...itemSnapshot.items![0]!, purchaseAmountMinor: Number.MAX_SAFE_INTEGER - 10 }],
      itemCosts: [{ ...itemSnapshot.itemCosts![0]!, amountMinor: 20 }],
    }
    expect(() => parsePlainJson(JSON.stringify(unsafeTotal))).toThrow('备份文件格式无效或版本不受支持')
  })

  it('imports fixed v1.2 plain and encrypted backups without dropping legacy data', async () => {
    expect(parsePlainJson(v12PlainFixture)).toEqual(v12Expected)
    await expect(importEncryptedBackup(v12EncryptedFixture, { password: v12Password })).resolves.toEqual(v12Expected)
    await expect(importEncryptedBackup(v12EncryptedFixture, { recoveryKey: v12RecoveryKey })).resolves.toEqual(v12Expected)

    const restored = await importEncryptedBackup(v12EncryptedFixture, { recoveryKey: v12RecoveryKey })
    expect(restored.transactions[0]?.note).toBe('v1.2 中餐午饭')
    expect(restored.categories.map((category) => category.name)).toEqual(['餐饮', '中餐'])
    expect(restored.conflicts?.[0]?.entityId).toBe('legacy-tx-lunch')
    expect(restored.devices.map((device) => device.id)).toEqual(['legacy-phone', 'legacy-pc'])
    expect(restored.settings.monthComparisonMode).toBe('full-month')
  })

  it.each(['外卖', '晚餐'])('preserves the imported food subcategory name %s exactly', (subcategoryName) => {
    const portableSnapshot: LedgerSnapshot = {
      ...snapshot,
      categories: snapshot.categories.map((item) =>
        item.id === 'lunch' ? { ...item, name: subcategoryName } : item,
      ),
    }

    const restored = parsePlainJson(exportPlainJson(portableSnapshot))

    expect(restored.categories.find((item) => item.id === 'lunch')?.name).toBe(subcategoryName)
  })

  it('accepts a plain backup at exactly 16 MiB of UTF-8 and rejects content above the limit', () => {
    const fixtureBytes = encoder.encode(v12PlainFixture).byteLength
    const exactLimit = v12PlainFixture + ' '.repeat(MAX_BACKUP_FILE_BYTES - fixtureBytes)
    expect(encoder.encode(exactLimit)).toHaveLength(MAX_BACKUP_FILE_BYTES)
    expect(parsePlainJson(exactLimit)).toEqual(v12Expected)
    expect(() => parsePlainJson(`${exactLimit} `)).toThrow('备份文件格式无效或版本不受支持')
  })

  it('rejects encrypted backup content above the 16 MiB limit before decrypting', async () => {
    const fixtureBytes = encoder.encode(v12EncryptedFixture).byteLength
    const oversized = v12EncryptedFixture + ' '.repeat(MAX_BACKUP_FILE_BYTES - fixtureBytes + 1)
    await expect(importEncryptedBackup(oversized, { password: v12Password })).rejects.toThrow('加密备份文件格式无效')
  })
})
