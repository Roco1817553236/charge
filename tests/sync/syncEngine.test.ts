import { describe, expect, it } from 'vitest'
import type { ConflictRecord, LedgerSnapshot, SyncMetadata } from '../../src/domain/models'
import { createEncryptedVault, decryptVault, type EncryptedVaultEnvelope } from '../../src/security/cryptoVault'
import {
  EtagConflictError,
  SyncEngine,
  type RemoteVaultFile,
  type SyncProvider,
  type SyncRepository,
} from '../../src/sync/syncEngine'

function snapshot(transactionIds: string[]): LedgerSnapshot {
  const now = '2026-08-14T00:00:00.000Z'
  return {
    schemaVersion: 1,
    exportedAt: now,
    transactions: transactionIds.map((id, index) => ({
      id, type: 'expense', amountMinor: 1000 + index, currency: 'CNY', categoryId: 'food', subcategoryId: null,
      occurredLocalDate: '2026-08-14', occurredLocalTime: '12:00', timeZone: 'Asia/Shanghai', note: `私密-${id}`,
      createdAt: now, updatedAt: now, revision: { counter: index + 2, deviceId: id.startsWith('remote') ? 'b' : 'a' },
    })),
    categories: [{
      id: 'food', type: 'expense', parentId: null, name: '餐饮', icon: '🍜', color: '#F97316', sortOrder: 0,
      isPinned: true, status: 'active', createdAt: now, updatedAt: now, revision: { counter: 1, deviceId: 'a' },
    }],
    settings: { id: 'book', currency: 'CNY', monthComparisonMode: 'to-date', updatedAt: now, revision: { counter: 1, deviceId: 'a' } },
    devices: [{ id: 'a', logicalCounter: 5 }],
  }
}

class MemoryRepository implements SyncRepository {
  metadata: SyncMetadata = { id: 'sync', pending: true, status: 'local' }
  applied?: LedgerSnapshot
  conflicts: ConflictRecord[] = []

  constructor(private value: LedgerSnapshot) {}
  async createSyncCheckpoint() {
    return { snapshot: this.value, generation: this.metadata.changeGeneration ?? 0 }
  }
  async applySyncedSnapshot(value: LedgerSnapshot, conflicts: ConflictRecord[]) {
    this.value = value
    this.applied = value
    this.conflicts = conflicts
    return { unresolvedConflicts: conflicts.filter((conflict) => !conflict.resolvedAt).length }
  }
  async completeSync(metadata: SyncMetadata) {
    this.metadata = metadata
    return { pending: metadata.pending }
  }
  async setSyncMetadata(metadata: SyncMetadata) { this.metadata = metadata }
  async getSyncMetadata() { return this.metadata }
}

class MemoryProvider implements SyncProvider {
  uploaded: Array<{ content: string; expectedEtag: string | null }> = []
  uploadAttempts = 0
  conflictOnce = false
  snapshots: string[] = []

  constructor(public remote: RemoteVaultFile | null) {}
  async download() { return this.remote }
  async upload(content: string, expectedEtag: string | null) {
    this.uploadAttempts += 1
    if (this.conflictOnce && this.uploadAttempts === 1) throw new EtagConflictError()
    this.uploaded.push({ content, expectedEtag })
    this.remote = { content, etag: `etag-${this.uploadAttempts}` }
    return { etag: this.remote.etag }
  }
  async createSnapshot(content: string) { this.snapshots.push(content) }
}

