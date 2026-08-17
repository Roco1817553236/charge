import Dexie, { type EntityTable } from 'dexie'
import type { VaultUnlockSession } from './cryptoVault'

interface TrustedCredentialRecord {
  id: string
  kind: 'session' | 'recovery'
  clientId: string
  key: CryptoKey
  iv?: Uint8Array<ArrayBuffer>
  ciphertext?: ArrayBuffer
  confirmed?: boolean
  vaultFingerprint?: string
  createdAt: string
}

class TrustedCredentialDatabase extends Dexie {
  credentials!: EntityTable<TrustedCredentialRecord, 'id'>

  constructor(name: string) {
    super(name)
    this.version(1).stores({ credentials: 'id, kind, clientId' })
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const recoveryAad = encoder.encode('personal-bookkeeping:pending-recovery-v1')

function sessionId(clientId: string): string {
  return `session:${clientId}`
}

function recoveryId(clientId: string): string {
  return `recovery:${clientId}`
}

export interface TrustedSessionRepository {
  saveSession(clientId: string, session: VaultUnlockSession): Promise<void>
  loadSession(clientId: string): Promise<VaultUnlockSession | null>
  clearSession(clientId: string): Promise<void>
  savePendingRecoveryKey(clientId: string, recoveryKey: string, vaultFingerprint: string): Promise<void>
  confirmPendingRecoveryKey(clientId: string, vaultFingerprint?: string): Promise<void>
  loadStagedRecoveryKey(clientId: string): Promise<{
    recoveryKey: string
    vaultFingerprint: string
    confirmed: boolean
  } | null>
  loadPendingRecoveryKey(clientId: string): Promise<string | null>
  clearPendingRecoveryKey(clientId: string, vaultFingerprint?: string): Promise<void>
}

export class TrustedSessionStore implements TrustedSessionRepository {
  private readonly db: TrustedCredentialDatabase

  constructor(dbName = 'personal-bookkeeping-trusted-credentials') {
    this.db = new TrustedCredentialDatabase(dbName)
  }

  async saveSession(clientId: string, session: VaultUnlockSession): Promise<void> {
    if (session.key.extractable) throw new Error('拒绝保存可导出的同步密钥')
    await this.db.credentials.put({
      id: sessionId(clientId), kind: 'session', clientId, key: session.key, createdAt: new Date().toISOString(),
    })
  }

  async loadSession(clientId: string): Promise<VaultUnlockSession | null> {
    const record = await this.db.credentials.get(sessionId(clientId))
    if (!record || record.kind !== 'session' || record.key.extractable) return null
    return { key: record.key }
  }

  async clearSession(clientId: string): Promise<void> {
    await this.db.credentials.delete(sessionId(clientId))
  }

  async savePendingRecoveryKey(clientId: string, recoveryKey: string, vaultFingerprint: string): Promise<void> {
    if (!vaultFingerprint) throw new Error('恢复密钥缺少云端账本指纹')
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: recoveryAad },
      key,
      encoder.encode(recoveryKey),
    )
    await this.db.credentials.put({
      id: recoveryId(clientId), kind: 'recovery', clientId, key, iv, ciphertext,
      confirmed: false, vaultFingerprint, createdAt: new Date().toISOString(),
    })
  }

  async confirmPendingRecoveryKey(clientId: string, vaultFingerprint?: string): Promise<void> {
    const id = recoveryId(clientId)
    const record = await this.db.credentials.get(id)
    if (!record || record.kind !== 'recovery') throw new Error('待确认的恢复密钥不存在')
    if (!record.vaultFingerprint || (vaultFingerprint && record.vaultFingerprint !== vaultFingerprint)) {
      throw new Error('恢复密钥与云端账本指纹不匹配')
    }
    await this.db.credentials.put({ ...record, confirmed: true })
  }

  async loadStagedRecoveryKey(clientId: string): Promise<{
    recoveryKey: string
    vaultFingerprint: string
    confirmed: boolean
  } | null> {
    const record = await this.db.credentials.get(recoveryId(clientId))
    if (!record || record.kind !== 'recovery' || !record.vaultFingerprint || !record.iv || !record.ciphertext) return null
    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: record.iv, additionalData: recoveryAad },
        record.key,
        record.ciphertext,
      )
      return {
        recoveryKey: decoder.decode(plaintext),
        vaultFingerprint: record.vaultFingerprint,
        confirmed: Boolean(record.confirmed),
      }
    } catch {
      return null
    }
  }

  async loadPendingRecoveryKey(clientId: string): Promise<string | null> {
    const staged = await this.loadStagedRecoveryKey(clientId)
    return staged?.confirmed ? staged.recoveryKey : null
  }

  async clearPendingRecoveryKey(clientId: string, vaultFingerprint?: string): Promise<void> {
    const id = recoveryId(clientId)
    if (vaultFingerprint) {
      const record = await this.db.credentials.get(id)
      if (record?.vaultFingerprint !== vaultFingerprint) return
    }
    await this.db.credentials.delete(id)
  }

  close(): void {
    this.db.close()
  }
}
