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
