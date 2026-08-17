import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SwipePager from '../../src/components/SwipePager.vue'

describe('SwipePager', () => {
  it('switches pages through the persistent bottom tabs', async () => {
    const wrapper = mount(SwipePager, {
      props: { modelValue: 0 },
      slots: { entry: '<div>记账页</div>', ledger: '<div>流水页</div>', stats: '<div>统计页</div>' },
    })
    expect(wrapper.get('[data-testid="nav-entry"]').attributes('aria-current')).toBe('page')
    await wrapper.get('[data-testid="nav-ledger"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([1])
  })

  it('supports a deliberate horizontal pointer swipe without wrapping past the final page', async () => {
    const wrapper = mount(SwipePager, {
      props: { modelValue: 1 },
      slots: { entry: '<div>记账页</div>', ledger: '<div>流水页</div>', stats: '<div>统计页</div>' },
    })
    const viewport = wrapper.get('[data-testid="pager-viewport"]')
    await viewport.trigger('pointerdown', { clientX: 260, clientY: 100, pointerId: 1 })
    await viewport.trigger('pointerup', { clientX: 80, clientY: 108, pointerId: 1 })
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([2])

    await wrapper.setProps({ modelValue: 2 })
    await viewport.trigger('pointerdown', { clientX: 260, clientY: 100, pointerId: 2 })
    await viewport.trigger('pointerup', { clientX: 80, clientY: 108, pointerId: 2 })
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
  })
})
