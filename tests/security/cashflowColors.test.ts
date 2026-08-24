import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('cashflow color tokens', () => {
  it('defines independent red-income and green-expense tokens in light and dark themes', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')
    const tokens = (name: string) => [...css.matchAll(new RegExp(`--${name}:\\s*(#[0-9A-F]{6})`, 'gi'))].map((match) => match[1]!.toUpperCase())
    const income = tokens('income-color')
    const expense = tokens('expense-color')
    const danger = tokens('danger')
    const rgb = (hex: string) => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))

    expect(income).toHaveLength(2)
    expect(expense).toHaveLength(2)
    expect(css.match(/--income-on-color:/g)).toHaveLength(2)
    expect(css.match(/--expense-on-color:/g)).toHaveLength(2)
    income.forEach((hex, index) => {
      const [red, green, blue] = rgb(hex)
      expect(red).toBeGreaterThan(green!)
      expect(red).toBeGreaterThan(blue!)
      expect(hex).not.toBe(expense[index])
      expect(hex).not.toBe(danger[index])
    })
    expense.forEach((hex) => {
      const [red, green, blue] = rgb(hex)
      expect(green).toBeGreaterThan(red!)
      expect(green).toBeGreaterThan(blue!)
    })
  })
})
