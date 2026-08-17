<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ConflictRecord, SyncMetadata } from '../domain/models'
import type { CloudSnapshotInfo } from '../sync/oneDriveProvider'

const props = withDefaults(defineProps<{
  syncMetadata: SyncMetadata
  initialClientId: string
  appVersion: string
  syncing?: boolean
  updateAvailable?: boolean
  offlineReady?: boolean
  newRecoveryKey?: string | null
  conflicts?: ConflictRecord[]
  cloudSnapshots?: CloudSnapshotInfo[]
  loadingCloudSnapshots?: boolean
  migrationRecoveryAvailable?: boolean
}>(), {
  syncing: false,
  updateAvailable: false,
  offlineReady: false,
  newRecoveryKey: null,
  conflicts: () => [],
  cloudSnapshots: () => [],
  loadingCloudSnapshots: false,
  migrationRecoveryAvailable: false,
})

const emit = defineEmits<{
  close: []
  sync: [request: {
    clientId: string
    method: { password: string } | { recoveryKey: string }
    rememberDevice: boolean
  }]
  'export-encrypted': [password: string]
  'export-csv': []
  'export-plain': []
  'import-file': [file: File, method: { password: string } | { recoveryKey: string } | null]
  'apply-update': []
  'check-update': []
  'download-recovery': [key: string]
  'recovery-saved': []
  'resolve-conflict': [conflict: ConflictRecord, choice: 'local' | 'remote']
  'refresh-cloud-snapshots': []
  'restore-cloud-snapshot': [snapshotId: string, method: { password: string } | { recoveryKey: string } | null]
  'export-migration-recovery': []
}>()

const clientId = ref(props.initialClientId)
const unlockMode = ref<'password' | 'recovery'>('password')
const syncPassword = ref('')
const recoveryKey = ref('')
const rememberDevice = ref(true)
const backupDialogOpen = ref(false)
const backupPassword = ref('')
const importPassword = ref('')
const importMode = ref<'password' | 'recovery'>('password')
const passwordStrength = computed(() => {
  const value = syncPassword.value
  const groups = [/[a-z]/i, /\d/, /[^\p{L}\p{N}]/u, /[\p{Script=Han}]/u].filter((pattern) => pattern.test(value)).length
  const score = Number([...value].length >= 10) + Number([...value].length >= 14) + Number(groups >= 2) + Number(groups >= 3)
  if (score >= 4) return { label: '强', level: 'strong' }
  if (score >= 2) return { label: '一般', level: 'medium' }
  return { label: '较弱', level: 'weak' }
})

watch(() => props.initialClientId, (value) => { clientId.value = value })

function requestSync(): void {
  const method = unlockMode.value === 'password'
    ? { password: syncPassword.value }
    : { recoveryKey: recoveryKey.value }
  emit('sync', { clientId: clientId.value.trim(), method, rememberDevice: rememberDevice.value })
  syncPassword.value = ''
  recoveryKey.value = ''
}

function requestEncryptedExport(): void {
  emit('export-encrypted', backupPassword.value)
  backupPassword.value = ''
  backupDialogOpen.value = false
}

function requestCloudSnapshotRestore(snapshotId: string): void {
  const method = unlockMode.value === 'password'
    ? syncPassword.value ? { password: syncPassword.value } : null
    : recoveryKey.value.trim() ? { recoveryKey: recoveryKey.value.trim() } : null
  emit('restore-cloud-snapshot', snapshotId, method)
  syncPassword.value = ''
  recoveryKey.value = ''
}

function onImport(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const secret = importPassword.value.trim()
  const method = secret
    ? importMode.value === 'password' ? { password: secret } : { recoveryKey: secret }
    : null
  emit('import-file', file, method)
  importPassword.value = ''
  input.value = ''
}

function describeConflictValue(value: ConflictRecord['localValue']): string {
  if ('amountMinor' in value) {
    const amount = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: value.currency }).format(value.amountMinor / 100)
    const note = value.note ? ` · ${value.note}` : ''
    return `${value.occurredLocalDate} · ${amount}${note}`
  }
  return `${value.parentId ? '二级分类' : '大类'} · ${value.icon} ${value.name}`
}
</script>

