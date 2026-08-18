import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const html = readFileSync('index.html', 'utf8')
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  dependencies?: Record<string, string>
}
const viteConfig = readFileSync('vite.config.ts', 'utf8')
const envExample = readFileSync('.env.example', 'utf8')
const importExportSource = readFileSync('src/services/importExport.ts', 'utf8')

describe('local-only security boundary', () => {
  it('allows only packaged resources and no longer permits Microsoft or OneDrive connections', () => {
    expect(html).toContain("script-src 'self'")
    expect(html).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(html).not.toContain('unsafe-eval')
    expect(html).not.toContain('login.microsoftonline.com')
    expect(html).not.toContain('graph.microsoft.com')
    expect(html).not.toContain('1drv.com')
    expect(html).toContain("connect-src 'self'")
  })

  it('ships without cloud-sync runtime, MSAL configuration, or CSV export', () => {
    expect(packageJson.dependencies).not.toHaveProperty('@azure/msal-browser')
    expect(viteConfig).not.toMatch(/OneDrive|Microsoft/u)
    expect(envExample).not.toContain('VITE_MS_CLIENT_ID')
    expect(importExportSource).not.toContain('exportLedgerCsv')
    expect(existsSync('src/sync')).toBe(false)
    expect(existsSync('src/services/backgroundSync.ts')).toBe(false)
    expect(existsSync('src/security/trustedSession.ts')).toBe(false)
  })
})
