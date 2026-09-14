<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import CategoryManager from './components/CategoryManager.vue'
import LedgerPage from './components/LedgerPage.vue'
import ItemPage from './components/ItemPage.vue'
import QuickEntryPage from './components/QuickEntryPage.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import StatsPage from './components/StatsPage.vue'
import SwipePager from './components/SwipePager.vue'
import type { SaveCategoryInput, SaveItemCategoryInput, SaveItemCostInput, SaveItemInput } from './data/localRepository'
import type { Category, Transaction } from './domain/models'
import { formatMinor } from './domain/money'
import {
  exportEncryptedBackup,
  exportPlainJson,
  importEncryptedBackup,
  MAX_BACKUP_FILE_BYTES,
  parsePlainJson,
} from './services/importExport'
import { PwaUpdateController } from './services/pwaUpdate'
import { useBookStore, type EntryDraft } from './stores/bookStore'
import { useItemStore } from './stores/itemStore'

const store = useBookStore()
const itemStore = useItemStore()
const {
  categories, transactions, draft, pageIndex, loading, saving, toast, error,
  monthComparisonMode, migrationRecoveryAvailable,
} = storeToRefs(store)
const {
  categories: itemCategories, items, costs: itemCosts, transactions: itemTransactions,
  saving: itemSaving, toast: itemToast, error: itemError,
} = storeToRefs(itemStore)
const categoryManagerOpen = ref(false)
const settingsOpen = ref(false)
const statsReturnTransactionId = ref<string | null>(null)
const duplicateCandidates = ref<Transaction[]>([])
const duplicateConfirming = ref(false)
const duplicateCancelButton = ref<HTMLButtonElement | null>(null)
const duplicateConfirmButton = ref<HTMLButtonElement | null>(null)
const updateController = new PwaUpdateController()
const updateState = updateController.state
const appVersion = import.meta.env.VITE_APP_VERSION || '1.7.0'
let dateRefreshTimer: number | null = null

function localToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

const today = ref(localToday())

watch(pageIndex, (page) => {
  if (page !== 3 || !itemStore.initialized) return
  void itemStore.refresh().catch(() => {
    itemStore.error = '刷新物品与来源流水失败'
  })
})

function scheduleDateRefresh(): void {
  const now = new Date()
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1)
  dateRefreshTimer = window.setTimeout(() => {
    today.value = localToday()
    scheduleDateRefresh()
  }, nextMidnight.getTime() - now.getTime())
}

onMounted(async () => {
  try {
    await store.initialize()
    await itemStore.initialize()
    scheduleDateRefresh()
    if (import.meta.env.PROD && 'serviceWorker' in navigator) await updateController.initialize()
  } catch {
    // The store exposes a user-safe error state and the app keeps the recovery screen mounted.
  }
})

onBeforeUnmount(() => {
  if (dateRefreshTimer !== null) window.clearTimeout(dateRefreshTimer)
})

async function saveDraft(value: EntryDraft): Promise<void> {
  store.updateDraft(value)
  try {
    const duplicates = store.previewDuplicateEntry()
    if (duplicates.length > 0) {
      store.error = null
      store.clearToast()
      duplicateCandidates.value = duplicates
      await nextTick()
      duplicateCancelButton.value?.focus()
      return
    }
    const returnedToStats = await saveCurrentEntry()
    if (returnedToStats) await focusStatsHeading()
  } catch {
    // Error is displayed next to the app shell.
  }
}

async function saveCurrentEntry(): Promise<boolean> {
  const operationEditingId = store.editingTransactionId
  const shouldReturnToStats = Boolean(operationEditingId) && statsReturnTransactionId.value === operationEditingId
  await store.saveEntry()
  if (!shouldReturnToStats || statsReturnTransactionId.value !== operationEditingId || store.editingTransactionId !== null) return false
  statsReturnTransactionId.value = null
  pageIndex.value = 2
  return true
}

async function focusStatsHeading(): Promise<void> {
  await nextTick()
  document.getElementById('stats-title')?.focus()
}

