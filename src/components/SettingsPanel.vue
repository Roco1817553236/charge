<script setup lang="ts">
import { computed, ref } from 'vue'

withDefaults(defineProps<{
  appVersion: string
  updateAvailable?: boolean
  offlineReady?: boolean
  migrationRecoveryAvailable?: boolean
}>(), {
  updateAvailable: false,
  offlineReady: false,
  migrationRecoveryAvailable: false,
})

const emit = defineEmits<{
  close: []
  'export-encrypted': [password: string]
  'export-plain': []
  'import-file': [file: File, method: { password: string } | { recoveryKey: string } | null]
  'apply-update': []
  'check-update': []
  'export-migration-recovery': []
}>()

const backupDialogOpen = ref(false)
const backupPassword = ref('')
const backupPasswordLength = computed(() => [...backupPassword.value].length)
const importPassword = ref('')
const importMode = ref<'password' | 'recovery'>('password')

function requestEncryptedExport(): void {
  if (backupPasswordLength.value < 10) return
  emit('export-encrypted', backupPassword.value)
  backupPassword.value = ''
  backupDialogOpen.value = false
}

function onImport(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const secret = importMode.value === 'password' ? importPassword.value : importPassword.value.trim()
  const method = secret
    ? importMode.value === 'password' ? { password: secret } : { recoveryKey: secret }
    : null
  emit('import-file', file, method)
  importPassword.value = ''
  input.value = ''
}
</script>

<template>
  <section class="settings-panel" aria-labelledby="settings-title">
    <header class="settings-header">
      <div><p>SETTINGS</p><h2 id="settings-title">设置与备份</h2></div>
      <button type="button" aria-label="关闭设置" @click="emit('close')">×</button>
    </header>

    <article class="local-card">
      <div class="local-icon" aria-hidden="true">⌂</div>
      <div>
        <strong>数据仅保存在当前浏览器</strong>
        <p>不需要账号或服务器，也不会上传到账页作者或 GitHub。跨设备时请导出 JSON，再在另一台设备导入。</p>
      </div>
    </article>

    <section class="settings-section">
      <header>
        <div><span class="section-icon backup">⇩</span><div><strong>JSON 备份与迁移</strong><small>随时带走完整账本</small></div></div>
        <span class="local-badge">本地处理</span>
      </header>
      <div class="backup-note">
        <strong>建议定期创建加密备份</strong>
        <p>清除浏览器网站数据可能删除本机账本。加密文件可用备份密码或独立恢复密钥解锁。</p>
      </div>

      <div class="action-list">
        <button v-if="migrationRecoveryAvailable" data-testid="export-migration-recovery" type="button" @click="emit('export-migration-recovery')"><span><b>下载迁移救援备份</b><small>升级自检失败时保留的旧版 JSON 快照</small></span><i>›</i></button>
        <button data-testid="export-encrypted" type="button" @click="backupDialogOpen = true"><span><b>加密 JSON 备份</b><small>推荐 · 包含分类、设置与完整流水</small></span><i>›</i></button>
        <button data-testid="export-plain" type="button" @click="emit('export-plain')"><span><b>明文 JSON</b><small>无需密码，下载前会再次确认</small></span><i>›</i></button>
      </div>

      <div class="import-box">
        <strong>导入 JSON 备份</strong>
        <div class="import-secret">
          <select v-model="importMode" aria-label="备份解锁方式"><option value="password">备份密码</option><option value="recovery">恢复密钥</option></select>
          <input v-model="importPassword" aria-label="备份密码或恢复密钥" type="password" placeholder="明文 JSON 可留空">
        </div>
        <label class="file-button">选择 JSON 备份文件<input type="file" accept="application/json,.json" @change="onImport"></label>
        <p>导入前会要求确认；密码错误或文件无效时不会修改当前账本。</p>
      </div>
    </section>

    <section class="settings-section update-section">
      <header><div><span class="section-icon update">↻</span><div><strong>应用更新</strong><small>当前版本 v{{ appVersion }}</small></div></div><span v-if="offlineReady" class="ready-badge">可离线使用</span></header>
      <p>普通更新会在后台下载，不需要重新安装。存在未保存草稿或编辑态时会阻止刷新。</p>
      <button v-if="updateAvailable" data-testid="apply-update" class="primary-action" type="button" @click="emit('apply-update')">应用已下载的更新<span>↻</span></button>
      <button v-else class="secondary-action" type="button" @click="emit('check-update')">立即检查更新</button>
      <details class="change-log">
        <summary>v{{ appVersion }} 更新内容</summary>
        <ul>
          <li>删除重复的“开始使用”输入，购买日期直接作为日均起算日</li>
          <li>已有物品与 v1.4.0 JSON 自动兼容，不删除物品或追加成本</li>
          <li>物品卡片统一显示购买日期，停用和维修/配件费规则保持不变</li>
        </ul>
      </details>
    </section>

    <footer><strong>账页</strong><span>本地保存 · 加密备份 · 无广告与分析追踪</span></footer>

    <div v-if="backupDialogOpen" class="dialog-backdrop" @click.self="backupDialogOpen = false">
      <form class="backup-dialog" @submit.prevent="requestEncryptedExport">
        <header><strong>创建加密 JSON 备份</strong><button type="button" aria-label="关闭加密备份" @click="backupDialogOpen = false">×</button></header>
        <p>将使用 AES-256-GCM 加密完整账本，并同时生成独立恢复密钥。</p>
        <label>加密备份密码<input v-model="backupPassword" aria-label="加密备份密码" type="password" minlength="10" required placeholder="至少 10 个字符"></label>
        <button data-testid="confirm-encrypted-export" class="primary-action" type="button" :disabled="backupPasswordLength < 10" @click="requestEncryptedExport">生成并下载</button>
      </form>
    </div>
  </section>
