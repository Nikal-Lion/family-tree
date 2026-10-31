import { expect, test, type Locator, type Page } from '@playwright/test'
import { normalizeFamilyBrowseData } from '../../src/services/familyBrowseData'

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
    if (path === '/api/browse-data') return route.fulfill({ json: { contractVersion: 1, data: normalizeFamilyBrowseData(data), revision: 1 } })
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
  await page.getByRole('tab', { name: '看族谱', exact: true }).click()
  await expect(page.locator('.chart-toolbar')).toBeVisible()
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

  for (const name of ['家族记事', '找家人', '看族谱']) {
    await page.getByRole('tab', { name, exact: true }).click()
    if (isMobile && name === '家族记事') {
      const table = page.locator('.ant-tabs-tabpane-active .ant-table-content:visible').first()
      await table.evaluate(element => { element.scrollLeft = 100 })
      expect(await table.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
    }
    await expectNoPageOverflow(page)
  }
})

test('the first content starts below the fixed header after opening the workspace', async ({ page }) => {
  await page.goto('/app/overview')
  const intro = page.getByRole('region', { name: '浏览入门提示', exact: true })
  await expect(intro).toBeVisible()
  await expect.poll(async () => {
    const header = await page.locator('.workspace-shell header').first().boundingBox()
    const content = await intro.boundingBox()
    return content!.y - (header!.y + header!.height)
  }).toBeGreaterThanOrEqual(0)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})

test('mobile search controls use zoom-safe text and omit the removed filters', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'iOS focus zoom regression')
  await page.goto('/app/overview')
  await expect(page.getByRole('button', { name: '刷新资料', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('筛选性别', { exact: true })).toHaveCount(0)
  const select = page.getByLabel('筛选分支', { exact: true })
  await select.click()
  expect(await select.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16)
  const inputs = page.locator('.overview-find input')
  for (const input of await inputs.all()) {
    expect(await input.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16)
  }
})

for (const path of ['/app/overview', '/app/manage']) {
  for (const close of ['button', 'escape', 'mask'] as const) {
    test(`${path} preserves mobile reading position when closing an archive by ${close}`, async ({ page, isMobile }) => {
      test.skip(!isMobile, 'Mobile card browsing regression')
      await page.setViewportSize({ width: close === 'mask' ? 740 : 360, height: 780 })
      await page.goto(path)
      const card = page.locator('.member-summary-card').nth(12)
      await card.scrollIntoViewIfNeeded()
      const originY = await page.evaluate(() => window.scrollY)
      expect(originY).toBeGreaterThan(500)
      await card.click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(dialog.locator('.ant-drawer-close')).toBeInViewport()
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(originY)
      await expect(dialog.locator('table')).toHaveCount(0)
      if (path.endsWith('manage')) {
        const actions = dialog.locator('.member-detail-actions .ant-btn')
        const boxes = await Promise.all((await actions.all()).map(action => action.boundingBox()))
        expect(boxes).toHaveLength(3)
        expect(new Set(boxes.map(box => box!.y)).size).toBe(1)
        for (const box of boxes) expect(box!.height).toBeGreaterThanOrEqual(44)
        const identity = await dialog.locator('.member-detail-identity').boundingBox()
        expect(boxes[0]!.y - (identity!.y + identity!.height)).toBeGreaterThanOrEqual(12)
      }
      await dialog.locator('.ant-drawer-body').evaluate(element => { element.scrollTop = 500 })
      if (close === 'button') await dialog.locator('.ant-drawer-close').click()
      else if (close === 'escape') await page.keyboard.press('Escape')
      else {
        await page.locator('.ant-drawer-mask').click({ position: { x: 10, y: 180 } })
      }
      await expect(dialog).not.toBeVisible()
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(originY)
      await expect(card).toBeInViewport()
      const top = page.getByRole('button', { name: '返回顶部', exact: true })
      if (path.endsWith('overview')) {
        await expect(top).toBeVisible()
        const bounds = await top.boundingBox()
        const viewport = page.viewportSize()!
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height)
        await top.click()
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
      }
      await expectNoPageOverflow(page)
    })
  }
}

test('default depth limits the rendered tree on phones without changing desktop defaults', async ({ page, isMobile }) => {
  await page.goto('/app/overview')
  await page.getByRole('tab', { name: '看族谱', exact: true }).click()
  const depth = page.getByLabel('展开层级')
  await expect(depth).toBeVisible()
  await expect(page.locator('.chart-toolbar')).toContainText(isMobile ? '展开 3 层' : '展开 4 层')
  await expect(page.getByText(isMobile ? '当前显示 31 / 600 人' : '当前显示 156 / 600 人', { exact: false })).toBeVisible()
  await depth.click()
  await expect(page.locator('.ant-select-item-option[title="展开 3 层"]')).toBeVisible()
})

