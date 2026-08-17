import { describe, expect, it, vi } from 'vitest'
import { startBackgroundSync } from '../../src/services/backgroundSync'

describe('startBackgroundSync', () => {
  it('syncs when connectivity returns or the app becomes visible, then removes its listeners', () => {
    const sync = vi.fn()
    const stop = startBackgroundSync(sync, window, document)

    window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(sync).toHaveBeenCalledTimes(2)

    stop()
    window.dispatchEvent(new Event('online'))
    expect(sync).toHaveBeenCalledTimes(2)
  })
})
