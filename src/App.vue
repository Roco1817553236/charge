<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import CategoryManager from './components/CategoryManager.vue'
import LedgerPage from './components/LedgerPage.vue'
import QuickEntryPage from './components/QuickEntryPage.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import StatsPage from './components/StatsPage.vue'
import SwipePager from './components/SwipePager.vue'
import type { SaveCategoryInput } from './data/localRepository'
import type { Category, ConflictRecord, Transaction } from './domain/models'
import {
  exportEncryptedBackup,
  exportLedgerCsv,
  exportPlainJson,
  importEncryptedBackup,
  MAX_BACKUP_FILE_BYTES,
  parsePlainJson,
} from './services/importExport'
import { startBackgroundSync } from './services/backgroundSync'
import { PwaUpdateController } from './services/pwaUpdate'
import { useBookStore, type EntryDraft } from './stores/bookStore'

const store = useBookStore()
const {
  categories, transactions, draft, pageIndex, loading, saving, toast, error, syncMetadata,
  syncing, syncClientId, newRecoveryKey, conflicts,
  cloudSnapshots, loadingCloudSnapshots, monthComparisonMode,
  migrationRecoveryAvailable,
} = storeToRefs(store)
const categoryManagerOpen = ref(false)
const settingsOpen = ref(false)
const updateController = new PwaUpdateController()
const updateState = updateController.state
const appVersion = import.meta.env.VITE_APP_VERSION || '1.0.0'
let stopBackgroundSync: (() => void) | null = null
let dateRefreshTimer: number | null = null

function localToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

const today = ref(localToday())

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
    scheduleDateRefresh()
    stopBackgroundSync = startBackgroundSync(() => store.backgroundSync())
    if (import.meta.env.PROD && 'serviceWorker' in navigator) await updateController.initialize()
  } catch {
    // The store exposes a user-safe error state and the app keeps the recovery screen mounted.
  }
})

onBeforeUnmount(() => {
  stopBackgroundSync?.()
  if (dateRefreshTimer !== null) window.clearTimeout(dateRefreshTimer)
})

async function saveDraft(value: EntryDraft): Promise<void> {
  store.updateDraft(value)
  try {
    await store.saveEntry()
  } catch {
    // Error is displayed next to the app shell.
  }
}

