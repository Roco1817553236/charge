import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const html = readFileSync('index.html', 'utf8')

describe('Content Security Policy', () => {
  it('allows only packaged scripts while permitting Microsoft identity, Graph, and OneDrive file downloads', () => {
    expect(html).toContain("script-src 'self'")
    expect(html).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(html).not.toContain('unsafe-eval')
    expect(html).toContain('https://login.microsoftonline.com')
    expect(html).toContain('https://graph.microsoft.com')
    expect(html).toContain('https://*.1drv.com')
  })
})
