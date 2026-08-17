<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Category, Transaction, TransactionType } from '../domain/models'
import { formatMinor } from '../domain/money'

const props = defineProps<{
  transactions: Transaction[]
  categories: Category[]
  initialMonth: string
}>()

const emit = defineEmits<{
  edit: [transaction: Transaction]
  duplicate: [transaction: Transaction]
  delete: [transaction: Transaction]
}>()

const query = ref('')
const month = ref(props.initialMonth)
const type = ref<TransactionType | 'all'>('all')
const categoryId = ref('all')
const subcategoryId = ref('all')
const openActions = ref<string | null>(null)

const categoryMap = computed(() => new Map(props.categories.map((category) => [category.id, category])))
const rootCategories = computed(() => props.categories
  .filter((category) => category.parentId === null && !category.deletedAt)
  .sort((left, right) => left.sortOrder - right.sortOrder))
const childCategories = computed(() => categoryId.value === 'all' ? [] : props.categories
  .filter((category) => category.parentId === categoryId.value && !category.deletedAt)
  .sort((left, right) => left.sortOrder - right.sortOrder))

watch(categoryId, () => { subcategoryId.value = 'all' })

const filtered = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase('zh-CN')
  return props.transactions
    .filter((transaction) => !transaction.deletedAt)
    .filter((transaction) => !month.value || transaction.occurredLocalDate.startsWith(month.value))
    .filter((transaction) => type.value === 'all' || transaction.type === type.value)
    .filter((transaction) => categoryId.value === 'all' || resolvedRootId(transaction) === categoryId.value)
    .filter((transaction) => subcategoryId.value === 'all' || transaction.subcategoryId === subcategoryId.value)
    .filter((transaction) => {
      if (!needle) return true
      const category = resolvedCategory(transaction)
      return `${transaction.note} ${category.root?.name ?? ''} ${category.child?.name ?? ''}`
        .toLocaleLowerCase('zh-CN')
        .includes(needle)
    })
    .sort((left, right) => `${right.occurredLocalDate}T${right.occurredLocalTime}`.localeCompare(`${left.occurredLocalDate}T${left.occurredLocalTime}`))
})

const groups = computed(() => {
  const byDate = new Map<string, Transaction[]>()
  filtered.value.forEach((transaction) => {
    const rows = byDate.get(transaction.occurredLocalDate) ?? []
    rows.push(transaction)
    byDate.set(transaction.occurredLocalDate, rows)
  })
  return [...byDate.entries()].map(([date, rows]) => ({
    date,
    rows,
    expenseMinor: rows.reduce((sum, row) => sum + (row.type === 'expense' ? row.amountMinor : 0), 0),
    incomeMinor: rows.reduce((sum, row) => sum + (row.type === 'income' ? row.amountMinor : 0), 0),
  }))
})

function resolvedRootId(transaction: Transaction): string {
  const child = transaction.subcategoryId ? categoryMap.value.get(transaction.subcategoryId) : undefined
  return child?.parentId ?? transaction.categoryId
}

function resolvedCategory(transaction: Transaction): { root: Category | undefined; child: Category | undefined } {
  const child = transaction.subcategoryId ? categoryMap.value.get(transaction.subcategoryId) : undefined
  return { root: categoryMap.value.get(child?.parentId ?? transaction.categoryId), child }
}

function dateLabel(date: string): string {
  const [, monthPart, dayPart] = date.split('-')
  return `${Number(monthPart)}月${Number(dayPart)}日`
}

function act(event: 'edit' | 'duplicate' | 'delete', transaction: Transaction): void {
  openActions.value = null
  if (event === 'edit') emit('edit', transaction)
  else if (event === 'duplicate') emit('duplicate', transaction)
  else emit('delete', transaction)
}
</script>

<template>
  <section class="ledger-page" aria-labelledby="ledger-title">
    <header class="page-header">
      <div>
        <p class="eyebrow">ALL ACTIVITY</p>
        <h1 id="ledger-title">流水</h1>
      </div>
      <div class="month-chip">{{ month || '全部月份' }}</div>
    </header>

    <div class="filter-card">
      <label class="search-field">
        <span aria-hidden="true">⌕</span>
        <input v-model="query" data-testid="ledger-search" type="search" placeholder="搜索备注或分类" aria-label="搜索流水">
      </label>
      <div class="filter-row">
        <input v-model="month" aria-label="筛选月份" type="month">
        <select v-model="type" aria-label="筛选收支类型">
          <option value="all">全部收支</option>
          <option value="expense">仅支出</option>
          <option value="income">仅收入</option>
        </select>
        <select v-model="categoryId" aria-label="筛选大类">
          <option value="all">全部分类</option>
          <option v-for="category in rootCategories" :key="category.id" :value="category.id">{{ category.name }}</option>
        </select>
        <select v-if="categoryId !== 'all'" v-model="subcategoryId" aria-label="筛选二级分类">
          <option value="all">全部二级分类</option>
          <option v-for="category in childCategories" :key="category.id" :value="category.id">
            {{ category.name }}{{ category.status === 'archived' ? '（已归档）' : '' }}
          </option>
        </select>
      </div>
    </div>

    <div v-if="groups.length" class="ledger-groups">
      <section v-for="group in groups" :key="group.date" class="day-group">
        <header class="day-header">
          <strong>{{ dateLabel(group.date) }}</strong>
          <span>
            <template v-if="group.expenseMinor">支出 {{ formatMinor(group.expenseMinor) }}</template>
            <template v-if="group.incomeMinor"> · 收入 {{ formatMinor(group.incomeMinor) }}</template>
          </span>
        </header>

        <article v-for="transaction in group.rows" :key="transaction.id" class="transaction-row">
          <span
            class="transaction-icon"
            :style="{ '--row-color': resolvedCategory(transaction).root?.color ?? '#64748B' }"
          >{{ resolvedCategory(transaction).root?.icon ?? '•' }}</span>
          <div class="transaction-main">
            <strong>{{ transaction.note || resolvedCategory(transaction).child?.name || resolvedCategory(transaction).root?.name || '未命名流水' }}</strong>
            <span>{{ transaction.occurredLocalTime }} · {{ resolvedCategory(transaction).root?.name }}<template v-if="resolvedCategory(transaction).child"> / {{ resolvedCategory(transaction).child?.name }}</template></span>
          </div>
          <strong class="transaction-amount" :class="transaction.type">
            {{ transaction.type === 'expense' ? '−' : '+' }}{{ formatMinor(transaction.amountMinor) }}
          </strong>
          <div class="action-wrap">
            <button
              :data-testid="`actions-${transaction.id}`"
              class="more-button"
              type="button"
              :aria-label="`操作 ${transaction.note || '流水'}`"
              @click="openActions = openActions === transaction.id ? null : transaction.id"
            >•••</button>
            <div v-if="openActions === transaction.id" class="action-menu">
              <button :data-testid="`edit-${transaction.id}`" type="button" @click="act('edit', transaction)">编辑</button>
              <button :data-testid="`duplicate-${transaction.id}`" type="button" @click="act('duplicate', transaction)">复制</button>
              <button :data-testid="`delete-${transaction.id}`" class="danger" type="button" @click="act('delete', transaction)">删除</button>
            </div>
          </div>
        </article>
      </section>
    </div>

    <div v-else class="empty-state">
      <span>◌</span>
      <strong>没有匹配的流水</strong>
      <p>换个筛选条件，或去记下第一笔吧。</p>
    </div>
  </section>