<template>
  <section class="settings-panel" aria-labelledby="settings-title">
    <header class="settings-header">
      <div><p>SETTINGS</p><h2 id="settings-title">设置与同步</h2></div>
      <button type="button" aria-label="关闭设置" @click="emit('close')">×</button>
    </header>

    <article class="local-card">
      <div class="status-orb" :class="syncMetadata.status"><i /></div>
      <div>
        <strong>{{ syncMetadata.status === 'synced' ? '账本已安全同步' : syncMetadata.pending ? '本机数据等待同步' : '本地优先账本' }}</strong>
        <p>断网时照常记账；所有云端内容在上传前已于本机加密。</p>
      </div>
      <small v-if="syncMetadata.lastSuccessAt">{{ new Date(syncMetadata.lastSuccessAt).toLocaleString('zh-CN') }}</small>
    </article>

    <section class="settings-section">
      <header><div><span class="section-icon cloud">☁</span><div><strong>OneDrive 多端同步</strong><small>Windows · Android · 浏览器</small></div></div><span class="free-badge">零服务器费用</span></header>
      <div class="privacy-note">
        <strong>不需要自建服务器</strong>
        <p>应用只请求 OneDrive「应用专属目录」权限，无法浏览你的其他文件。同步密码不会发送给微软或应用作者。</p>
      </div>

      <label>Microsoft 应用客户端 ID
        <input v-model="clientId" aria-label="Microsoft 应用客户端 ID" autocomplete="off" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx">
      </label>
      <p class="field-help">发布者可预置客户端 ID；自行使用时也可在 Microsoft Entra 免费注册单页应用，不需要客户端密钥。<a href="https://entra.microsoft.com/" target="_blank" rel="noreferrer">打开注册入口 ↗</a></p>

      <div class="unlock-tabs">
        <button type="button" :class="{ active: unlockMode === 'password' }" @click="unlockMode = 'password'">同步密码</button>
        <button type="button" :class="{ active: unlockMode === 'recovery' }" @click="unlockMode = 'recovery'">恢复密钥</button>
      </div>
      <label v-if="unlockMode === 'password'">同步密码
        <input v-model="syncPassword" aria-label="同步密码" type="password" minlength="10" autocomplete="current-password" placeholder="至少 10 个字符">
      </label>
      <p v-if="unlockMode === 'password' && syncPassword" class="password-strength" :class="passwordStrength.level" role="status">
        密码强度：{{ passwordStrength.label }} · 建议 14 个以上字符并混合数字或符号
      </p>
      <label v-else>恢复密钥
        <textarea v-model="recoveryKey" aria-label="恢复密钥" rows="2" placeholder="粘贴首次建库时保存的恢复密钥" />
      </label>
      <label class="remember-device">
        <input v-model="rememberDevice" type="checkbox">
        <span><strong>信任此设备</strong><small>仅保存不可导出的本机加密密钥，启动后可自动同步；不会保存同步密码。</small></span>
      </label>
      <button
        data-testid="sync-now"
        class="primary-action"
        type="button"
        :disabled="syncing || !clientId.trim() || (unlockMode === 'password' ? syncPassword.length < 10 : !recoveryKey.trim())"
        @click="requestSync"
      >{{ syncing ? '正在登录并同步…' : '登录 Microsoft 并立即同步' }}<span>→</span></button>

      <div v-if="newRecoveryKey" class="recovery-card">
        <strong>请立即保存恢复密钥</strong>
        <p>忘记同步密码且丢失恢复密钥后，加密账本无法恢复。</p>
        <code>{{ newRecoveryKey }}</code>
        <div class="recovery-actions">
          <button type="button" @click="emit('download-recovery', newRecoveryKey)">下载恢复密钥</button>
          <button type="button" class="acknowledge" @click="emit('recovery-saved')">我已离线妥善保存</button>
        </div>
      </div>

      <div class="cloud-snapshots">
        <div class="snapshot-heading">
          <span><strong>最近 5 个加密快照</strong><small>每次覆盖云端账本前自动保留</small></span>
          <button type="button" :disabled="loadingCloudSnapshots" @click="emit('refresh-cloud-snapshots')">
            {{ loadingCloudSnapshots ? '读取中…' : '查看' }}
          </button>
        </div>
        <p v-if="cloudSnapshots.length === 0">登录 Microsoft 后可读取历史快照；主账本损坏时，可在上方输入密码或恢复密钥再恢复。</p>
        <div v-else class="snapshot-list">
          <span v-for="snapshot in cloudSnapshots" :key="snapshot.id">
            <i><b>{{ new Date(snapshot.createdAt).toLocaleString('zh-CN') }}</b><small>{{ snapshot.name }}</small></i>
            <button :data-testid="`restore-cloud-${snapshot.id}`" type="button" @click="requestCloudSnapshotRestore(snapshot.id)">恢复</button>
          </span>
        </div>
      </div>
    </section>

    <section v-if="conflicts.length" class="settings-section conflict-section">
      <header><div><span class="section-icon conflict">!</span><div><strong>同步冲突</strong><small>两台设备同时修改了同一条数据</small></div></div><span class="conflict-count">{{ conflicts.length }} 项</span></header>
      <p class="conflict-help">请选择要保留的版本。你的选择会生成新的修订版本，并在下次同步时应用到所有设备。</p>
      <article v-for="conflict in conflicts" :key="conflict.id" class="conflict-card">
        <div class="conflict-choice">
          <small>本机版本</small>
          <strong>{{ describeConflictValue(conflict.localValue) }}</strong>
          <button :data-testid="`conflict-local-${conflict.id}`" type="button" @click="emit('resolve-conflict', conflict, 'local')">使用本机版本</button>
        </div>
        <div class="conflict-choice">
          <small>远端版本</small>
          <strong>{{ describeConflictValue(conflict.remoteValue) }}</strong>
          <button :data-testid="`conflict-remote-${conflict.id}`" type="button" @click="emit('resolve-conflict', conflict, 'remote')">使用远端版本</button>
        </div>
      </article>
    </section>

    <section class="settings-section">
      <header><div><span class="section-icon backup">⇩</span><div><strong>备份与迁移</strong><small>随时带走完整账本</small></div></div></header>
      <div class="action-list">
        <button v-if="migrationRecoveryAvailable" data-testid="export-migration-recovery" type="button" @click="emit('export-migration-recovery')"><span><b>下载迁移救援备份</b><small>升级自检失败时保留的独立旧版快照</small></span><i>›</i></button>
        <button data-testid="export-encrypted" type="button" @click="backupDialogOpen = true"><span><b>加密 JSON 备份</b><small>推荐 · 包含分类与完整流水</small></span><i>›</i></button>
        <button data-testid="export-csv" type="button" @click="emit('export-csv')"><span><b>CSV 表格</b><small>Excel 可读，文件为明文</small></span><i>›</i></button>
        <button type="button" @click="emit('export-plain')"><span><b>明文 JSON</b><small>需二次确认，便于迁移</small></span><i>›</i></button>
      </div>

      <div class="import-box">
        <strong>恢复备份</strong>
        <div class="import-secret">
          <select v-model="importMode" aria-label="备份解锁方式"><option value="password">密码</option><option value="recovery">恢复密钥</option></select>
          <input v-model="importPassword" aria-label="备份密码或恢复密钥" type="password" placeholder="加密文件需要；明文可留空">
        </div>
        <label class="file-button">选择 JSON 备份文件<input type="file" accept="application/json,.json" @change="onImport"></label>
        <p>恢复前会要求确认；现有账本不会在解锁失败时被修改。</p>
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
          <li>Windows、Android 与浏览器的 OneDrive 端到端加密同步</li>
          <li>月度环比、年度同比、分类统计与完整月份切换</li>
          <li>可信设备密钥、云端快照恢复与数据库迁移备份</li>
        </ul>
      </details>
    </section>

    <footer><strong>账页</strong><span>本地优先 · 端到端加密 · 无广告与分析追踪</span></footer>

    <div v-if="backupDialogOpen" class="dialog-backdrop" @click.self="backupDialogOpen = false">
      <form class="backup-dialog" @submit.prevent="requestEncryptedExport">
        <header><strong>创建加密备份</strong><button type="button" @click="backupDialogOpen = false">×</button></header>
        <p>将使用 AES-256-GCM 加密完整账本，并生成独立恢复密钥。</p>
        <label>加密备份密码<input v-model="backupPassword" aria-label="加密备份密码" type="password" minlength="10" required placeholder="至少 10 个字符"></label>
        <button data-testid="confirm-encrypted-export" class="primary-action" type="button" :disabled="backupPassword.length < 10" @click="requestEncryptedExport">生成并下载</button>
      </form>
    </div>
  </section>
