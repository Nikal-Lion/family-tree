import { expect, test, type Page } from '@playwright/test'
import { createEmptyFamilyData } from '../../src/services/importExport'
import { toFamilyBrowseData } from '../../src/services/familyBrowseData'
import type { UserRole } from '../../src/types/auth'
import { familyFixture } from '../fixtures/familyData'

async function mockBrowsing(page: Page, role: UserRole = 'user', data = familyFixture()) {
  const mutations: string[] = []
  const user = {
    id: 1, mobile: '13800000000', name: '浏览测试账号',
    role, enabled: true, createdAt: '2026-01-01', updatedAt: '2026-01-01',
  }
  const firstMember = data.members[0]
  if (firstMember) firstMember.photoUrl = ''
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('product-browsing-initialized')) {
      localStorage.setItem('family_auth_session_token', 'product-browsing-test')
      sessionStorage.setItem('product-browsing-initialized', 'true')
    }
  })
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    if (request.method() !== 'GET') {
      mutations.push(`${request.method()} ${new URL(request.url()).pathname}`)
      return route.fulfill({ status: 403, json: { error: '只读浏览不可修改资料' } })
    }
    const path = new URL(request.url()).pathname
    if (path === '/api/auth/session') return route.fulfill({ json: { user } })
    if (path === '/api/browse-data') return route.fulfill({ json: { contractVersion: 1, data: toFamilyBrowseData(data), revision: 1 } })
    throw new Error(`Unexpected browsing request: ${path}`)
  })
  return mutations
}

test('ordinary members start with finding family and never see maintenance actions', async ({ page }) => {
  const mutations = await mockBrowsing(page)
  await page.goto('/app/overview')
  await expect(page.getByRole('tab', { name: '找家人', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: '看族谱', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: '家族记事', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '进入管理', exact: true })).toHaveCount(0)
  for (const name of ['新增', '编辑', '删除', '导入', '从备份恢复']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
  }
  expect(mutations).toEqual([])
})

test('ordinary members cannot enter management by typing its address', async ({ page }) => {
  const mutations = await mockBrowsing(page)
  await page.goto('/app/manage')
  await expect(page).toHaveURL(/\/app\/overview$/)
  await expect(page.getByRole('tab', { name: '找家人', exact: true })).toBeVisible()
  expect(mutations).toEqual([])
})

test('an empty family has a read-only empty state rather than an import prompt', async ({ page }) => {
  const mutations = await mockBrowsing(page, 'user', createEmptyFamilyData())
  await page.goto('/app/overview')
  await expect(page.getByRole('tab', { name: '找家人', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('暂无族谱资料', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: /新增|添加|导入|备份/ })).toHaveCount(0)
  expect(mutations).toEqual([])
})

test('a failed read shows a retry action rather than pretending the family is empty', async ({ page }) => {
  const mutations = await mockBrowsing(page)
  let failing = true
  await page.route((url) => url.pathname === '/api/browse-data', async (route) => {
    expect(route.request().method()).toBe('GET')
    if (failing) return route.fulfill({ status: 503, json: { error: '模拟加载失败' } })
    const data = familyFixture()
    data.members[0]!.photoUrl = ''
    return route.fulfill({ json: { contractVersion: 1, data: toFamilyBrowseData(data), revision: 1 } })
  })
  await page.goto('/app/overview')
  await expect(page.getByText('族谱加载失败', { exact: true })).toBeVisible()
  await expect(page.getByText('暂无族谱资料', { exact: false })).toHaveCount(0)
  failing = false
  await page.getByRole('button', { name: /^重\s*试$/ }).click()
  await expect(page.getByRole('tab', { name: '找家人', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^朝\s*玉/ }).first()).toBeVisible()
  expect(mutations).toEqual([])
})

test('help can be opened and dismissed without logging out or modifying data', async ({ page }) => {
  const mutations = await mockBrowsing(page)
  await page.goto('/app/overview')
  await page.getByRole('button', { name: '账号菜单：浏览测试账号' }).click()
  await page.getByRole('menuitem', { name: '使用帮助' }).click()
  await expect(page.getByRole('heading', { name: '从找到一位家人开始' })).toBeVisible()
  await expect(page.getByText('浏览不会修改族谱。发现资料有误或需要补充时，请联系家族维护人员。')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: '从找到一位家人开始' })).not.toBeVisible()
  await expect(page).toHaveURL(/\/app\/overview$/)
  expect(mutations).toEqual([])
})

