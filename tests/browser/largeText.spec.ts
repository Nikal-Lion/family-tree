import { expect, test, type Page } from '@playwright/test'
import { toFamilyBrowseData } from '../../src/services/familyBrowseData'
import { familyFixture } from '../fixtures/familyData'

const preferenceKey = 'family_large_text_v1'
const user = {
  id: 1, mobile: '13800000000', name: '大字模式测试账号', role: 'sysadmin',
  enabled: true, createdAt: '', updatedAt: '',
}

test.beforeEach(async ({ page }) => {
  const data = familyFixture()
  data.members.forEach(member => { member.photoUrl = '' })
  await page.addInitScript(() => localStorage.setItem('family_browse_guide_seen_v1', '1'))
  await page.route('**/api/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/auth/status') return route.fulfill({ json: { initialized: true } })
    if (path === '/api/auth/login-options') return route.fulfill({ json: { passwordRequired: true } })
    if (path === '/api/auth/login') return route.fulfill({ json: { ok: true, token: 'large-text-test', user, expiresAt: '' } })
    if (path === '/api/auth/logout') return route.fulfill({ json: { ok: true } })
    if (request.method() !== 'GET') throw new Error(`Display preferences must not write business data: ${path}`)
    if (path === '/api/auth/session') return route.fulfill({ json: { user } })
    if (path === '/api/browse-data') return route.fulfill({ json: { contractVersion: 1, data: toFamilyBrowseData(data), revision: 1 } })
    if (path === '/api/family-data') return route.fulfill({ json: { data, revision: 1 } })
    if (path === '/api/login-users') return route.fulfill({ json: { users: [user] } })
    throw new Error(`Unexpected API request: ${path}`)
  })
})

async function expectContained(page: Page) {
  const overflow = await page.evaluate(() => [...document.querySelectorAll('html, body, main')].map(element => ({
    width: element.clientWidth, scroll: element.scrollWidth,
  })))
  for (const element of overflow) expect(element.scroll).toBeLessThanOrEqual(element.width)
  const toggle = page.getByRole('button', { name: '大字模式', exact: true })
  await expect(toggle).toBeInViewport()
  const size = await toggle.boundingBox()
  expect(size!.height).toBeGreaterThanOrEqual(44)
  expect(size!.width).toBeGreaterThanOrEqual(44)
}

async function openWorkspace(page: Page, path = '/app/overview') {
  await page.addInitScript(() => localStorage.setItem('family_auth_session_token', 'large-text-test'))
  await page.goto(path)
  await expect(page.getByRole('button', { name: '大字模式', exact: true })).toBeVisible()
}

test('large text spans login, management, browsing, overlays and logout, and can be restored', async ({ page }) => {
  await page.goto('/login')
  const toggle = page.getByRole('button', { name: '大字模式', exact: true })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  const title = page.getByRole('heading', { name: '欢迎回来', exact: true })
  const originalTitleSize = await title.evaluate(element => parseFloat(getComputedStyle(element).fontSize))
  const phone = page.getByLabel('手机号', { exact: true })
  await phone.fill(user.mobile)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(phone).toHaveValue(user.mobile)
  expect(await title.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeCloseTo(originalTitleSize * 1.25)
  await expect.poll(() => phone.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(18)
  await expectContained(page)
  await page.getByLabel('账号密码', { exact: true }).fill('test-only-password')
  await page.getByRole('button', { name: '验证并登录', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/manage$/)
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expectContained(page)

  await page.getByRole('button', { name: '浏览族谱', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/overview$/)
  const search = page.getByRole('textbox', { name: '搜索族人', exact: true })
  expect(await search.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(18)
  await search.fill('朝玉')
  await page.getByRole('button', { name: /^朝\s*玉/ }).first().click()
  const archive = page.getByRole('dialog')
  await expect(archive).toBeVisible()
  expect(await archive.locator('.archive-name').evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBe(25)
  await archive.locator('.ant-drawer-close').click()
  await expect(archive).not.toBeVisible()
  await expect(search).toHaveValue('朝玉')
  await page.getByRole('tab', { name: '看族谱', exact: true }).click()
  await expect(page.locator('.chart-canvas canvas')).toBeVisible()
  const hint = await page.locator('.chart-toolbar .chart-hint').textContent()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.chart-toolbar .chart-hint')).toHaveText(hint!)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expectContained(page)

  await page.goto('/app/system')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('heading', { name: '系统管理', exact: true })).toBeVisible()
  await expectContained(page)
  await page.reload()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: /^账号菜单：/ }).click()
  await page.getByRole('menuitem', { name: '退出登录' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await toggle.press('Enter')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await page.reload()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(await title.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBe(originalTitleSize)
  expect(await page.evaluate(key => localStorage.getItem(key), preferenceKey)).toBe('0')
})

for (const width of [360, 740]) {
  test(`large text keeps controls and overlays within a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 })
    await page.addInitScript(key => localStorage.setItem(key, '1'), preferenceKey)
    await openWorkspace(page, '/app/manage')
    await expectContained(page)
    await page.getByRole('button', { name: /新增族人/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const bounds = await dialog.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    const input = dialog.locator('input').first()
    expect(await input.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(18)
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await page.getByRole('button', { name: '浏览族谱', exact: true }).click()
    await page.getByRole('tab', { name: '看族谱', exact: true }).click()
    await expect(page.locator('.chart-canvas canvas')).toBeVisible()
    await expectContained(page)
    await page.getByLabel('图谱方向').click()
    await page.getByTitle('纵向排列', { exact: true }).click()
    await expectContained(page)
  })
}

test('blocked storage reports the persistence failure but still changes the current display', async ({ page }) => {
  await page.addInitScript(key => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('Storage blocked', 'QuotaExceededError')
      return original.call(this, name, value)
    }
  }, preferenceKey)
  await page.goto('/login')
  const toggle = page.getByRole('button', { name: '大字模式', exact: true })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('大字模式已切换，但无法记住设置，下次打开时需重新选择。')).toBeVisible()
  expect(await page.locator('html').evaluate(element => element.classList.contains('large-text'))).toBe(true)
})
