import { describe, expect, it, vi } from 'vitest'
import { PwaUpdateController, type WorkboxLike } from '../../src/services/pwaUpdate'

describe('PwaUpdateController', () => {
  it('reports a waiting update and activates it only after user confirmation', async () => {
    const listeners = new Map<string, () => void>()
    const workbox: WorkboxLike = {
      addEventListener: vi.fn((name, listener) => { listeners.set(name, listener) }),
      register: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      messageSkipWaiting: vi.fn(),
    }
    const reload = vi.fn()
    const controller = new PwaUpdateController(() => workbox, reload)
    await controller.initialize()

    listeners.get('waiting')?.()
    expect(controller.state.updateAvailable).toBe(true)
    controller.applyUpdate()
    expect(workbox.messageSkipWaiting).toHaveBeenCalledOnce()
    listeners.get('controlling')?.()
    expect(reload).toHaveBeenCalledOnce()

    await controller.checkForUpdate()
    expect(workbox.update).toHaveBeenCalledOnce()
  })

  it('marks the app ready for offline use after its first service-worker activation', async () => {
    const listeners = new Map<string, () => void>()
    const workbox: WorkboxLike = {
      addEventListener: (_name, _listener) => { listeners.set(_name, _listener) },
      register: vi.fn().mockResolvedValue(undefined), update: vi.fn(), messageSkipWaiting: vi.fn(),
    }
    const controller = new PwaUpdateController(() => workbox)
    await controller.initialize()
    listeners.get('activated')?.()
    expect(controller.state.offlineReady).toBe(true)
  })
})
