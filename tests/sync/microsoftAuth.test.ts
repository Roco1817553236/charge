import { describe, expect, it, vi } from 'vitest'
import { InteractionRequiredAuthError } from '@azure/msal-browser'
import { APP_FOLDER_SCOPES, MicrosoftAuth, buildMsalConfig } from '../../src/sync/microsoftAuth'

describe('MicrosoftAuth', () => {
  it('uses the consumers authority and only the OneDrive application-folder file permission', () => {
    const config = buildMsalConfig('client-id', 'https://example.test/app/')
    expect(config.auth.authority).toBe('https://login.microsoftonline.com/consumers')
    expect(config.auth.clientId).toBe('client-id')
    expect(config.auth.redirectUri).toBe('https://example.test/app/')
    expect(APP_FOLDER_SCOPES).toEqual(['Files.ReadWrite.AppFolder'])
  })

  it('initializes, signs in and obtains a token without a client secret', async () => {
    const account = { homeAccountId: 'home-1', username: 'user@example.test' }
    const client = {
      initialize: vi.fn().mockResolvedValue(undefined),
      getAllAccounts: vi.fn().mockReturnValue([]),
      loginPopup: vi.fn().mockResolvedValue({ account }),
      acquireTokenSilent: vi.fn().mockResolvedValue({ accessToken: 'token-1' }),
      acquireTokenPopup: vi.fn(),
      logoutPopup: vi.fn(),
    }
    const auth = new MicrosoftAuth('client-id', 'https://example.test/app/', () => client as never)

    await auth.initialize()
    await expect(auth.signIn()).resolves.toMatchObject({ username: 'user@example.test' })
    await expect(auth.getAccessToken()).resolves.toBe('token-1')
    expect(client.loginPopup).toHaveBeenCalledWith(expect.objectContaining({ scopes: APP_FOLDER_SCOPES }))
    expect(client.acquireTokenSilent).toHaveBeenCalledWith(expect.objectContaining({ scopes: APP_FOLDER_SCOPES }))
  })

  it('does not open an interactive token popup during trusted-device background sync', async () => {
    const account = { homeAccountId: 'home-1', username: 'user@example.test' }
    const client = {
      initialize: vi.fn().mockResolvedValue(undefined),
      getAllAccounts: vi.fn().mockReturnValue([account]),
      loginPopup: vi.fn(),
      acquireTokenSilent: vi.fn().mockRejectedValue(new InteractionRequiredAuthError('interaction_required', 'sign in')),
      acquireTokenPopup: vi.fn(),
      logoutPopup: vi.fn(),
    }
    const auth = new MicrosoftAuth('client-id', 'https://example.test/app/', () => client as never)
    await auth.initialize()

    await expect(auth.getAccessToken(false)).rejects.toThrow('需要重新登录 Microsoft')
    expect(client.acquireTokenPopup).not.toHaveBeenCalled()
  })
})
