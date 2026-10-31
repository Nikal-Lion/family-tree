import { expect, test, type Page, type Route } from '@playwright/test'
import type { LoginUser, LoginUserRole } from '../../src/types/auth'
import { familyFixture } from '../fixtures/familyData'
import { toFamilyBrowseData } from '../../src/services/familyBrowseData'

function account(role: LoginUserRole = 'user', id = 1): LoginUser {
  return {
    id, mobile: '+85212345678', name: `测试${role}`, role, enabled: true,
    passwordConfigured: true, passwordChangeRequired: false, createdAt: '', updatedAt: '',
  }
}

async function mockApi(page: Page, login: (route: Route) => Promise<void>, current = account(), initialized = true) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/status') return route.fulfill({ json: { initialized } })
    if (path === '/api/auth/login' || path === '/api/auth/bootstrap-sysadmin') return login(route)
    if (path === '/api/auth/session') return route.fulfill({ json: { user: current } })
    if (path === '/api/browse-data') return route.fulfill({ json: { contractVersion: 1, data: toFamilyBrowseData(familyFixture()), revision: 1 } })
    if (path === '/api/family-data') return route.fulfill({ json: { data: familyFixture(), revision: 1 } })
    if (path === '/api/login-users') return route.fulfill({ json: { users: [current] } })
    throw new Error(`Unexpected login test request: ${path}`)
  })
}

for (const role of ['user', 'maintainer', 'sysadmin'] as const) {
  test(`${role} requires a password with a normalized international phone and no role choice`, async ({ page }) => {
    const requests: unknown[] = []
    await mockApi(page, async route => {
      requests.push(route.request().postDataJSON())
      await route.fulfill({ json: { ok: true, token: 'account-session', user: account(role), expiresAt: '' } })
    }, account(role))
    await page.goto('/login')
    await expect(page.getByRole('radio')).toHaveCount(0)
    const submit = page.getByRole('button', { name: /^登\s*录$/ })
    expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await page.getByLabel('手机号', { exact: true }).fill(' +852 1234 5678 ')
    await submit.click()
    await expect(page).toHaveURL(/\/login$/)
    expect(requests).toEqual([])
    await page.getByLabel('账号密码', { exact: true }).fill('account-password')
    await submit.click()
    await expect(page).toHaveURL(new RegExp(`/app/${role === 'user' ? 'overview' : 'manage'}$`))
    expect(requests).toEqual([{ mobile: '+85212345678', password: 'account-password' }])
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('account-password')
  })
}

test('phone blur does not authenticate or probe accounts; first login opens the guide only once', async ({ page }) => {
  const logins: unknown[] = []
  await mockApi(page, async route => {
    logins.push(route.request().postDataJSON())
    await route.fulfill({ json: { ok: true, token: 'ordinary-session', user: account(), expiresAt: '' } })
  })
  await page.goto('/login')
  const phone = page.getByLabel('手机号', { exact: true })
  await phone.fill('+85212345678')
  await phone.press('Tab')
  await expect(page.getByLabel('账号密码', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '首次启用？初始化系统管理员', exact: true })).toHaveCount(0)
  expect(logins).toEqual([])
  await page.getByLabel('账号密码', { exact: true }).fill('account-password')
  await page.getByRole('button', { name: /^登\s*录$/ }).click()
  await expect(page).toHaveURL(/\/app\/overview$/)
  const guide = page.getByRole('dialog', { name: '使用帮助', exact: true })
  await expect(guide).toBeVisible()
  await guide.locator('.ant-drawer-close').click()
  await expect(guide).not.toBeVisible()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  const header = await page.locator('.workspace-shell header').first().boundingBox()
  const intro = await page.getByRole('region', { name: '浏览入门提示', exact: true }).boundingBox()
  expect(intro!.y).toBeGreaterThanOrEqual(header!.y + header!.height)
  await page.reload()
  await expect(page.getByRole('tab', { name: '找家人', exact: true })).toBeVisible()
  await expect(guide).not.toBeVisible()
  await page.getByRole('button', { name: /^账号菜单：/ }).click()
  await page.getByRole('menuitem', { name: '使用帮助' }).click()
  await expect(guide).toBeVisible()
})

