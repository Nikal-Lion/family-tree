import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { familyFixture } from '../fixtures/familyData'
import { toFamilyBrowseData } from '../../src/services/familyBrowseData'

const fetchMock = vi.fn()
beforeEach(() => {
  vi.resetModules()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('location', { origin: 'http://local.invalid' })
})
afterEach(() => vi.unstubAllGlobals())
describe('login API contract', () => {
  it('exposes error codes and status while retaining normal Error messages', async () => {
    const api = await import('../../src/services/d1ApiService')
    fetchMock.mockResolvedValueOnce(Response.json({ error: '请输入密码', code: 'PASSWORD_REQUIRED' }, { status: 401 }))
    const error = await api.loginWithMobile('+85212345678').catch((value) => value)
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(api.ApiError)
    expect(error).toMatchObject({ message: '请输入密码', status: 401, code: 'PASSWORD_REQUIRED' })
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ mobile: '+85212345678' })
  })

  it('sends an optional password verbatim and never sends a login role or session token', async () => {
    const api = await import('../../src/services/d1ApiService')
    api.setSessionToken('old-session')
    fetchMock.mockImplementation(async () => Response.json({ user: { role: 'maintainer' }, token: 'new-session', expiresAt: '' }))
    await api.loginWithMobile('123456', '  secret password  ')
    await api.loginAsSysadmin('123456', 'fixed-password')
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ mobile: '123456', password: '  secret password  ' })
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ mobile: '123456', password: 'fixed-password' })
    expect((fetchMock.mock.calls[0]![1].headers as Headers).has('Authorization')).toBe(false)
  })

  it('supports initial/reset passwords while omitting absent passwords on profile-only edits', async () => {
    const api = await import('../../src/services/d1ApiService')
    fetchMock.mockImplementation(async () => Response.json({ ok: true, user: { id: 2, passwordConfigured: true } }))
    expect(await api.createLoginUser({ mobile: '123456', role: 'maintainer', password: ' initial password ' })).toMatchObject({ passwordConfigured: true })
    await api.updateLoginUser(2, { password: 'replacement' })
    await api.updateLoginUser(2, { name: '姓名' })
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).password).toBe(' initial password ')
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ password: 'replacement' })
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body)).toEqual({ name: '姓名' })
  })

  it.each([
    new Response('服务暂不可用', { status: 503 }),
    new Response('', { status: 502 }),
  ])('keeps plain-text and empty error responses readable', async (response) => {
    const api = await import('../../src/services/d1ApiService')
    fetchMock.mockResolvedValueOnce(response)
    await expect(api.loginWithMobile('123456')).rejects.toMatchObject({ status: response.status, message: response.status === 503 ? '服务暂不可用' : '请求失败（502）' })
  })
})
describe('revision-aware D1 client', () => {
  it('loads all v4 collections with one request and carries the acknowledged revision', async () => {
    const api = await import('../../src/services/d1ApiService')
    api.setSessionToken('test-session')
    const data = familyFixture()
    fetchMock.mockResolvedValueOnce(Response.json({ data, revision: 7 }))
    expect(await api.loadFamilyDataFromD1()).toEqual(data)
    expect(fetchMock).toHaveBeenCalledOnce()
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true, revision: 8 }))
    await api.saveFamilyDataToD1(data)
    expect((fetchMock.mock.calls[1]![1].headers as Headers).get('If-Match')).toBe('"7"')
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true, revision: 9 }))
    await api.saveFamilyDataToD1(data)
    expect((fetchMock.mock.calls[2]![1].headers as Headers).get('If-Match')).toBe('"8"')
  })

  describe('isolated browsing client', () => {
    it('loads all evidence through the authenticated no-store browsing contract without counters', async () => {
      const api = await import('../../src/services/d1ApiService')
      api.setSessionToken('browse-session')
      const full = familyFixture()
      fetchMock.mockResolvedValueOnce(Response.json({ contractVersion: 1, data: full, revision: 20 }))
      const data = await api.loadFamilyBrowseDataFromD1()
      expect(data).toEqual(toFamilyBrowseData(full))
      expect(Object.keys(data!).some((key) => key.startsWith('next'))).toBe(false)
      const [url, options] = fetchMock.mock.calls[0]!
      expect(new URL(url).pathname).toBe('/api/browse-data')
      expect(new URL(url).searchParams.has('_ts')).toBe(true)
      expect(options).toMatchObject({ method: 'GET', cache: 'no-store' })
      expect((options.headers as Headers).get('Authorization')).toBe('Bearer browse-session')
      await expect(api.saveFamilyDataToD1(full)).rejects.toThrow('先加载')
      expect(fetchMock).toHaveBeenCalledOnce()
    })

    it('does not replace the maintenance CAS revision after loading or refreshing browsing data', async () => {
      const api = await import('../../src/services/d1ApiService')
      const full = familyFixture()
      fetchMock.mockResolvedValueOnce(Response.json({ data: full, revision: 7 }))
      await api.loadFamilyDataFromD1()
      fetchMock.mockResolvedValueOnce(Response.json({ contractVersion: 1, data: toFamilyBrowseData(full), revision: 99 }))
      await api.loadFamilyBrowseDataFromD1()
      fetchMock.mockResolvedValueOnce(Response.json({ ok: true, revision: 8 }))
      await api.saveFamilyDataToD1(full)
      expect((fetchMock.mock.calls[2]![1].headers as Headers).get('If-Match')).toBe('"7"')
    })

    it.each([
      { contractVersion: 2, data: null, revision: 0 },
      { data: null, revision: 0 },
      { contractVersion: 1, data: null, revision: -1 },
      { contractVersion: 1, data: null, revision: 1.5 },
      { contractVersion: 1, data: null },
      { contractVersion: 1, data: { schemaVersion: 4, members: [] }, revision: 0 },
    ])('rejects incompatible browsing responses without falling back to maintenance: %j', async (payload) => {
      const api = await import('../../src/services/d1ApiService')
      fetchMock.mockResolvedValueOnce(Response.json(payload))
      await expect(api.loadFamilyBrowseDataFromD1()).rejects.toThrow()
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(new URL(fetchMock.mock.calls[0]![0]).pathname).toBe('/api/browse-data')
    })

    it('accepts a confirmed empty cloud and surfaces permission errors without fallback', async () => {
      const api = await import('../../src/services/d1ApiService')
      fetchMock.mockResolvedValueOnce(Response.json({ contractVersion: 1, data: null, revision: 0 }))
      await expect(api.loadFamilyBrowseDataFromD1()).resolves.toBeNull()
      fetchMock.mockResolvedValueOnce(Response.json({ error: '请重新登录' }, { status: 401 }))
      await expect(api.loadFamilyBrowseDataFromD1()).rejects.toMatchObject({ status: 401, message: '请重新登录' })
      expect(fetchMock.mock.calls.every(([url]) => new URL(url).pathname === '/api/browse-data')).toBe(true)
    })

    it.each([false, true])('rejects in-flight loads after session changes, including token reuse (%s)', async (reuse) => {
      const api = await import('../../src/services/d1ApiService')
      api.setSessionToken('first')
      let release!: (response: Response) => void
      fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve }))
      const loading = api.loadFamilyBrowseDataFromD1()
      api.setSessionToken('second')
      if (reuse) api.setSessionToken('first')
      release(Response.json({ contractVersion: 1, data: toFamilyBrowseData(familyFixture()), revision: 5 }))
      await expect(loading).rejects.toThrow('登录会话已变更')
      await expect(api.saveFamilyDataToD1(familyFixture())).rejects.toThrow('先加载')
    })
  })
  it('refuses blind writes and discards the loaded revision when accounts change', async () => {
    const api = await import('../../src/services/d1ApiService')
    await expect(api.saveFamilyDataToD1(familyFixture())).rejects.toThrow('先加载')
    api.setSessionToken('first')
    fetchMock.mockResolvedValueOnce(Response.json({ data: familyFixture(), revision: 1 }))
    await api.loadFamilyDataFromD1()
    api.setSessionToken('second')
    await expect(api.saveFamilyDataToD1(familyFixture())).rejects.toThrow('先加载')
  })
  it('surfaces stale-write conflicts instead of treating them as success', async () => {
    const api = await import('../../src/services/d1ApiService')
    fetchMock.mockResolvedValueOnce(Response.json({ data: familyFixture(), revision: 1 }))
    await api.loadFamilyDataFromD1()
    fetchMock.mockResolvedValueOnce(Response.json({ error: '云端已更新，请重新加载' }, { status: 409 }))
    await expect(api.saveFamilyDataToD1(familyFixture())).rejects.toThrow('云端已更新')
  })
  it('surfaces forbidden writes without advancing the acknowledged revision', async () => {
    const api = await import('../../src/services/d1ApiService')
    fetchMock.mockResolvedValueOnce(Response.json({ data: familyFixture(), revision: 7 }))
    await api.loadFamilyDataFromD1()
    fetchMock.mockResolvedValueOnce(Response.json({ error: '需要 maintainer 权限' }, { status: 403 }))
    await expect(api.saveFamilyDataToD1(familyFixture())).rejects.toThrow('需要 maintainer 权限')
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true, revision: 8 }))
    await api.saveFamilyDataToD1(familyFixture())
    expect((fetchMock.mock.calls[2]![1].headers as Headers).get('If-Match')).toBe('"7"')
  })
})
