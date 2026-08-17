import { describe, expect, it } from 'vitest'
import type { LedgerSnapshot } from '../../src/domain/models'
import {
  exportEncryptedBackup,
  exportLedgerCsv,
  exportPlainJson,
  importEncryptedBackup,
  parsePlainJson,
} from '../../src/services/importExport'

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
  it('creates an Excel-readable UTF-8 CSV with category names and escaped notes', () => {
    const csv = exportLedgerCsv(snapshot)
    expect(csv.startsWith('\uFEFF日期,时间,类型,金额（元）,大类,二级分类,备注')).toBe(true)
    expect(csv).toContain('2026-08-14,12:30,支出,58.00,餐饮,正餐,"午饭,""套餐"""')
  })

  it('neutralizes spreadsheet formulas in user-authored CSV cells', () => {
    const dangerous = {
      ...snapshot,
      transactions: [{ ...snapshot.transactions[0]!, note: '=HYPERLINK("https://example.test")' }],
    }

    const csv = exportLedgerCsv(dangerous)

    expect(csv).toContain('"\'=HYPERLINK(""https://example.test"")"')
    expect(csv).not.toContain(',"=HYPERLINK')
  })

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
})
