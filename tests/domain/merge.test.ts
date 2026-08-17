import { describe, expect, it } from 'vitest'
import type { Category, Transaction } from '../../src/domain/models'
import { compareRevision, mergeLedgerEntities } from '../../src/domain/merge'

function transaction(id: string, counter: number, deviceId: string, extra: Partial<Transaction> = {}): Transaction {
  return {
    id,
    type: 'expense',
    amountMinor: 1000,
    currency: 'CNY',
    categoryId: 'food',
    subcategoryId: null,
    occurredLocalDate: '2026-08-14',
    occurredLocalTime: '12:00',
    timeZone: 'Asia/Shanghai',
    note: '',
    createdAt: '2026-08-14T04:00:00.000Z',
    updatedAt: '2026-08-14T04:00:00.000Z',
    revision: { counter, deviceId },
    ...extra,
  }
}

describe('logical revisions', () => {
  it('orders vector-clock causality and treats independent device counters as concurrent', () => {
    expect(compareRevision(
      { counter: 4, deviceId: 'b', clock: { a: 8, b: 4 } },
      { counter: 8, deviceId: 'a', clock: { a: 8, b: 3 } },
    )).toBe('newer')
    expect(compareRevision({ counter: 2, deviceId: 'a' }, { counter: 1, deviceId: 'b' })).toBe('concurrent')
    expect(compareRevision({ counter: 1, deviceId: 'a' }, { counter: 2, deviceId: 'a' })).toBe('older')
    expect(compareRevision({ counter: 2, deviceId: 'a' }, { counter: 2, deviceId: 'a' })).toBe('equal')
    expect(compareRevision({ counter: 2, deviceId: 'a' }, { counter: 2, deviceId: 'b' })).toBe('concurrent')
  })

  it('detects unequal offline edits from two devices as concurrent', () => {
    const deviceA = { counter: 11, deviceId: 'a', clock: { a: 11, b: 5, c: 2 } }
    const deviceB = { counter: 6, deviceId: 'b', clock: { a: 10, b: 6, c: 2 } }

    expect(compareRevision(deviceA, deviceB)).toBe('concurrent')
    expect(compareRevision(deviceB, deviceA)).toBe('concurrent')
  })
})

describe('ledger merge', () => {
  it('unions independent records and selects a causally newer revision', () => {
    const local = [transaction('local-only', 1, 'a'), transaction('shared', 3, 'a', {
      note: 'newer', revision: { counter: 3, deviceId: 'a', clock: { a: 3, b: 2 } },
    })]
    const remote = [transaction('remote-only', 1, 'b'), transaction('shared', 2, 'b', {
      note: 'older', revision: { counter: 2, deviceId: 'b', clock: { a: 2, b: 2 } },
    })]

    const result = mergeLedgerEntities(local, remote, [] as Category[], [] as Category[], '2026-08-14T05:00:00.000Z')

    expect(result.transactions.map((item) => item.id).sort()).toEqual(['local-only', 'remote-only', 'shared'])
    expect(result.transactions.find((item) => item.id === 'shared')?.note).toBe('newer')
    expect(result.conflicts).toHaveLength(0)
  })

  it('records a conflict for concurrent edits and keeps both candidates', () => {
    const local = transaction('shared', 3, 'a', { note: '本机版本' })
    const remote = transaction('shared', 3, 'b', { note: '远端版本' })

    const result = mergeLedgerEntities([local], [remote], [], [], '2026-08-14T05:00:00.000Z')

    expect(result.transactions.find((item) => item.id === 'shared')?.note).toBe('本机版本')
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]?.localValue).toEqual(local)
    expect(result.conflicts[0]?.remoteValue).toEqual(remote)
  })

  it('uses a stable conflict identity for the same concurrent revisions across retries', () => {
    const first = transaction('shared', 3, 'a', { note: '本机版本' })
    const second = transaction('shared', 3, 'b', { note: '远端版本' })

    const initial = mergeLedgerEntities([first], [second], [], [], '2026-08-14T05:00:00.000Z')
    const retry = mergeLedgerEntities([second], [first], [], [], '2026-08-14T05:01:00.000Z')

    expect(initial.conflicts[0]?.id).toBe(retry.conflicts[0]?.id)
  })

  it('propagates a newer soft deletion', () => {
    const local = transaction('shared', 2, 'a', { revision: { counter: 2, deviceId: 'a', clock: { a: 2, b: 2 } } })
    const remote = transaction('shared', 3, 'b', {
      revision: { counter: 3, deviceId: 'b', clock: { a: 2, b: 3 } },
      deletedAt: '2026-08-14T05:00:00.000Z',
      deleteRevision: { counter: 3, deviceId: 'b', clock: { a: 2, b: 3 } },
    })

    const result = mergeLedgerEntities([local], [remote], [], [], '2026-08-14T05:00:00.000Z')
    expect(result.transactions[0]?.deletedAt).toBeTruthy()
    expect(result.conflicts).toHaveLength(0)
  })

  it('creates a conflict for an offline edit racing an unequal-counter deletion', () => {
    const edited = transaction('shared', 11, 'a', {
      note: '离线编辑', revision: { counter: 11, deviceId: 'a', clock: { a: 11, b: 5 } },
    })
    const deleted = transaction('shared', 6, 'b', {
      revision: { counter: 6, deviceId: 'b', clock: { a: 10, b: 6 } },
      deletedAt: '2026-08-14T05:00:00.000Z',
      deleteRevision: { counter: 6, deviceId: 'b', clock: { a: 10, b: 6 } },
    })

    const result = mergeLedgerEntities([edited], [deleted], [], [], '2026-08-14T05:00:00.000Z')
    expect(result.conflicts).toHaveLength(1)
  })
})
