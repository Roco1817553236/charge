<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { SaveItemCategoryInput, SaveItemCostInput, SaveItemInput } from '../data/localRepository'
import { buildItemCostSummary, calculateItemMetrics } from '../domain/itemCosts'
import { formatMinor } from '../domain/money'
import type { ItemCategory, ItemCost, OwnedItem, Transaction } from '../domain/models'

const props = defineProps<{
  categories: ItemCategory[]
  items: OwnedItem[]
  costs: ItemCost[]
  transactions: Transaction[]
  asOfDate: string
  saving?: boolean
}>()

const emit = defineEmits<{
  'save-item': [input: SaveItemInput]
  'save-cost': [input: SaveItemCostInput]
  retire: [id: string, date: string]
  'restore-use': [id: string]
  'delete-item': [id: string]
  'delete-cost': [id: string]
  'save-category': [input: SaveItemCategoryInput]
  'remove-category': [id: string]
}>()

const statusFilter = ref<'active' | 'retired' | 'all'>('active')
const categoryFilter = ref('all')
const sortMode = ref<'daily-desc' | 'daily-asc' | 'newest'>('daily-desc')
const expandedItemId = ref<string | null>(null)
const dialog = ref<'choose' | 'item' | 'cost' | 'categories' | null>(null)
const itemSourceMode = ref<'manual' | 'source'>('manual')
const itemSourceId = ref('')
const costSourceId = ref('')
const formError = ref('')
const costItemId = ref('')

const activeCategories = computed(() => props.categories.filter((item) => !item.deletedAt && item.status === 'active'))
const expenseTransactions = computed(() => props.transactions.filter((item) => item.type === 'expense' && !item.deletedAt))
const linkedSourceCount = computed(() => itemSourceId.value
  ? props.items.filter((item) => !item.deletedAt && item.id !== itemForm.id && item.sourceTransactionId === itemSourceId.value).length
  : 0)

const summary = computed(() => buildItemCostSummary(props.items, props.costs, props.asOfDate, {
  status: statusFilter.value,
  categoryId: categoryFilter.value === 'all' ? null : categoryFilter.value,
}))

const visibleItems = computed(() => props.items
  .filter((item) => !item.deletedAt)
  .filter((item) => statusFilter.value === 'all' || (statusFilter.value === 'retired') === Boolean(item.retiredLocalDate))
  .filter((item) => categoryFilter.value === 'all' || item.categoryId === categoryFilter.value)
  .sort((left, right) => {
    if (sortMode.value === 'newest') return right.purchaseLocalDate.localeCompare(left.purchaseLocalDate)
    const leftDaily = calculateItemMetrics(left, props.costs, props.asOfDate).dailyCostMinor
    const rightDaily = calculateItemMetrics(right, props.costs, props.asOfDate).dailyCostMinor
    return sortMode.value === 'daily-asc' ? leftDaily - rightDaily : rightDaily - leftDaily
  }))

const itemForm = reactive({
  id: undefined as string | undefined,
  name: '', amount: '', categoryId: '', icon: '◇', purchaseDate: '', startDate: '', retiredDate: undefined as string | undefined, note: '',
})
const costForm = reactive({
  id: undefined as string | undefined,
  type: 'repair' as 'repair' | 'accessory', amount: '', date: '', note: '',
})
const categoryForm = reactive({ name: '', icon: '◇', color: '#6366F1' })

function itemCosts(itemId: string): ItemCost[] {
  return props.costs.filter((cost) => cost.itemId === itemId && !cost.deletedAt)
    .sort((left, right) => right.occurredLocalDate.localeCompare(left.occurredLocalDate))
}

function metrics(item: OwnedItem) {
  return calculateItemMetrics(item, props.costs, props.asOfDate)
}

function dailyText(item: OwnedItem): string {
  return `${formatMinor(Math.round(metrics(item).dailyCostMinor))}/天`
}

function summaryDaily(value: number | null): string {
  return value === null ? '—' : formatMinor(Math.round(value))
}

