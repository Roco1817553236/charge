import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
  type Configuration,
  type IPublicClientApplication,
} from '@azure/msal-browser'

export const APP_FOLDER_SCOPES = ['Files.ReadWrite.AppFolder'] as const

export function buildMsalConfig(clientId: string, redirectUri: string): Configuration {
  return {
    auth: {
      clientId,
      authority: 'https://login.microsoftonline.com/consumers',
      redirectUri,
    },
    cache: {
      cacheLocation: 'localStorage',
    },
    system: {
      allowPlatformBroker: false,
    },
  }
}

type MsalFactory = (configuration: Configuration) => IPublicClientApplication

export class MicrosoftAuth {
  private readonly client: IPublicClientApplication
  private account: AccountInfo | null = null
  private initialized = false

  constructor(
    clientId: string,
    redirectUri: string,
    factory: MsalFactory = (configuration) => new PublicClientApplication(configuration),
  ) {
    if (!clientId.trim()) throw new Error('需要 Microsoft 应用客户端 ID 才能启用 OneDrive 同步')
    this.client = factory(buildMsalConfig(clientId.trim(), redirectUri))
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    await this.client.initialize()
    this.account = this.client.getAllAccounts()[0] ?? null
    this.initialized = true
  }

  async signIn(): Promise<AccountInfo> {
    await this.initialize()
    const result = await this.client.loginPopup({ scopes: [...APP_FOLDER_SCOPES], prompt: 'select_account' })
    if (!result.account) throw new Error('微软登录未返回账号')
    this.account = result.account
    return result.account
  }

  async getAccessToken(allowInteractive = true): Promise<string> {
    await this.initialize()
    const account = this.account ?? (await this.signIn())
    try {
      const result = await this.client.acquireTokenSilent({ account, scopes: [...APP_FOLDER_SCOPES] })
      return result.accessToken
    } catch (error) {
      if (!(error instanceof InteractionRequiredAuthError)) throw error
      if (!allowInteractive) throw new Error('需要重新登录 Microsoft 才能继续云端同步')
      const result = await this.client.acquireTokenPopup({ account, scopes: [...APP_FOLDER_SCOPES] })
      return result.accessToken
    }
  }

  async signOut(): Promise<void> {
    await this.initialize()
    if (this.account) await this.client.logoutPopup({ account: this.account })
    this.account = null
  }

  get currentAccount(): AccountInfo | null {
    return this.account
  }
}