function editFromLedger(transaction: Transaction): void {
  if (saving.value) {
    store.toast = { message: '当前流水正在保存，请稍候' }
    return
  }
  statsReturnTransactionId.value = null
  store.beginEdit(transaction)
}

function duplicateFromLedger(transaction: Transaction): void {
  if (saving.value) {
    store.toast = { message: '当前流水正在保存，请稍候' }
    return
  }
  statsReturnTransactionId.value = null
  store.duplicateToDraft(transaction)
}

function editFromStats(transaction: Transaction): void {
  if (saving.value) {
    store.toast = { message: '当前流水正在保存，请稍候' }
    return
  }
  statsReturnTransactionId.value = transaction.id
  store.beginEdit(transaction)
}

function duplicateCategoryLabel(transaction: Transaction): string {
  const root = categories.value.find((category) => category.id === transaction.categoryId)
  const child = transaction.subcategoryId
    ? categories.value.find((category) => category.id === transaction.subcategoryId)
    : null
  if (root && child) return `${root.name} / ${child.name}`
  return root?.name ?? child?.name ?? '未知分类'
}

async function cancelDuplicateSave(): Promise<void> {
  if (duplicateConfirming.value) return
  duplicateCandidates.value = []
  await nextTick()
  document.querySelector<HTMLButtonElement>('[data-testid="save-entry"] .save-button')?.focus()
}

async function confirmDuplicateSave(): Promise<void> {
  if (duplicateConfirming.value) return
  duplicateConfirming.value = true
  try {
    const returnedToStats = await saveCurrentEntry()
    duplicateCandidates.value = []
    await nextTick()
    if (returnedToStats) document.getElementById('stats-title')?.focus()
    else document.querySelector<HTMLInputElement>('[data-testid="amount-input"]')?.focus()
  } catch {
    // Store error remains visible while the draft and confirmation stay intact.
  } finally {
    duplicateConfirming.value = false
  }
}

function handleDuplicateDialogKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    void cancelDuplicateSave()
    return
  }
  if (event.key !== 'Tab') return
  const first = duplicateCancelButton.value
  const last = duplicateConfirmButton.value
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function downloadText(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function backupFilename(extension: string): string {
  return `账页备份-${today.value}.${extension}`
}

async function exportEncrypted(password: string): Promise<void> {
  try {
    const result = await exportEncryptedBackup(await store.createSnapshot(), password)
    downloadText(backupFilename('encrypted.json'), result.fileContent, 'application/json;charset=utf-8')
    downloadRecovery(result.recoveryKey, '账页备份恢复密钥.txt')
    store.toast = { message: '加密备份与独立恢复密钥已下载' }
  } catch (caught) {
    store.error = caught instanceof Error ? caught.message : '加密备份生成失败'
  }
}

async function exportPlain(): Promise<void> {
  if (!window.confirm('明文 JSON 包含完整金额、分类和备注。确定继续下载吗？')) return
  downloadText(backupFilename('json'), exportPlainJson(await store.createSnapshot()), 'application/json;charset=utf-8')
  store.toast = { message: '明文 JSON 已下载，请妥善保管' }
}

async function exportMigrationRecovery(): Promise<void> {
  if (!window.confirm('迁移救援备份包含完整金额、分类和备注，且将以明文 JSON 下载。确定继续吗？')) return
  try {
    const snapshot = await store.getMigrationRecoverySnapshot()
    if (!snapshot) throw new Error('未找到可用的迁移救援备份')
    downloadText('账页-迁移救援备份.json', exportPlainJson(snapshot), 'application/json;charset=utf-8')
    store.toast = { message: '迁移救援备份已下载；文件为明文，请妥善保管' }
  } catch (caught) {
    store.error = caught instanceof Error ? caught.message : '迁移救援备份导出失败'
  }
}

async function importBackup(file: File, method: { password: string } | { recoveryKey: string } | null): Promise<void> {
  try {
    if (file.size > MAX_BACKUP_FILE_BYTES) throw new Error('备份文件超过 16 MiB 安全大小上限')
    const content = await file.text()
    const snapshot = method ? await importEncryptedBackup(content, method) : parsePlainJson(content)
    if (!window.confirm(`将使用“${file.name}”替换当前本机账本，确定继续吗？`)) return
    await store.restoreSnapshot(snapshot)
    await itemStore.refresh()
  } catch (caught) {
    store.error = caught instanceof Error ? caught.message : '备份恢复失败'
  }
}

function downloadRecovery(key: string, filename = '账页备份恢复密钥.txt'): void {
  downloadText(filename, `账页备份恢复密钥\n\n${key}\n\n请离线妥善保存。忘记备份密码且丢失此密钥后，加密 JSON 无法恢复。\n`, 'text/plain;charset=utf-8')
}

async function saveCategory(
  value: SaveCategoryInput,
  context: { affectedCount: number; previousParentId: string | null },
): Promise<void> {
  if (context.affectedCount > 0) {
    const confirmed = window.confirm(`移动会影响 ${context.affectedCount} 笔历史流水的分类统计，确定继续吗？`)
    if (!confirmed) return
  }
  try {
    await store.saveCategory(value)
  } catch {
    // Store error is shown by the shell.
  }
}

async function removeCategory(category: Category): Promise<void> {
  if (!window.confirm(`确定归档或删除“${category.name}”吗？`)) return
  try {
    await store.removeCategory(category)
  } catch {
    // Store error is shown by the shell.
  }
}

async function deleteTransaction(transaction: Transaction): Promise<void> {
  try {
    await store.deleteTransaction(transaction)
  } catch {
    // Store error is shown by the shell.
  }
}

async function saveItem(input: SaveItemInput, complete: (error?: string) => void): Promise<void> {
  try {
    await itemStore.saveItem(input)
    complete()
  } catch (caught) {
    complete(caught instanceof Error ? caught.message : '物品保存失败')
  }
}

async function saveItemCost(input: SaveItemCostInput, complete: (error?: string) => void): Promise<void> {
  try {
    await itemStore.saveCost(input)
    complete()
  } catch (caught) {
    complete(caught instanceof Error ? caught.message : '追加成本保存失败')
  }
}

async function retireItem(id: string, date: string): Promise<void> {
  if (!window.confirm('停用后将以该日期冻结使用天数和日均成本，确定继续吗？')) return
  try { await itemStore.retire(id, date) } catch { /* Item store exposes a user-safe error. */ }
}

async function deleteItem(id: string): Promise<void> {
  if (!window.confirm('确定删除这个物品吗？追加成本会保留用于撤销。')) return
  try { await itemStore.deleteItem(id) } catch { /* Item store exposes a user-safe error. */ }
}

async function deleteItemCost(id: string): Promise<void> {
  if (!window.confirm('确定删除这条追加成本吗？')) return
  try { await itemStore.deleteCost(id) } catch { /* Item store exposes a user-safe error. */ }
}

async function saveItemCategory(input: SaveItemCategoryInput): Promise<void> {
  try { await itemStore.saveCategory(input) } catch { /* Item store exposes a user-safe error. */ }
}

async function removeItemCategory(id: string): Promise<void> {
  if (!window.confirm('确定归档或删除这个物品分类吗？')) return
  try { await itemStore.removeCategory(id) } catch { /* Item store exposes a user-safe error. */ }
}

function applyAvailableUpdate(): void {
  const hasUnsavedDraft = Boolean(
    draft.value.amount.trim() || draft.value.categoryId || draft.value.subcategoryId || draft.value.note.trim()
      || store.editingTransactionId,
  )
  if (hasUnsavedDraft) {
    store.toast = { message: '当前有未保存草稿，请先保存或清空后再应用更新' }
    return
  }
  updateController.applyUpdate()
}
</script>

<template>
  <div class="app-shell">
    <div v-if="loading && !store.initialized" class="loading-screen" role="status">
      <span class="brand-mark">账</span>
      <strong>正在打开本地账本</strong>
      <i />
    </div>

    <template v-else>
      <div class="app-interaction-layer" :inert="duplicateCandidates.length > 0">
      <button class="settings-button" type="button" aria-label="打开设置与备份" title="设置与备份" @click="settingsOpen = true">
        <span aria-hidden="true">⚙</span>
      </button>

      <SwipePager v-model="pageIndex">
        <template #entry>
          <QuickEntryPage
            :categories="categories"
            :draft="draft"
            :saving="saving"
            :latest-bookkeeping-timestamp="store.latestBookkeepingTimestamp"
            :current-local-date="today"
            @update:draft="store.updateDraft"
            @save="saveDraft"
            @manage-categories="categoryManagerOpen = true"
          />
        </template>
        <template #ledger>
          <LedgerPage
            :transactions="transactions"
            :categories="categories"
            :initial-month="today.slice(0, 7)"
            @edit="editFromLedger"
            @duplicate="duplicateFromLedger"
            @delete="deleteTransaction"
          />
        </template>
        <template #stats>
          <StatsPage
            :transactions="transactions"
            :categories="categories"
            :as-of-date="today"
            :month-comparison-mode="monthComparisonMode"
            @update:month-comparison-mode="store.updateMonthComparisonMode"
            @edit="editFromStats"
          />
        </template>
        <template #items>
          <ItemPage
            :categories="itemCategories"
            :items="items"
            :costs="itemCosts"
            :transactions="itemTransactions"
            :as-of-date="today"
            :saving="itemSaving"
            @save-item="saveItem"
            @save-cost="saveItemCost"
            @retire="retireItem"
            @restore-use="itemStore.restoreUse"
            @delete-item="deleteItem"
            @delete-cost="deleteItemCost"
            @save-category="saveItemCategory"
            @remove-category="removeItemCategory"
          />
        </template>
      </SwipePager>

      <Transition name="drawer">
        <div v-if="categoryManagerOpen" class="drawer-backdrop" @click.self="categoryManagerOpen = false">
          <aside class="drawer-panel" aria-label="分类管理面板">
            <CategoryManager
              :categories="categories"
              :transactions="transactions"
              @close="categoryManagerOpen = false"
              @save="saveCategory"
              @remove="removeCategory"
              @reorder="store.reorderCategory"
            />
          </aside>
        </div>
      </Transition>

      <Transition name="drawer">
        <div v-if="settingsOpen" class="drawer-backdrop" @click.self="settingsOpen = false">
          <aside class="drawer-panel" aria-label="设置与备份面板">
            <SettingsPanel
              :app-version="appVersion"
              :update-available="updateState.updateAvailable"
              :offline-ready="updateState.offlineReady"
              :migration-recovery-available="migrationRecoveryAvailable"
              @close="settingsOpen = false"
              @export-encrypted="exportEncrypted"
              @export-plain="exportPlain"
              @import-file="importBackup"
              @apply-update="applyAvailableUpdate"
              @check-update="updateController.checkForUpdate()"
              @export-migration-recovery="exportMigrationRecovery"
            />
          </aside>
        </div>
      </Transition>

      <Transition name="toast">
        <div v-if="toast && pageIndex !== 3" class="toast-message" role="status">
          <span>{{ toast.message }}</span>
          <button v-if="toast.action === 'undo-delete'" type="button" @click="store.undoDelete">撤销</button>
          <button v-else-if="toast.action === 'undo-save'" type="button" @click="store.undoLastSave">撤销</button>
          <button type="button" aria-label="关闭提示" @click="store.clearToast">×</button>
        </div>
      </Transition>

      <Transition name="toast">
        <div v-if="itemToast && pageIndex === 3" class="toast-message" role="status">
          <span>{{ itemToast.message }}</span>
          <button v-if="itemToast.action === 'undo-delete'" type="button" @click="itemStore.undoLastDelete">撤销</button>
          <button v-else-if="itemToast.action === 'undo-retire'" type="button" @click="itemStore.undoLastRetire">撤销</button>
          <button type="button" aria-label="关闭物品提示" @click="itemStore.toast = null">×</button>
        </div>
      </Transition>

      <div v-if="error" class="error-banner" role="alert"><span>!</span>{{ error }}</div>
      <div v-else-if="itemError" class="error-banner" role="alert"><span>!</span>{{ itemError }}</div>
      </div>

      <Transition name="drawer">
        <div v-if="duplicateCandidates.length" class="dialog-backdrop">
          <section
            data-testid="duplicate-entry-dialog"
            class="duplicate-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="duplicate-entry-title"
            @keydown="handleDuplicateDialogKeydown"
          >
            <div class="duplicate-dialog-heading">
              <span aria-hidden="true">≋</span>
              <div>
                <h2 id="duplicate-entry-title">疑似重复账单</h2>
                <p>同一天、同金额的{{ draft.type === 'expense' ? '支出' : '收入' }}已有 {{ duplicateCandidates.length }} 笔。</p>
              </div>
            </div>
            <div class="duplicate-list">
              <article v-for="transaction in duplicateCandidates.slice(0, 3)" :key="transaction.id">
                <div>
                  <strong>{{ duplicateCategoryLabel(transaction) }}</strong>
                  <span>{{ transaction.note || '无备注' }}</span>
                </div>
                <b>{{ formatMinor(transaction.amountMinor) }}</b>
              </article>
              <p v-if="duplicateCandidates.length > 3" class="duplicate-more">
                另有 {{ duplicateCandidates.length - 3 }} 笔相同记录
              </p>
            </div>
            <p v-if="error" class="duplicate-error" role="alert">{{ error }}</p>
            <div class="duplicate-actions">
              <button
                ref="duplicateCancelButton"
                data-testid="duplicate-entry-cancel"
                type="button"
                :disabled="duplicateConfirming"
                @click="cancelDuplicateSave"
              >返回检查</button>
              <button
                ref="duplicateConfirmButton"
                data-testid="duplicate-entry-confirm"
                class="primary"
                type="button"
                :disabled="duplicateConfirming"
                @click="confirmDuplicateSave"
              >{{ duplicateConfirming ? '保存中…' : '仍然保存' }}</button>
            </div>
          </section>
        </div>
      </Transition>
    </template>
  </div>
</template>

<style scoped>
.app-shell { min-height: 100dvh; background: var(--app-bg); }
.loading-screen { display: grid; min-height: 100dvh; place-content: center; place-items: center; gap: 14px; color: var(--muted); }.brand-mark { display: grid; width: 64px; height: 64px; place-items: center; border-radius: 21px; background: var(--accent); color: white; font: 800 25px var(--font-display); box-shadow: 0 18px 45px color-mix(in srgb, var(--accent) 30%, transparent); }.loading-screen strong { color: var(--ink); font-size: 13px; }.loading-screen i { width: 34px; height: 3px; overflow: hidden; border-radius: 999px; background: var(--line); }.loading-screen i::after { display: block; width: 45%; height: 100%; border-radius: inherit; background: var(--accent); animation: loading 1s ease-in-out infinite alternate; content: ''; }
.settings-button { position: fixed; z-index: 25; top: max(12px, env(safe-area-inset-top)); right: 14px; display: grid; width: 38px; height: 38px; place-items: center; border: 1px solid var(--line); border-radius: 13px; background: color-mix(in srgb, var(--surface) 86%, transparent); color: var(--muted-strong); box-shadow: var(--shadow-soft); backdrop-filter: blur(12px); }.settings-button span { font-size: 17px; line-height: 1; }
.drawer-backdrop { position: fixed; z-index: 45; inset: 0; display: flex; justify-content: end; background: rgb(15 23 42 / 34%); backdrop-filter: blur(4px); }.drawer-panel { width: min(100%, 520px); height: 100%; overflow-y: auto; background: var(--app-bg); box-shadow: -24px 0 70px rgb(15 23 42 / 18%); }
.dialog-backdrop { position: fixed; z-index: 80; inset: 0; display: grid; place-items: center; padding: 20px; background: rgb(15 23 42 / 42%); backdrop-filter: blur(5px); }
.duplicate-dialog { width: min(100%, 430px); max-height: min(82dvh, 620px); overflow-y: auto; padding: 20px; border: 1px solid var(--line); border-radius: 24px; background: var(--surface); color: var(--ink); box-shadow: 0 28px 80px rgb(15 23 42 / 28%); }
.duplicate-dialog-heading { display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 12px; align-items: start; }.duplicate-dialog-heading > span { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 14px; background: var(--accent-soft); color: var(--accent-strong); font-size: 24px; font-weight: 800; }.duplicate-dialog h2 { margin: 1px 0 5px; font-size: 19px; }.duplicate-dialog-heading p { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.55; }
.duplicate-list { display: grid; gap: 8px; margin: 18px 0; }.duplicate-list article { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 11px 12px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface-2); }.duplicate-list article div { display: grid; min-width: 0; gap: 3px; }.duplicate-list strong, .duplicate-list span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.duplicate-list strong { font-size: 12px; }.duplicate-list span { color: var(--muted); font-size: 10px; }.duplicate-list b { color: v-bind("draft.type === 'expense' ? 'var(--expense-color)' : 'var(--income-color)'"); font-size: 13px; white-space: nowrap; }.duplicate-more { margin: 0; color: var(--muted); font-size: 10px; text-align: center; }
.duplicate-error { margin: -6px 0 14px; padding: 9px 11px; border: 1px solid #FECACA; border-radius: 11px; background: #FEF2F2; color: #991B1B; font-size: 10px; font-weight: 700; line-height: 1.45; }
.duplicate-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }.duplicate-actions button { min-height: 44px; border: 1px solid var(--line); border-radius: 13px; background: var(--surface-2); color: var(--ink); font-weight: 750; }.duplicate-actions button.primary { border-color: transparent; background: var(--accent); color: white; }.duplicate-actions button:disabled { cursor: wait; opacity: .65; }
.toast-message { position: fixed; z-index: 70; right: 16px; bottom: calc(max(82px, env(safe-area-inset-bottom) + 82px)); left: 16px; display: flex; max-width: 440px; align-items: center; justify-content: space-between; gap: 12px; margin: auto; padding: 12px 14px; border: 1px solid color-mix(in srgb, var(--ink) 8%, transparent); border-radius: 15px; background: color-mix(in srgb, var(--ink) 94%, transparent); color: var(--surface); box-shadow: 0 18px 45px rgb(15 23 42 / 24%); font-size: 12px; font-weight: 650; backdrop-filter: blur(10px); }.toast-message button { border: 0; background: transparent; color: #C7D2FE; font-weight: 800; }
.error-banner { position: fixed; z-index: 65; top: 60px; right: 16px; left: 16px; display: flex; max-width: 520px; align-items: center; gap: 8px; margin: auto; padding: 11px 13px; border: 1px solid #FECACA; border-radius: 13px; background: #FEF2F2; color: #991B1B; font-size: 11px; box-shadow: var(--shadow-soft); }.error-banner span { display: grid; width: 20px; height: 20px; place-items: center; border-radius: 50%; background: #DC2626; color: white; font-weight: 800; }
.drawer-enter-active, .drawer-leave-active { transition: opacity .22s ease; }.drawer-enter-active .drawer-panel, .drawer-leave-active .drawer-panel { transition: transform .28s cubic-bezier(.22,.75,.24,1); }.drawer-enter-from, .drawer-leave-to { opacity: 0; }.drawer-enter-from .drawer-panel, .drawer-leave-to .drawer-panel { transform: translateX(100%); }
.toast-enter-active, .toast-leave-active { transition: .2s ease; }.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(10px); }
@keyframes loading { to { transform: translateX(120%); } }
</style>
