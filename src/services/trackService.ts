import type { GpxPoint, TrackStats } from '../types/member'

export interface ParsedTrack {
  points: GpxPoint[]
  startPoint: GpxPoint
  endPoint: GpxPoint
  stats: TrackStats
}

const EARTH_RADIUS_METERS = 6371000

function toRadians(value: number): number {
  return (value * Math.PI) / 180
}

function haversineDistanceMeters(a: GpxPoint, b: GpxPoint): number {
  const dLat = toRadians(b.lat - a.lat)
  const dLon = toRadians(b.lng - a.lng)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)

  const sinLat = Math.sin(dLat / 2)
  const sinLon = Math.sin(dLon / 2)
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h))
}

export function parseGpx(raw: string): ParsedTrack {
  const parser = new DOMParser()
  const xml = parser.parseFromString(raw, 'application/xml')
  const parseError = xml.querySelector('parsererror')
  if (parseError) {
    throw new Error('GPX 解析失败：文件格式无效')
  }

  const trackPoints = Array.from(xml.getElementsByTagName('trkpt'))
  if (trackPoints.length < 2) {
    throw new Error('GPX 解析失败：轨迹点不足（至少 2 个）')
  }

  const points: GpxPoint[] = []
  for (const node of trackPoints) {
    const lat = Number(node.getAttribute('lat'))
    const lng = Number(node.getAttribute('lon'))
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      continue
    }

    const eleNode = node.getElementsByTagName('ele')[0]
    const timeNode = node.getElementsByTagName('time')[0]

    const point: GpxPoint = { lat, lng }
    if (eleNode?.textContent) {
      const ele = Number(eleNode.textContent)
      if (Number.isFinite(ele)) {
        point.ele = ele
      }
    }
    if (timeNode?.textContent) {
      point.time = timeNode.textContent
    }

    points.push(point)
  }

  if (points.length < 2) {
    throw new Error('GPX 解析失败：未提取到有效轨迹点')
  }

  let distanceMeters = 0
  let elevationGainMeters = 0

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]
    const current = points[i]
    distanceMeters += haversineDistanceMeters(prev, current)

    if (typeof prev.ele === 'number' && typeof current.ele === 'number' && current.ele > prev.ele) {
      elevationGainMeters += current.ele - prev.ele
    }
  }

  return {
    points,
    startPoint: points[0],
    endPoint: points[points.length - 1],
    stats: {
      pointCount: points.length,
      distanceMeters: Math.round(distanceMeters),
      elevationGainMeters: elevationGainMeters > 0 ? Math.round(elevationGainMeters) : null,
    },
  }
}
