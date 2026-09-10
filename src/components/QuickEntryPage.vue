<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { Category, TransactionType } from '../domain/models'
import { parseAmountToMinor } from '../domain/money'
import { formatLastBookkeepingTime, suggestSubcategory } from '../domain/quickEntry'
import type { EntryDraft } from '../stores/bookStore'

const props = withDefaults(defineProps<{
  categories: Category[]
  draft: EntryDraft
  saving?: boolean
  latestBookkeepingTimestamp?: string | null
  currentLocalDate?: string
}>(), { saving: false, latestBookkeepingTimestamp: null, currentLocalDate: '' })

const emit = defineEmits<{
  save: [draft: EntryDraft]
  'update:draft': [draft: EntryDraft]
  'manage-categories': []
}>()

const form = reactive<EntryDraft>({ ...props.draft })
const detailsOpen = ref(Boolean(props.draft.note.trim()))
const moreOpen = ref(false)
const automaticSubcategory = ref(false)

watch(() => props.draft, (draft) => {
  const changedExternally = (Object.keys(draft) as Array<keyof EntryDraft>)
    .some((key) => draft[key] !== form[key])
  Object.assign(form, draft)
  if (changedExternally) automaticSubcategory.value = false
  if (draft.note.trim()) detailsOpen.value = true
}, { deep: true })

const latestBookkeepingLabel = computed(() => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(props.currentLocalDate)
  const reference = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)
    : new Date()
  return formatLastBookkeepingTime(props.latestBookkeepingTimestamp, reference)
})

const roots = computed(() => props.categories
  .filter((category) => category.type === form.type && category.parentId === null && category.status === 'active')
  .sort((left, right) => left.sortOrder - right.sortOrder))

const visibleRoots = computed(() => {
  if (moreOpen.value) return roots.value
  const pinned = roots.value.filter((category) => category.isPinned).slice(0, 6)
  return pinned.length > 0 ? pinned : roots.value.slice(0, 6)
})

const children = computed(() => {
  if (!form.categoryId) return []
  return props.categories
    .filter((category) => category.parentId === form.categoryId && category.status === 'active')
    .sort((left, right) => left.sortOrder - right.sortOrder)
})

function publish(): void {
  emit('update:draft', { ...form })
}

function setType(type: TransactionType): void {
  form.type = type
  form.categoryId = null
  form.subcategoryId = null
  automaticSubcategory.value = false
  moreOpen.value = false
  publish()
}

function selectRoot(category: Category): void {
  form.categoryId = category.id
  automaticSubcategory.value = true
  form.subcategoryId = suggestSubcategory(props.categories, category, parsedAmountMinor())
  publish()
}

function selectChild(category: Category): void {
  automaticSubcategory.value = false
  form.subcategoryId = form.subcategoryId === category.id ? null : category.id
  publish()
}

function parsedAmountMinor(): number | undefined {
  try {
    return parseAmountToMinor(form.amount)
  } catch {
    return undefined
  }
}

function updateAmount(): void {
  if (automaticSubcategory.value && form.categoryId) {
    const root = roots.value.find((category) => category.id === form.categoryId)
    if (root?.name === '餐饮') {
      form.subcategoryId = suggestSubcategory(props.categories, root, parsedAmountMinor())
    }
  }
  publish()
}

function submit(): void {
  if (!form.amount.trim() || !form.categoryId || props.saving) return
  emit('save', { ...form })
}
</script>

