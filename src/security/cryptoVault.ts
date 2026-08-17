export const DEFAULT_PBKDF2_ITERATIONS = 600_000
export const MAX_PBKDF2_ITERATIONS = 2_000_000
export const MAX_VAULT_PAYLOAD_BYTES = 12 * 1024 * 1024

interface CipherBlock {
  iv: string
  ciphertext: string
}

export interface EncryptedVaultEnvelope {
  version: 1
  algorithm: 'AES-256-GCM'
  createdAt: string
  updatedAt?: string
  kdf: {
    name: 'PBKDF2'
    hash: 'SHA-256'
    iterations: number
    salt: string
  }
  wrappedKeys: {
    password: CipherBlock
    recovery: CipherBlock
  }
  payload: CipherBlock
}

interface CreateVaultOptions {
  iterations?: number
  now?: string
}

export type UnlockMethod = { password: string; recoveryKey?: never } | { recoveryKey: string; password?: never }

export interface VaultUnlockSession {
  key: CryptoKey
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const blockAad = encoder.encode('personal-bookkeeping:vault-v1')

function payloadAad(recovery: CipherBlock): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify({
    context: 'personal-bookkeeping:vault-v1:payload',
    recovery: {
      iv: recovery.iv,
      ciphertext: recovery.ciphertext,
    },
  }))
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  return fromBase64(padded)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function validatedBase64(value: unknown, exactBytes?: number, maxBytes = exactBytes): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0) {
    throw new Error('加密账本参数无效')
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('加密账本参数无效')
  const maximumCharacters = maxBytes === undefined ? Number.POSITIVE_INFINITY : Math.ceil(maxBytes / 3) * 4 + 4
  if (value.length > maximumCharacters) throw new Error('加密账本参数无效')
  let decoded: Uint8Array<ArrayBuffer>
  try {
    decoded = fromBase64(value)
  } catch {
    throw new Error('加密账本参数无效')
  }
  if (exactBytes !== undefined && decoded.byteLength !== exactBytes) throw new Error('加密账本参数无效')
  if (maxBytes !== undefined && decoded.byteLength > maxBytes) throw new Error('加密账本参数无效')
  return decoded
}

function validateCipherBlock(value: unknown, exactCiphertextBytes?: number, maxCiphertextBytes?: number): void {
  if (!isRecord(value)) throw new Error('加密账本参数无效')
  validatedBase64(value.iv, 12)
  const ciphertext = validatedBase64(value.ciphertext, exactCiphertextBytes, maxCiphertextBytes)
  if (ciphertext.byteLength < 16) throw new Error('加密账本参数无效')
}

export function validateEncryptedVaultEnvelope(value: unknown): asserts value is EncryptedVaultEnvelope {
  if (!isRecord(value) || value.version !== 1 || value.algorithm !== 'AES-256-GCM') {
    throw new Error('加密账本参数无效')
  }
  if (typeof value.createdAt !== 'string' || value.createdAt.length > 64) throw new Error('加密账本参数无效')
  if (value.updatedAt !== undefined && (typeof value.updatedAt !== 'string' || value.updatedAt.length > 64)) {
    throw new Error('加密账本参数无效')
  }
  if (!isRecord(value.kdf) || value.kdf.name !== 'PBKDF2' || value.kdf.hash !== 'SHA-256') {
    throw new Error('加密账本参数无效')
  }
  if (
    !Number.isSafeInteger(value.kdf.iterations) ||
    (value.kdf.iterations as number) < 1_000 ||
    (value.kdf.iterations as number) > MAX_PBKDF2_ITERATIONS
  ) throw new Error('加密账本参数无效')
  validatedBase64(value.kdf.salt, 16)
  if (!isRecord(value.wrappedKeys)) throw new Error('加密账本参数无效')
  validateCipherBlock(value.wrappedKeys.password, 48)
  validateCipherBlock(value.wrappedKeys.recovery, 48)
  validateCipherBlock(value.payload, undefined, MAX_VAULT_PAYLOAD_BYTES + 16)
}

export async function vaultRecoveryFingerprint(envelope: EncryptedVaultEnvelope): Promise<string> {
  validateEncryptedVaultEnvelope(envelope)
  const canonical = JSON.stringify({
    version: envelope.version,
    algorithm: envelope.algorithm,
    recovery: {
      iv: envelope.wrappedKeys.recovery.iv,
      ciphertext: envelope.wrappedKeys.recovery.ciphertext,
    },
  })
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(canonical))
  return toBase64Url(new Uint8Array(digest))
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length))
}

async function importAesKey(raw: BufferSource, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, usages)
}

async function derivePasswordKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function encryptBlock(
  bytes: BufferSource,
  key: CryptoKey,
  additionalData: BufferSource = blockAad,
): Promise<CipherBlock> {
  const iv = randomBytes(12)
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, bytes)
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(encrypted)) }
}

async function decryptBlock(
  block: CipherBlock,
  key: CryptoKey,
  additionalData: BufferSource = blockAad,
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(block.iv), additionalData },
    key,
    fromBase64(block.ciphertext),
  )
}

