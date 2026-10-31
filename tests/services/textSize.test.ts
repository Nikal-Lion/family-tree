import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let saved: Map<string, string>
beforeEach(() => {
  vi.resetModules()
  saved = new Map()
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => saved.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => saved.set(key, value)),
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('大字模式偏好', () => {
  it('默认关闭，不将其他本地值误认作开启', async () => {
    saved.set('family_large_text_v1', 'true')
    const { useTextSize } = await import('../../src/composables/useTextSize')
    expect(useTextSize().largeText.value).toBe(false)
  })

  it('所有入口共享状态，切换和恢复后都保存明确的开关值', async () => {
    const { useTextSize } = await import('../../src/composables/useTextSize')
    const login = useTextSize()
    const workspace = useTextSize()
    expect(login.toggleLargeText()).toBe(true)
    expect(workspace.largeText.value).toBe(true)
    expect(saved.get('family_large_text_v1')).toBe('1')
    vi.resetModules()
    const restored = (await import('../../src/composables/useTextSize')).useTextSize()
    expect(restored.largeText.value).toBe(true)
    expect(restored.toggleLargeText()).toBe(true)
    expect(saved.get('family_large_text_v1')).toBe('0')
    expect(saved.size).toBe(1)
  })

  it('读取失败时记录原因，仍可在当前会话中开启', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = new Error('Storage blocked')
    vi.mocked(localStorage.getItem).mockImplementation(() => { throw error })
    const { useTextSize } = await import('../../src/composables/useTextSize')
    const settings = useTextSize()
    expect(settings.largeText.value).toBe(false)
    expect(warning).toHaveBeenCalledWith('[TextSize] 无法读取大字模式设置', error)
    expect(settings.toggleLargeText()).toBe(true)
    expect(settings.largeText.value).toBe(true)
  })

  it('保存失败不撤销当前显示，但返回失败并记录原因供界面提示', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = new Error('Quota exceeded')
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw error })
    const { useTextSize } = await import('../../src/composables/useTextSize')
    const settings = useTextSize()
    expect(settings.toggleLargeText()).toBe(false)
    expect(settings.largeText.value).toBe(true)
    expect(warning).toHaveBeenCalledWith('[TextSize] 无法保存大字模式设置', error)
  })
})
