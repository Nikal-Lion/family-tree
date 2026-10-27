import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { familyFixture } from '../fixtures/familyData'

const fetchMock = vi.fn()
beforeEach(() => {
  vi.resetModules()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('location', { origin: 'http://local.invalid' })
})
afterEach(() => vi.unstubAllGlobals())

describe('system page D1 diagnostic contract', () => {
  it('issues a real authenticated no-cache read and reports cloud counts', async () => {
    const api = await import('../../src/services/d1ApiService')
    api.setSessionToken('diagnostic-test')
    const data = familyFixture()
    fetchMock.mockResolvedValueOnce(Response.json({ data, revision: 1 }))
    const result = await api.runD1SelfCheck()
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, request] = fetchMock.mock.calls[0]!
    expect(new URL(url).pathname).toBe('/api/family-data')
    expect(request.method).toBe('GET')
    expect(request.cache).toBe('no-store')
    expect(request.headers.get('Authorization')).toBe('Bearer diagnostic-test')
    expect(result).toMatchObject({
      ok: true, status: 'ok', httpStatus: 200, schemaVersion: data.schemaVersion,
      memberCount: data.members.length, trackCount: data.tracks.length, eventCount: data.events.length,
    })
    expect(Number.isNaN(Date.parse(result.checkedAt))).toBe(false)
  })

  it('distinguishes an empty cloud database from a connection failure', async () => {
    const api = await import('../../src/services/d1ApiService')
    fetchMock.mockResolvedValueOnce(Response.json({ data: null, revision: 0 }))
    expect(await api.runD1SelfCheck()).toMatchObject({
      ok: true, status: 'warning', httpStatus: 200, schemaVersion: null, memberCount: 0,
    })
    fetchMock.mockRejectedValueOnce(new Error('网络断开'))
    expect(await api.runD1SelfCheck()).toMatchObject({
      ok: false, status: 'error', httpStatus: null, message: '网络断开',
    })
  })

  it('preserves permission and server failures and permits a subsequent retry', async () => {
    const api = await import('../../src/services/d1ApiService')
    fetchMock.mockResolvedValueOnce(Response.json({ error: '需要登录' }, { status: 401 }))
    expect(await api.runD1SelfCheck()).toMatchObject({
      ok: false, status: 'error', httpStatus: 401, message: '需要登录',
    })
    fetchMock.mockResolvedValueOnce(new Response('Worker 不可用', { status: 503 }))
    expect(await api.runD1SelfCheck()).toMatchObject({
      ok: false, status: 'error', httpStatus: 503, message: 'Worker 不可用',
    })
    fetchMock.mockResolvedValueOnce(Response.json({ data: familyFixture(), revision: 1 }))
    expect(await api.runD1SelfCheck()).toMatchObject({ ok: true, status: 'ok', httpStatus: 200 })
  })
})