function categoryFor(item: OwnedItem): ItemCategory | undefined {
  return props.categories.find((category) => category.id === item.categoryId)
}

function sourceMissing(sourceTransactionId: string | null): boolean {
  return Boolean(sourceTransactionId && !props.transactions.some((transaction) => transaction.id === sourceTransactionId))
}

function toggleItem(id: string): void {
  expandedItemId.value = expandedItemId.value === id ? null : id
}

function resetItemForm(): void {
  Object.assign(itemForm, {
    id: undefined, name: '', amount: '', categoryId: activeCategories.value[0]?.id ?? '', icon: '◇',
    purchaseDate: props.asOfDate, startDate: props.asOfDate, retiredDate: undefined, note: '',
  })
  itemSourceId.value = ''
  formError.value = ''
}

function beginAdd(mode: 'manual' | 'source'): void {
  itemSourceMode.value = mode
  resetItemForm()
  dialog.value = 'item'
}

function editItem(item: OwnedItem): void {
  itemSourceMode.value = item.sourceTransactionId ? 'source' : 'manual'
  itemSourceId.value = item.sourceTransactionId ?? ''
  Object.assign(itemForm, {
    id: item.id, name: item.name, amount: (item.purchaseAmountMinor / 100).toFixed(2), categoryId: item.categoryId,
    icon: item.icon, purchaseDate: item.purchaseLocalDate, startDate: item.startedLocalDate,
    retiredDate: item.retiredLocalDate, note: item.note,
  })
  formError.value = ''
  dialog.value = 'item'
}

watch(itemSourceId, (id) => {
  if (!id || itemSourceMode.value !== 'source') return
  const transaction = expenseTransactions.value.find((item) => item.id === id)
  if (!transaction) return
  itemForm.amount = (transaction.amountMinor / 100).toFixed(2)
  itemForm.purchaseDate = transaction.occurredLocalDate
  itemForm.startDate = transaction.occurredLocalDate
  itemForm.note = transaction.note
  if (!itemForm.name) itemForm.name = transaction.note
})

function parseAmount(value: string, allowZero: boolean): number {
  if (!/^(?:\d+|\d*\.\d{1,2})$/.test(value.trim())) throw new Error('请输入最多两位小数的金额')
  const [yuan = '0', fraction = ''] = value.trim().split('.')
  const minor = Number(yuan || '0') * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(minor) || minor < 0 || (!allowZero && minor === 0)) throw new Error('金额无效')
  return minor
}

function submitItem(): void {
  try {
    const input: SaveItemInput = {
      ...(itemForm.id ? { id: itemForm.id } : {}),
      categoryId: itemForm.categoryId,
      name: itemForm.name,
      icon: itemForm.icon,
      note: itemForm.note,
      purchaseAmountMinor: parseAmount(itemForm.amount, true),
      purchaseLocalDate: itemForm.purchaseDate,
      startedLocalDate: itemForm.startDate,
      ...(itemForm.retiredDate ? { retiredLocalDate: itemForm.retiredDate } : {}),
      sourceTransactionId: itemSourceMode.value === 'source' ? itemSourceId.value || null : null,
    }
    formError.value = ''
    emit('save-item', input)
    dialog.value = null
  } catch (error) {
    formError.value = error instanceof Error ? error.message : '物品信息无效'
  }
}

function openCost(item: OwnedItem): void {
  costItemId.value = item.id
  costSourceId.value = ''
  Object.assign(costForm, { id: undefined, type: 'repair', amount: '', date: props.asOfDate, note: '' })
  formError.value = ''
  dialog.value = 'cost'
}

watch(costSourceId, (id) => {
  if (!id) return
  const transaction = expenseTransactions.value.find((item) => item.id === id)
  if (!transaction) return
  costForm.amount = (transaction.amountMinor / 100).toFixed(2)
  costForm.date = transaction.occurredLocalDate
  costForm.note = transaction.note
})

