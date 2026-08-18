import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SettingsPanel from '../../src/components/SettingsPanel.vue'

describe('SettingsPanel', () => {
  it('presents local JSON-only backup settings without cloud sync or CSV', () => {
    const wrapper = mount(SettingsPanel, {
      props: { appVersion: '1.3.0' },
    })

    expect(wrapper.text()).toContain('设置与备份')
    expect(wrapper.text()).toContain('数据仅保存在当前浏览器')
    expect(wrapper.text()).toContain('加密 JSON 备份')
    expect(wrapper.text()).toContain('明文 JSON')
    expect(wrapper.text()).toContain('选择 JSON 备份文件')
    expect(wrapper.text()).not.toContain('OneDrive')
    expect(wrapper.text()).not.toContain('Microsoft')
    expect(wrapper.text()).not.toContain('登录 Microsoft 并立即同步')
    expect(wrapper.text()).not.toContain('最近 5 个加密快照')
    expect(wrapper.text()).not.toContain('同步冲突')
    expect(wrapper.text()).not.toContain('CSV')
    expect(wrapper.find('[data-testid="sync-now"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="export-csv"]').exists()).toBe(false)
  })

  it('emits encrypted and plain JSON backup, import, migration, and update actions', async () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        appVersion: '1.3.0',
        updateAvailable: true,
        migrationRecoveryAvailable: true,
      },
    })

    await wrapper.get('[data-testid="export-encrypted"]').trigger('click')
    expect(wrapper.text()).toContain('加密备份密码')
    await wrapper.get('input[aria-label="加密备份密码"]').setValue('足够长的备份文件密码')
    await wrapper.get('[data-testid="confirm-encrypted-export"]').trigger('click')
    await wrapper.get('[data-testid="export-plain"]').trigger('click')
    await wrapper.get('[data-testid="apply-update"]').trigger('click')
    await wrapper.get('[data-testid="export-migration-recovery"]').trigger('click')

    const file = new File(['{}'], '账页备份.json', { type: 'application/json' })
    const input = wrapper.get('input[type="file"]')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
    await input.trigger('change')

    expect(wrapper.emitted('export-encrypted')?.[0]).toEqual(['足够长的备份文件密码'])
    expect(wrapper.emitted('export-plain')).toHaveLength(1)
    expect(wrapper.emitted('apply-update')).toHaveLength(1)
    expect(wrapper.emitted('export-migration-recovery')).toHaveLength(1)
    expect(wrapper.emitted('import-file')?.[0]).toEqual([file, null])
  })

  it('preserves backup-password whitespace while trimming recovery keys', async () => {
    const wrapper = mount(SettingsPanel, {
      props: { appVersion: '1.3.0' },
    })
    const passwordInput = wrapper.get('input[aria-label="备份密码或恢复密钥"]')
    const fileInput = wrapper.get('input[type="file"]')
    const passwordFile = new File(['{}'], 'password.json', { type: 'application/json' })

    await passwordInput.setValue('  v1.2 backup password  ')
    Object.defineProperty(fileInput.element, 'files', { configurable: true, value: [passwordFile] })
    await fileInput.trigger('change')

    expect(wrapper.emitted('import-file')?.[0]).toEqual([
      passwordFile,
      { password: '  v1.2 backup password  ' },
    ])

    const recoveryFile = new File(['{}'], 'recovery.json', { type: 'application/json' })
    await wrapper.get('select[aria-label="备份解锁方式"]').setValue('recovery')
    await passwordInput.setValue('  recovery-key  ')
    Object.defineProperty(fileInput.element, 'files', { configurable: true, value: [recoveryFile] })
    await fileInput.trigger('change')

    expect(wrapper.emitted('import-file')?.[1]).toEqual([
      recoveryFile,
      { recoveryKey: 'recovery-key' },
    ])
  })

  it('counts backup-password length by Unicode characters', async () => {
    const wrapper = mount(SettingsPanel, {
      props: { appVersion: '1.3.0' },
    })

    await wrapper.get('[data-testid="export-encrypted"]').trigger('click')
    const passwordInput = wrapper.get('input[aria-label="加密备份密码"]')
    const confirm = wrapper.get('[data-testid="confirm-encrypted-export"]')
    await passwordInput.setValue('🔐🔐🔐🔐🔐')
    expect(confirm.attributes('disabled')).toBeDefined()
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('export-encrypted')).toBeUndefined()

    await passwordInput.setValue('🔐🔐🔐🔐🔐🔐🔐🔐🔐🔐')
    expect(confirm.attributes('disabled')).toBeUndefined()
  })
})
