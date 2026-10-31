import { expect, test, type Page, type Route } from '@playwright/test'
import type { LoginUser, LoginUserRole } from '../../src/types/auth'
import { familyFixture } from '../fixtures/familyData'
import { toFamilyBrowseData } from '../../src/services/familyBrowseData'

function account(role: LoginUserRole = 'user', id = 1): LoginUser {
  return {
    id, mobile: '+85212345678', name: `测试${role}`, role, enabled: true,
    passwordConfigured: role === 'maintainer', createdAt: '', updatedAt: '',
  }
}

async function mockApi(page: Page, login: (route: Route) => Promise<void>, current = account(), initialized = true) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/status') return route.fulfill({ json: { initialized } })
    if (path === '/api/auth/login-options') return route.fulfill({ json: { passwordRequired: false } })
    if (path === '/api/auth/login' || path === '/api/auth/bootstrap-sysadmin') return login(route)
    if (path === '/api/auth/session') return route.fulfill({ json: { user: current } })
    if (path === '/api/browse-data') return route.fulfill({ json: { contractVersion: 1, data: toFamilyBrowseData(familyFixture()), revision: 1 } })
    if (path === '/api/family-data') return route.fulfill({ json: { data: familyFixture(), revision: 1 } })
    if (path === '/api/login-users') return route.fulfill({ json: { users: [current] } })
    throw new Error(`Unexpected login test request: ${path}`)
  })
}

test('ordinary accounts log in directly with a normalized international phone and no role choice', async ({ page }) => {
  const requests: unknown[] = []
  await mockApi(page, async (route) => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({ json: { ok: true, token: 'ordinary-session', user: account(), expiresAt: '' } })
  })
  await page.goto('/login')
  await expect(page.getByLabel('账号密码', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('radio')).toHaveCount(0)
  const submit = page.getByRole('button', { name: /^登\s*录$/ })
  const bounds = await submit.boundingBox()
  expect(bounds!.height).toBeGreaterThanOrEqual(44)
  await page.getByLabel('手机号', { exact: true }).fill(' +852 1234 5678 ')
  await submit.click()
  await expect(page).toHaveURL(/\/app\/overview$/)
  expect(requests).toEqual([{ mobile: '+85212345678' }])
})

for (const role of ['maintainer', 'sysadmin'] as const) {
  test(`${role} sees its password field on phone blur without creating a login session`, async ({ page }) => {
    const logins: unknown[] = []
    const lookups: unknown[] = []
    await mockApi(page, async route => {
      logins.push(route.request().postDataJSON())
      await route.fulfill({ json: { ok: true, token: 'blur-session', user: account(role), expiresAt: '' } })
    }, account(role))
    await page.route('**/api/auth/login-options', async route => {
      lookups.push(route.request().postDataJSON())
      await route.fulfill({ json: { passwordRequired: true } })
    })
    await page.goto('/login')
    const phone = page.getByLabel('手机号', { exact: true })
    await phone.fill(' +852 1234 5678 ')
    await phone.press('Tab')
    await expect(page.getByLabel('账号密码', { exact: true })).toBeVisible()
    expect(lookups).toEqual([{ mobile: '+85212345678' }])
    expect(logins).toEqual([])
    expect(await page.evaluate(() => localStorage.getItem('family_auth_session_token'))).toBeNull()
    await page.getByLabel('账号密码', { exact: true }).fill('account-password')
    await page.getByRole('button', { name: '验证并登录', exact: true }).click()
    await expect(page).toHaveURL(/\/app\/manage$/)
    expect(logins).toEqual([{ mobile: '+85212345678', password: 'account-password' }])
  })
}

test('ordinary phone blur does not log in; first login opens the guide only once on this browser', async ({ page }) => {
  const logins: unknown[] = []
  await mockApi(page, async route => {
    logins.push(route.request().postDataJSON())
    await route.fulfill({ json: { ok: true, token: 'ordinary-session', user: account(), expiresAt: '' } })
  })
  await page.goto('/login')
  const phone = page.getByLabel('手机号', { exact: true })
  await phone.fill('+85212345678')
  await phone.press('Tab')
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.getByLabel('账号密码', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '首次启用？初始化系统管理员', exact: true })).toHaveCount(0)
  expect(logins).toEqual([])
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