</template>

<style scoped>
.settings-panel { min-height: 100%; padding: 22px 18px 70px; background: var(--app-bg); }.settings-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }.settings-header p { margin: 0 0 3px; color: var(--accent); font-size: 10px; font-weight: 800; letter-spacing: .17em; }.settings-header h2 { margin: 0; color: var(--ink); font-size: 24px; letter-spacing: -.04em; }.settings-header > button { width: 38px; height: 38px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--muted); font-size: 23px; }
.local-card { display: grid; grid-template-columns: 42px 1fr; align-items: center; gap: 11px; margin-bottom: 13px; padding: 13px; border: 1px solid var(--line); border-radius: 17px; background: var(--surface); box-shadow: var(--shadow-soft); }.status-orb { display: grid; width: 40px; height: 40px; place-items: center; border-radius: 14px; background: var(--surface-2); }.status-orb i { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); }.status-orb.synced i { background: var(--positive); box-shadow: 0 0 0 5px color-mix(in srgb, var(--positive) 12%, transparent); }.status-orb.attention i { background: var(--danger); }.local-card div:nth-child(2) { display: grid; gap: 3px; }.local-card strong { color: var(--ink); font-size: 12px; }.local-card p { margin: 0; color: var(--muted); font-size: 9px; line-height: 1.45; }.local-card > small { grid-column: 2; color: var(--muted); font-size: 8px; }
.settings-section { margin-top: 13px; padding: 15px; border: 1px solid var(--line); border-radius: 19px; background: var(--surface); box-shadow: var(--shadow-soft); }.settings-section > header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }.settings-section > header > div { display: flex; align-items: center; gap: 9px; }.settings-section header div > div { display: grid; gap: 2px; }.settings-section header strong { color: var(--ink); font-size: 13px; }.settings-section header small { color: var(--muted); font-size: 9px; }.section-icon { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 11px; background: var(--accent-soft); color: var(--accent-strong); font-size: 16px; }.section-icon.backup { background: #ECFDF5; color: #047857; }.section-icon.update { background: #FFF7ED; color: #C2410C; }.free-badge, .ready-badge { padding: 5px 7px; border-radius: 999px; background: #ECFDF5; color: #047857; font-size: 8px; font-weight: 800; }
.privacy-note { margin-bottom: 13px; padding: 11px; border-radius: 12px; background: var(--accent-soft); color: var(--accent-strong); }.privacy-note strong { font-size: 10px; }.privacy-note p { margin: 3px 0 0; font-size: 9px; line-height: 1.5; opacity: .82; }.settings-section label { display: grid; gap: 6px; color: var(--muted); font-size: 10px; font-weight: 700; }.settings-section input, .settings-section textarea, .settings-section select { min-width: 0; padding: 10px 11px; border: 1px solid var(--line); border-radius: 10px; outline: 0; background: var(--surface-2); color: var(--ink); font: inherit; resize: vertical; }.field-help { margin: 5px 0 11px; color: var(--muted); font-size: 8px; line-height: 1.45; }.field-help a { color: var(--accent); text-decoration: none; }.unlock-tabs { display: flex; gap: 3px; margin-bottom: 9px; padding: 3px; border-radius: 10px; background: var(--surface-2); }.unlock-tabs button { flex: 1; padding: 7px; border: 0; border-radius: 8px; background: transparent; color: var(--muted); font-size: 9px; font-weight: 700; }.unlock-tabs button.active { background: var(--surface); color: var(--ink); box-shadow: var(--shadow-soft); }
.password-strength { margin: 5px 0 0; font-size: 8px; }.password-strength.weak { color: #B91C1C; }.password-strength.medium { color: #B45309; }.password-strength.strong { color: var(--positive); }
.primary-action, .secondary-action { display: flex; width: 100%; align-items: center; justify-content: space-between; margin-top: 11px; padding: 11px 13px; border: 0; border-radius: 11px; background: var(--accent); color: white; font-size: 10px; font-weight: 800; }.primary-action:disabled { opacity: .4; cursor: not-allowed; }.secondary-action { justify-content: center; border: 1px solid var(--line); background: var(--surface-2); color: var(--muted-strong); }.recovery-card { margin-top: 11px; padding: 11px; border: 1px solid #FCD34D; border-radius: 11px; background: #FFFBEB; color: #78350F; }.recovery-card strong { font-size: 10px; }.recovery-card p { margin: 4px 0 7px; font-size: 8px; }.recovery-card code { display: block; overflow-wrap: anywhere; padding: 7px; border-radius: 7px; background: rgb(255 255 255 / 60%); font-size: 8px; }.recovery-card button { margin-top: 7px; padding: 7px 9px; border: 0; border-radius: 7px; background: #92400E; color: white; font-size: 8px; font-weight: 700; }
.recovery-actions { display: flex; flex-wrap: wrap; gap: 6px; }.recovery-actions .acknowledge { background: transparent; color: #92400E; outline: 1px solid #D97706; }
.remember-device { display: flex !important; align-items: start; gap: 8px !important; margin-top: 10px; padding: 10px; border-radius: 10px; background: var(--surface-2); }.remember-device input { width: 15px; height: 15px; margin: 1px 0 0; padding: 0; }.remember-device span { display: grid; gap: 2px; }.remember-device strong { color: var(--ink); font-size: 9px; }.remember-device small { color: var(--muted); font-size: 8px; font-weight: 500; line-height: 1.4; }
.cloud-snapshots { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); }.snapshot-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }.snapshot-heading > span { display: grid; gap: 2px; }.snapshot-heading strong { color: var(--ink); font-size: 9px; }.snapshot-heading small, .cloud-snapshots > p { color: var(--muted); font-size: 8px; }.snapshot-heading > button, .snapshot-list button { padding: 6px 8px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface-2); color: var(--accent-strong); font-size: 8px; font-weight: 750; }.cloud-snapshots > p { margin: 8px 0 0; line-height: 1.45; }.snapshot-list { display: grid; gap: 5px; margin-top: 8px; }.snapshot-list > span { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px; border-radius: 9px; background: var(--surface-2); }.snapshot-list i { display: grid; min-width: 0; gap: 2px; font-style: normal; }.snapshot-list b { color: var(--ink); font-size: 8px; }.snapshot-list small { overflow: hidden; color: var(--muted); font-size: 7px; text-overflow: ellipsis; white-space: nowrap; }
.section-icon.conflict { background: #FEF2F2; color: #B91C1C; }.conflict-count { padding: 5px 7px; border-radius: 999px; background: #FEF2F2; color: #B91C1C; font-size: 8px; font-weight: 800; }.conflict-help { margin: -3px 0 10px; color: var(--muted); font-size: 9px; line-height: 1.5; }.conflict-card { display: grid; gap: 7px; }.conflict-card + .conflict-card { margin-top: 11px; padding-top: 11px; border-top: 1px solid var(--line); }.conflict-choice { display: grid; gap: 5px; padding: 10px; border-radius: 11px; background: var(--surface-2); }.conflict-choice small { color: var(--muted); font-size: 8px; font-weight: 750; }.conflict-choice strong { overflow-wrap: anywhere; color: var(--ink); font-size: 10px; line-height: 1.45; }.conflict-choice button { justify-self: start; padding: 7px 9px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--accent-strong); font-size: 8px; font-weight: 800; }
.action-list { display: grid; }.action-list button { display: flex; align-items: center; justify-content: space-between; padding: 11px 2px; border: 0; border-bottom: 1px solid var(--line); background: transparent; color: var(--ink); text-align: left; }.action-list button:last-child { border-bottom: 0; }.action-list span { display: grid; gap: 3px; }.action-list b { font-size: 10px; }.action-list small { color: var(--muted); font-size: 8px; }.action-list i { color: var(--muted); font-style: normal; }
.import-box { margin-top: 9px; padding: 11px; border-radius: 12px; background: var(--surface-2); }.import-box > strong { color: var(--ink); font-size: 10px; }.import-secret { display: grid; grid-template-columns: 84px 1fr; gap: 6px; margin: 8px 0; }.file-button { display: block !important; padding: 9px; border: 1px dashed var(--accent); border-radius: 9px; color: var(--accent-strong) !important; text-align: center; cursor: pointer; }.file-button input { display: none; }.import-box p { margin: 6px 0 0; color: var(--muted); font-size: 8px; line-height: 1.4; }.update-section > p { margin: 0; color: var(--muted); font-size: 9px; line-height: 1.5; }
.change-log { margin-top: 10px; color: var(--muted); font-size: 8px; }.change-log summary { cursor: pointer; color: var(--muted-strong); font-weight: 750; }.change-log ul { margin: 7px 0 0; padding-left: 16px; line-height: 1.6; }
footer { display: grid; place-items: center; gap: 3px; padding: 26px 0; color: var(--muted); } footer strong { color: var(--ink); font-size: 12px; } footer span { font-size: 8px; }
.dialog-backdrop { position: fixed; z-index: 80; inset: 0; display: flex; align-items: end; justify-content: center; padding: 16px; background: rgb(15 23 42 / 40%); backdrop-filter: blur(4px); }.backup-dialog { display: grid; width: min(100%, 430px); gap: 11px; padding: 17px; border-radius: 20px; background: var(--surface); box-shadow: 0 25px 80px rgb(15 23 42 / 24%); }.backup-dialog header { display: flex; justify-content: space-between; }.backup-dialog header strong { color: var(--ink); font-size: 14px; }.backup-dialog header button { border: 0; background: transparent; color: var(--muted); font-size: 20px; }.backup-dialog p { margin: 0; color: var(--muted); font-size: 9px; line-height: 1.5; }
@media (min-width: 680px) { .settings-panel { padding: 28px; }.dialog-backdrop { align-items: center; } }
</style>
