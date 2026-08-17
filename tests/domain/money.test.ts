import { describe, expect, it } from 'vitest'

import { formatMinor, parseAmountToMinor } from '../../src/domain/money'

describe('parseAmountToMinor', () => {
  it('converts a decimal yuan amount to integer fen', () => {
    expect(parseAmountToMinor('58.00')).toBe(5800)
    expect(parseAmountToMinor(' 0.10 ')).toBe(10)
    expect(parseAmountToMinor('.5')).toBe(50)
  })

  it.each(['', '0', '0.00', '-1', '1.234', '1e2', 'abc'])('rejects invalid amount %s', (value) => {
    expect(() => parseAmountToMinor(value)).toThrow('请输入大于 0 且最多两位小数的金额')
  })

  it('rejects values outside the safe integer range', () => {
    expect(() => parseAmountToMinor('999999999999999.99')).toThrow('金额过大')
  })
})

describe('formatMinor', () => {
  it('formats integer fen as Chinese yuan', () => {
    expect(formatMinor(5800)).toBe('¥58.00')
  })
})