</template>

<style scoped>
.ledger-page { width: 100%; max-width: 840px; margin: 0 auto; padding: 24px 20px 120px; }
.page-header { display: flex; align-items: end; justify-content: space-between; margin-bottom: 18px; }
.eyebrow { margin: 0 0 4px; color: var(--accent); font-size: 11px; font-weight: 800; letter-spacing: .18em; }
h1 { margin: 0; color: var(--ink); font-size: clamp(28px, 7vw, 38px); letter-spacing: -.05em; }
.month-chip { padding: 8px 11px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--muted); font-size: 12px; font-weight: 700; }
.filter-card { margin-bottom: 20px; padding: 12px; border: 1px solid var(--line); border-radius: 20px; background: var(--surface); box-shadow: var(--shadow-soft); }
.search-field { display: flex; align-items: center; gap: 8px; padding: 0 4px 10px; border-bottom: 1px solid var(--line); color: var(--muted); }
.search-field input { width: 100%; border: 0; outline: 0; background: transparent; color: var(--ink); font: inherit; }
.filter-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding-top: 10px; }
.filter-row input, .filter-row select { width: 100%; min-width: 0; padding: 9px 8px; border: 0; border-radius: 10px; outline: 0; background: var(--surface-2); color: var(--muted-strong); font: 600 11px/1.2 inherit; }
.ledger-groups { display: grid; gap: 22px; }
.day-header { display: flex; align-items: center; justify-content: space-between; margin: 0 3px 9px; color: var(--muted); font-size: 11px; }
.day-header strong { color: var(--ink); font-size: 14px; }
.day-group { min-width: 0; }
.transaction-row { position: relative; display: grid; grid-template-columns: 44px minmax(0, 1fr) auto 28px; align-items: center; gap: 11px; min-height: 72px; padding: 11px 10px; border-bottom: 1px solid var(--line); background: var(--surface); }
.transaction-row:first-of-type { border-radius: 18px 18px 0 0; }
.transaction-row:last-of-type { border-bottom: 0; border-radius: 0 0 18px 18px; }
.transaction-row:only-of-type { border-radius: 18px; }
.transaction-icon { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 14px; background: color-mix(in srgb, var(--row-color) 12%, var(--surface-2)); font-size: 20px; }
.transaction-main { display: grid; min-width: 0; gap: 4px; }
.transaction-main strong { overflow: hidden; color: var(--ink); font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.transaction-main span { overflow: hidden; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.transaction-amount { color: var(--ink); font-size: 14px; white-space: nowrap; }
.transaction-amount.income { color: var(--positive); }
.more-button { width: 28px; height: 34px; border: 0; background: transparent; color: var(--muted); font-size: 11px; letter-spacing: -1px; }
.action-wrap { position: relative; }
.action-menu { position: absolute; z-index: 5; top: 34px; right: 0; display: grid; width: 104px; padding: 5px; border: 1px solid var(--line); border-radius: 13px; background: var(--surface); box-shadow: var(--shadow-card); }
.action-menu button { padding: 9px; border: 0; border-radius: 8px; background: transparent; color: var(--ink); text-align: left; font-weight: 650; }
.action-menu button:hover { background: var(--surface-2); }
.action-menu .danger { color: var(--danger); }
.empty-state { display: grid; place-items: center; min-height: 300px; color: var(--muted); text-align: center; }
.empty-state > span { font-size: 54px; color: var(--ink-faint); }
.empty-state strong { color: var(--ink); }
.empty-state p { margin: 5px 0; font-size: 13px; }
@media (min-width: 680px) { .ledger-page { padding-top: 36px; } .filter-card { display: grid; grid-template-columns: .8fr 1.7fr; align-items: center; } .search-field { border-right: 1px solid var(--line); border-bottom: 0; padding: 0 12px 0 4px; } .filter-row { grid-template-columns: repeat(4, minmax(0, 1fr)); padding: 0 0 0 10px; } }
</style>