test('changing phone ignores a delayed password lookup', async ({ page }) => {
  let release!: () => void
  await mockApi(page, async () => { throw new Error('Lookup must not authenticate') })
  await page.route('**/api/auth/login-options', async route => {
    await new Promise<void>(resolve => { release = resolve })
    await route.fulfill({ json: { passwordRequired: true } })
  })
  await page.goto('/login')
  const phone = page.getByLabel('手机号', { exact: true })
  await phone.fill('+85212345678')
  const lookup = page.waitForRequest('**/api/auth/login-options')
  await phone.press('Tab')
  await lookup
  await phone.fill('123456')
  const response = page.waitForResponse('**/api/auth/login-options')
  release()
  await response
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.getByLabel('账号密码', { exact: true })).toHaveCount(0)
  await expect(phone).toBeEditable()
  expect(await page.evaluate(() => localStorage.getItem('family_auth_session_token'))).toBeNull()
})

test('submitting during phone lookup waits for the password requirement instead of logging in twice', async ({ page }) => {
  let release!: () => void
  const logins: unknown[] = []
  await mockApi(page, async route => {
    logins.push(route.request().postDataJSON())
    await route.fulfill({ json: { ok: true, token: 'detected-session', user: account('maintainer'), expiresAt: '' } })
  })
  await page.route('**/api/auth/login-options', async route => {
    await new Promise<void>(resolve => { release = resolve })
    await route.fulfill({ json: { passwordRequired: true } })
  })
  await page.goto('/login')
  const phone = page.getByLabel('手机号', { exact: true })
  await phone.fill('+85212345678')
  const lookup = page.waitForRequest('**/api/auth/login-options')
  await phone.press('Tab')
  await lookup
  await page.getByRole('button', { name: /^登\s*录$/ }).click()
  release()
  const password = page.getByLabel('账号密码', { exact: true })
  await expect(password).toBeVisible()
  await expect(password).toBeFocused()
  expect(logins).toEqual([])
  await password.fill('account-password')
  await page.getByRole('button', { name: '验证并登录', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/manage$/)
  expect(logins).toEqual([{ mobile: '+85212345678', password: 'account-password' }])
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

for (const role of ['maintainer', 'sysadmin'] as const) {
  test(`${role} is challenged on the same phone and retries with a password, never a selected role`, async ({ page }) => {
    const requests: Record<string, string>[] = []
    await mockApi(page, async (route) => {
      const body = route.request().postDataJSON()
      requests.push(body)
      if (!body.password) return route.fulfill({ status: 401, json: { error: '请输入账号密码', code: 'PASSWORD_REQUIRED' } })
      if (body.password === 'wrong-password') return route.fulfill({
        status: 401, json: { error: '密码不正确，请重试', code: role === 'maintainer' ? 'INVALID_PASSWORD' : 'INVALID_SYSADMIN_PASSWORD' },
      })
      await route.fulfill({ json: { ok: true, token: `${role}-session`, user: account(role), expiresAt: '' } })
    })
    await page.goto('/login')
    await page.getByLabel('手机号', { exact: true }).fill('+85212345678')
    await page.getByRole('button', { name: /^登\s*录$/ }).click()
    const password = page.getByLabel('账号密码', { exact: true })
    await expect(password).toBeVisible()
    await expect(password).toBeFocused()
    await expect(page.getByLabel('手机号', { exact: true })).toHaveValue('+85212345678')
    await password.fill('wrong-password')
    await page.getByRole('button', { name: '验证并登录', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('密码不正确')
    await password.fill('  valid password  ')
    await page.getByRole('button', { name: '验证并登录', exact: true }).click()
    await expect(page).toHaveURL(/\/app\/manage$/)
    expect(requests).toEqual([
      { mobile: '+85212345678' },
      { mobile: '+85212345678', password: 'wrong-password' },
      { mobile: '+85212345678', password: '  valid password  ' },
    ])
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
    expect(storage).not.toContain('valid password')
  })
}

test('changing phone clears the password challenge and ignores a pending successful response', async ({ page }) => {
  let release!: () => void
  let finish!: () => void
  const finished = new Promise<void>((done) => { finish = done })
  await mockApi(page, async (route) => {
    if (!route.request().postDataJSON().password) {
      return route.fulfill({ status: 401, json: { error: '请输入账号密码', code: 'PASSWORD_REQUIRED' } })
    }
    await new Promise<void>((done) => { release = done })
    await route.fulfill({ json: { ok: true, token: 'stale-session', user: account('maintainer'), expiresAt: '' } })
    finish()
  })
  await page.goto('/login')
  await page.getByLabel('手机号', { exact: true }).fill('+85212345678')
  await page.getByRole('button', { name: /^登\s*录$/ }).click()
  await page.getByLabel('账号密码', { exact: true }).fill('account-password')
  const sent = page.waitForRequest((request) => request.url().endsWith('/api/auth/login') && !!request.postDataJSON().password)
  await page.getByRole('button', { name: '验证并登录', exact: true }).click()
  await sent
  await page.getByRole('button', { name: '更换手机号', exact: true }).click()
  await page.getByLabel('手机号', { exact: true }).fill('123456')
  release()
  await finished
  // A second challenge ensures the earlier response has completed without restoring its identity.
  await page.getByRole('button', { name: /^登\s*录$/ }).click()
  await expect(page.getByLabel('账号密码', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('手机号', { exact: true })).toHaveValue('123456')
  await expect(page).toHaveURL(/\/login$/)
  expect(await page.evaluate(() => localStorage.getItem('family_auth_session_token'))).toBeNull()
})

for (const [code, error] of [
  ['PASSWORD_NOT_SET', '此维护人员尚未设置密码，请联系系统管理员'],
  ['USER_NOT_FOUND', '手机号未登记，请联系管理员'],
  ['USER_DISABLED', '账号已禁用，请联系管理员'],
]) {
  test(`shows explicit ${code} errors without offering phone-only fallback`, async ({ page }) => {
    await mockApi(page, async (route) => route.fulfill({ status: 403, json: { code, error } }))
    await page.goto('/login')
    await page.getByLabel('手机号', { exact: true }).fill('123456')
    await page.getByRole('button', { name: /^登\s*录$/ }).click()
    await expect(page.getByRole('alert')).toContainText(error!)
    await expect(page.getByLabel('账号密码', { exact: true })).toHaveCount(0)
    await expect(page).toHaveURL(/\/login$/)
  })
}

test('bootstrap is secondary, confirms the fixed password, and uses its dedicated endpoint', async ({ page }) => {
  const requests: { path: string; body: unknown }[] = []
  await mockApi(page, async (route) => {
    requests.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() })
    await route.fulfill({ json: { ok: true, token: 'bootstrap-session', user: account('sysadmin'), expiresAt: '' } })
  }, account(), false)
  await page.goto('/login')
  await page.getByRole('button', { name: '首次启用？初始化系统管理员', exact: true }).click()
  await page.getByLabel('手机号', { exact: true }).fill('123456')
  await page.getByLabel('系统管理员固定密码', { exact: true }).fill('fixed-password')
  await page.getByLabel('确认密码', { exact: true }).fill('different-password')
  await page.getByRole('button', { name: '初始化并登录', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('两次输入的密码不一致')
  expect(requests).toEqual([])
  await page.getByLabel('确认密码', { exact: true }).fill('fixed-password')
  await page.getByRole('button', { name: '初始化并登录', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/manage$/)
  expect(requests).toEqual([{ path: '/api/auth/bootstrap-sysadmin', body: { mobile: '123456', password: 'fixed-password' } }])
})

test('the account editor requires a maintainer initial password, confirms it, and omits passwords for other roles', async ({ page }) => {
  const current = account('sysadmin')
  const created: Record<string, string>[] = []
  await page.addInitScript(() => localStorage.setItem('family_auth_session_token', 'admin-session'))
  await mockApi(page, async () => { throw new Error('Unexpected login') }, current)
  await page.route('**/api/login-users', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { users: [current] } })
    const input = route.request().postDataJSON()
    created.push(input)
    return route.fulfill({ json: { ok: true, user: { ...account(input.role, 2), mobile: input.mobile, name: input.name, passwordConfigured: !!input.password } } })
  })
  await page.goto('/app/system')
  await page.getByRole('button', { name: /新增账号$/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('登录手机号', { exact: true }).fill(' +852 2345 6789 ')
  await dialog.getByTitle('普通用户', { exact: true }).click()
  await page.getByTitle('数据维护人员', { exact: true }).click()
  await dialog.getByRole('button', { name: '保存到云端', exact: true }).click()
  await expect(dialog.getByRole('alert').first()).toContainText('请为维护人员设置初始密码')
  await dialog.getByLabel('初始密码', { exact: true }).fill(' initial password ')
  await dialog.getByLabel('确认密码', { exact: true }).fill('wrong-password')
  await dialog.getByRole('button', { name: '保存到云端', exact: true }).click()
  await expect(dialog.getByRole('alert').first()).toContainText('两次输入的密码不一致')
  await dialog.getByLabel('确认密码', { exact: true }).fill(' initial password ')
  await dialog.getByRole('button', { name: '保存到云端', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(created).toEqual([{ mobile: '+85223456789', name: '', role: 'maintainer', password: ' initial password ' }])
  await page.getByRole('button', { name: /新增账号$/ }).click()
  await dialog.getByLabel('登录手机号', { exact: true }).fill('123456')
  await expect(dialog.getByLabel('初始密码', { exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: '保存到云端', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(created[1]).toEqual({ mobile: '123456', name: '', role: 'user' })
})

test('legacy maintainers require an initial password; configured accounts can keep or reset theirs', async ({ page }) => {
  const current = account('sysadmin')
  let maintainer = { ...account('maintainer', 2), passwordConfigured: false }
  const edits: Record<string, string>[] = []
  await page.addInitScript(() => localStorage.setItem('family_auth_session_token', 'admin-session'))
  await mockApi(page, async () => { throw new Error('Unexpected login') }, current)
  await page.route('**/api/login-users', async (route) => route.fulfill({ json: { users: [current, maintainer] } }))
  await page.route('**/api/login-users/2', async (route) => {
    const input = route.request().postDataJSON()
    edits.push(input)
    maintainer = { ...maintainer, name: input.name, mobile: input.mobile, passwordConfigured: true }
    return route.fulfill({ json: { ok: true, user: maintainer } })
  })
  await page.goto('/app/system')
  const row = page.getByRole('row').filter({ hasText: '测试maintainer' })
  const dialog = page.getByRole('dialog')
  await row.getByRole('button', { name: '编辑', exact: true }).click()
  await dialog.getByRole('button', { name: '保存到云端', exact: true }).click()
  await expect(dialog.getByRole('alert').first()).toContainText('请为维护人员设置初始密码')
  await dialog.getByLabel('初始密码', { exact: true }).fill('        ')
  await dialog.getByLabel('确认密码', { exact: true }).fill('        ')
  await dialog.getByRole('button', { name: '保存到云端', exact: true }).click()
  await expect(dialog.getByRole('alert').first()).toContainText('密码须为 8–128 个字符，且不能全为空格')
  await dialog.getByLabel('初始密码', { exact: true }).fill('initial-password')
  await dialog.getByLabel('确认密码', { exact: true }).fill('initial-password')
  await dialog.getByRole('button', { name: '保存到云端', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(edits[0]?.password).toBe('initial-password')

  await row.getByRole('button', { name: '编辑', exact: true }).click()
  await expect(dialog.getByLabel('重设密码（选填）', { exact: true })).toHaveValue('')
  await expect(dialog.getByText('不修改密码请留空。重设密码后，该账号所有已登录设备都会退出。')).toBeVisible()
  await dialog.getByRole('button', { name: '保存到云端', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(edits[1]).not.toHaveProperty('password')

  await row.getByRole('button', { name: '编辑', exact: true }).click()
  await dialog.getByLabel('重设密码（选填）', { exact: true }).fill(' replacement password ')
  await dialog.getByLabel('确认密码', { exact: true }).fill(' replacement password ')
  await dialog.getByRole('button', { name: '保存到云端', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(edits[2]?.password).toBe(' replacement password ')
})

test('self name-only edits update the header, but self phone changes require logging in again', async ({ page }) => {
  let current = account('sysadmin')
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('self-edit-initialized')) {
      localStorage.setItem('family_auth_session_token', 'admin-session')
      sessionStorage.setItem('self-edit-initialized', '1')
    }
  })
  await mockApi(page, async () => { throw new Error('Unexpected login') }, current)
  await page.route('**/api/login-users', async (route) => route.fulfill({ json: { users: [current] } }))
  await page.route('**/api/login-users/1', async (route) => {
    current = { ...current, ...route.request().postDataJSON() }
    await route.fulfill({ json: { ok: true, user: current } })
  })
  await page.goto('/app/system')
  const dialog = page.getByRole('dialog')
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await expect(dialog.getByText('系统管理员使用服务端配置的固定密码，此处无需设置密码。')).toBeVisible()
  await expect(dialog.getByLabel('初始密码', { exact: true })).toHaveCount(0)
  await dialog.getByLabel('用户名称', { exact: true }).fill('新的显示名称')
  await dialog.getByRole('button', { name: '保存到云端', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('button', { name: '账号菜单：新的显示名称', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('family_auth_session_token'))).toBe('admin-session')
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await dialog.getByLabel('登录手机号', { exact: true }).fill('123456')
  await dialog.getByRole('button', { name: '保存到云端', exact: true }).click()
  await expect(page).toHaveURL(/\/login\?redirect=/)
  expect(await page.evaluate(() => localStorage.getItem('family_auth_session_token'))).toBeNull()
})
