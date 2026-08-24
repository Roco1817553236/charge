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
  await expect(stats.getByRole('heading', { name: '收支统计' })).toBeVisible()
  await expect(stats.getByText('¥18.80').first()).toBeVisible()

  const subcategory = stats.locator('.subcategory-list button').first()
  await subcategory.press('Enter')
  const details = stats.getByTestId('expense-subcategory-details')
  await expect(details).toContainText('端到端验收午饭')
  await expect(details).toContainText('¥18.80')
  await details.getByRole('button', { name: /收起/ }).click()
  await expect(details).toHaveCount(0)
  await expect(subcategory).toBeFocused()

  await subcategory.press('Space')
  await expect(details).toContainText('端到端验收午饭')
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

test('shows income, expense and balance together in statistics', async ({ page }) => {
  await page.setViewportSize({ width: 414, height: 900 })
  await page.goto('/')
  const disabledBackground = await page.getByTestId('save-entry').locator('.save-button').evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(disabledBackground).not.toBe('rgb(21, 128, 61)')
  expect(disabledBackground).not.toBe('rgb(198, 40, 40)')
  await page.getByTestId('amount-input').fill('999999999998.99')
  await page.getByRole('button', { name: /餐饮/ }).click()
  await expect(page.getByTestId('amount-input')).toHaveCSS('color', 'rgb(21, 128, 61)')
  await expect(page.getByTestId('save-entry').locator('.save-button')).toHaveCSS('background-color', 'rgb(21, 128, 61)')
  await page.getByTestId('save-entry').getByRole('button', { name: '保存支出' }).click()

  await page.getByTestId('type-income').click()
  await page.getByTestId('amount-input').fill('999999999999.99')
  await page.getByRole('button', { name: /工资/ }).click()
  await expect(page.getByTestId('amount-input')).toHaveCSS('color', 'rgb(198, 40, 40)')
  await expect(page.getByTestId('save-entry').locator('.save-button')).toHaveCSS('background-color', 'rgb(198, 40, 40)')
  await page.getByTestId('save-entry').getByRole('button', { name: '保存收入' }).click()

  await page.getByTestId('nav-stats').click()
  await expect(page.getByTestId('stats-current-income')).toContainText('¥999,999,999,999.99')
  await expect(page.getByTestId('stats-current-expense')).toContainText('¥999,999,999,998.99')
  await expect(page.getByTestId('stats-current-balance')).toContainText('¥1.00')
  await expect(page.getByTestId('stats-current-income').locator('strong')).toHaveCSS('color', 'rgb(198, 40, 40)')
  await expect(page.getByTestId('stats-current-expense').locator('strong')).toHaveCSS('color', 'rgb(21, 128, 61)')
  await page.waitForTimeout(400)
  const clipped = await page.locator('.cashflow-card strong, .change-card strong').evaluateAll(
    (nodes) => nodes.some((node) => {
      const amount = node.getBoundingClientRect()
      const card = node.closest('article')?.getBoundingClientRect()
      return !card || amount.left < card.left || amount.right > card.right || amount.left < 0 || amount.right > innerWidth
    }),
  )
  expect(clipped).toBe(false)

  await page.getByTestId('nav-ledger').click()
  await expect(page.locator('.transaction-amount.income')).toHaveCSS('color', 'rgb(198, 40, 40)')
  await expect(page.locator('.transaction-amount.expense')).toHaveCSS('color', 'rgb(21, 128, 61)')

  await page.emulateMedia({ colorScheme: 'dark' })
  const darkColors = await page.evaluate(() => {
    const resolve = (token: string) => {
      const probe = document.createElement('span')
      probe.style.color = `var(${token})`
      document.body.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    }
    return { income: resolve('--income-color'), expense: resolve('--expense-color') }
  })
  expect(darkColors).toEqual({ income: 'rgb(255, 107, 107)', expense: 'rgb(74, 222, 128)' })
  await expect(page.locator('.transaction-amount.income')).toHaveCSS('color', 'rgb(255, 107, 107)')
  await expect(page.locator('.transaction-amount.expense')).toHaveCSS('color', 'rgb(74, 222, 128)')
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

test('tracks item daily cost with additional repair cost across reload', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('nav-items').click()
  await expect(page.getByRole('heading', { name: '物品日均' })).toBeVisible()

  await page.getByTestId('add-item').click()
  await page.getByTestId('add-item-manual').click()
  await page.getByTestId('item-name-input').fill('端到端笔记本')
  await page.getByTestId('item-amount-input').fill('1000.00')
  await page.getByTestId('item-purchase-date-input').fill('2026-08-01')
  await page.getByTestId('item-form').getByRole('button', { name: '保存物品' }).click()
  await expect(page.getByText('端到端笔记本')).toBeVisible()

  await page.getByRole('button', { name: /端到端笔记本/ }).click()
  await page.getByRole('button', { name: '＋ 追加成本' }).click()
  const costDialog = page.getByRole('dialog')
  await costDialog.getByLabel('金额').fill('200.00')
  await costDialog.getByLabel('发生日期').fill('2026-08-10')
  await costDialog.getByLabel('说明').fill('更换风扇')
  await costDialog.getByRole('button', { name: '保存追加成本' }).click()
  const itemCard = page.locator('.item-card').filter({ hasText: '端到端笔记本' })
  await expect(itemCard.getByText('¥1,200.00').last()).toBeVisible()

  await page.reload()
  await page.getByTestId('nav-items').click()
  await page.getByRole('button', { name: /端到端笔记本/ }).click()
  await expect(page.getByText('更换风扇')).toBeVisible()
  await expect(page.locator('.item-card').filter({ hasText: '端到端笔记本' }).getByText('¥1,200.00').last()).toBeVisible()
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