async function syncOneDrive(request: {
  clientId: string
  method: { password: string } | { recoveryKey: string }
  rememberDevice: boolean
}): Promise<void> {
  try {
    await store.syncOneDrive(request.clientId, request.method, request.rememberDevice)
  } catch {
    // Store presents a safe error without exposing tokens or ledger contents.
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

async function exportCsv(): Promise<void> {
  downloadText(backupFilename('csv'), exportLedgerCsv(await store.createSnapshot()), 'text/csv;charset=utf-8')
  store.toast = { message: 'CSV 已下载；该文件是明文，请妥善保管' }
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
  } catch (caught) {
    store.error = caught instanceof Error ? caught.message : '备份恢复失败'
  }
}

function downloadRecovery(key: string, filename = '账页-OneDrive-恢复密钥.txt'): void {
  downloadText(filename, `账页恢复密钥\n\n${key}\n\n请离线妥善保存。忘记同步密码且丢失此密钥后，密文无法恢复。\n`, 'text/plain;charset=utf-8')
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

async function resolveConflict(conflict: ConflictRecord, choice: 'local' | 'remote'): Promise<void> {
  try {
    await store.resolveConflict(conflict, choice)
  } catch (caught) {
    store.error = caught instanceof Error ? caught.message : '同步冲突处理失败'
  }
}

async function restoreCloudSnapshot(
  snapshotId: string,
  method: { password: string } | { recoveryKey: string } | null,
): Promise<void> {
  if (!window.confirm('恢复该云端快照会把它设为新的账本版本，并同步到其他设备。建议先导出当前备份。确定继续吗？')) return
  try {
    await store.restoreCloudSnapshot(snapshotId, method ?? undefined)
  } catch {
    // Store exposes a safe error and leaves the current ledger untouched.
  }
}

async function refreshCloudSnapshots(): Promise<void> {
  try {
    await store.refreshCloudSnapshots()
  } catch {
    // Store exposes a safe error and keeps the settings panel usable.
  }
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

function syncStatusLabel(): string {
  if (syncMetadata.value.status === 'syncing') return '同步中'
  if (syncMetadata.value.status === 'synced') return '已同步'
  if (syncMetadata.value.status === 'attention') return '需要处理'
  return syncMetadata.value.pending ? '待同步' : '本机账本'
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
      <button class="sync-status" type="button" :class="syncMetadata.status" title="同步与备份设置" @click="settingsOpen = true">
        <i /><span>{{ syncStatusLabel() }}</span>
      </button>

      <SwipePager v-model="pageIndex">
        <template #entry>
          <QuickEntryPage
            :categories="categories"
            :draft="draft"
            :saving="saving"
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
            @edit="store.beginEdit"
            @duplicate="store.duplicateToDraft"
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
          <aside class="drawer-panel" aria-label="设置与同步面板">
            <SettingsPanel
              :sync-metadata="syncMetadata"
              :initial-client-id="syncClientId"
              :app-version="appVersion"
              :syncing="syncing"
              :update-available="updateState.updateAvailable"
              :offline-ready="updateState.offlineReady"
              :new-recovery-key="newRecoveryKey"
              :conflicts="conflicts"
              :cloud-snapshots="cloudSnapshots"
              :loading-cloud-snapshots="loadingCloudSnapshots"
              :migration-recovery-available="migrationRecoveryAvailable"
              @close="settingsOpen = false"
              @sync="syncOneDrive"
              @export-encrypted="exportEncrypted"
              @export-csv="exportCsv"
              @export-plain="exportPlain"
              @import-file="importBackup"
              @apply-update="applyAvailableUpdate"
              @check-update="updateController.checkForUpdate()"
              @download-recovery="downloadRecovery"
              @recovery-saved="store.confirmRecoveryKeySaved"
              @resolve-conflict="resolveConflict"
              @refresh-cloud-snapshots="refreshCloudSnapshots"
              @restore-cloud-snapshot="restoreCloudSnapshot"
              @export-migration-recovery="exportMigrationRecovery"
            />
          </aside>
        </div>
      </Transition>

      <Transition name="toast">
        <div v-if="toast" class="toast-message" role="status">
          <span>{{ toast.message }}</span>
          <button v-if="toast.action === 'undo-delete'" type="button" @click="store.undoDelete">撤销</button>
          <button v-else-if="toast.action === 'undo-save'" type="button" @click="store.undoLastSave">撤销</button>
          <button v-else type="button" aria-label="关闭提示" @click="store.clearToast">×</button>
        </div>
      </Transition>

      <div v-if="error" class="error-banner" role="alert"><span>!</span>{{ error }}</div>
    </template>
  </div>
</template>

<style scoped>
.app-shell { min-height: 100dvh; background: var(--app-bg); }
.loading-screen { display: grid; min-height: 100dvh; place-content: center; place-items: center; gap: 14px; color: var(--muted); }.brand-mark { display: grid; width: 64px; height: 64px; place-items: center; border-radius: 21px; background: var(--accent); color: white; font: 800 25px var(--font-display); box-shadow: 0 18px 45px color-mix(in srgb, var(--accent) 30%, transparent); }.loading-screen strong { color: var(--ink); font-size: 13px; }.loading-screen i { width: 34px; height: 3px; overflow: hidden; border-radius: 999px; background: var(--line); }.loading-screen i::after { display: block; width: 45%; height: 100%; border-radius: inherit; background: var(--accent); animation: loading 1s ease-in-out infinite alternate; content: ''; }
.sync-status { position: fixed; z-index: 25; top: max(12px, env(safe-area-inset-top)); right: 14px; display: flex; align-items: center; gap: 6px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 999px; background: color-mix(in srgb, var(--surface) 86%, transparent); color: var(--muted); font-size: 10px; font-weight: 750; box-shadow: var(--shadow-soft); backdrop-filter: blur(12px); }.sync-status i { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); }.sync-status.synced i { background: var(--positive); }.sync-status.syncing i { background: var(--accent); animation: pulse 1s infinite; }.sync-status.attention i { background: var(--danger); }
.drawer-backdrop { position: fixed; z-index: 45; inset: 0; display: flex; justify-content: end; background: rgb(15 23 42 / 34%); backdrop-filter: blur(4px); }.drawer-panel { width: min(100%, 520px); height: 100%; overflow-y: auto; background: var(--app-bg); box-shadow: -24px 0 70px rgb(15 23 42 / 18%); }
.toast-message { position: fixed; z-index: 70; right: 16px; bottom: calc(max(82px, env(safe-area-inset-bottom) + 82px)); left: 16px; display: flex; max-width: 440px; align-items: center; justify-content: space-between; gap: 12px; margin: auto; padding: 12px 14px; border: 1px solid color-mix(in srgb, var(--ink) 8%, transparent); border-radius: 15px; background: color-mix(in srgb, var(--ink) 94%, transparent); color: var(--surface); box-shadow: 0 18px 45px rgb(15 23 42 / 24%); font-size: 12px; font-weight: 650; backdrop-filter: blur(10px); }.toast-message button { border: 0; background: transparent; color: #C7D2FE; font-weight: 800; }
.error-banner { position: fixed; z-index: 65; top: 60px; right: 16px; left: 16px; display: flex; max-width: 520px; align-items: center; gap: 8px; margin: auto; padding: 11px 13px; border: 1px solid #FECACA; border-radius: 13px; background: #FEF2F2; color: #991B1B; font-size: 11px; box-shadow: var(--shadow-soft); }.error-banner span { display: grid; width: 20px; height: 20px; place-items: center; border-radius: 50%; background: #DC2626; color: white; font-weight: 800; }
.drawer-enter-active, .drawer-leave-active { transition: opacity .22s ease; }.drawer-enter-active .drawer-panel, .drawer-leave-active .drawer-panel { transition: transform .28s cubic-bezier(.22,.75,.24,1); }.drawer-enter-from, .drawer-leave-to { opacity: 0; }.drawer-enter-from .drawer-panel, .drawer-leave-to .drawer-panel { transform: translateX(100%); }
.toast-enter-active, .toast-leave-active { transition: .2s ease; }.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(10px); }
@keyframes loading { to { transform: translateX(120%); } } @keyframes pulse { 50% { opacity: .35; transform: scale(.75); } }
</style>