describe('SyncEngine', () => {
  it('creates an encrypted remote vault on first sync and returns a recovery key once', async () => {
    const repository = new MemoryRepository(snapshot(['local-1']))
    const provider = new MemoryProvider(null)
    const engine = new SyncEngine(repository, provider, {
      now: () => '2026-08-14T01:00:00.000Z', vaultIterations: 1_000, wait: async () => {},
    })

    const result = await engine.sync({ password: '这是一个足够长的同步密码' })

    expect(result.recoveryKey).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(provider.uploaded[0]?.content).not.toContain('私密-local-1')
    const envelope = JSON.parse(provider.uploaded[0]!.content) as EncryptedVaultEnvelope
    const decrypted = await decryptVault<LedgerSnapshot>(envelope, { password: '这是一个足够长的同步密码' })
    expect(decrypted.transactions[0]?.id).toBe('local-1')
    expect(repository.metadata.status).toBe('synced')
  })

  it('durably hands off the first recovery key before uploading the new vault', async () => {
    const repository = new MemoryRepository(snapshot(['local-1']))
    const events: string[] = []
    const provider = new MemoryProvider(null)
    const originalUpload = provider.upload.bind(provider)
    provider.upload = async (content, etag) => {
      events.push('upload')
      return originalUpload(content, etag)
    }
    const engine = new SyncEngine(repository, provider, {
      now: () => '2026-08-14T01:00:00.000Z', vaultIterations: 1_000,
      onRecoveryKey: async () => { events.push('saved-recovery') },
      onRecoveryKeyConfirmed: async () => { events.push('confirmed-recovery') },
    })

    await engine.sync({ password: '这是一个足够长的同步密码' })

    expect(events).toEqual(['saved-recovery', 'upload', 'confirmed-recovery'])
  })

  it('confirms the fingerprint-bound recovery key immediately after upload even if local apply fails', async () => {
    const repository = new MemoryRepository(snapshot(['local-1']))
    repository.applySyncedSnapshot = async () => { throw new Error('模拟上传后本地崩溃') }
    const provider = new MemoryProvider(null)
    const staged: Array<{ key: string; fingerprint: string }> = []
    const confirmed: string[] = []
    const engine = new SyncEngine(repository, provider, {
      now: () => '2026-08-14T01:00:00.000Z', vaultIterations: 1_000,
      onRecoveryKey: async (key, fingerprint) => { staged.push({ key, fingerprint }) },
      onRecoveryKeyConfirmed: async (fingerprint) => { confirmed.push(fingerprint) },
    })

    await expect(engine.sync({ password: '这是一个足够长的同步密码' })).rejects.toThrow('模拟上传后本地崩溃')

    expect(provider.remote).not.toBeNull()
    expect(staged).toHaveLength(1)
    expect(confirmed).toEqual([staged[0]!.fingerprint])
  })

  it('invalidates a staged recovery key when another device wins first-vault creation', async () => {
    const repository = new MemoryRepository(snapshot(['local-1']))
    const winner = await createEncryptedVault(snapshot(['remote-winner']), '这是一个足够长的同步密码', {
      iterations: 1_000,
    })
    const provider = new MemoryProvider(null)
    const originalUpload = provider.upload.bind(provider)
    provider.upload = async (content, etag) => {
      if (provider.uploadAttempts === 0) {
        provider.uploadAttempts += 1
        provider.remote = { content: JSON.stringify(winner.envelope), etag: 'etag-winner' }
        throw new EtagConflictError()
      }
      return originalUpload(content, etag)
    }
    const staged: Array<{ key: string; fingerprint: string }> = []
    const invalidated: string[] = []
    const engine = new SyncEngine(repository, provider, {
      now: () => '2026-08-14T01:00:00.000Z', vaultIterations: 1_000, wait: async () => {},
      onRecoveryKey: async (key, fingerprint) => { staged.push({ key, fingerprint }) },
      onRecoveryKeyInvalidated: async (fingerprint) => { invalidated.push(fingerprint) },
    })

    const result = await engine.sync({ password: '这是一个足够长的同步密码' })

    expect(staged).toHaveLength(1)
    expect(invalidated).toEqual([staged[0]!.fingerprint])
    expect(result.recoveryKey).toBeUndefined()
    expect(repository.applied?.transactions.map((item) => item.id).sort()).toEqual([
      'local-1',
      'remote-winner',
    ])
  })

  it('merges independent local and remote records before conditional upload', async () => {
    const remote = await createEncryptedVault(snapshot(['remote-1']), '这是一个足够长的同步密码', { iterations: 1_000 })
    const repository = new MemoryRepository(snapshot(['local-1']))
    const provider = new MemoryProvider({ content: JSON.stringify(remote.envelope), etag: 'etag-old' })
    const engine = new SyncEngine(repository, provider, {
      now: () => '2026-08-14T01:00:00.000Z', vaultIterations: 1_000, wait: async () => {},
    })

    await engine.sync({ password: '这是一个足够长的同步密码' })

    expect(repository.applied?.transactions.map((item) => item.id).sort()).toEqual(['local-1', 'remote-1'])
    expect(provider.uploaded[0]?.expectedEtag).toBe('etag-old')
    expect(provider.snapshots).toEqual([JSON.stringify(remote.envelope)])
  })

  it('never uploads or applies data when the sync password is wrong', async () => {
    const remote = await createEncryptedVault(snapshot(['remote-1']), '这是一个足够长的同步密码', { iterations: 1_000 })
    const repository = new MemoryRepository(snapshot(['local-1']))
    const provider = new MemoryProvider({ content: JSON.stringify(remote.envelope), etag: 'etag-old' })
    const observedFingerprints: string[] = []
    const engine = new SyncEngine(repository, provider, {
      vaultIterations: 1_000,
      wait: async () => {},
      onRemoteVault: async (fingerprint) => { observedFingerprints.push(fingerprint) },
    })

    await expect(engine.sync({ password: '完全错误但长度足够的密码' })).rejects.toThrow('无法解锁加密账本')
    expect(provider.uploaded).toHaveLength(0)
    expect(repository.applied).toBeUndefined()
    expect(repository.metadata.status).toBe('attention')
    expect(observedFingerprints).toEqual([])
  })

  it('deeply validates a decrypted remote ledger before observing its recovery fingerprint', async () => {
    const malformed = {
      ...snapshot(['remote-1']),
      settings: {
        ...snapshot([]).settings,
        revision: undefined,
      },
    }
    const remote = await createEncryptedVault(malformed, '这是一个足够长的同步密码', { iterations: 1_000 })
    const repository = new MemoryRepository(snapshot(['local-1']))
    const provider = new MemoryProvider({ content: JSON.stringify(remote.envelope), etag: 'etag-old' })
    const observedFingerprints: string[] = []
    const engine = new SyncEngine(repository, provider, {
      vaultIterations: 1_000,
      wait: async () => {},
      onRemoteVault: async (fingerprint) => { observedFingerprints.push(fingerprint) },
    })

    await expect(engine.sync({ password: '这是一个足够长的同步密码' })).rejects.toThrow('远端账本版本不受支持')
    expect(observedFingerprints).toEqual([])
    expect(provider.uploaded).toHaveLength(0)
    expect(repository.applied).toBeUndefined()
  })

  it('redownloads and retries after an ETag race', async () => {
    const remote = await createEncryptedVault(snapshot(['remote-1']), '这是一个足够长的同步密码', { iterations: 1_000 })
    const repository = new MemoryRepository(snapshot(['local-1']))
    const provider = new MemoryProvider({ content: JSON.stringify(remote.envelope), etag: 'etag-old' })
    provider.conflictOnce = true
    const waits: number[] = []
    const engine = new SyncEngine(repository, provider, {
      now: () => '2026-08-14T01:00:00.000Z', vaultIterations: 1_000, wait: async (milliseconds) => { waits.push(milliseconds) },
    })

    await engine.sync({ password: '这是一个足够长的同步密码' })
    expect(provider.uploadAttempts).toBe(2)
    expect(waits).toEqual([250])
  })

  it('retries transient OneDrive throttling using the server retry delay', async () => {
    const repository = new MemoryRepository(snapshot(['local-1']))
    const provider = new MemoryProvider(null)
    const download = provider.download.bind(provider)
    let attempts = 0
    provider.download = async () => {
      attempts += 1
      if (attempts === 1) throw Object.assign(new Error('限流'), { code: 'throttled', retryAfterSeconds: 2 })
      return download()
    }
    const waits: number[] = []
    const engine = new SyncEngine(repository, provider, {
      now: () => '2026-08-14T01:00:00.000Z', vaultIterations: 1_000,
      wait: async (milliseconds) => { waits.push(milliseconds) },
    })

    await engine.sync({ password: '这是一个足够长的同步密码' })

    expect(attempts).toBe(2)
    expect(waits).toEqual([2_000])
  })

  it('propagates a locally resolved conflict without reviving the remote unresolved marker', async () => {
    const local = snapshot(['shared'])
    const remote = snapshot(['shared'])
    local.transactions[0] = {
      ...local.transactions[0]!, note: '已选择版本',
      revision: { counter: 4, deviceId: 'a', clock: { a: 4, b: 3 } },
    }
    remote.transactions[0] = {
      ...remote.transactions[0]!, note: '远端旧版本', revision: { counter: 3, deviceId: 'b', clock: { b: 3 } },
    }
    const unresolved: ConflictRecord = {
      id: 'conflict-transaction-shared', entityType: 'transaction', entityId: 'shared',
      localValue: { ...local.transactions[0]!, note: '原本机版本', revision: { counter: 3, deviceId: 'a' } },
      remoteValue: remote.transactions[0]!, createdAt: '2026-08-14T00:30:00.000Z',
    }
    local.conflicts = [{ ...unresolved, resolvedAt: '2026-08-14T00:45:00.000Z' }]
    remote.conflicts = [unresolved]

    const encryptedRemote = await createEncryptedVault(remote, '这是一个足够长的同步密码', { iterations: 1_000 })
    const repository = new MemoryRepository(local)
    const provider = new MemoryProvider({ content: JSON.stringify(encryptedRemote.envelope), etag: 'etag-old' })
    const engine = new SyncEngine(repository, provider, {
      now: () => '2026-08-14T01:00:00.000Z', vaultIterations: 1_000, wait: async () => {},
    })

    const result = await engine.sync({ password: '这是一个足够长的同步密码' })

    expect(result.conflicts).toBe(0)
    expect(repository.conflicts[0]?.resolvedAt).toBe('2026-08-14T00:45:00.000Z')
    expect(repository.metadata.status).toBe('synced')
    const uploaded = await decryptVault<LedgerSnapshot>(
      JSON.parse(provider.uploaded[0]!.content) as EncryptedVaultEnvelope,
      { password: '这是一个足够长的同步密码' },
    )
    expect(uploaded.conflicts?.[0]?.resolvedAt).toBe('2026-08-14T00:45:00.000Z')
  })
})
