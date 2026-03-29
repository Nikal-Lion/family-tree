import type { GpxPoint } from '../types/member'

export function buildNavigationUrl(point: GpxPoint): string {
  const lat = point.lat.toFixed(6)
  const lng = point.lng.toFixed(6)

  // Use a web URL for better cross-platform behavior in desktop and mobile browsers.
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
}
