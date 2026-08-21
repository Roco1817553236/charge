<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ modelValue: number }>()
const emit = defineEmits<{ 'update:modelValue': [page: number] }>()

const start = ref<{ x: number; y: number; pointerId: number } | null>(null)

function onPointerDown(event: PointerEvent): void {
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, button, a, [data-no-swipe]')) return
  start.value = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
}

function onPointerUp(event: PointerEvent): void {
  if (!start.value || start.value.pointerId !== event.pointerId) return
  const deltaX = event.clientX - start.value.x
  const deltaY = event.clientY - start.value.y
  start.value = null
  if (Math.abs(deltaX) < 70 || Math.abs(deltaX) < Math.abs(deltaY) * 1.4) return
  const next = Math.max(0, Math.min(3, props.modelValue + (deltaX < 0 ? 1 : -1)))
  if (next !== props.modelValue) emit('update:modelValue', next)
}

function cancelSwipe(): void {
  start.value = null
}
</script>

<template>
  <div
    data-testid="pager-viewport"
    class="pager-viewport"
    @pointerdown="onPointerDown"
    @pointerup="onPointerUp"
    @pointercancel="cancelSwipe"
  >
    <main class="pager-track" :style="{ transform: `translate3d(-${modelValue * 100}%, 0, 0)` }">
      <div class="pager-page" :aria-hidden="modelValue !== 0" :inert="modelValue !== 0"><slot name="entry" /></div>
      <div class="pager-page" :aria-hidden="modelValue !== 1" :inert="modelValue !== 1"><slot name="ledger" /></div>
      <div class="pager-page" :aria-hidden="modelValue !== 2" :inert="modelValue !== 2"><slot name="stats" /></div>
      <div class="pager-page" :aria-hidden="modelValue !== 3" :inert="modelValue !== 3"><slot name="items" /></div>
    </main>

    <nav class="bottom-nav" aria-label="主要页面">
      <button
        data-testid="nav-entry"
        type="button"
        :class="{ active: modelValue === 0 }"
        :aria-current="modelValue === 0 ? 'page' : undefined"
        @click="emit('update:modelValue', 0)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v15H5zM8 9h8M8 13h8M8 17h4" /></svg>
        <span>记账</span>
      </button>
      <button
        data-testid="nav-ledger"
        type="button"
        :class="{ active: modelValue === 1 }"
        :aria-current="modelValue === 1 ? 'page' : undefined"
        @click="emit('update:modelValue', 1)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14M5 12h14M5 19h14M3 5h.01M3 12h.01M3 19h.01" /></svg>
        <span>流水</span>
      </button>
      <button
        data-testid="nav-stats"
        type="button"
        :class="{ active: modelValue === 2 }"
        :aria-current="modelValue === 2 ? 'page' : undefined"
        @click="emit('update:modelValue', 2)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7" /></svg>
        <span>统计</span>
      </button>
      <button
        data-testid="nav-items"
        type="button"
        :class="{ active: modelValue === 3 }"
        :aria-current="modelValue === 3 ? 'page' : undefined"
        @click="emit('update:modelValue', 3)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5zM8 9h8M8 13h5" /></svg>
        <span>物品</span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
.pager-viewport { position: fixed; inset: 0; overflow: hidden; background: var(--app-bg); touch-action: pan-y pinch-zoom; }
.pager-track { display: grid; width: 100%; height: 100%; grid-template-columns: repeat(4, 100%); transition: transform 340ms cubic-bezier(.22,.75,.24,1); will-change: transform; }
.pager-page { width: 100%; height: 100%; overflow-x: hidden; overflow-y: auto; overscroll-behavior-y: contain; scrollbar-gutter: stable; }
.bottom-nav { position: fixed; z-index: 30; right: 12px; bottom: max(12px, env(safe-area-inset-bottom)); left: 12px; display: grid; max-width: 430px; grid-template-columns: repeat(4, 1fr); margin: auto; padding: 6px; border: 1px solid color-mix(in srgb, var(--line) 85%, transparent); border-radius: 20px; background: color-mix(in srgb, var(--surface) 88%, transparent); box-shadow: 0 16px 45px rgb(15 23 42 / 16%); backdrop-filter: blur(18px) saturate(140%); }
.bottom-nav button { position: relative; display: grid; min-height: 52px; place-items: center; align-content: center; gap: 3px; border: 0; border-radius: 15px; background: transparent; color: var(--muted); font-size: 10px; font-weight: 700; transition: .18s ease; }
.bottom-nav button::before { position: absolute; top: 3px; width: 24px; height: 3px; border-radius: 0 0 3px 3px; background: transparent; content: ''; }
.bottom-nav button.active { background: var(--accent-soft); color: var(--accent-strong); }
.bottom-nav button.active::before { background: var(--accent); }
.bottom-nav svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
@media (min-width: 900px) { .bottom-nav { bottom: 18px; } }
@media (prefers-reduced-motion: reduce) { .pager-track { transition-duration: 1ms; } }
</style>
