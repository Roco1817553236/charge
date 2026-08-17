import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { createEncryptedVault, openEncryptedVault } from '../../src/security/cryptoVault'
import { TrustedSessionStore } from '../../src/security/trustedSession'

const dbName = 'trusted-session-test'

describe('TrustedSessionStore', () => {
  afterEach(async () => { await Dexie.delete(dbName) })

  it('persists only a non-extractable sync key and encrypts a pending recovery key', async () => {
    const payload = { private: 'ledger' }
    const { envelope } = await createEncryptedVault(payload, 'correct-password', { iterations: 1_000 })
    const { session } = await openEncryptedVault(envelope, { password: 'correct-password' })
    const store = new TrustedSessionStore(dbName)

    await store.saveSession('client-id', session)
    await store.savePendingRecoveryKey('client-id', 'recovery-secret', 'vault-fingerprint')

    const loaded = await store.loadSession('client-id')
    expect(loaded?.key.extractable).toBe(false)
    expect(await store.loadPendingRecoveryKey('client-id')).toBeNull()
    expect(await store.loadStagedRecoveryKey('client-id')).toMatchObject({
      recoveryKey: 'recovery-secret', vaultFingerprint: 'vault-fingerprint', confirmed: false,
    })
    await store.confirmPendingRecoveryKey('client-id', 'vault-fingerprint')
    expect(await store.loadPendingRecoveryKey('client-id')).toBe('recovery-secret')
    await store.clearPendingRecoveryKey('client-id')
    expect(await store.loadPendingRecoveryKey('client-id')).toBeNull()
    await store.close()
  })
})
