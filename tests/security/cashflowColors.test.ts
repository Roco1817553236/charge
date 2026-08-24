import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('cashflow color tokens', () => {
  it('defines independent red-income and green-expense tokens in light and dark themes', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')

    expect(css.match(/--income-color:/g)).toHaveLength(2)
    expect(css.match(/--expense-color:/g)).toHaveLength(2)
    expect(css.match(/--income-on-color:/g)).toHaveLength(2)
    expect(css.match(/--expense-on-color:/g)).toHaveLength(2)
    expect(css).toContain('--danger:')
    expect(css).not.toMatch(/--income-color:\s*var\(--danger\)/)
  })
})