test('opening an editor over an archive keeps the archive and reading position intact', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 })
  await page.goto('/app/manage')
  const card = page.locator('.member-summary-card').nth(12)
  await card.scrollIntoViewIfNeeded()
  const originY = await page.evaluate(() => window.scrollY)
  await card.click()
  const archive = page.getByRole('dialog', { name: /人物档案/ })
  await archive.getByRole('button', { name: '编辑档案', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '编辑人物档案', exact: true })
  await expect(editor).toBeVisible()
  await expect.poll(() => editor.evaluate(element => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(editor).not.toBeVisible()
  await expect(archive).toBeVisible()
  await archive.locator('.ant-drawer-close').click()
  await expect(archive).not.toBeVisible()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(originY)
})

test('a drawer locks background wheel scrolling without moving the page', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Mobile WebKit does not expose wheel input')
  await page.setViewportSize({ width: 740, height: 780 })
  await page.goto('/app/overview')
  await page.locator('.member-summary-card').nth(12).scrollIntoViewIfNeeded()
  const originY = await page.evaluate(() => window.scrollY)
  await page.locator('.member-summary-card').nth(12).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.mouse.move(10, 300)
  await page.mouse.wheel(0, 300)
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe('hidden')
  expect(await page.evaluate(() => window.scrollY)).toBe(originY)
  await page.locator('.ant-drawer-mask').click({ position: { x: 10, y: 180 } })
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(originY)
})

test('archive transitions respect reduced motion without losing close behavior', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 360, height: 780 })
  await page.goto('/app/overview')
  await page.locator('.member-summary-card').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const duration = await page.locator('.workspace-drawer .ant-drawer-content-wrapper').evaluate(element =>
    parseFloat(getComputedStyle(element).transitionDuration))
  expect(duration).toBeLessThanOrEqual(0.001)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('phone rotation preserves a manually chosen depth and keeps the page contained', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Phone rotation only')
  await page.goto('/app/overview')
  await page.getByRole('tab', { name: '看族谱', exact: true }).click()
  await page.getByLabel('展开层级').click()
  await page.locator('.ant-select-item-option[title="展开 2 层"]').click()
  await expect(page.locator('.chart-toolbar')).toContainText('展开 2 层')
  await page.setViewportSize({ width: 844, height: 390 })
  await expect(page.locator('.chart-toolbar')).toContainText('展开 2 层')
  await expectNoPageOverflow(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await expectNoPageOverflow(page)
})

test('management navigation opens from the header and can change pages', async ({ page, isMobile }) => {
  await page.goto('/app/system')
  const toggle = page.getByRole('button', { name: '展开导航', exact: true })
  if (!isMobile) {
    await page.getByRole('button', { name: '收起导航', exact: true }).click()
  }
  await expect(toggle).toBeVisible()
  if (isMobile) await toggle.tap()
  else await toggle.click()
  await expect(page.getByRole('button', { name: '收起导航', exact: true })).toHaveAttribute('aria-expanded', 'true')
  const manage = page.getByRole('menuitem', { name: '数据维护', exact: false })
  await expect(manage).toBeVisible()
  if (isMobile) await manage.tap()
  else await manage.click()
  await expect(page).toHaveURL(/\/app\/manage$/)
  await expectNoPageOverflow(page)
})

test('the mobile header brand returns from system management to the family directory', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'The desktop brand lives in the sidebar')
  await page.goto('/app/system')
  const brand = page.locator('header .workspace-brand')
  await expect(brand).toBeVisible()
  await brand.tap()
  await expect(page).toHaveURL(/\/app\/overview$/)
  await expect(page.getByRole('tab', { name: '找家人', exact: true })).toBeVisible()
})

for (const input of ['touch', 'mouse'] as const) {
  test(`mobile header controls respond to ${input} input with the account menu open after scrolling`, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile input interaction regression')
    const activate = (target: Locator) => input === 'touch' ? target.tap() : target.click()
    await page.goto('/app/system')
    await page.getByText('D1 云端诊断', { exact: true }).scrollIntoViewIfNeeded()
    await activate(page.getByRole('button', { name: /^账号菜单：/ }))
    await expect(page.getByRole('menuitem', { name: '使用帮助' })).toBeVisible()
    await activate(page.getByRole('button', { name: '展开导航', exact: true }))
    await expect(page.getByRole('button', { name: '收起导航', exact: true })).toHaveAttribute('aria-expanded', 'true')
    await activate(page.getByRole('menuitem', { name: '系统管理', exact: false }))
    await expect(page.getByRole('button', { name: '展开导航', exact: true })).toHaveAttribute('aria-expanded', 'false')
    await activate(page.getByRole('button', { name: /^账号菜单：/ }))
    await expect(page.getByRole('menuitem', { name: '使用帮助' })).toBeVisible()
    await activate(page.locator('header .workspace-brand'))
    await expect(page).toHaveURL(/\/app\/overview$/)
  })
}
