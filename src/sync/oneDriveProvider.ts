import { EtagConflictError, type RemoteVaultFile, type SyncProvider } from './syncEngine'

const graphBaseUrl = 'https://graph.microsoft.com/v1.0'
const vaultItemUrl = `${graphBaseUrl}/me/drive/special/approot:/vault-v1.json`
const vaultContentUrl = `${graphBaseUrl}/me/drive/special/approot:/vault-v1.json:/content`
export const MAX_REMOTE_VAULT_BYTES = 16 * 1024 * 1024

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export class AuthenticationRequiredError extends Error {
  constructor() {
    super('微软授权已过期或应用专属目录权限不可用，请重新登录')
    this.name = 'AuthenticationRequiredError'
  }
}

export class SyncProviderError extends Error {
  constructor(
    public readonly code: 'throttled' | 'storage-full' | 'network' | 'unexpected',
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'SyncProviderError'
  }
}

interface DriveItemMetadata {
  id?: string
  name?: string
  eTag?: string
  createdDateTime?: string
  '@microsoft.graph.downloadUrl'?: string
}

export interface CloudSnapshotInfo {
  id: string
  name: string
  createdAt: string
}

interface DriveItemCollection {
  value?: DriveItemMetadata[]
}

export class OneDriveSyncProvider implements SyncProvider {
  constructor(
    private readonly getAccessToken: () => Promise<string>,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  async download(): Promise<RemoteVaultFile | null> {
    const token = await this.getAccessToken()
    let metadataResponse: Response
    try {
      metadataResponse = await this.fetcher(`${vaultItemUrl}?select=eTag,@microsoft.graph.downloadUrl`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch {
      throw new SyncProviderError('network', '无法连接 OneDrive，请检查网络后重试')
    }
    if (metadataResponse.status === 404) return null
    if (!metadataResponse.ok) throw this.mapError(metadataResponse)

    const metadata = (await metadataResponse.json()) as DriveItemMetadata
    if (!metadata.eTag || !metadata['@microsoft.graph.downloadUrl']) {
      throw new SyncProviderError('unexpected', 'OneDrive 返回的账本元数据不完整')
    }

    let contentResponse: Response
    try {
      contentResponse = await this.fetcher(metadata['@microsoft.graph.downloadUrl'])
    } catch {
      throw new SyncProviderError('network', '无法下载 OneDrive 加密账本，请稍后重试')
    }
    if (!contentResponse.ok) throw this.mapError(contentResponse)
    return { content: await this.readBoundedVault(contentResponse), etag: metadata.eTag }
  }

  async upload(content: string, expectedEtag: string | null): Promise<{ etag: string }> {
    this.assertVaultSize(content)
    const token = await this.getAccessToken()
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    }
    if (expectedEtag) headers['If-Match'] = expectedEtag
    else headers['If-None-Match'] = '*'

    let response: Response
    try {
      response = await this.fetcher(vaultContentUrl, { method: 'PUT', headers, body: content })
    } catch {
      throw new SyncProviderError('network', '无法连接 OneDrive，加密账本仍安全保存在本机')
    }
    if (!response.ok) throw this.mapError(response)
    const metadata = (await response.json()) as DriveItemMetadata
    if (!metadata.eTag) throw new SyncProviderError('unexpected', 'OneDrive 未返回新版 ETag')
    return { etag: metadata.eTag }
  }

  async createSnapshot(content: string, timestamp: string): Promise<void> {
    this.assertVaultSize(content)
    const token = await this.getAccessToken()
    const authorization = { Authorization: `Bearer ${token}` }
    const folderUrl = `${graphBaseUrl}/me/drive/special/approot:/snapshots`
    let folderResponse: Response
    try {
      folderResponse = await this.fetcher(folderUrl, { headers: authorization })
    } catch {
      throw new SyncProviderError('network', '无法检查 OneDrive 加密快照目录')
    }
    if (folderResponse.status === 404) {
      const createResponse = await this.fetcher(`${graphBaseUrl}/me/drive/special/approot/children`, {
        method: 'POST',
        headers: { ...authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'snapshots', folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
      })
      if (!createResponse.ok && createResponse.status !== 409) throw this.mapError(createResponse)
    } else if (!folderResponse.ok) {
      throw this.mapError(folderResponse)
    }

    const safeTimestamp = timestamp.replaceAll('-', '').replaceAll(':', '').replace('.', '')
    const snapshotName = `vault-${safeTimestamp}.json`
    const uploadResponse = await this.fetcher(
      `${graphBaseUrl}/me/drive/special/approot:/snapshots/${snapshotName}:/content`,
      {
        method: 'PUT',
        headers: { ...authorization, 'Content-Type': 'application/json; charset=utf-8' },
        body: content,
      },
    )
    if (!uploadResponse.ok) throw this.mapError(uploadResponse)

    const listResponse = await this.fetcher(
      `${graphBaseUrl}/me/drive/special/approot:/snapshots:/children?$select=id,name,createdDateTime&$orderby=createdDateTime%20desc`,
      { headers: authorization },
    )
    if (!listResponse.ok) throw this.mapError(listResponse)
    const collection = (await listResponse.json()) as DriveItemCollection
    const oldSnapshots = (collection.value ?? []).filter((item) => item.name?.startsWith('vault-')).slice(5)
    for (const snapshot of oldSnapshots) {
      if (!snapshot.id) continue
      const deleteResponse = await this.fetcher(
        `${graphBaseUrl}/me/drive/items/${encodeURIComponent(snapshot.id)}`,
        { method: 'DELETE', headers: authorization },
      )
      if (!deleteResponse.ok) throw this.mapError(deleteResponse)
    }
  }

  async listSnapshots(): Promise<CloudSnapshotInfo[]> {
    const token = await this.getAccessToken()
    let response: Response
    try {
      response = await this.fetcher(
        `${graphBaseUrl}/me/drive/special/approot:/snapshots:/children?$select=id,name,createdDateTime&$orderby=createdDateTime%20desc`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
    } catch {
      throw new SyncProviderError('network', '无法读取 OneDrive 加密快照列表')
    }
    if (response.status === 404) return []
    if (!response.ok) throw this.mapError(response)
    const collection = (await response.json()) as DriveItemCollection
    return (collection.value ?? []).flatMap((item) =>
      item.id && item.name?.startsWith('vault-') && item.createdDateTime
        ? [{ id: item.id, name: item.name, createdAt: item.createdDateTime }]
        : [],
    )
  }

  async downloadSnapshot(id: string): Promise<string> {
    if (!id.trim()) throw new Error('快照标识无效')
    const token = await this.getAccessToken()
    let response: Response
    try {
      response = await this.fetcher(`${graphBaseUrl}/me/drive/items/${encodeURIComponent(id)}/content`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch {
      throw new SyncProviderError('network', '无法下载 OneDrive 加密快照')
    }
    if (!response.ok) throw this.mapError(response)
    return this.readBoundedVault(response)
  }

  private assertVaultSize(content: string): void {
    if (new TextEncoder().encode(content).byteLength > MAX_REMOTE_VAULT_BYTES) {
      throw new SyncProviderError('unexpected', 'OneDrive 加密账本超过安全大小上限，已停止处理')
    }
  }

  private async readBoundedVault(response: Response): Promise<string> {
    const declaredLength = Number(response.headers.get('Content-Length'))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REMOTE_VAULT_BYTES) {
      throw new SyncProviderError('unexpected', 'OneDrive 加密账本超过安全大小上限，已停止处理')
    }
    if (!response.body) {
      let content: string
      try {
        content = await response.text()
      } catch {
        throw new SyncProviderError('network', '下载 OneDrive 加密账本时连接中断，请稍后重试')
      }
      this.assertVaultSize(content)
      return content
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let totalBytes = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        totalBytes += value.byteLength
        if (totalBytes > MAX_REMOTE_VAULT_BYTES) {
          try {
            await reader.cancel('vault-size-limit')
          } catch {
            // The size violation remains the actionable error even if cancellation also fails.
          }
          throw new SyncProviderError('unexpected', 'OneDrive 加密账本超过安全大小上限，已停止处理')
        }
        chunks.push(value)
      }
    } catch (error) {
      if (error instanceof SyncProviderError) throw error
      throw new SyncProviderError('network', '下载 OneDrive 加密账本时连接中断，请稍后重试')
    } finally {
      reader.releaseLock()
    }
    const combined = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      combined.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new TextDecoder().decode(combined)
  }

  private mapError(response: Response): Error {
    if (response.status === 401 || response.status === 403) return new AuthenticationRequiredError()
    if (response.status === 409 || response.status === 412) return new EtagConflictError()
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('Retry-After'))
      return new SyncProviderError(
        'throttled',
        'OneDrive 请求过于频繁，稍后会自动重试',
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      )
    }
    if (response.status === 507) return new SyncProviderError('storage-full', 'OneDrive 空间不足，请清理空间或先导出备份')
    return new SyncProviderError('unexpected', `OneDrive 同步失败（HTTP ${response.status}）`)
  }
}
