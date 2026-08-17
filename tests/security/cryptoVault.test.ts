import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PBKDF2_ITERATIONS,
  createEncryptedVault,
  decryptVault,
  decryptVaultWithSession,
  openEncryptedVault,
  updateEncryptedVault,
  updateEncryptedVaultWithSession,
  validateEncryptedVaultEnvelope,
  vaultRecoveryFingerprint,
  type EncryptedVaultEnvelope,
} from '../../src/security/cryptoVault'

const payload = {
  schemaVersion: 1,
  exportedAt: '2026-08-14T00:00:00.000Z',
  transactions: [{ id: 'tx-1', amountMinor: 5800, note: '测试' }],
  categories: [],
}

describe('CryptoVault', () => {
  it('uses the approved production KDF work factor', () => {
    expect(DEFAULT_PBKDF2_ITERATIONS).toBe(600_000)
  })

  it('round-trips a vault with either the password or generated recovery key', async () => {
    const { envelope, recoveryKey } = await createEncryptedVault(payload, '这是一个足够长的同步密码', {
      iterations: 1_000,
      now: '2026-08-14T00:00:00.000Z',
    })

    expect(envelope.version).toBe(1)
    expect(envelope.kdf.hash).toBe('SHA-256')
    expect(envelope.kdf.iterations).toBe(1_000)
    expect(recoveryKey).toMatch(/^[A-Za-z0-9_-]+$/)
    await expect(decryptVault<typeof payload>(envelope, { password: '这是一个足够长的同步密码' })).resolves.toEqual(payload)
    await expect(decryptVault<typeof payload>(envelope, { recoveryKey })).resolves.toEqual(payload)
  })

  it('does not reveal whether a wrong password or tampered ciphertext caused authentication failure', async () => {
    const { envelope } = await createEncryptedVault(payload, 'correct-password', { iterations: 1_000 })
    await expect(decryptVault(envelope, { password: 'wrong-password' })).rejects.toThrow('无法解锁加密账本')

    const tampered: EncryptedVaultEnvelope = {
      ...envelope,
      payload: {
        ...envelope.payload,
        ciphertext: `${envelope.payload.ciphertext.slice(0, -2)}AA`,
      },
    }
    await expect(decryptVault(tampered, { password: 'correct-password' })).rejects.toThrow('无法解锁加密账本')
  })

  it('binds the recovery wrapper to the authenticated payload', async () => {
    const original = await createEncryptedVault(payload, 'correct-password', { iterations: 1_000 })
    const unrelated = await createEncryptedVault(payload, 'correct-password', { iterations: 1_000 })
    const wrapperSwapped: EncryptedVaultEnvelope = {
      ...original.envelope,
      wrappedKeys: {
        ...original.envelope.wrappedKeys,
        recovery: unrelated.envelope.wrappedKeys.recovery,
      },
    }

    await expect(decryptVault(wrapperSwapped, { password: 'correct-password' })).rejects.toThrow('无法解锁加密账本')
    await expect(decryptVaultWithSession(wrapperSwapped, original.session)).rejects.toThrow('可信设备密钥已失效')
  })

  it('requires a sync password of at least ten Unicode characters', async () => {
    await expect(createEncryptedVault(payload, 'short', { iterations: 1_000 })).rejects.toThrow('同步密码至少需要 10 个字符')
  })

  it('updates payload ciphertext without invalidating the original recovery key', async () => {
    const { envelope, recoveryKey } = await createEncryptedVault(payload, 'correct-password', { iterations: 1_000 })
    const nextPayload = { ...payload, exportedAt: '2026-08-15T00:00:00.000Z' }
    const updated = await updateEncryptedVault(envelope, { password: 'correct-password' }, nextPayload, '2026-08-15T00:00:00.000Z')

    expect(updated.wrappedKeys).toEqual(envelope.wrappedKeys)
    expect(updated.payload.ciphertext).not.toBe(envelope.payload.ciphertext)
    await expect(decryptVault<typeof payload>(updated, { recoveryKey })).resolves.toEqual(nextPayload)
  })

  it('continues a sync session with a non-extractable key instead of retaining the password', async () => {
    const { envelope } = await createEncryptedVault(payload, 'correct-password', { iterations: 1_000 })
    const opened = await openEncryptedVault<typeof payload>(envelope, { password: 'correct-password' })
    expect(opened.session.key.extractable).toBe(false)

    const nextPayload = { ...payload, exportedAt: '2026-08-16T00:00:00.000Z' }
    const updated = await updateEncryptedVaultWithSession(envelope, opened.session, nextPayload)
    await expect(decryptVaultWithSession<typeof payload>(updated, opened.session)).resolves.toEqual(nextPayload)
  })

  it('rejects malformed or excessive KDF parameters before any key derivation', async () => {
    const { envelope } = await createEncryptedVault(payload, 'correct-password', { iterations: 1_000 })

    expect(() => validateEncryptedVaultEnvelope({
      ...envelope,
      kdf: { ...envelope.kdf, name: 'scrypt' },
    })).toThrow('加密账本参数无效')
    expect(() => validateEncryptedVaultEnvelope({
      ...envelope,
      kdf: { ...envelope.kdf, iterations: 2_000_001 },
    })).toThrow('加密账本参数无效')
  })

  it('uses a canonical recovery fingerprint independent of JSON field order', async () => {
    const { envelope } = await createEncryptedVault(payload, 'correct-password', { iterations: 1_000 })
    const reordered = {
      ...envelope,
      wrappedKeys: {
        ...envelope.wrappedKeys,
        recovery: {
          ciphertext: envelope.wrappedKeys.recovery.ciphertext,
          iv: envelope.wrappedKeys.recovery.iv,
        },
      },
    } as typeof envelope

    await expect(vaultRecoveryFingerprint(reordered)).resolves.toBe(await vaultRecoveryFingerprint(envelope))
  })
})
