import type { ConflictRecord, LedgerSnapshot, SyncMetadata } from '../domain/models'
import { mergeSnapshots } from '../domain/snapshots'
import { isLedgerSnapshot } from '../services/importExport'
import {
  createEncryptedVault,
  decryptVaultWithSession,
  openEncryptedVault,
  updateEncryptedVaultWithSession,
  vaultRecoveryFingerprint,
  type EncryptedVaultEnvelope,
  type UnlockMethod,
  type VaultUnlockSession,
} from '../security/cryptoVault'

export interface RemoteVaultFile {
  content: string
  etag: string
}

export interface SyncProvider {
  download(): Promise<RemoteVaultFile | null>
  upload(content: string, expectedEtag: string | null): Promise<{ etag: string }>
  createSnapshot?(content: string, timestamp: string): Promise<void>
}

export interface SyncRepository {
  createSyncCheckpoint(): Promise<{ snapshot: LedgerSnapshot; generation: number }>
  applySyncedSnapshot(
    snapshot: LedgerSnapshot,
    conflicts: ConflictRecord[],
    checkpoint?: LedgerSnapshot,
  ): Promise<{ unresolvedConflicts: number }>
  completeSync(metadata: SyncMetadata, expectedGeneration: number): Promise<{ pending: boolean }>
  getSyncMetadata(): Promise<SyncMetadata>
  setSyncMetadata(metadata: SyncMetadata): Promise<void>
}

interface SyncEngineOptions {
  now?: () => string
  wait?: (milliseconds: number) => Promise<void>
  vaultIterations?: number
  maxAttempts?: number
  onRecoveryKey?: (recoveryKey: string, vaultFingerprint: string) => void | Promise<void>
  onRecoveryKeyConfirmed?: (vaultFingerprint: string) => void | Promise<void>
  onRecoveryKeyInvalidated?: (vaultFingerprint: string) => void | Promise<void>
  onRemoteVault?: (vaultFingerprint: string) => void | Promise<void>
}

export type SyncUnlockMethod = UnlockMethod | { session: VaultUnlockSession }
const MAX_REMOTE_VAULT_CHARACTERS = 16 * 1024 * 1024

export class EtagConflictError extends Error {
  constructor() {
    super('远端账本已更新')
    this.name = 'EtagConflictError'
  }
}

export class SyncEngine {
  private readonly now: () => string
  private readonly wait: (milliseconds: number) => Promise<void>
  private readonly vaultIterations: number | undefined
  private readonly maxAttempts: number
  private readonly onRecoveryKey: ((recoveryKey: string, vaultFingerprint: string) => void | Promise<void>) | undefined
  private readonly onRecoveryKeyConfirmed: ((vaultFingerprint: string) => void | Promise<void>) | undefined
  private readonly onRecoveryKeyInvalidated: ((vaultFingerprint: string) => void | Promise<void>) | undefined
  private readonly onRemoteVault: ((vaultFingerprint: string) => void | Promise<void>) | undefined

  constructor(
    private readonly repository: SyncRepository,
    private readonly provider: SyncProvider,
    options: SyncEngineOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    this.vaultIterations = options.vaultIterations
    this.maxAttempts = options.maxAttempts ?? 3
    this.onRecoveryKey = options.onRecoveryKey
    this.onRecoveryKeyConfirmed = options.onRecoveryKeyConfirmed
    this.onRecoveryKeyInvalidated = options.onRecoveryKeyInvalidated
    this.onRemoteVault = options.onRemoteVault
  }