export async function createEncryptedVault<T>(
  payload: T,
  password: string,
  options: CreateVaultOptions = {},
): Promise<{
  envelope: EncryptedVaultEnvelope
  recoveryKey: string
  recoveryFingerprint: string
  session: VaultUnlockSession
}> {
  if ([...password].length < 10) throw new Error('同步密码至少需要 10 个字符')
  const iterations = options.iterations ?? DEFAULT_PBKDF2_ITERATIONS
  if (!Number.isSafeInteger(iterations) || iterations < 1_000 || iterations > MAX_PBKDF2_ITERATIONS) {
    throw new Error('KDF 参数无效')
  }

  const dataKeyBytes = randomBytes(32)
  const recoveryKeyBytes = randomBytes(32)
  const salt = randomBytes(16)
  const dataKey = await importAesKey(dataKeyBytes, ['encrypt', 'decrypt'])
  const passwordKey = await derivePasswordKey(password, salt, iterations)
  const recoveryWrappingKey = await importAesKey(recoveryKeyBytes, ['encrypt', 'decrypt'])
  const [passwordWrappedKey, recoveryWrappedKey] = await Promise.all([
    encryptBlock(dataKeyBytes, passwordKey),
    encryptBlock(dataKeyBytes, recoveryWrappingKey),
  ])
  const encryptedPayload = await encryptBlock(
    encoder.encode(JSON.stringify(payload)),
    dataKey,
    payloadAad(recoveryWrappedKey),
  )

  const envelope: EncryptedVaultEnvelope = {
    version: 1,
    algorithm: 'AES-256-GCM',
    createdAt: options.now ?? new Date().toISOString(),
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations,
      salt: toBase64(salt),
    },
    wrappedKeys: {
      password: passwordWrappedKey,
      recovery: recoveryWrappedKey,
    },
    payload: encryptedPayload,
  }
  return {
    session: { key: dataKey },
    envelope,
    recoveryKey: toBase64Url(recoveryKeyBytes),
    recoveryFingerprint: await vaultRecoveryFingerprint(envelope),
  }
}

export async function decryptVault<T>(envelope: EncryptedVaultEnvelope, method: UnlockMethod): Promise<T> {
  return (await openEncryptedVault<T>(envelope, method)).payload
}

export async function openEncryptedVault<T>(
  envelope: EncryptedVaultEnvelope,
  method: UnlockMethod,
): Promise<{ payload: T; session: VaultUnlockSession }> {
  try {
    const dataKey = await unlockDataKey(envelope, method, ['encrypt', 'decrypt'])
    const plaintext = await decryptBlock(envelope.payload, dataKey, payloadAad(envelope.wrappedKeys.recovery))
    return { payload: JSON.parse(decoder.decode(plaintext)) as T, session: { key: dataKey } }
  } catch {
    throw new Error('无法解锁加密账本，请检查密码、恢复密钥或文件完整性')
  }
}

export async function decryptVaultWithSession<T>(
  envelope: EncryptedVaultEnvelope,
  session: VaultUnlockSession,
): Promise<T> {
  try {
    validateEncryptedVaultEnvelope(envelope)
    const plaintext = await decryptBlock(
      envelope.payload,
      session.key,
      payloadAad(envelope.wrappedKeys.recovery),
    )
    return JSON.parse(decoder.decode(plaintext)) as T
  } catch {
    throw new Error('可信设备密钥已失效，请重新输入同步密码或恢复密钥')
  }
}

async function unlockDataKey(
  envelope: EncryptedVaultEnvelope,
  method: UnlockMethod,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  validateEncryptedVaultEnvelope(envelope)
  let wrappingKey: CryptoKey
  let wrappedDataKey: CipherBlock
  if ('password' in method && typeof method.password === 'string') {
    wrappingKey = await derivePasswordKey(method.password, fromBase64(envelope.kdf.salt), envelope.kdf.iterations)
    wrappedDataKey = envelope.wrappedKeys.password
  } else if ('recoveryKey' in method && typeof method.recoveryKey === 'string') {
    wrappingKey = await importAesKey(fromBase64Url(method.recoveryKey), ['decrypt'])
    wrappedDataKey = envelope.wrappedKeys.recovery
  } else {
    throw new Error('No unlock method')
  }
  const rawDataKey = await decryptBlock(wrappedDataKey, wrappingKey)
  return importAesKey(rawDataKey, usages)
}

export async function updateEncryptedVault<T>(
  envelope: EncryptedVaultEnvelope,
  method: UnlockMethod,
  payload: T,
  now = new Date().toISOString(),
): Promise<EncryptedVaultEnvelope> {
  try {
    const dataKey = await unlockDataKey(envelope, method, ['encrypt', 'decrypt'])
    return updateEncryptedVaultWithSession(envelope, { key: dataKey }, payload, now)
  } catch {
    throw new Error('无法解锁加密账本，请检查密码、恢复密钥或文件完整性')
  }
}

export async function updateEncryptedVaultWithSession<T>(
  envelope: EncryptedVaultEnvelope,
  session: VaultUnlockSession,
  payload: T,
  now = new Date().toISOString(),
): Promise<EncryptedVaultEnvelope> {
  try {
    validateEncryptedVaultEnvelope(envelope)
    return {
      ...envelope,
      updatedAt: now,
      payload: await encryptBlock(
        encoder.encode(JSON.stringify(payload)),
        session.key,
        payloadAad(envelope.wrappedKeys.recovery),
      ),
    }
  } catch {
    throw new Error('可信设备密钥已失效，请重新输入同步密码或恢复密钥')
  }
}
