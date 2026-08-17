import { expect, test } from '@playwright/test'

test('records a transaction and exposes it in the ledger and statistics', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '记一笔' })).toBeVisible()

  await page.getByTestId('amount-input').fill('18.80')
  await page.getByRole('button', { name: /餐饮/ }).click()
  await page.getByTestId('entry-details-toggle').click()
  await page.getByLabel('备注').fill('端到端验收午饭')
  await page.getByTestId('save-entry').getByRole('button', { name: '保存支出' }).click()
  await expect(page.getByText('本机已保存，可继续记账')).toBeVisible()

  await page.getByTestId('nav-ledger').click()
  const ledger = page.locator('section[aria-labelledby="ledger-title"]')
  await expect(ledger.getByText('端到端验收午饭')).toBeVisible()
  await expect(ledger.getByText('−¥18.80')).toBeVisible()

  await page.getByTestId('nav-stats').click()
  const stats = page.locator('section[aria-labelledby="stats-title"]')
  await expect(stats.getByRole('heading', { name: '支出去向' })).toBeVisible()
  await expect(stats.getByText('¥18.80').first()).toBeVisible()
})

test('persists an unfinished draft across reload and lets the user undo a saved row', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('amount-input').fill('9.90')
  await page.getByTestId('entry-details-toggle').click()
  await page.getByLabel('备注').fill('刷新后仍保留')
  await page.reload()
  await expect(page.getByTestId('amount-input')).toHaveValue('9.90')
  await expect(page.getByLabel('备注')).toHaveValue('刷新后仍保留')

  await page.getByRole('button', { name: /餐饮/ }).click()
  await page.getByTestId('save-entry').getByRole('button', { name: '保存支出' }).click()
  await page.getByRole('status').getByRole('button', { name: '撤销' }).click()
  await page.getByTestId('nav-ledger').click()
  await expect(page.getByText('刷新后仍保留')).toHaveCount(0)
})

test('keeps edit identity across reload and overwrites the original row', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('amount-input').fill('28.80')
  await page.getByRole('button', { name: /餐饮/ }).click()
  await page.getByTestId('entry-details-toggle').click()
  await page.getByLabel('备注').fill('编辑前流水')
  await page.getByTestId('save-entry').getByRole('button', { name: '保存支出' }).click()

  await page.getByTestId('nav-ledger').click()
  await page.getByRole('button', { name: '操作 编辑前流水' }).click()
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await page.getByLabel('备注').fill('编辑后流水')
  await page.reload()
  await expect(page.getByLabel('备注')).toHaveValue('编辑后流水')
  await page.getByTestId('save-entry').getByRole('button', { name: '保存支出' }).click()

  await page.getByTestId('nav-ledger').click()
  await expect(page.getByText('编辑后流水')).toHaveCount(1)
  await expect(page.getByText('编辑前流水')).toHaveCount(0)
})

test('opens the production PWA while the browser is offline', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await context.setOffline(true)
  try {
    await page.reload()
    await expect(page.getByRole('heading', { name: '记一笔' })).toBeVisible()
  } finally {
    await context.setOffline(false)
  }
})
