import { pbkdf2Sync } from 'node:crypto'
import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import worker from '../../api/index'
import { TestD1Database } from '../helpers/d1Database'

const require = createRequire(import.meta.url)
const password = 'browser-maintainer-password'
const adminPassword = 'browser-fixed-admin-password'
const salt = '0123456789abcdef0123456789abcdef'
const adminHash = `pbkdf2_sha256$100000$${salt}$${pbkdf2Sync(adminPassword, Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex')}`
const accounts = [
  { mobile: '13900000001', name: '浏览测试账号', role: 'user', password: undefined },
  { mobile: '13900000002', name: '维护测试账号', role: 'maintainer', password },
  { mobile: '13900000003', name: '系统测试账号', role: 'sysadmin', password: undefined },
] as const
let SQL: SqlJsStatic
let db: TestD1Database

function env() {
  return {
    DB: db, API_TOKEN: 'browser-worker-setup', ALLOW_LEGACY_API_TOKEN_AUTH: 'true',
    SYSADMIN_PASSWORD_PBKDF2: adminHash,
  }
}

function adminRequest(path: string, method: string, input: unknown) {
  return worker.fetch(new Request(`http://local.invalid${path}`, {
    method, headers: { Authorization: 'Bearer browser-worker-setup', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }), env())
}

test.beforeAll(async () => { SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') }) })
test.beforeEach(async ({ page }) => {
  db = new TestD1Database(new SQL.Database())
  for (const account of accounts) {
    const response = await adminRequest('/api/login-users', 'POST', account)
    expect(response.status, await response.clone().text()).toBe(201)
  }
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const response = await worker.fetch(new Request(request.url(), {
      method: request.method(), headers: request.headers(), body: request.postData(),
    }), env())
    await route.fulfill({
      status: response.status, headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
})
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' })
  db.database.close()
})

async function enterMobile(page: Page, mobile: string) {
  await page.goto('/login')
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await page.getByLabel('手机号', { exact: true }).fill(mobile)
  await page.locator('button[type="submit"]').click()
}

for (const account of accounts) {
  test(`real Worker resolves ${account.role} authentication without a role selector`, async ({ page }) => {
    await enterMobile(page, account.mobile)
    if (account.role !== 'user') {
      const passwordInput = page.locator('input[type="password"]')
      await expect(passwordInput).toBeVisible()
      await passwordInput.fill(account.role === 'sysadmin' ? adminPassword : password)
      await page.locator('button[type="submit"]').click()
    }
    await expect(page).toHaveURL(new RegExp(`/app/${account.role === 'user' ? 'overview' : 'manage'}$`))
    await expect(page.getByRole('button', { name: `账号菜单：${account.name}` })).toBeVisible()
    if (account.role === 'user') await expect(page.getByRole('button', { name: '进入管理', exact: true })).toHaveCount(0)
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
    expect(storage).not.toContain(password)
    expect(storage).not.toContain(adminPassword)
    expect(storage).not.toContain('pbkdf2_sha256')
  })
}

test('real Worker forces a promoted phone-only user to authenticate again with a password', async ({ page }) => {
  await enterMobile(page, accounts[0].mobile)
  await expect(page).toHaveURL(/\/app\/overview$/)
  const updated = await adminRequest('/api/login-users/1', 'PUT', { role: 'maintainer', password })
  expect(updated.status).toBe(200)
  await page.reload()
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel('手机号', { exact: true }).fill(accounts[0].mobile)
  await page.locator('button[type="submit"]').click()
  await expect(page.locator('input[type="password"]')).toBeVisible()
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/app\/overview$/)
  await page.getByRole('button', { name: '进入管理', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/manage$/)
})

test('a legacy maintainer cannot log in until a sysadmin sets its account password', async ({ page }) => {
  db.database.run(`INSERT INTO login_users (id,mobile,name,role,created_at,updated_at)
    VALUES (4,'13900000004','旧维护测试账号','maintainer','2026-01-01','2026-01-01')`)
  await enterMobile(page, '13900000004')
  await expect(page.getByRole('alert')).toContainText('请联系系统管理员')
  await expect(page).toHaveURL(/\/login$/)
  const updated = await adminRequest('/api/login-users/4', 'PUT', { password })
  expect(updated.status).toBe(200)
  await page.locator('button[type="submit"]').click()
  await expect(page.locator('input[type="password"]')).toBeVisible()
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/app\/manage$/)
})

test('a sysadmin can reset a maintainer password through the UI and revoke its actual session', async ({ page }) => {
  const priorLogin = await adminRequest('/api/auth/login', 'POST', { mobile: accounts[1].mobile, password })
  expect(priorLogin.status).toBe(200)
  const { token } = await priorLogin.json() as { token: string }
  await enterMobile(page, accounts[2].mobile)
  await page.locator('input[type="password"]').fill(adminPassword)
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/app\/manage$/)
  await page.goto('/app/system')
  await page.getByRole('row').filter({ hasText: accounts[1].mobile }).getByRole('button', { name: /^编\s*辑$/ }).click()
  const dialog = page.getByRole('dialog', { name: '编辑登录账号', exact: true })
  await dialog.getByLabel('重设密码（选填）', { exact: true }).fill('changed-via-account-editor')
  await dialog.getByLabel('确认密码', { exact: true }).fill('changed-via-account-editor')
  await dialog.getByRole('button', { name: '保存到云端', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect((await adminRequest('/api/auth/login', 'POST', { mobile: accounts[1].mobile, password })).status).toBe(401)
  expect((await adminRequest('/api/auth/login', 'POST', {
    mobile: accounts[1].mobile, password: 'changed-via-account-editor',
  })).status).toBe(200)
  const expired = await worker.fetch(new Request('http://local.invalid/api/auth/session', {
    headers: { Authorization: `Bearer ${token}` },
  }), env())
  expect(expired.status).toBe(401)
})

test('first-use guidance is dismissible, survives refresh and never changes the authenticated account', async ({ page }) => {
  await enterMobile(page, accounts[0].mobile)
  await expect(page).toHaveURL(/\/app\/overview$/)
  const intro = page.getByRole('region', { name: '浏览入门提示', exact: true })
  await expect(intro).toBeVisible()
  await expect(page.getByRole('tab', { name: '找家人', exact: true })).toBeVisible()
  await intro.getByRole('button', { name: '查看使用指南', exact: true }).click()
  await expect(page.getByText('登录遇到问题时', { exact: true })).toBeVisible()
  await page.locator('.ant-drawer-close').click()
  const token = await page.evaluate(() => localStorage.getItem('family_auth_session_token'))
  await intro.getByRole('button', { name: '不再提示', exact: true }).click()
  await expect(intro).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('tab', { name: '找家人', exact: true })).toBeVisible()
  await expect(intro).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('family_auth_session_token'))).toBe(token)
  await expect(page.getByRole('button', { name: '进入管理', exact: true })).toHaveCount(0)
})

test('invalidating a self account edit reloads the document instead of retaining the maintenance workspace', async ({ page }) => {
  await enterMobile(page, accounts[2].mobile)
  await page.locator('input[type="password"]').fill(adminPassword)
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/app\/manage$/)
  await page.goto('/app/system')
  await page.evaluate(() => { document.documentElement.dataset.priorWorkspace = 'loaded' })
  await page.getByRole('row').filter({ hasText: accounts[2].mobile }).getByRole('button', { name: /^编\s*辑$/ }).click()
  const dialog = page.getByRole('dialog', { name: '编辑登录账号', exact: true })
  await dialog.getByLabel('登录手机号', { exact: true }).fill('13900000005')
  await dialog.getByRole('button', { name: '保存到云端', exact: true }).click()
  await expect(page).toHaveURL(/\/login\?redirect=/)
  await expect(page.getByLabel('手机号', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.dataset.priorWorkspace)).toBeUndefined()
  expect(await page.evaluate(() => localStorage.getItem('family_auth_session_token'))).toBeNull()
})