test('the account logout action still clears the session and leaves the workspace', async ({ page }) => {
  const mutations = await mockBrowsing(page)
  let loggedOut = false
  await page.route('**/api/auth/logout', async (route) => {
    expect(route.request().method()).toBe('POST')
    loggedOut = true
    await route.fulfill({ json: { ok: true } })
  })
  await page.goto('/app/overview')
  await page.getByRole('button', { name: '账号菜单：浏览测试账号' }).click()
  await page.getByRole('menuitem', { name: '退出登录' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible()
  expect(loggedOut).toBe(true)
  expect(await page.evaluate(() => localStorage.getItem('family_auth_session_token'))).toBeNull()
  expect(mutations).toEqual([])
})

test('an alias search opens a clear archive and can locate its person in the tree', async ({ page }) => {
  const mutations = await mockBrowsing(page)
  await page.goto('/app/overview')
  const search = page.getByRole('textbox', { name: '搜索族人', exact: true })
  await search.fill('玉公')
  await page.getByRole('button', { name: /^朝\s*玉/ }).first().click()
  const archive = page.getByRole('dialog')
  await expect(archive.getByText('暂未记录生父', { exact: true })).toBeVisible()
  await expect(archive.getByRole('button', { name: '在族谱中查看', exact: true })).toBeVisible()
  await archive.getByRole('button', { name: '在族谱中查看', exact: true }).click()
  await expect(page.getByRole('tab', { name: '看族谱', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.chart-toolbar')).toBeVisible()
  await page.getByRole('tab', { name: '找家人', exact: true }).click()
  await expect(search).toHaveValue('玉公')
  expect(mutations).toEqual([])
})

test('archives keep original evidence collapsed without losing genealogy details', async ({ page }) => {
  const mutations = await mockBrowsing(page)
  await page.goto('/app/overview')
  await page.getByRole('button', { name: /^朝\s*玉/ }).first().click()
  const archive = page.locator('.member-archive')
  const evidence = archive.locator('details')
  await expect(evidence).not.toHaveAttribute('open', '')
  await expect(archive.getByText('谱文原句', { exact: true })).not.toBeVisible()
  await expect(archive.getByText('原谱中的子女记载', { exact: true })).toBeVisible()
  await expect(archive.getByText('已关联档案的子女', { exact: true })).toBeVisible()
  await evidence.locator('summary').click()
  await expect(archive.getByText('谱文原句', { exact: true })).toBeVisible()
  await expect(evidence.getByText('甲子年', { exact: false })).toBeVisible()
  await expect(evidence.getByText('坐北朝南', { exact: false })).toBeVisible()
  await expect(evidence.getByText('配孔氏', { exact: true }).first()).toBeVisible()
  expect(mutations).toEqual([])
})

test('relative navigation can return to the previous archive without losing the search', async ({ page }) => {
  const mutations = await mockBrowsing(page)
  await page.goto('/app/overview')
  const search = page.getByRole('textbox', { name: '搜索族人', exact: true })
  await search.fill('玉公')
  await page.getByRole('button', { name: /^朝\s*玉/ }).first().click()
  const archive = page.getByRole('dialog')
  await expect(archive).toHaveAttribute('aria-label', '朝玉 · 人物档案')
  await archive.getByRole('button', { name: /^太\s*琼$/ }).first().click()
  await expect(archive).toHaveAttribute('aria-label', '太琼 · 人物档案')
  await archive.getByRole('button', { name: '返回上一位', exact: true }).click()
  await expect(archive).toHaveAttribute('aria-label', '朝玉 · 人物档案')
  await page.keyboard.press('Escape')
  await expect(archive).not.toBeVisible()
  await expect(search).toHaveValue('玉公')
  await page.getByRole('button', { name: /^朝\s*玉/ }).first().click()
  await expect(archive.getByRole('button', { name: '返回上一位', exact: true })).toHaveCount(0)
  expect(mutations).toEqual([])
})

test('recentering a person preserves the chosen depth and manually collapsed descendants', async ({ page }) => {
  const mutations = await mockBrowsing(page)
  await page.goto('/app/overview')
  const search = page.getByRole('textbox', { name: '搜索族人', exact: true })
  await search.fill('玉公')
  await page.getByRole('button', { name: /^朝\s*玉/ }).first().click()
  await page.getByRole('button', { name: '在族谱中查看', exact: true }).click()
  await page.getByLabel('展开层级').click()
  await page.locator('.ant-select-item-option[title="展开 2 层"]').click()
  await page.getByRole('button', { name: '收起后代', exact: true }).click()
  await expect(page.getByRole('button', { name: '展开后代', exact: true })).toBeEnabled()
  const count = page.locator('.chart-toolbar .chart-hint')
  const collapsedCount = await count.textContent()
  await page.getByRole('button', { name: '回到当前人物', exact: true }).click()
  await expect(count).toHaveText(collapsedCount!)
  await expect(page.getByRole('button', { name: '展开后代', exact: true })).toBeEnabled()
  await expect(page.locator('.chart-toolbar')).toContainText('展开 2 层')
  await expect(search).toHaveValue('玉公')
  expect(mutations).toEqual([])
})

test('desktop directory keeps its current page after viewing a person and switching tabs', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The mobile directory uses load-more cards instead of pagination')
  const data = familyFixture()
  data.members.push(...Array.from({ length: 25 }, (_, index) => ({
    id: 100 + index, name: `补充族人${index}`, gender: '男' as const, parentId: 1,
  })))
  data.nextId = 125
  const mutations = await mockBrowsing(page, 'user', data)
  await page.goto('/app/overview')
  await page.locator('.ant-pagination-item-2').click()
  const firstName = page.locator('.ant-table-row').first().getByRole('button').first()
  const name = await firstName.innerText()
  await firstName.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: '看族谱', exact: true }).click()
  await page.getByRole('tab', { name: '找家人', exact: true }).click()
  await expect(page.locator('.ant-pagination-item-active')).toHaveText('2')
  await expect(page.locator('.ant-table-row').first().getByRole('button').first()).toHaveText(name)
  expect(mutations).toEqual([])
})

test('360px browsing and archive stay inside the page viewport', async ({ page }) => {
  const mutations = await mockBrowsing(page)
  await page.setViewportSize({ width: 360, height: 780 })
  await page.goto('/app/overview')
  for (const name of ['找家人', '看族谱', '家族记事']) {
    const tab = page.getByRole('tab', { name, exact: true })
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    const size = await tab.boundingBox()
    expect(size?.height).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
  }
  await page.getByRole('tab', { name: '找家人', exact: true }).click()
  await page.getByRole('button', { name: /^朝\s*玉/ }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const action = page.getByRole('button', { name: '在族谱中查看', exact: true })
  expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
  expect(mutations).toEqual([])
})

for (const role of ['maintainer', 'sysadmin'] as const) {
  test(`${role} retains a management entry while browsing`, async ({ page }) => {
    await mockBrowsing(page, role)
    await page.goto('/app/overview')
    await expect(page.getByRole('button', { name: '进入管理', exact: true })).toBeVisible()
  })
}
