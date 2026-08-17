import { describe, expect, it, vi } from 'vitest'
import { EtagConflictError } from '../../src/sync/syncEngine'
import {
  AuthenticationRequiredError,
  OneDriveSyncProvider,
  SyncProviderError,
  MAX_REMOTE_VAULT_BYTES,
} from '../../src/sync/oneDriveProvider'

function response(body: string | object, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

describe('OneDriveSyncProvider', () => {
  it('downloads only from the OneDrive application folder and returns its ETag', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ eTag: 'etag-1', '@microsoft.graph.downloadUrl': 'https://download.example/vault' }))
      .mockResolvedValueOnce(response('{"encrypted":true}', 200, { 'Content-Type': 'application/json' }))
    const provider = new OneDriveSyncProvider(async () => 'access-token', fetcher)

    await expect(provider.download()).resolves.toEqual({ content: '{"encrypted":true}', etag: 'etag-1' })
    expect(fetcher.mock.calls[0]?.[0]).toContain('/me/drive/special/approot:/vault-v1.json')
    expect(fetcher.mock.calls[0]?.[1]?.headers.Authorization).toBe('Bearer access-token')
    expect(fetcher.mock.calls[1]?.[0]).toBe('https://download.example/vault')
  })

  it('treats a missing vault as first sync', async () => {
    const provider = new OneDriveSyncProvider(async () => 'token', vi.fn().mockResolvedValue(response('', 404)))
    await expect(provider.download()).resolves.toBeNull()
  })

  it('rejects an oversized remote vault before reading its body', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ eTag: 'etag-1', '@microsoft.graph.downloadUrl': 'https://download.example/vault' }))
      .mockResolvedValueOnce(response('', 200, { 'Content-Length': String(MAX_REMOTE_VAULT_BYTES + 1) }))
    const provider = new OneDriveSyncProvider(async () => 'token', fetcher)

    await expect(provider.download()).rejects.toThrow('超过安全大小上限')
  })

  it('cancels a streamed vault as soon as accumulated bytes exceed the limit', async () => {
    const chunk = new Uint8Array(1024 * 1024)
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(chunk)
        if (pulls >= 20) controller.close()
      },
    })
    const oversized = new Response(body, { status: 200 })
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ eTag: 'etag-1', '@microsoft.graph.downloadUrl': 'https://download.example/vault' }))
      .mockResolvedValueOnce(oversized)
    const provider = new OneDriveSyncProvider(async () => 'token', fetcher)

    await expect(provider.download()).rejects.toThrow('超过安全大小上限')
    expect(pulls).toBeLessThan(20)
  })

  it('maps a mid-stream download failure to a retryable network error', async () => {
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        if (pulls === 1) {
          controller.enqueue(new TextEncoder().encode('{"partial":'))
        } else {
          controller.error(new Error('connection reset'))
        }
      },
    })
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ eTag: 'etag-1', '@microsoft.graph.downloadUrl': 'https://download.example/vault' }))
      .mockResolvedValueOnce(new Response(body, { status: 200 }))
    const provider = new OneDriveSyncProvider(async () => 'token', fetcher)

    await expect(provider.download()).rejects.toMatchObject({ code: 'network' } satisfies Partial<SyncProviderError>)
  })

  it('uses conditional upload and maps an ETag race', async () => {
    const successfulFetch = vi.fn().mockResolvedValue(response({ eTag: 'etag-2' }, 200))
    const provider = new OneDriveSyncProvider(async () => 'token', successfulFetch)
    await expect(provider.upload('{"vault":1}', 'etag-1')).resolves.toEqual({ etag: 'etag-2' })
    expect(successfulFetch.mock.calls[0]?.[1]?.headers['If-Match']).toBe('etag-1')

    const racingProvider = new OneDriveSyncProvider(async () => 'token', vi.fn().mockResolvedValue(response('', 412)))
    await expect(racingProvider.upload('{}', 'etag-old')).rejects.toBeInstanceOf(EtagConflictError)
  })

  it('surfaces authentication and throttling without exposing response bodies', async () => {
    const unauthorized = new OneDriveSyncProvider(async () => 'token', vi.fn().mockResolvedValue(response('secret', 401)))
    await expect(unauthorized.download()).rejects.toBeInstanceOf(AuthenticationRequiredError)

    const throttled = new OneDriveSyncProvider(
      async () => 'token',
      vi.fn().mockResolvedValue(response('private', 429, { 'Retry-After': '7' })),
    )
    await expect(throttled.download()).rejects.toMatchObject({ code: 'throttled', retryAfterSeconds: 7 } satisfies Partial<SyncProviderError>)
  })

  it('stores a pre-sync encrypted snapshot and prunes versions beyond the newest five', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response('', 404))
      .mockResolvedValueOnce(response({ id: 'snapshots-folder' }, 201))
      .mockResolvedValueOnce(response({ eTag: 'snapshot-etag' }, 201))
      .mockResolvedValueOnce(response({ value: [
        { id: 'new-1', name: 'vault-1.json' }, { id: 'new-2', name: 'vault-2.json' }, { id: 'new-3', name: 'vault-3.json' },
        { id: 'new-4', name: 'vault-4.json' }, { id: 'new-5', name: 'vault-5.json' }, { id: 'old-6', name: 'vault-6.json' },
      ] }))
      .mockResolvedValueOnce(response('', 204))
    const provider = new OneDriveSyncProvider(async () => 'token', fetcher)

    await provider.createSnapshot('{"encrypted":true}', '2026-08-14T01:02:03.004Z')

    expect(fetcher.mock.calls[1]?.[0]).toContain('/me/drive/special/approot/children')
    expect(fetcher.mock.calls[1]?.[1]?.method).toBe('POST')
    expect(fetcher.mock.calls[2]?.[0]).toContain('/snapshots/vault-20260814T010203004Z.json:/content')
    expect(fetcher.mock.calls[4]?.[0]).toContain('/me/drive/items/old-6')
    expect(fetcher.mock.calls[4]?.[1]?.method).toBe('DELETE')
  })

  it('lists and downloads encrypted snapshots from the application folder', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ value: [
        { id: 'snapshot-1', name: 'vault-20260814.json', createdDateTime: '2026-08-14T01:00:00.000Z' },
        { id: 'other', name: 'notes.txt', createdDateTime: '2026-08-14T00:00:00.000Z' },
      ] }))
      .mockResolvedValueOnce(response('{"encrypted":true}', 200, { 'Content-Type': 'application/json' }))
    const provider = new OneDriveSyncProvider(async () => 'token', fetcher)

    await expect(provider.listSnapshots()).resolves.toEqual([
      { id: 'snapshot-1', name: 'vault-20260814.json', createdAt: '2026-08-14T01:00:00.000Z' },
    ])
    await expect(provider.downloadSnapshot('snapshot-1')).resolves.toBe('{"encrypted":true}')
    expect(fetcher.mock.calls[0]?.[0]).toContain('/snapshots:/children')
    expect(fetcher.mock.calls[1]?.[0]).toContain('/me/drive/items/snapshot-1/content')
  })
})
