import { describe, expect, it } from 'vitest'
import { createDefaultItemCategories } from '../../src/domain/itemCategories'

describe('default item categories', () => {
  it('creates stable independent categories for every device', () => {
    const first = createDefaultItemCategories()
    const second = createDefaultItemCategories()

    expect(first.map((item) => item.name)).toEqual(['数码', '家电', '家居', '工具', '服饰', '运动', '其他'])
    expect(second).toEqual(first)
    expect(new Set(first.map((item) => item.id)).size).toBe(first.length)
    expect(first.every((item) => item.status === 'active' && item.isSystemDefault)).toBe(true)
  })
})
