import type { GpxPoint } from '../types/member'

export function buildNavigationUrl(point: GpxPoint): string {
  const lat = point.lat.toFixed(6)
  const lng = point.lng.toFixed(6)

  // Use a web URL for better cross-platform behavior in desktop and mobile browsers.
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
}

export function openTrackNavigation(point: GpxPoint): void {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)
    || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) {
    throw new Error('轨迹终点坐标无效，无法导航')
  }
  // noopener can return null even when a window opened; detach before navigating instead.
  const popup = window.open('about:blank', '_blank')
  if (!popup || popup.closed) throw new Error('导航页面被拦截，请允许弹窗后重试')
  try {
    popup.opener = null
    popup.location.replace(buildNavigationUrl(point))
  } catch (error) {
    popup.close()
    throw error
  }
}
