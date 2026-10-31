import { pbkdf2Sync } from 'node:crypto'
import { createRequire } from 'node:module'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { expect, test, type Page } from '@playwright/test'
import worker from '../../api/index'
import { TestD1Database } from '../helpers/d1Database'

const require = createRequire(import.meta.url)
const temporary = 'browser-temporary-password'
const personal = 'browser-personal-password'
const reset = 'browser-reset-password'
const mobile = '13900000002'
const adminMobile = '13900000001'
const salt = '0123456789abcdef0123456789abcdef'
const hash = `pbkdf2_sha256$100000$${salt}$${pbkdf2Sync(temporary, Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex')}`
let SQL: SqlJsStatic
let db: TestD1Database
let familyRequests = 0

test.beforeAll(async () => { SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') }) })
test.beforeEach(async ({ page }) => {
  db = new TestD1Database(new SQL.Database())
  familyRequests = 0
  await worker.fetch(new Request('https://test.invalid/api/auth/session'), { DB: db })
  db.database.run(`INSERT INTO login_users (id, mobile, name, role, enabled, created_at, updated_at)
    VALUES (1, ?, '测试管理员', 'sysadmin', 1, '', ''), (2, ?, '测试成员', 'maintainer', 1, '', '')`, [adminMobile, mobile])
  db.database.run('INSERT INTO login_credentials VALUES (1, ?, 0, 1), (2, ?, 1, 1)', [hash, hash])
  // All API traffic is served by an isolated in-memory Worker, never remote D1.
  await page.route('**/api/**', async (route) => {
    const incoming = route.request()
    const path = new URL(incoming.url()).pathname
    if (path === '/api/family-data') familyRequests++
    const response = await worker.fetch(new Request(`https://test.invalid${path}`, {
      method: incoming.method(),
      headers: incoming.headers(),
      body: incoming.postData(),
    }), { DB: db })
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() })
  })
})
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('page-content', { body: await page.locator('body').innerText(), contentType: 'text/plain' })
  }
  await page.goto('about:blank')
  db.database.close()
})

async function signIn(page: Page, account: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('手机号', { exact: true }).fill(account)
  await page.getByLabel('账号密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: /^登\s*录$/ }).click()
}

test('temporary passwords require setup before any family request and survive page reload', async ({ page }) => {
  await signIn(page, mobile, temporary)
  await expect(page).toHaveURL(/\/change-password$/)
  await page.goto('/app/manage')
  await expect(page).toHaveURL(/\/change-password$/)
  await page.reload()
  await expect(page.getByText('请先修改初始密码', { exact: true })).toBeVisible()
  expect(familyRequests).toBe(0)
  await page.getByLabel('当前密码或临时密码', { exact: true }).fill(temporary)
  await page.getByLabel('新密码', { exact: true }).fill(personal)
  await page.getByLabel('确认新密码', { exact: true }).fill('mismatch-password')
  await page.getByRole('button', { name: '保存新密码', exact: true }).click()
  await expect(page.getByText('两次输入的新密码不一致', { exact: true })).toBeVisible()
  await page.getByLabel('确认新密码', { exact: true }).fill(personal)
  await page.getByRole('button', { name: '保存新密码', exact: true }).click()
  await expect(page).toHaveURL(/\/login\?passwordChanged=1$/)
  expect(await page.evaluate(() => localStorage.getItem('family_auth_session_token'))).toBeNull()
  await signIn(page, mobile, personal)
  await expect(page).toHaveURL(/\/app\/manage$/)
  await expect(page.getByText('族人名录', { exact: true })).toBeVisible()
  expect(familyRequests).toBeGreaterThan(0)
})

test('normal accounts can change passwords through the account menu and retry a wrong current password', async ({ page }) => {
  await signIn(page, adminMobile, temporary)
  await expect(page).toHaveURL(/\/app\/manage$/)
  await page.getByRole('button', { name: '账号菜单：测试管理员' }).click()
  await page.getByRole('menuitem', { name: '修改密码', exact: true }).click()
  await expect(page).toHaveURL(/\/change-password$/)
  await page.getByLabel('当前密码或临时密码', { exact: true }).fill('incorrect-password')
  await page.getByLabel('新密码', { exact: true }).fill(personal)
  await page.getByLabel('确认新密码', { exact: true }).fill(personal)
  await page.getByRole('button', { name: '保存新密码', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('当前密码错误')
  await expect(page.getByLabel('新密码', { exact: true })).toHaveValue(personal)
  await page.getByLabel('当前密码或临时密码', { exact: true }).fill(temporary)
  await page.getByRole('button', { name: '保存新密码', exact: true }).click()
  await expect(page).toHaveURL(/\/login\?passwordChanged=1$/)
  await signIn(page, adminMobile, temporary)
  await expect(page.getByRole('alert')).toContainText('手机号或密码错误')
  await page.getByLabel('账号密码', { exact: true }).fill(personal)
  await page.getByRole('button', { name: /^登\s*录$/ }).click()
  await expect(page).toHaveURL(/\/app\/manage$/)
})

test('administrators create and reset temporary passwords without storing plaintext in the browser', async ({ page }) => {
  await signIn(page, adminMobile, temporary)
  await expect(page).toHaveURL(/\/app\/manage$/)
  await page.goto('/app/system')
  await page.getByRole('button', { name: /新增账号/ }).click()
  const editor = page.getByRole('dialog', { name: '新增登录账号' })
  await editor.getByLabel('登录手机号', { exact: true }).fill('13900000003')
  await editor.getByLabel('临时密码', { exact: true }).fill(personal)
  await editor.getByLabel('确认临时密码', { exact: true }).fill(personal)
  await editor.getByRole('button', { name: '保存到云端', exact: true }).click()
  await expect(editor).not.toBeVisible()
  const row = page.getByRole('row').filter({ hasText: '13900000003' })
  await expect(row).toContainText('待首次改密')
  await row.getByRole('button', { name: '重置密码', exact: true }).click()
  const resetDialog = page.getByRole('dialog', { name: '重置账号密码' })
  await resetDialog.getByLabel('新临时密码', { exact: true }).fill(reset)
  await resetDialog.getByLabel('确认临时密码', { exact: true }).fill(reset)
  await resetDialog.getByRole('button', { name: '重置并撤销旧会话', exact: true }).click()
  await expect(resetDialog).not.toBeVisible()
  const storage = await page.evaluate(() => JSON.stringify(localStorage))
  for (const password of [temporary, personal, reset]) expect(storage).not.toContain(password)
  await page.getByRole('button', { name: '账号菜单：测试管理员' }).click()
  await page.getByRole('menuitem', { name: /退出登录/ }).click()
  await expect(page).toHaveURL(/\/login$/)
  await signIn(page, '13900000003', reset)
  await expect(page).toHaveURL(/\/change-password$/)
})
