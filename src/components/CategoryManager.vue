<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { getSubcategoryMoveImpact } from '../domain/categories'
import type { Category, Transaction, TransactionType } from '../domain/models'
import type { SaveCategoryInput } from '../data/localRepository'

const props = defineProps<{
  categories: Category[]
  transactions: Transaction[]
}>()

const emit = defineEmits<{
  save: [category: SaveCategoryInput, context: { affectedCount: number; previousParentId: string | null }]
  remove: [category: Category]
  reorder: [category: Category, direction: -1 | 1]
  close: []
}>()

const activeType = ref<TransactionType>('expense')
const editing = ref<Category | null>(null)
const formOpen = ref(false)
const form = reactive<SaveCategoryInput>({
  type: 'expense', parentId: null, name: '', icon: '●', color: '#6366F1', isPinned: false,
})

const roots = computed(() => props.categories
  .filter((category) => category.type === activeType.value && category.parentId === null && category.status === 'active')
  .sort((left, right) => left.sortOrder - right.sortOrder))

const archived = computed(() => props.categories
  .filter((category) => category.type === activeType.value && category.status === 'archived')
  .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')))

const affectedCount = computed(() => {
  if (!editing.value || editing.value.parentId === null || form.parentId === editing.value.parentId) return 0
  return getSubcategoryMoveImpact(editing.value.id, props.transactions)
})

function childrenOf(rootId: string): Category[] {
  return props.categories
    .filter((category) => category.parentId === rootId && category.status === 'active')
    .sort((left, right) => left.sortOrder - right.sortOrder)
}

function openNew(parentId: string | null): void {
  editing.value = null
  Object.assign(form, {
    id: undefined,
    type: activeType.value,
    parentId,
    name: '',
    icon: parentId ? '◦' : '●',
    color: parentId ? roots.value.find((root) => root.id === parentId)?.color ?? '#6366F1' : '#6366F1',
    isPinned: false,
  })
  formOpen.value = true
}

function openEdit(category: Category): void {
  editing.value = category
  Object.assign(form, {
    id: category.id,
    type: category.type,
    parentId: category.parentId,
    name: category.name,
    icon: category.icon,
    color: category.color,
    isPinned: category.isPinned,
    sortOrder: category.sortOrder,
    status: category.status,
  })
  formOpen.value = true
}

function submit(): void {
  emit('save', { ...form }, {
    affectedCount: affectedCount.value,
    previousParentId: editing.value?.parentId ?? null,
  })
  formOpen.value = false
}
</script>

<template>
  <section class="category-manager" aria-labelledby="category-title">
    <header class="manager-header">
      <div><p>CATEGORIES</p><h2 id="category-title">分类管理</h2></div>
      <button type="button" aria-label="关闭分类管理" @click="emit('close')">×</button>
    </header>

    <div class="type-tabs">
      <button type="button" :class="{ active: activeType === 'expense' }" @click="activeType = 'expense'">支出分类</button>
      <button type="button" :class="{ active: activeType === 'income' }" @click="activeType = 'income'">收入分类</button>
    </div>

    <button data-testid="add-root-category" class="add-root" type="button" @click="openNew(null)"><span>＋</span>新增大类</button>

    <div class="category-tree">
      <article v-for="(root, rootIndex) in roots" :key="root.id" class="root-card">
        <header>
          <span class="root-icon" :style="{ background: `color-mix(in srgb, ${root.color} 13%, var(--surface-2))` }">{{ root.icon }}</span>
          <div><strong>{{ root.name }}</strong><small>{{ childrenOf(root.id).length }} 个二级分类<template v-if="root.isPinned"> · 已固定</template></small></div>
          <div class="tree-actions">
            <button type="button" :disabled="rootIndex === 0" aria-label="上移" @click="emit('reorder', root, -1)">↑</button>
            <button type="button" :disabled="rootIndex === roots.length - 1" aria-label="下移" @click="emit('reorder', root, 1)">↓</button>
            <button :data-testid="`edit-category-${root.id}`" type="button" aria-label="编辑大类" @click="openEdit(root)">✎</button>
          </div>
        </header>
        <div class="children-list">
          <button
            v-for="child in childrenOf(root.id)"
            :key="child.id"
            :data-testid="`edit-category-${child.id}`"
            type="button"
            @click="openEdit(child)"
          ><span>{{ child.icon }}</span>{{ child.name }}<i>›</i></button>
          <button class="add-child" type="button" @click="openNew(root.id)">＋ 添加二级分类</button>
        </div>
      </article>
    </div>

    <details v-if="archived.length" class="archived-list">
      <summary>已归档（{{ archived.length }}）</summary>
      <button v-for="category in archived" :key="category.id" type="button" @click="openEdit(category)">{{ category.icon }} {{ category.name }}</button>
    </details>

    <div v-if="formOpen" class="form-backdrop" @click.self="formOpen = false">
      <form data-testid="category-form" class="category-form" @submit.prevent="submit">
        <header><strong>{{ editing ? '编辑分类' : form.parentId ? '新增二级分类' : '新增大类' }}</strong><button type="button" @click="formOpen = false">×</button></header>
        <div class="icon-name-row">
          <label>图标<input v-model="form.icon" aria-label="分类图标" maxlength="4"></label>
          <label>名称<input v-model="form.name" aria-label="分类名称" maxlength="20" required autofocus></label>
        </div>
        <label>颜色<input v-model="form.color" aria-label="分类颜色" type="color"></label>
        <label v-if="form.parentId !== null || (editing !== null && editing.parentId !== null)">所属大类
          <select v-model="form.parentId" aria-label="所属大类">
            <option v-for="root in roots" :key="root.id" :value="root.id">{{ root.name }}</option>
          </select>
        </label>
        <label v-if="form.parentId === null" class="checkbox-row">
          <input v-model="form.isPinned" aria-label="固定到快速记账" type="checkbox">固定到快速记账（最多显示六个）
        </label>
        <label v-if="editing">状态
          <select v-model="form.status" aria-label="分类状态">
            <option value="active">启用</option>
            <option value="archived">归档</option>
          </select>
        </label>
        <p v-if="affectedCount" class="impact-warning">移动后会影响 {{ affectedCount }} 笔历史流水的统计归属，保存前会再次确认。</p>
        <div class="form-actions">
          <button v-if="editing" class="remove-button" type="button" @click="emit('remove', editing); formOpen = false">归档/删除</button>
          <span />
          <button type="button" @click="formOpen = false">取消</button>
          <button class="primary-button" type="submit">保存</button>
        </div>
      </form>
    </div>
  </section>
</template>

<style scoped>
.category-manager { min-height: 100%; padding: 22px 18px 110px; background: var(--app-bg); }
.manager-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }.manager-header p { margin: 0 0 3px; color: var(--accent); font-size: 10px; font-weight: 800; letter-spacing: .17em; }.manager-header h2 { margin: 0; color: var(--ink); font-size: 24px; letter-spacing: -.04em; }.manager-header > button { width: 38px; height: 38px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--muted); font-size: 23px; }
.type-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; border-radius: 14px; background: var(--surface-2); }.type-tabs button { padding: 10px; border: 0; border-radius: 10px; background: transparent; color: var(--muted); font-weight: 700; }.type-tabs button.active { background: var(--surface); color: var(--ink); box-shadow: var(--shadow-soft); }
.add-root { display: flex; width: 100%; align-items: center; justify-content: center; gap: 7px; margin: 14px 0; padding: 12px; border: 1px dashed color-mix(in srgb, var(--accent) 40%, var(--line)); border-radius: 15px; background: var(--accent-soft); color: var(--accent-strong); font-weight: 750; }.add-root span { font-size: 18px; }
.category-tree { display: grid; gap: 11px; }.root-card { overflow: hidden; border: 1px solid var(--line); border-radius: 18px; background: var(--surface); box-shadow: var(--shadow-soft); }.root-card > header { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 12px; }.root-icon { display: grid; width: 40px; height: 40px; place-items: center; border-radius: 13px; font-size: 19px; }.root-card header > div:nth-child(2) { display: grid; gap: 3px; }.root-card strong { color: var(--ink); font-size: 13px; }.root-card small { color: var(--muted); font-size: 10px; }.tree-actions { display: flex; gap: 2px; }.tree-actions button { width: 27px; height: 29px; border: 0; border-radius: 8px; background: var(--surface-2); color: var(--muted); }.tree-actions button:disabled { opacity: .25; }
.children-list { display: grid; padding: 0 12px 10px 62px; }.children-list button { display: grid; grid-template-columns: 20px 1fr auto; align-items: center; padding: 9px 5px; border: 0; border-top: 1px solid var(--line); background: transparent; color: var(--muted-strong); font-size: 11px; text-align: left; }.children-list i { color: var(--muted); font-style: normal; }.children-list .add-child { display: block; color: var(--accent); font-weight: 700; }
.archived-list { margin-top: 14px; padding: 12px; border: 1px solid var(--line); border-radius: 14px; color: var(--muted); font-size: 11px; }.archived-list button { margin: 8px 6px 0 0; padding: 7px 9px; border: 0; border-radius: 9px; background: var(--surface-2); color: var(--muted); }
.form-backdrop { position: fixed; z-index: 50; inset: 0; display: flex; align-items: end; justify-content: center; padding: 16px; background: rgb(15 23 42 / 38%); backdrop-filter: blur(4px); }.category-form { display: grid; width: min(100%, 470px); gap: 13px; padding: 18px; border: 1px solid var(--line); border-radius: 24px; background: var(--surface); box-shadow: 0 25px 80px rgb(15 23 42 / 24%); }.category-form > header { display: flex; align-items: center; justify-content: space-between; }.category-form > header strong { color: var(--ink); font-size: 16px; }.category-form > header button { border: 0; background: transparent; color: var(--muted); font-size: 22px; }.category-form label { display: grid; gap: 6px; color: var(--muted); font-size: 11px; font-weight: 700; }.category-form input:not([type="checkbox"]), .category-form select { min-width: 0; padding: 11px; border: 1px solid var(--line); border-radius: 11px; background: var(--surface-2); color: var(--ink); font: inherit; }.category-form input[type="color"] { width: 100%; height: 42px; padding: 5px; }.icon-name-row { display: grid; grid-template-columns: 76px 1fr; gap: 10px; }.checkbox-row { display: flex !important; align-items: center; gap: 8px !important; }.impact-warning { margin: 0; padding: 10px; border-radius: 10px; background: #FEF3C7; color: #92400E; font-size: 10px; line-height: 1.5; }.form-actions { display: grid; grid-template-columns: auto 1fr auto auto; gap: 7px; margin-top: 2px; }.form-actions button { padding: 9px 12px; border: 0; border-radius: 10px; background: var(--surface-2); color: var(--muted-strong); font-weight: 700; }.form-actions .primary-button { background: var(--accent); color: white; }.form-actions .remove-button { background: transparent; color: var(--danger); padding-left: 0; }
@media (min-width: 680px) { .form-backdrop { align-items: center; }.category-manager { padding: 28px; } }
</style>
