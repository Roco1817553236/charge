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
    const incomeOn = tokens('income-on-color')
    const expenseOn = tokens('expense-on-color')
    const surfaces = tokens('surface')
    const rgb = (hex: string) => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
    const luminance = (hex: string) => {
      const channels = rgb(hex).map((value) => {
        const normalized = value / 255
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
    }
    const contrast = (left: string, right: string) => {
      const values = [luminance(left), luminance(right)].sort((a, b) => b - a)
      return (values[0]! + 0.05) / (values[1]! + 0.05)
    }

    expect(income).toHaveLength(2)
    expect(expense).toHaveLength(2)
    expect(danger).toHaveLength(2)
    expect(surfaces).toHaveLength(2)
    expect(css.match(/--income-on-color:/g)).toHaveLength(2)
    expect(css.match(/--expense-on-color:/g)).toHaveLength(2)
    income.forEach((hex, index) => {
      const [red, green, blue] = rgb(hex)
      expect(red).toBeGreaterThan(green!)
      expect(red).toBeGreaterThan(blue!)
      expect(hex).not.toBe(expense[index])
      expect(hex).not.toBe(danger[index])
      expect(contrast(hex, surfaces[index]!)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(hex, incomeOn[index]!)).toBeGreaterThanOrEqual(4.5)
    })
    expense.forEach((hex) => {
      const [red, green, blue] = rgb(hex)
      expect(green).toBeGreaterThan(red!)
      expect(green).toBeGreaterThan(blue!)
      const index = expense.indexOf(hex)
      expect(contrast(hex, surfaces[index]!)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(hex, expenseOn[index]!)).toBeGreaterThanOrEqual(4.5)
    })
  })
})
