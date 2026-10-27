import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildNavigationUrl, openTrackNavigation } from '../../src/services/navigationBridge'

afterEach(() => vi.unstubAllGlobals())

describe('只读与维护端共享终点导航', () => {
  it('保留真实零坐标，生成固定地图域名链接', () => {
    expect(buildNavigationUrl({ lat: 0, lng: 0 })).toBe('https://www.google.com/maps/dir/?api=1&destination=0.000000,0.000000')
  })
  it.each([{ lat: NaN, lng: 0 }, { lat: 0, lng: Infinity }, { lat: 91, lng: 0 }, { lat: 0, lng: -181 }])('非法坐标不打开窗口：%j', (point) => {
    const open = vi.fn()
    vi.stubGlobal('window', { open })
    expect(() => openTrackNavigation(point)).toThrow('坐标无效')
    expect(open).not.toHaveBeenCalled()
  })
  it('弹窗受阻明确报错', () => {
    vi.stubGlobal('window', { open: vi.fn(() => null) })
    expect(() => openTrackNavigation({ lat: 0, lng: 0 })).toThrow('被拦截')
  })
  it('先切断 opener，再跳转到外部地图', () => {
    const popup = { closed: false, opener: {}, location: { replace: vi.fn() }, close: vi.fn() }
    popup.location.replace.mockImplementation(() => expect(popup.opener).toBeNull())
    const open = vi.fn(() => popup)
    vi.stubGlobal('window', { open })
    openTrackNavigation({ lat: 26, lng: 119 })
    expect(open).toHaveBeenCalledWith('about:blank', '_blank')
    expect(popup.location.replace).toHaveBeenCalledWith(buildNavigationUrl({ lat: 26, lng: 119 }))
  })
  it('跳转失败关闭空白窗口，并保留原始错误', () => {
    const error = new Error('navigation failed')
    const popup = { closed: false, opener: {}, location: { replace: vi.fn(() => { throw error }) }, close: vi.fn() }
    vi.stubGlobal('window', { open: vi.fn(() => popup) })
    expect(() => openTrackNavigation({ lat: 26, lng: 119 })).toThrow(error)
    expect(popup.close).toHaveBeenCalledOnce()
  })
})