test('a failed initialization check keeps bootstrap hidden and provides an explicit retry', async ({ page }) => {
  await mockApi(page, async () => { throw new Error('Unexpected login') })
  let failing = true
  await page.route('**/api/auth/status', route => failing
    ? route.fulfill({ status: 503, json: { error: '检测暂不可用' } })
    : route.fulfill({ json: { initialized: false } }))
  await page.goto('/login')
  await expect(page.getByText('无法检测系统初始化状态', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '首次启用？初始化系统管理员', exact: true })).toHaveCount(0)
  failing = false
  await page.getByRole('button', { name: '重试检测', exact: true }).click()
  await expect(page.getByRole('button', { name: '首次启用？初始化系统管理员', exact: true })).toBeVisible()
})

for (const role of ['user', 'maintainer', 'sysadmin'] as const) {
  test(`${role} retries a rejected password without losing the phone or offering passwordless access`, async ({ page }) => {
    const requests: unknown[] = []
    await mockApi(page, async route => {
      const body = route.request().postDataJSON()
      requests.push(body)
      if (body.password === 'wrong-password') return route.fulfill({
        status: 401, json: { error: '手机号或密码错误，或账号不可用', code: 'LOGIN_FAILED' },
      })
      await route.fulfill({ json: { ok: true, token: `${role}-session`, user: account(role), expiresAt: '' } })
    })
    await page.goto('/login')
    await page.getByLabel('手机号', { exact: true }).fill('+85212345678')
    const password = page.getByLabel('账号密码', { exact: true })
    await password.fill('wrong-password')
    await page.getByRole('button', { name: /^登\s*录$/ }).click()
    await expect(page.getByRole('alert')).toContainText('手机号或密码错误')
    await expect(page.getByLabel('手机号', { exact: true })).toHaveValue('+85212345678')
    await password.fill('  valid password  ')
    await page.getByRole('button', { name: /^登\s*录$/ }).click()
    await expect(page).toHaveURL(new RegExp(`/app/${role === 'user' ? 'overview' : 'manage'}$`))
    expect(requests).toEqual([
      { mobile: '+85212345678', password: 'wrong-password' },
      { mobile: '+85212345678', password: '  valid password  ' },
    ])
  })
}

