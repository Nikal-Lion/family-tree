import { expect, test, type Page } from '@playwright/test'

const members = Array.from({ length: 600 }, (_, index) => ({
  id: index + 1,
  name: index ? `测试族人${index + 1}` : '测试始祖',
  gender: '男',
  parentId: index ? Math.floor((index - 1) / 5) + 1 : null,
  lineageBranch: '测试分支',
}))
const user = {
  id: 1, mobile: '13800000000', name: '测试账号'.repeat(20),
  role: 'sysadmin', enabled: true, createdAt: '2026-01-01', updatedAt: '2026-01-01',
  passwordConfigured: true, passwordChangeRequired: false,
}
const data = {
  schemaVersion: 4, members,
  spouses: [], childClaims: [], aliases: [], temporals: [], relations: [], burials: [],
  events: [{
    id: 1, memberId: 1, type: '其他', title: '测试事件', date: '2026-01-01',
    description: '测试说明'.repeat(100), createdAt: '2026-01-01', updatedAt: '2026-01-01',
  }],
  tracks: [],
  nextId: 601, nextSpouseId: 1, nextChildClaimId: 1, nextAliasId: 1,
  nextTemporalId: 1, nextRelationId: 1, nextBurialId: 1, nextEventId: 2, nextTrackId: 1,
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('family_auth_session_token', 'browser-layout-test'))
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() !== 'GET') throw new Error('Layout tests must not write data')
    if (path === '/api/auth/session') return route.fulfill({ json: { user } })
    if (path === '/api/family-data') return route.fulfill({ json: { data, revision: 1 } })
    if (path === '/api/login-users') return route.fulfill({ json: { users: [user] } })
    throw new Error(`Unexpected API request: ${path}`)
  })
})

async function expectNoPageOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    main: document.querySelector('main')!.scrollWidth,
    mainViewport: document.querySelector('main')!.clientWidth,
  }))
  expect(widths.document).toBeLessThanOrEqual(widths.viewport)
  expect(widths.body).toBeLessThanOrEqual(widths.viewport)
  expect(widths.main).toBeLessThanOrEqual(widths.mainViewport)
  await page.evaluate(() => window.scrollTo(200, window.scrollY))
  const scroll = await page.evaluate(() => ({
    x: window.scrollX,
    innerWidth: window.innerWidth,
    viewport: window.visualViewport?.width,
    document: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
    body: document.body.getBoundingClientRect().width,
    rootOverflow: getComputedStyle(document.documentElement).overflowX,
    bodyOverflow: getComputedStyle(document.body).overflowX,
  }))
  expect(scroll.x, JSON.stringify(scroll)).toBe(0)
}

test('overview stays inside the viewport while charts and tables scroll locally', async ({ page, isMobile }) => {
  await page.goto('/app/overview')
  await expect(page.getByRole('heading', { name: '父系世系图' })).toBeVisible()
  await expectNoPageOverflow(page)
  const stage = page.locator('.chart-stage')
  await expect.poll(() => stage.evaluate((element, horizontal) => horizontal
    ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight, isMobile)).toBeGreaterThan(0)
  await stage.evaluate((element, horizontal) => {
    if (horizontal) element.scrollLeft = 100
    else element.scrollTop = 100
  }, isMobile)
  expect(await stage.evaluate((element, horizontal) => horizontal ? element.scrollLeft : element.scrollTop, isMobile)).toBeGreaterThan(0)
  await expectNoPageOverflow(page)

  for (const name of ['世代统计', '家族事件 · 1', '寻根足迹 · 0', '族谱与族人']) {
    await page.getByRole('tab', { name, exact: true }).click()
    if (isMobile && name === '家族事件 · 1') {
      const table = page.locator('.ant-tabs-tabpane-active .ant-table-content')
      await table.evaluate(element => { element.scrollLeft = 100 })
      expect(await table.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
    }
    await expectNoPageOverflow(page)
  }
})

test('default depth limits the rendered tree on phones without changing desktop defaults', async ({ page, isMobile }) => {
  await page.goto('/app/overview')
  const depth = page.getByLabel('展开层级')
  await expect(depth).toBeVisible()
  await expect(page.locator('.chart-toolbar')).toContainText(isMobile ? '展开 3 层' : '展开 4 层')
  await expect(page.getByText(isMobile ? '当前显示 31 / 600 人' : '当前显示 156 / 600 人', { exact: false })).toBeVisible()
  await depth.click()
  await expect(page.locator('.ant-select-item-option[title="展开 3 层"]')).toBeVisible()
})

test('phone rotation preserves a manually chosen depth and keeps the page contained', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Phone rotation only')
  await page.goto('/app/overview')
  await page.getByLabel('展开层级').click()
  await page.locator('.ant-select-item-option[title="展开 2 层"]').click()
  await expect(page.locator('.chart-toolbar')).toContainText('展开 2 层')
  await page.setViewportSize({ width: 844, height: 390 })
  await expect(page.locator('.chart-toolbar')).toContainText('展开 2 层')
  await expectNoPageOverflow(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await expectNoPageOverflow(page)
})