function submitCost(): void {
  try {
    emit('save-cost', {
      ...(costForm.id ? { id: costForm.id } : {}),
      itemId: costItemId.value,
      type: costForm.type,
      amountMinor: parseAmount(costForm.amount, false),
      occurredLocalDate: costForm.date,
      note: costForm.note,
      sourceTransactionId: costSourceId.value || null,
    })
    formError.value = ''
    dialog.value = null
  } catch (error) {
    formError.value = error instanceof Error ? error.message : '追加成本无效'
  }
}

function submitCategory(): void {
  emit('save-category', { ...categoryForm })
  categoryForm.name = ''
  categoryForm.icon = '◇'
}

function toggleCategory(category: ItemCategory): void {
  if (category.status === 'active') {
    emit('remove-category', category.id)
    return
  }
  emit('save-category', {
    id: category.id,
    name: category.name,
    icon: category.icon,
    color: category.color,
    sortOrder: category.sortOrder,
    status: 'active',
  })
}
</script>

<template>
  <section class="item-page" aria-labelledby="item-page-title">
    <header class="item-header">
      <div><p>ITEM COST</p><h1 id="item-page-title">物品日均</h1></div>
      <button type="button" aria-label="管理物品分类" @click="dialog = 'categories'">⚙</button>
    </header>

    <section class="item-summary" aria-label="物品成本汇总">
      <div><span>总投入成本</span><strong>{{ formatMinor(summary.totalCostMinor) }}</strong></div>
      <div><span>当前总日均</span><strong>{{ summaryDaily(summary.totalDailyMinor) }}</strong></div>
      <div class="summary-mini">
        <span><small>物品数量</small><b data-testid="item-count">{{ summary.itemCount }} 件</b></span>
        <span><small>最高日均</small><b>{{ summaryDaily(summary.highestDailyMinor) }}</b></span>
        <span><small>最低日均</small><b>{{ summaryDaily(summary.lowestDailyMinor) }}</b></span>
      </div>
    </section>

    <div class="item-filters">
      <select v-model="statusFilter" data-testid="item-status-filter" aria-label="物品状态">
        <option value="active">使用中</option><option value="retired">已停用</option><option value="all">全部状态</option>
      </select>
      <select v-model="categoryFilter" data-testid="item-category-filter" aria-label="物品分类">
        <option value="all">全部分类</option><option v-for="category in categories.filter((item) => !item.deletedAt)" :key="category.id" :value="category.id">{{ category.name }}</option>
      </select>
      <select v-model="sortMode" aria-label="物品排序">
        <option value="daily-desc">日均从高</option><option value="daily-asc">日均从低</option><option value="newest">最近购入</option>
      </select>
    </div>

    <div v-if="visibleItems.length === 0" data-testid="item-empty" class="item-empty">这个筛选条件下暂无物品</div>
    <div v-else class="item-list">
      <article v-for="item in visibleItems" :key="item.id" class="item-card">
        <button :data-testid="`item-card-${item.id}`" type="button" class="item-row" :aria-expanded="expandedItemId === item.id" @click="toggleItem(item.id)">
          <span class="item-icon" :style="{ background: `${categoryFor(item)?.color ?? '#64748B'}22` }">{{ item.icon || categoryFor(item)?.icon }}</span>
          <span class="item-copy"><strong>{{ item.name }}</strong><small>总成本 {{ formatMinor(metrics(item).totalCostMinor) }} · {{ item.startedLocalDate }}</small></span>
          <span class="item-daily"><strong>{{ dailyText(item) }}</strong><small>{{ metrics(item).usageDays }} 天⌄</small></span>
        </button>
        <div v-if="expandedItemId === item.id" :data-testid="`item-details-${item.id}`" class="item-details">
          <div><span>购买价格</span><strong>{{ formatMinor(item.purchaseAmountMinor) }}</strong></div>
          <div v-if="item.retiredLocalDate"><span>停用日期</span><strong>{{ item.retiredLocalDate }}</strong></div>
          <div v-if="sourceMissing(item.sourceTransactionId)" class="missing-source"><span>购买来源</span><strong>来源流水已删除</strong></div>
          <div v-for="cost in itemCosts(item.id)" :key="cost.id">
            <span>{{ cost.type === 'repair' ? '维修' : '配件' }} · {{ cost.note || cost.occurredLocalDate }}<em v-if="sourceMissing(cost.sourceTransactionId)"> · 来源流水已删除</em></span>
            <strong>+ {{ formatMinor(cost.amountMinor) }} <button type="button" aria-label="删除追加成本" @click="emit('delete-cost', cost.id)">×</button></strong>
          </div>
          <div><span>总成本</span><strong>{{ formatMinor(metrics(item).totalCostMinor) }}</strong></div>
          <div class="item-actions">
            <button type="button" @click="openCost(item)">＋ 追加成本</button>
            <button type="button" @click="editItem(item)">编辑</button>
            <button v-if="item.retiredLocalDate" type="button" @click="emit('restore-use', item.id)">恢复使用</button>
            <button v-else type="button" @click="emit('retire', item.id, asOfDate)">停用</button>
            <button type="button" @click="emit('delete-item', item.id)">删除</button>
          </div>
        </div>
      </article>
    </div>

    <button data-testid="add-item" class="item-fab" type="button" aria-label="新增物品" @click="dialog = 'choose'">＋</button>

    <Teleport to="body">
    <div v-if="dialog" class="item-dialog-backdrop" @click.self="dialog = null">
      <section class="item-dialog" role="dialog" aria-modal="true">
        <header><strong>{{ dialog === 'categories' ? '物品分类' : dialog === 'cost' ? '追加成本' : dialog === 'item' ? (itemForm.id ? '编辑物品' : '新增物品') : '新增物品' }}</strong><button type="button" aria-label="关闭" @click="dialog = null">×</button></header>

        <div v-if="dialog === 'choose'" class="source-choices">
          <button data-testid="add-item-source" type="button" @click="beginAdd('source')"><b>☷</b><span><strong>从支出流水创建</strong><small>自动带入金额和日期</small></span></button>
          <button data-testid="add-item-manual" type="button" @click="beginAdd('manual')"><b>＋</b><span><strong>手动添加物品</strong><small>适合旧物、赠品或没有流水的记录</small></span></button>
        </div>

        <form v-else-if="dialog === 'item'" data-testid="item-form" class="item-form" @submit.prevent="submitItem">
          <label v-if="itemSourceMode === 'source'">来源支出<select v-model="itemSourceId" data-testid="item-source-input" required><option value="" disabled>选择支出流水</option><option v-for="transaction in expenseTransactions" :key="transaction.id" :value="transaction.id">{{ transaction.occurredLocalDate }} · {{ formatMinor(transaction.amountMinor) }} · {{ transaction.note || '无备注' }}</option></select></label>
          <p v-if="linkedSourceCount > 0" class="source-warning">该流水已经关联 {{ linkedSourceCount }} 件物品，仍可继续创建</p>
          <div class="form-pair"><label>物品名称<input v-model="itemForm.name" data-testid="item-name-input" required maxlength="100"></label><label>图标<input v-model="itemForm.icon" maxlength="4"></label></div>
          <div class="form-pair"><label>购买金额<input v-model="itemForm.amount" data-testid="item-amount-input" inputmode="decimal" required></label><label>物品分类<select v-model="itemForm.categoryId" data-testid="item-category-input" required><option v-for="category in activeCategories" :key="category.id" :value="category.id">{{ category.name }}</option></select></label></div>
          <div class="form-pair"><label>购买日期<input v-model="itemForm.purchaseDate" data-testid="item-purchase-date-input" type="date" required></label><label>开始使用<input v-model="itemForm.startDate" data-testid="item-start-date-input" type="date" required></label></div>
          <label>备注<textarea v-model="itemForm.note" maxlength="500" rows="2" /></label>
          <p v-if="formError" role="alert" class="form-error">{{ formError }}</p>
          <button class="dialog-primary" type="submit" :disabled="saving">{{ saving ? '保存中…' : '保存物品' }}</button>
        </form>

        <form v-else-if="dialog === 'cost'" class="item-form" @submit.prevent="submitCost">
          <div class="type-tabs"><button type="button" :class="{ active: costForm.type === 'repair' }" @click="costForm.type = 'repair'">维修费</button><button type="button" :class="{ active: costForm.type === 'accessory' }" @click="costForm.type = 'accessory'">配件费</button></div>
          <label>关联支出（可选）<select v-model="costSourceId"><option value="">手动填写</option><option v-for="transaction in expenseTransactions" :key="transaction.id" :value="transaction.id">{{ transaction.occurredLocalDate }} · {{ formatMinor(transaction.amountMinor) }} · {{ transaction.note || '无备注' }}</option></select></label>
          <div class="form-pair"><label>金额<input v-model="costForm.amount" inputmode="decimal" required></label><label>发生日期<input v-model="costForm.date" type="date" required></label></div>
          <label>说明<textarea v-model="costForm.note" maxlength="500" rows="2" /></label>
          <p v-if="formError" role="alert" class="form-error">{{ formError }}</p>
          <button class="dialog-primary" type="submit" :disabled="saving">保存追加成本</button>
        </form>

        <div v-else-if="dialog === 'categories'" class="category-manager">
          <div v-for="category in categories.filter((item) => !item.deletedAt)" :key="category.id" class="category-row"><span>{{ category.icon }} {{ category.name }}</span><button type="button" @click="toggleCategory(category)">{{ category.status === 'active' ? '归档' : '恢复' }}</button></div>
          <form class="item-form" @submit.prevent="submitCategory"><div class="form-pair"><label>名称<input v-model="categoryForm.name" required maxlength="40"></label><label>图标<input v-model="categoryForm.icon" maxlength="4"></label></div><label>颜色<input v-model="categoryForm.color" type="color"></label><button class="dialog-primary" type="submit">新增分类</button></form>
        </div>
      </section>
    </div>
    </Teleport>
  </section>
