import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoginUser } from '../../src/types/auth'

const api = vi.hoisted(() => ({
  bootstrapSysadmin: vi.fn(),
  fetchCurrentSession: vi.fn(),
  loginAsSysadmin: vi.fn(),
  loginWithMobile: vi.fn(),
  logoutCurrentSession: vi.fn(),
  setSessionToken: vi.fn(),
}))
vi.mock('../../src/services/d1ApiService', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/services/d1ApiService')>(),
  ...api,
}))

const user: LoginUser = {
  id: 1, mobile: '13900000001', role: 'user', enabled: true,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
}
let saved: Map<string, string>

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  saved = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  })
})

describe('authentication lifecycle', () => {
  it('starts anonymous without a persisted token', async () => {
    const auth = await import('../../src/services/authService')
    await auth.initAuthSession()
    expect(auth.useAuth().isAuthenticated.value).toBe(false)
    expect(auth.useAuth().ready.value).toBe(true)
    expect(api.fetchCurrentSession).not.toHaveBeenCalled()
  })

  it('restores the server-verified maintainer role before showing management', async () => {
    saved.set('family_auth_session_token', 'saved-session')
    api.fetchCurrentSession.mockResolvedValue({ ...user, role: 'maintainer' })
    const auth = await import('../../src/services/authService')
    await Promise.all([auth.initAuthSession(), auth.initAuthSession()])
    expect(api.fetchCurrentSession).toHaveBeenCalledTimes(1)
    expect(auth.useAuth().canMaintain.value).toBe(true)
    expect(auth.useAuth().isSysadmin.value).toBe(false)
    expect(auth.useAuth().resolveDefaultAppPath()).toBe('/app/manage')
  })

  it('discards an expired session instead of trusting the persisted token', async () => {
    saved.set('family_auth_session_token', 'expired-session')
    api.fetchCurrentSession.mockRejectedValue(new Error('未登录'))
    const auth = await import('../../src/services/authService')
    await auth.initAuthSession()
    expect(saved.has('family_auth_session_token')).toBe(false)
    expect(auth.useAuth().role.value).toBe('anonymous')
  })

  it('uses the role returned by the server for mobile login', async () => {
    api.loginWithMobile.mockResolvedValue({ user: { ...user, role: 'maintainer' }, token: 'session', expiresAt: '2026-12-01' })
    const auth = await import('../../src/services/authService')
    expect((await auth.loginAsUserByMobile(user.mobile)).ok).toBe(true)
    expect(auth.useAuth().role.value).toBe('maintainer')
    expect(saved.get('family_auth_session_token')).toBe('session')
  })
  it('updates the displayed profile only when the saved account is the current user', async () => {
    api.loginWithMobile.mockResolvedValue({ user: { ...user, name: '旧名称' }, token: 'session' })
    const auth = await import('../../src/services/authService')
    await auth.loginAsUserByMobile(user.mobile)
    auth.updateCurrentLoginUser({ ...user, id: 2, name: '其他账号' })
    expect(auth.useAuth().user.value?.name).toBe('旧名称')
    auth.updateCurrentLoginUser({ ...user, name: '新名称' })
    expect(auth.useAuth().user.value?.name).toBe('新名称')
    expect(saved.get('family_auth_session_token')).toBe('session')
  })

  it('does not accept a non-admin account in the sysadmin login flow', async () => {
    api.loginAsSysadmin.mockResolvedValue({ user, token: 'wrong-role', expiresAt: '2026-12-01' })
    const auth = await import('../../src/services/authService')
    expect((await auth.loginWithSysadminPassword(user.mobile, 'test-password')).ok).toBe(false)
    expect(auth.useAuth().isSysadmin.value).toBe(false)
    expect(saved.has('family_auth_session_token')).toBe(false)
  })

  it('logs out on the server and clears the current account', async () => {
    api.loginWithMobile.mockResolvedValue({ user, token: 'session', expiresAt: '2026-12-01' })
    const auth = await import('../../src/services/authService')
    await auth.loginAsUserByMobile(user.mobile)
    await auth.logout()
    expect(api.logoutCurrentSession).toHaveBeenCalledOnce()
    expect(saved.has('family_auth_session_token')).toBe(false)
    expect(auth.useAuth().role.value).toBe('anonymous')
  })

  it('exposes typed password challenges without authenticating or persisting passwords', async () => {
    const { ApiError } = await import('../../src/services/d1ApiService')
    api.loginWithMobile.mockRejectedValueOnce(new ApiError('请输入账号密码', 401, 'PASSWORD_REQUIRED'))
    const auth = await import('../../src/services/authService')
    expect(await auth.loginAsUserByMobile(' +852 1234 5678 ')).toEqual({
      ok: false, message: '请输入账号密码', code: 'PASSWORD_REQUIRED',
    })
    expect(api.loginWithMobile).toHaveBeenLastCalledWith('+85212345678', undefined)
    expect(auth.useAuth().isAuthenticated.value).toBe(false)
    api.loginWithMobile.mockResolvedValueOnce({ user: { ...user, role: 'maintainer' }, token: 'session' })
    await auth.loginAsUserByMobile(user.mobile, ' password with spaces ')
    expect(api.loginWithMobile).toHaveBeenLastCalledWith(user.mobile, ' password with spaces ')
    expect([...saved.values()]).toEqual(['session'])
  })

  it.each(['PASSWORD_NOT_SET', 'INVALID_PASSWORD', 'INVALID_SYSADMIN_PASSWORD', 'USER_DISABLED', 'USER_NOT_FOUND'])('preserves %s errors for the login page', async (code) => {
    const { ApiError } = await import('../../src/services/d1ApiService')
    api.loginWithMobile.mockRejectedValue(new ApiError('服务端提示', 403, code))
    const auth = await import('../../src/services/authService')
    expect(await auth.loginAsUserByMobile(user.mobile)).toEqual({ ok: false, message: '服务端提示', code })
    expect(saved.size).toBe(0)
  })

  it('ignores a successful response after the login identity has changed', async () => {
    let resolve!: (session: unknown) => void
    api.loginWithMobile.mockReturnValue(new Promise((done) => { resolve = done }))
    const auth = await import('../../src/services/authService')
    const pending = auth.loginAsUserByMobile(user.mobile)
    auth.cancelPendingLogin()
    resolve({ user, token: 'stale-session' })
    expect((await pending).code).toBe('AUTH_REQUEST_CANCELLED')
    expect(auth.useAuth().isAuthenticated.value).toBe(false)
    expect(saved.size).toBe(0)
  })

  it.each([
    { role: 'maintainer' as const },
    { role: 'sysadmin' as const },
    { mobile: '+85212345678' },
    { enabled: false },
  ])('clears the token instead of applying an invalidating self edit: %j', async (changes) => {
    api.loginWithMobile.mockResolvedValue({ user, token: 'session' })
    const auth = await import('../../src/services/authService')
    await auth.loginAsUserByMobile(user.mobile)
    auth.updateCurrentLoginUser({ ...user, ...changes })
    expect(auth.useAuth().role.value).toBe('anonymous')
    expect(saved.size).toBe(0)
    expect(api.setSessionToken).toHaveBeenLastCalledWith(null)
  })

  it.each(['12345', '+123456789012345678901', 'legacy-account'])('rejects invalid phone %s without a request', async (mobile) => {
    const auth = await import('../../src/services/authService')
    expect((await auth.loginAsUserByMobile(mobile)).ok).toBe(false)
    expect(api.loginWithMobile).not.toHaveBeenCalled()
  })
})