  async sync(
    method: SyncUnlockMethod,
  ): Promise<{
    recoveryKey?: string
    recoveryFingerprint?: string
    conflicts: number
    pending: boolean
    session: VaultUnlockSession
  }> {
    const initialMetadata = await this.repository.getSyncMetadata()
    await this.repository.setSyncMetadata({ ...initialMetadata, status: 'syncing', message: '同步中' })
    const checkpoint = await this.repository.createSyncCheckpoint()
    const local = checkpoint.snapshot
    let stagedRecovery: { recoveryKey: string; vaultFingerprint: string } | undefined

    try {
      for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
        try {
          const remoteFile = await this.provider.download()
          const now = this.now()
          let envelope: EncryptedVaultEnvelope
          let merged: LedgerSnapshot
          let recoveryKey: string | undefined
          let recoveryFingerprint: string | undefined
          let session: VaultUnlockSession

          if (!remoteFile) {
            if (!('password' in method)) throw new Error('首次创建云端账本需要同步密码')
            merged = { ...local, exportedAt: now }
            const created = await createEncryptedVault(merged, method.password, {
              ...(this.vaultIterations === undefined ? {} : { iterations: this.vaultIterations }),
              now,
            })
            envelope = created.envelope
            recoveryKey = created.recoveryKey
            recoveryFingerprint = created.recoveryFingerprint
            stagedRecovery = { recoveryKey, vaultFingerprint: recoveryFingerprint }
            session = created.session
            await this.onRecoveryKey?.(recoveryKey, recoveryFingerprint)
          } else {
            if (remoteFile.content.length > MAX_REMOTE_VAULT_CHARACTERS) {
              throw new Error('远端加密账本超过安全大小上限，已停止处理')
            }
            try {
              envelope = JSON.parse(remoteFile.content) as EncryptedVaultEnvelope
            } catch {
              throw new Error('远端加密账本格式无效，已停止覆盖')
            }
            let remote: unknown
            if ('session' in method) {
              session = method.session
              remote = await decryptVaultWithSession<unknown>(envelope, session)
            } else {
              const opened = await openEncryptedVault<unknown>(envelope, method)
              session = opened.session
              remote = opened.payload
            }
            if (!isLedgerSnapshot(remote)) throw new Error('远端账本版本不受支持，已停止覆盖')
            await this.onRemoteVault?.(await vaultRecoveryFingerprint(envelope))
            merged = mergeSnapshots(local, remote, now)
            envelope = await updateEncryptedVaultWithSession(envelope, session, merged, now)
          }

          if (remoteFile && this.provider.createSnapshot) {
            await this.provider.createSnapshot(remoteFile.content, now)
          }
          const uploaded = await this.provider.upload(JSON.stringify(envelope), remoteFile?.etag ?? null)
          if (recoveryFingerprint) await this.onRecoveryKeyConfirmed?.(recoveryFingerprint)
          stagedRecovery = undefined
          const applied = await this.repository.applySyncedSnapshot(merged, merged.conflicts ?? [], local)
          const completion = await this.repository.completeSync({
            id: 'sync',
            remoteEtag: uploaded.etag,
            lastSuccessAt: now,
            pending: false,
            status: applied.unresolvedConflicts > 0 ? 'attention' : 'synced',
            message: applied.unresolvedConflicts > 0 ? `有 ${applied.unresolvedConflicts} 个冲突需要处理` : '已同步',
          }, checkpoint.generation)
          return recoveryKey && recoveryFingerprint
            ? {
                recoveryKey,
                recoveryFingerprint,
                conflicts: applied.unresolvedConflicts,
                pending: completion.pending,
                session,
              }
            : { conflicts: applied.unresolvedConflicts, pending: completion.pending, session }
        } catch (error) {
          if (error instanceof EtagConflictError && stagedRecovery) {
            const invalidatedFingerprint = stagedRecovery.vaultFingerprint
            stagedRecovery = undefined
            await this.onRecoveryKeyInvalidated?.(invalidatedFingerprint)
          }
          const delay = this.retryDelay(error, attempt)
          if (delay === null || attempt === this.maxAttempts - 1) throw error
          await this.wait(delay)
        }
      }
      throw new Error('同步重试次数已用尽')
    } catch (error) {
      await this.repository.setSyncMetadata({
        ...initialMetadata,
        pending: true,
        status: 'attention',
        message: error instanceof Error ? error.message : '同步失败',
      })
      throw error
    }
  }

  private retryDelay(error: unknown, attempt: number): number | null {
    if (error instanceof EtagConflictError) return 250 * 2 ** attempt
    if (!error || typeof error !== 'object' || !('code' in error)) return null
    if (error.code === 'throttled') {
      const retryAfter = 'retryAfterSeconds' in error ? Number(error.retryAfterSeconds) : Number.NaN
      return Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 1_000 * 2 ** attempt
    }
    if (error.code === 'network') return 500 * 2 ** attempt
    return null
  }
}