</template>

<style scoped>
.item-page { min-height: 100%; padding: 26px 18px 120px; background: var(--app-bg); color: var(--ink); }
.item-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px; }
.item-header p { margin: 0 0 3px; color: var(--accent-strong); font-size: 10px; font-weight: 800; letter-spacing: .16em; }
.item-header h1 { margin: 0; font-size: 26px; letter-spacing: -.04em; }
.item-header > button { width: 40px; height: 40px; border: 1px solid var(--line); border-radius: 13px; background: var(--surface); color: var(--ink); }
.item-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 13px; padding: 19px; border-radius: 22px; background: linear-gradient(135deg, var(--accent), #8778ff); color: white; box-shadow: 0 16px 38px rgb(109 93 252 / 24%); }
.item-summary span { display: block; margin-bottom: 4px; font-size: 11px; opacity: .82; }
.item-summary strong { font-size: 23px; letter-spacing: -.04em; }
.summary-mini { display: grid; grid-column: 1 / -1; grid-template-columns: repeat(3, 1fr); padding-top: 12px; border-top: 1px solid rgb(255 255 255 / 25%); text-align: center; }
.summary-mini span { display: grid; gap: 3px; margin: 0; }
.summary-mini small { font-size: 10px; }
.summary-mini b { font-size: 13px; }
.item-filters { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin-bottom: 12px; }
.item-filters select, .item-form input, .item-form select, .item-form textarea { width: 100%; min-height: 40px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 11px; background: var(--surface); color: var(--ink); }
.item-list { display: grid; gap: 9px; }
.item-card { overflow: hidden; border: 1px solid var(--line); border-radius: 18px; background: var(--surface); box-shadow: var(--shadow-soft); }
.item-row { display: grid; width: 100%; grid-template-columns: 45px minmax(0, 1fr) auto; align-items: center; gap: 11px; padding: 13px; border: 0; background: transparent; color: inherit; text-align: left; }
.item-icon { display: grid; width: 45px; height: 45px; place-items: center; border-radius: 14px; font-size: 22px; }
.item-copy { min-width: 0; }
.item-copy strong, .item-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-copy small, .item-daily small { margin-top: 4px; color: var(--muted); font-size: 11px; }
.item-daily { text-align: right; }
.item-daily strong { display: block; color: var(--accent-strong); font-size: 14px; }
.item-details { padding: 0 13px 14px 69px; }
.item-details > div:not(.item-actions) { display: flex; justify-content: space-between; gap: 10px; padding: 7px 0; border-top: 1px solid var(--line); font-size: 12px; }
.item-details span { color: var(--muted); }
.item-details em, .missing-source strong { color: var(--danger); font-style: normal; }
.item-details strong { font-weight: 700; }
.item-details strong button { border: 0; background: transparent; color: var(--muted); }
.item-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
.item-actions button { min-height: 34px; padding: 0 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-soft); color: var(--ink); font-size: 11px; }
.item-actions button:first-child { border-color: transparent; background: var(--accent); color: white; }
.item-empty { padding: 50px 12px; color: var(--muted); text-align: center; }
.item-fab { position: sticky; z-index: 22; bottom: 82px; display: grid; width: 52px; height: 52px; place-items: center; margin: 24px 4px 0 auto; border: 0; border-radius: 17px; background: var(--accent); color: white; box-shadow: 0 12px 30px rgb(109 93 252 / 35%); font-size: 27px; }
.item-dialog-backdrop { position: fixed; z-index: 70; inset: 0; display: grid; padding: 18px; place-items: end center; background: rgb(15 23 42 / 38%); }
.item-dialog { width: min(100%, 500px); max-height: min(86vh, 760px); overflow-y: auto; padding: 18px; border: 1px solid var(--line); border-radius: 22px; background: var(--surface); box-shadow: 0 25px 70px rgb(15 23 42 / 28%); }
.item-dialog > header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.item-dialog > header strong { font-size: 19px; }
.item-dialog > header button { width: 34px; height: 34px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-soft); color: var(--ink); }
.source-choices { display: grid; gap: 9px; }
.source-choices > button { display: grid; grid-template-columns: 38px 1fr; align-items: center; gap: 10px; min-height: 66px; padding: 11px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface-soft); color: var(--ink); text-align: left; }
.source-choices b { display: grid; width: 36px; height: 36px; place-items: center; border-radius: 11px; background: var(--accent-soft); color: var(--accent-strong); }
.source-choices span strong, .source-choices span small { display: block; }
.source-choices small { margin-top: 3px; color: var(--muted); }
.item-form { display: grid; gap: 11px; }
.item-form label { display: grid; gap: 5px; color: var(--muted); font-size: 11px; }
.form-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
.dialog-primary { min-height: 43px; border: 0; border-radius: 12px; background: var(--accent); color: white; font-weight: 800; }
.form-error { margin: 0; color: var(--danger); font-size: 12px; }
.source-warning { margin: 0; padding: 8px 10px; border-radius: 10px; background: var(--accent-soft); color: var(--accent-strong); font-size: 11px; }
.type-tabs { display: grid; grid-template-columns: 1fr 1fr; padding: 4px; border-radius: 12px; background: var(--surface-soft); }
.type-tabs button { min-height: 36px; border: 0; border-radius: 9px; background: transparent; color: var(--muted); }
.type-tabs button.active { background: var(--surface); color: var(--accent-strong); box-shadow: var(--shadow-soft); }
.category-manager { display: grid; gap: 8px; }
.category-row { display: flex; align-items: center; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid var(--line); }
.category-row button { border: 0; background: transparent; color: var(--accent-strong); }
@media (max-width: 390px) { .item-page { padding-right: 12px; padding-left: 12px; } .item-summary { padding: 15px; } .item-summary strong { font-size: 20px; } .item-row { grid-template-columns: 40px minmax(0, 1fr) auto; gap: 8px; padding: 11px; } .item-icon { width: 40px; height: 40px; } .item-details { padding-left: 59px; } .form-pair { grid-template-columns: 1fr; } }
</style>