test('changing phone clears the password and ignores a pending successful response', async ({ page }) => {
  let release!: () => void
  await mockApi(page, async route => {
    await new Promise<void>(resolve => { release = resolve })
    await route.fulfill({ json: { ok: true, token: 'stale-session', user: account('maintainer'), expiresAt: '' } })
  })
  await page.goto('/login')
  await page.getByLabel('手机号', { exact: true }).fill('+85212345678')
  await page.getByLabel('账号密码', { exact: true }).fill('account-password')
  const sent = page.waitForRequest('**/api/auth/login')
  await page.getByRole('button', { name: /^登\s*录$/ }).click()
  await sent
  await page.getByLabel('手机号', { exact: true }).fill('123456')
  const received = page.waitForResponse('**/api/auth/login')
  release()
  await received
  await expect(page.getByLabel('账号密码', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('手机号', { exact: true })).toHaveValue('123456')
  await page.getByRole('button', { name: /^登\s*录$/ }).click()
  await expect(page).toHaveURL(/\/login$/)
  expect(await page.evaluate(() => localStorage.getItem('family_auth_session_token'))).toBeNull()
})

test('bootstrap is secondary, confirms the provisioning password, then requires independent password setup', async ({ page }) => {
  const requests: { path: string; body: unknown }[] = []
  await mockApi(page, async route => {
    requests.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() })
    await route.fulfill({ json: { ok: true, token: 'bootstrap-session', user: { ...account('sysadmin'), passwordChangeRequired: true }, expiresAt: '' } })
  }, account(), false)
  await page.goto('/login')
  await page.getByRole('button', { name: '首次启用？初始化系统管理员', exact: true }).click()
  await page.getByLabel('手机号', { exact: true }).fill('123456')
  await page.getByLabel('服务端初始化验证密码', { exact: true }).fill('fixed-password')
  await page.getByLabel('确认密码', { exact: true }).fill('different-password')
  await page.getByRole('button', { name: '初始化并登录', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('两次输入的密码不一致')
  expect(requests).toEqual([])
  await page.getByLabel('确认密码', { exact: true }).fill('fixed-password')
  await page.getByRole('button', { name: '初始化并登录', exact: true }).click()
  await expect(page).toHaveURL(/\/change-password$/)
  expect(requests).toEqual([{ path: '/api/auth/bootstrap-sysadmin', body: { mobile: '123456', password: 'fixed-password' } }])
})

test('the account editor requires and confirms temporary passwords for every role', async ({ page }) => {
  const current = account('sysadmin')
  const created: Record<string, string>[] = []
  await page.addInitScript(() => localStorage.setItem('family_auth_session_token', 'admin-session'))
  await mockApi(page, async () => { throw new Error('Unexpected login') }, current)
  await page.route('**/api/login-users', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { users: [current] } })
    const input = route.request().postDataJSON()
    created.push(input)
    return route.fulfill({ json: { ok: true, user: { ...account(input.role, 2), ...input, passwordChangeRequired: true } } })
  })
  await page.goto('/app/system')
  for (const [role, label] of [['user', '普通用户'], ['maintainer', '数据维护人员'], ['sysadmin', '系统管理员']] as const) {
    await page.getByRole('button', { name: /新增账号$/ }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('登录手机号', { exact: true }).fill(' +852 2345 6789 ')
    if (role !== 'user') {
      await dialog.getByTitle('普通用户', { exact: true }).click()
      await page.getByTitle(label, { exact: true }).click()
    }
    await dialog.getByLabel('临时密码', { exact: true }).fill(' initial password ')
    await dialog.getByLabel('确认临时密码', { exact: true }).fill('wrong-password')
    await dialog.getByRole('button', { name: '保存到云端', exact: true }).click()
    await expect(dialog.getByRole('alert').first()).toContainText('两次输入的临时密码不一致')
    await dialog.getByLabel('确认临时密码', { exact: true }).fill(' initial password ')
    await dialog.getByRole('button', { name: '保存到云端', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    expect(created.at(-1)).toEqual({ mobile: '+85223456789', name: '', role, password: ' initial password ' })
  }
})

test('self name-only edits update the header, but self phone changes reload the login page', async ({ page }) => {
  let current = account('sysadmin')
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('self-edit-initialized')) {
      localStorage.setItem('family_auth_session_token', 'admin-session')
      sessionStorage.setItem('self-edit-initialized', '1')
    }
  })
  await mockApi(page, async () => { throw new Error('Unexpected login') }, current)
  await page.route('**/api/login-users', route => route.fulfill({ json: { users: [current] } }))
  await page.route('**/api/login-users/1', async route => {
    const input = route.request().postDataJSON()
    expect(input).not.toHaveProperty('password')
    current = { ...current, ...input }
    await route.fulfill({ json: { ok: true, user: current } })
  })
  await page.goto('/app/system')
  const dialog = page.getByRole('dialog')
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0)
  await dialog.getByLabel('用户名称', { exact: true }).fill('新的显示名称')
  await dialog.getByRole('button', { name: '保存到云端', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('button', { name: '账号菜单：新的显示名称', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('family_auth_session_token'))).toBe('admin-session')
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await dialog.getByLabel('登录手机号', { exact: true }).fill('123456')
  await dialog.getByRole('button', { name: '保存到云端', exact: true }).click()
  await expect(page).toHaveURL(/\/login(?:\?redirect=)?/)
  expect(await page.evaluate(() => localStorage.getItem('family_auth_session_token'))).toBeNull()
})
