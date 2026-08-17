import { reactive } from 'vue'
import { Workbox } from 'workbox-window'

export interface WorkboxLike {
  addEventListener(name: string, listener: () => void): void
  register(): Promise<unknown>
  update(): Promise<unknown> | void
  messageSkipWaiting(): void
}

type WorkboxFactory = () => WorkboxLike

export class PwaUpdateController {
  readonly state = reactive({ updateAvailable: false, offlineReady: false, checking: false })
  private workbox: WorkboxLike | null = null
  private applying = false

  constructor(
    private readonly factory: WorkboxFactory = () => new Workbox(`${import.meta.env.BASE_URL}sw.js`) as WorkboxLike,
    private readonly reload: () => void = () => window.location.reload(),
  ) {}

  async initialize(): Promise<void> {
    if (this.workbox) return
    const workbox = this.factory()
    this.workbox = workbox
    workbox.addEventListener('waiting', () => { this.state.updateAvailable = true })
    workbox.addEventListener('activated', () => { this.state.offlineReady = true })
    workbox.addEventListener('controlling', () => {
      if (this.applying) this.reload()
    })
    await workbox.register()
  }

  applyUpdate(): void {
    if (!this.workbox || !this.state.updateAvailable) return
    this.applying = true
    this.workbox.messageSkipWaiting()
  }

  async checkForUpdate(): Promise<void> {
    if (!this.workbox) await this.initialize()
    this.state.checking = true
    try {
      await this.workbox?.update()
    } finally {
      this.state.checking = false
    }
  }
}