</template>

<style scoped>
.settings-panel { min-height: 100%; padding: 22px 18px 70px; background: var(--app-bg); }
.settings-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.settings-header p { margin: 0 0 3px; color: var(--accent); font-size: 10px; font-weight: 800; letter-spacing: .17em; }
.settings-header h2 { margin: 0; color: var(--ink); font-size: 24px; letter-spacing: -.04em; }
.settings-header > button { width: 38px; height: 38px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--muted); font-size: 23px; }
.local-card { display: grid; grid-template-columns: 42px 1fr; align-items: center; gap: 11px; margin-bottom: 13px; padding: 13px; border: 1px solid var(--line); border-radius: 17px; background: var(--surface); box-shadow: var(--shadow-soft); }
.local-icon { display: grid; width: 40px; height: 40px; place-items: center; border-radius: 14px; background: var(--accent-soft); color: var(--accent-strong); font-size: 18px; font-weight: 800; }
.local-card div:nth-child(2) { display: grid; gap: 3px; }
.local-card strong { color: var(--ink); font-size: 12px; }
.local-card p { margin: 0; color: var(--muted); font-size: 9px; line-height: 1.5; }
.settings-section { margin-top: 13px; padding: 15px; border: 1px solid var(--line); border-radius: 19px; background: var(--surface); box-shadow: var(--shadow-soft); }
.settings-section > header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; }
.settings-section > header > div { display: flex; align-items: center; gap: 9px; }
.settings-section header div > div { display: grid; gap: 2px; }
.settings-section header strong { color: var(--ink); font-size: 13px; }
.settings-section header small { color: var(--muted); font-size: 9px; }
.section-icon { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 11px; font-size: 16px; }
.section-icon.backup { background: #ECFDF5; color: #047857; }
.section-icon.update { background: #FFF7ED; color: #C2410C; }
.local-badge, .ready-badge { padding: 5px 7px; border-radius: 999px; background: #ECFDF5; color: #047857; font-size: 8px; font-weight: 800; white-space: nowrap; }
.backup-note { margin-bottom: 8px; padding: 11px; border-radius: 12px; background: var(--accent-soft); color: var(--accent-strong); }
.backup-note strong { font-size: 10px; }
.backup-note p { margin: 3px 0 0; font-size: 9px; line-height: 1.5; opacity: .82; }
.action-list { display: grid; }
.action-list button { display: flex; align-items: center; justify-content: space-between; padding: 11px 2px; border: 0; border-bottom: 1px solid var(--line); background: transparent; color: var(--ink); text-align: left; }
.action-list button:last-child { border-bottom: 0; }
.action-list span { display: grid; gap: 3px; }
.action-list b { font-size: 10px; }
.action-list small { color: var(--muted); font-size: 8px; }
.action-list i { color: var(--muted); font-style: normal; }
.import-box { margin-top: 9px; padding: 11px; border-radius: 12px; background: var(--surface-2); }
.import-box > strong { color: var(--ink); font-size: 10px; }
.import-secret { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 6px; margin: 8px 0; }
.settings-section label { display: grid; gap: 6px; color: var(--muted); font-size: 10px; font-weight: 700; }
.settings-section input, .settings-section select { min-width: 0; padding: 10px 11px; border: 1px solid var(--line); border-radius: 10px; outline: 0; background: var(--surface-2); color: var(--ink); font: inherit; }
.file-button { display: block !important; padding: 9px; border: 1px dashed var(--accent); border-radius: 9px; color: var(--accent-strong) !important; text-align: center; cursor: pointer; }
.file-button input { display: none; }
.import-box p, .update-section > p { margin: 6px 0 0; color: var(--muted); font-size: 8px; line-height: 1.5; }
.primary-action, .secondary-action { display: flex; width: 100%; align-items: center; justify-content: space-between; margin-top: 11px; padding: 11px 13px; border: 0; border-radius: 11px; background: var(--accent); color: white; font-size: 10px; font-weight: 800; }
.primary-action:disabled { opacity: .4; cursor: not-allowed; }
.secondary-action { justify-content: center; border: 1px solid var(--line); background: var(--surface-2); color: var(--muted-strong); }
.change-log { margin-top: 10px; color: var(--muted); font-size: 8px; }
.change-log summary { cursor: pointer; color: var(--muted-strong); font-weight: 750; }
.change-log ul { margin: 7px 0 0; padding-left: 16px; line-height: 1.6; }
footer { display: grid; place-items: center; gap: 3px; padding: 26px 0; color: var(--muted); }
footer strong { color: var(--ink); font-size: 12px; }
footer span { font-size: 8px; }
.dialog-backdrop { position: fixed; z-index: 80; inset: 0; display: flex; align-items: end; justify-content: center; padding: 16px; background: rgb(15 23 42 / 40%); backdrop-filter: blur(4px); }
.backup-dialog { display: grid; width: min(100%, 430px); gap: 11px; padding: 17px; border-radius: 20px; background: var(--surface); box-shadow: 0 25px 80px rgb(15 23 42 / 24%); }
.backup-dialog header { display: flex; justify-content: space-between; }
.backup-dialog header strong { color: var(--ink); font-size: 14px; }
.backup-dialog header button { border: 0; background: transparent; color: var(--muted); font-size: 20px; }
.backup-dialog p { margin: 0; color: var(--muted); font-size: 9px; line-height: 1.5; }
@media (min-width: 680px) { .settings-panel { padding: 28px; }.dialog-backdrop { align-items: center; } }
</style>