<template>
  <section class="entry-page" aria-labelledby="entry-title">
    <header class="entry-header">
      <div>
        <p class="eyebrow">QUICK ENTRY</p>
        <h1 id="entry-title">记一笔</h1>
        <p data-testid="latest-bookkeeping-time" class="latest-bookkeeping-time">{{ latestBookkeepingLabel }}</p>
      </div>
      <button class="icon-button" type="button" aria-label="管理分类" @click="emit('manage-categories')">⚙</button>
    </header>

    <form data-testid="save-entry" class="entry-card" :class="`${form.type}-mode`" @submit.prevent="submit">
      <div class="type-switch" aria-label="收支类型">
        <button
          data-testid="type-expense"
          type="button"
          :class="{ active: form.type === 'expense' }"
          @click="setType('expense')"
        >支出</button>
        <button
          data-testid="type-income"
          type="button"
          :class="{ active: form.type === 'income' }"
          @click="setType('income')"
        >收入</button>
      </div>

      <label class="amount-field">
        <span>金额</span>
        <span class="currency">¥</span>
        <input
          v-model="form.amount"
          data-testid="amount-input"
          aria-label="金额"
          inputmode="decimal"
          autocomplete="off"
          placeholder="0.00"
          @input="updateAmount"
        >
      </label>

      <div class="section-heading">
        <span>选择分类</span>
        <button v-if="roots.length > 6" type="button" @click="moreOpen = !moreOpen">
          {{ moreOpen ? '收起' : '更多' }}
        </button>
      </div>

      <div class="category-grid">
        <button
          v-for="category in visibleRoots"
          :key="category.id"
          :data-testid="`category-${category.id}`"
          type="button"
          class="category-tile"
          :class="{ selected: form.categoryId === category.id }"
          :style="{ '--category-color': category.color }"
          @click="selectRoot(category)"
        >
          <span class="category-icon">{{ category.icon }}</span>
          <span>{{ category.name }}</span>
        </button>
      </div>

      <Transition name="rise">
        <div v-if="children.length" class="subcategory-row" aria-label="二级分类">
          <button
            v-for="category in children"
            :key="category.id"
            :data-testid="`subcategory-${category.id}`"
            type="button"
            :class="{ selected: form.subcategoryId === category.id }"
            @click="selectChild(category)"
          >{{ category.name }}</button>
        </div>
      </Transition>

      <button
        data-testid="entry-details-toggle"
        class="details-toggle"
        type="button"
        :aria-expanded="detailsOpen"
        @click="detailsOpen = !detailsOpen"
      >
        <span>日期、时间与备注</span>
        <span>{{ detailsOpen ? '−' : '+' }}</span>
      </button>

      <Transition name="rise">
        <div v-if="detailsOpen" class="entry-details">
          <label>日期<input v-model="form.date" aria-label="日期" type="date" @input="publish"></label>
          <label>时间<input v-model="form.time" aria-label="时间" type="time" @input="publish"></label>
          <label class="note-field">备注<textarea v-model="form.note" aria-label="备注" maxlength="500" placeholder="可选" @input="publish" /></label>
        </div>
      </Transition>

      <button class="save-button" type="submit" :disabled="saving || !form.amount.trim() || !form.categoryId">
        <span>{{ saving ? '保存中…' : form.type === 'expense' ? '保存支出' : '保存收入' }}</span>
        <span aria-hidden="true">→</span>
      </button>
    </form>
  </section>
</template>

