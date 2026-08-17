export function parseAmountToMinor(value: string): number {
  const normalized = value.trim()
  if (!/^(?:\d+|\d*\.\d{1,2})$/.test(normalized)) {
    throw new Error('请输入大于 0 且最多两位小数的金额')
  }

  const [yuanPart = '0', fractionPart = ''] = normalized.split('.')
  const minor = Number(yuanPart || '0') * 100 + Number(fractionPart.padEnd(2, '0'))
  if (!Number.isSafeInteger(minor)) {
    throw new Error('金额过大')
  }
  if (minor <= 0) {
    throw new Error('请输入大于 0 且最多两位小数的金额')
  }
  return minor
}

const cnyFormatter = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  currencyDisplay: 'narrowSymbol',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatMinor(amountMinor: number): string {
  return cnyFormatter.format(amountMinor / 100)
}
