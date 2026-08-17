import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SettingsPanel from '../../src/components/SettingsPanel.vue'
import type { ConflictRecord, Transaction } from '../../src/domain/models'

const conflictedTransaction: Transaction = {
  id: 'tx-1', type: 'expense', amountMinor: 2580, currency: 'CNY', categoryId: 'food', subcategoryId: null,
  occurredLocalDate: '2026-08-14', occurredLocalTime: '12:30', timeZone: 'Asia/Shanghai', note: '本机午饭',
  createdAt: '2026-08-14T04:30:00.000Z', updatedAt: '2026-08-14T04:30:00.000Z',
  revision: { counter: 2, deviceId: 'device-a' },
}

const conflict: ConflictRecord = {
  id: 'conflict-1', entityType: 'transaction', entityId: 'tx-1',
  localValue: conflictedTransaction,
  remoteValue: { ...conflictedTransaction, amountMinor: 3280, note: '远端午饭', revision: { counter: 2, deviceId: 'device-b' } },
  createdAt: '2026-08-14T05:00:00.000Z',
}

describe('SettingsPanel', () => {
  it('explains the free serverless OneDrive model and emits a minimal-permission sync request', async () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        syncMetadata: { id: 'sync', pending: true, status: 'local' },
        initialClientId: '',
        appVersion: '0.1.0',
      },
    })
    expect(wrapper.text()).toContain('不需要自建服务器')
    expect(wrapper.text()).toContain('应用专属目录')

    await wrapper.get('input[aria-label="Microsoft 应用客户端 ID"]').setValue('client-id')
    await wrapper.get('input[aria-label="同步密码"]').setValue('这是一个足够长的同步密码')
    await wrapper.get('[data-testid="sync-now"]').trigger('click')
    expect(wrapper.emitted('sync')?.[0]?.[0]).toEqual({
      clientId: 'client-id', method: { password: '这是一个足够长的同步密码' }, rememberDevice: true,
    })
    expect((wrapper.get('input[aria-label="同步密码"]').element as HTMLInputElement).value).toBe('')
  })

  it('offers encrypted JSON by default, explicit CSV/plain exports, imports, and in-app updates', async () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        syncMetadata: { id: 'sync', pending: false, status: 'synced' },
        initialClientId: 'client-id',
        appVersion: '0.1.0',
        updateAvailable: true,
        migrationRecoveryAvailable: true,
      },
    })
    await wrapper.get('[data-testid="export-encrypted"]').trigger('click')
    expect(wrapper.text()).toContain('加密备份密码')
    await wrapper.get('input[aria-label="加密备份密码"]').setValue('足够长的备份文件密码')
    await wrapper.get('[data-testid="confirm-encrypted-export"]').trigger('click')
    await wrapper.get('[data-testid="export-csv"]').trigger('click')
    await wrapper.get('[data-testid="apply-update"]').trigger('click')
    await wrapper.get('[data-testid="export-migration-recovery"]').trigger('click')

    expect(wrapper.emitted('export-encrypted')?.[0]).toEqual(['足够长的备份文件密码'])
    expect(wrapper.emitted('export-csv')).toHaveLength(1)
    expect(wrapper.emitted('apply-update')).toHaveLength(1)
    expect(wrapper.emitted('export-migration-recovery')).toHaveLength(1)
    expect(wrapper.find('input[type="file"]').exists()).toBe(true)
  })

  it('shows concurrent edits and lets the user explicitly keep the remote version', async () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        syncMetadata: { id: 'sync', pending: true, status: 'attention' },
        initialClientId: 'client-id',
        appVersion: '0.1.0',
        conflicts: [conflict],
      },
    })

    expect(wrapper.text()).toContain('同步冲突')
    expect(wrapper.text()).toContain('本机午饭')
    expect(wrapper.text()).toContain('远端午饭')
    await wrapper.get('[data-testid="conflict-remote-conflict-1"]').trigger('click')

    expect(wrapper.emitted('resolve-conflict')?.[0]).toEqual([conflict, 'remote'])
  })

  it('shows encrypted cloud snapshots and requests an explicit restore', async () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        syncMetadata: { id: 'sync', pending: false, status: 'synced' },
        initialClientId: 'client-id', appVersion: '0.1.0',
        cloudSnapshots: [{ id: 'snapshot-1', name: 'vault-1.json', createdAt: '2026-08-14T01:00:00.000Z' }],
      },
    })
    await wrapper.get('[data-testid="restore-cloud-snapshot-1"]').trigger('click')
    expect(wrapper.emitted('restore-cloud-snapshot')?.[0]).toEqual(['snapshot-1', null])
  })
})