<style scoped>
.entry-page { width: 100%; max-width: 720px; margin: 0 auto; padding: 24px 20px 120px; }
.entry-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.eyebrow { margin: 0 0 4px; color: var(--accent); font-size: 11px; font-weight: 800; letter-spacing: .18em; }
h1 { margin: 0; color: var(--ink); font-size: clamp(28px, 7vw, 38px); letter-spacing: -.05em; }
.latest-bookkeeping-time { margin: 6px 0 0; color: var(--muted); font-size: 11px; font-weight: 650; }
.icon-button { width: 44px; height: 44px; border: 1px solid var(--line); border-radius: 15px; background: var(--surface); color: var(--muted); font-size: 19px; box-shadow: var(--shadow-soft); }
.entry-card { padding: 18px; border: 1px solid var(--line); border-radius: 28px; background: var(--surface); box-shadow: var(--shadow-card); }
.type-switch { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; padding: 4px; border-radius: 14px; background: var(--surface-2); }
.type-switch button { min-height: 40px; border: 0; border-radius: 11px; background: transparent; color: var(--muted); font-weight: 700; }
.type-switch button.active { background: var(--surface); color: var(--ink); box-shadow: 0 2px 10px rgb(15 23 42 / 8%); }
.expense-mode .type-switch [data-testid="type-expense"].active { background: var(--expense-soft); color: var(--expense-color); }
.income-mode .type-switch [data-testid="type-income"].active { background: var(--income-soft); color: var(--income-color); }
.amount-field { position: relative; display: grid; grid-template-columns: auto 1fr; align-items: end; margin: 24px 2px 28px; border-bottom: 1px solid var(--line); }
.amount-field > span:first-child { grid-column: 1 / -1; margin-bottom: 7px; color: var(--muted); font-size: 12px; font-weight: 700; }
.currency { padding: 0 8px 9px 0; color: var(--muted); font-size: 26px; font-weight: 700; }
.amount-field input { width: 100%; min-width: 0; padding: 0 0 6px; border: 0; outline: 0; background: transparent; color: var(--ink); font: 700 clamp(44px, 13vw, 66px)/1.1 var(--font-display); letter-spacing: -.055em; }
.amount-field input::placeholder { color: var(--ink-faint); }
.expense-mode .currency, .expense-mode .amount-field input { color: var(--expense-color); }
.income-mode .currency, .income-mode .amount-field input { color: var(--income-color); }
.section-heading { display: flex; justify-content: space-between; margin-bottom: 12px; color: var(--muted); font-size: 13px; font-weight: 700; }
.section-heading button { border: 0; background: transparent; color: var(--accent); font-weight: 700; }
.category-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.category-tile { display: flex; min-width: 0; flex-direction: column; align-items: center; gap: 7px; min-height: 86px; padding: 12px 5px; border: 1px solid var(--line); border-radius: 18px; background: var(--surface); color: var(--muted-strong); font-size: 12px; font-weight: 650; transition: .18s ease; }
.category-tile.selected { border-color: color-mix(in srgb, var(--category-color) 55%, transparent); background: color-mix(in srgb, var(--category-color) 10%, var(--surface)); color: var(--ink); transform: translateY(-2px); }
.category-icon { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 13px; background: color-mix(in srgb, var(--category-color) 13%, var(--surface-2)); font-size: 20px; }
.subcategory-row { display: flex; gap: 8px; margin-top: 14px; padding: 2px 0 4px; overflow-x: auto; scrollbar-width: none; }
.subcategory-row button { flex: 0 0 auto; padding: 9px 13px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--muted); font-weight: 650; }
.subcategory-row button.selected { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-strong); }
.details-toggle { display: flex; width: 100%; justify-content: space-between; margin-top: 18px; padding: 14px 2px 8px; border: 0; border-top: 1px solid var(--line); background: transparent; color: var(--muted); font-weight: 650; }
.entry-details { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding-top: 8px; }
.entry-details label { display: grid; gap: 6px; color: var(--muted); font-size: 12px; font-weight: 700; }
.entry-details input, .entry-details textarea { min-width: 0; padding: 11px 12px; border: 1px solid var(--line); border-radius: 12px; outline: none; background: var(--surface-2); color: var(--ink); font: inherit; }
.note-field { grid-column: 1 / -1; }
.note-field textarea { min-height: 68px; resize: vertical; }
.save-button { display: flex; width: 100%; min-height: 54px; align-items: center; justify-content: space-between; margin-top: 20px; padding: 0 20px; border: 0; border-radius: 17px; background: var(--accent); color: white; font-size: 15px; font-weight: 800; box-shadow: 0 12px 25px color-mix(in srgb, var(--accent) 28%, transparent); }
.expense-mode .save-button { background: var(--expense-color); color: var(--expense-on-color); box-shadow: 0 12px 25px color-mix(in srgb, var(--expense-color) 28%, transparent); }
.income-mode .save-button { background: var(--income-color); color: var(--income-on-color); box-shadow: 0 12px 25px color-mix(in srgb, var(--income-color) 28%, transparent); }
.save-button:disabled { background: var(--surface-2); color: var(--muted); box-shadow: none; cursor: not-allowed; opacity: .65; }
.rise-enter-active, .rise-leave-active { transition: .18s ease; }
.rise-enter-from, .rise-leave-to { opacity: 0; transform: translateY(-6px); }
@media (min-width: 680px) { .entry-page { padding-top: 36px; } .entry-card { padding: 24px; } .category-grid { grid-template-columns: repeat(6, 1fr); } }
</style>
