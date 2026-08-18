import { describe, expect, it } from 'vitest'
import {
  createEncryptedVault,
  decryptVault,
  validateEncryptedVaultEnvelope,
  type EncryptedVaultEnvelope,
} from '../../src/security/cryptoVault'

const payload = { amount: 2580, note: '午饭' }

describe('encrypted JSON backup vault', () => {
  it('encrypts payloads and unlocks them with either the backup password or recovery key', async () => {
    const { envelope, recoveryKey } = await createEncryptedVault(payload, '这是一个足够长的备份密码', {
      iterations: 1_000,
      now: '2026-08-14T00:00:00.000Z',
    })

    expect(JSON.stringify(envelope)).not.toContain('午饭')
    await expect(decryptVault<typeof payload>(envelope, { password: '这是一个足够长的备份密码' })).resolves.toEqual(payload)
    await expect(decryptVault<typeof payload>(envelope, { recoveryKey })).resolves.toEqual(payload)
  })

  it('rejects wrong passwords, tampered ciphertext, and swapped recovery wrappers', async () => {
    const original = await createEncryptedVault(payload, 'correct-password', { iterations: 1_000 })
    const unrelated = await createEncryptedVault(payload, 'correct-password', { iterations: 1_000 })

    await expect(decryptVault(original.envelope, { password: 'wrong-password' })).rejects.toThrow('无法解锁加密备份')

    const tampered: EncryptedVaultEnvelope = {
      ...original.envelope,
      payload: {
        ...original.envelope.payload,
        ciphertext: original.envelope.payload.ciphertext.replace(/^./, (value) => value === 'A' ? 'B' : 'A'),
      },
    }
    await expect(decryptVault(tampered, { password: 'correct-password' })).rejects.toThrow('无法解锁加密备份')

    const wrapperSwapped: EncryptedVaultEnvelope = {
      ...original.envelope,
      wrappedKeys: { ...original.envelope.wrappedKeys, recovery: unrelated.envelope.wrappedKeys.recovery },
    }
    await expect(decryptVault(wrapperSwapped, { password: 'correct-password' })).rejects.toThrow('无法解锁加密备份')
  })

  it('requires a sufficiently long backup password', async () => {
    await expect(createEncryptedVault(payload, 'short', { iterations: 1_000 })).rejects.toThrow('备份密码至少需要 10 个字符')
  })

  it('validates bounded envelope parameters before attempting expensive crypto', async () => {
    const { envelope } = await createEncryptedVault(payload, 'correct-password', { iterations: 1_000 })

    expect(() => validateEncryptedVaultEnvelope({
      ...envelope,
      kdf: { ...envelope.kdf, iterations: 99_999_999 },
    })).toThrow('加密账本参数无效')
    expect(() => validateEncryptedVaultEnvelope({
      ...envelope,
      payload: { ...envelope.payload, ciphertext: 'A'.repeat(20 * 1024 * 1024) },
    })).toThrow('加密账本参数无效')
  })
})
