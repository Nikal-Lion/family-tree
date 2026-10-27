import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseGpx, parseGpxCoordinates } from '../../src/services/trackService'

describe('GPX coordinate parsing', () => {
  it.each([
    [null, null], [null, '0'], ['0', null], ['', '0'], ['0', ''],
    [' \t\n', '0'], ['0', ' \t\n'],
  ])('rejects missing or blank coordinates (%s, %s)', (lat, lng) => {
    expect(parseGpxCoordinates(lat, lng)).toBeNull()
  })

  it.each([
    ['bad', '0'], ['0', 'bad'], ['NaN', '0'], ['0', 'Infinity'],
    ['0x0', '0'], ['0', '0b0'], ['1,2', '0'], ['1e2', '0'],
    ['9'.repeat(400), '0'],
  ])('rejects non-decimal or non-finite coordinates (%s, %s)', (lat, lng) => {
    expect(parseGpxCoordinates(lat, lng)).toBeNull()
  })

  it.each([
    ['90.0001', '0'], ['-90.0001', '0'], ['0', '180.0001'], ['0', '-180.0001'],
  ])('rejects out-of-range coordinates (%s, %s)', (lat, lng) => {
    expect(parseGpxCoordinates(lat, lng)).toBeNull()
  })

  it('accepts actual zero coordinates and whitespace around decimal values', () => {
    expect(parseGpxCoordinates('0', '0')).toEqual({ lat: 0, lng: 0 })
    expect(parseGpxCoordinates(' 0.0 ', ' +0.000 ')).toEqual({ lat: 0, lng: 0 })
    expect(parseGpxCoordinates(' .5 ', ' -1.25 ')).toEqual({ lat: 0.5, lng: -1.25 })
  })

  it('accepts inclusive latitude and longitude bounds', () => {
    expect(parseGpxCoordinates('90', '180')).toEqual({ lat: 90, lng: 180 })
    expect(parseGpxCoordinates('-90', '-180')).toEqual({ lat: -90, lng: -180 })
  })
})

type CoordinateFixture = { lat?: string; lon?: string; ele?: string; time?: string }
function stubTrackDocument(coordinates: CoordinateFixture[]): void {
  const nodes = coordinates.map((coordinate) => ({
    getAttribute(name: string): string | null {
      if (name === 'lat') return coordinate.lat ?? null
      if (name === 'lon') return coordinate.lon ?? null
      return null
    },
    getElementsByTagName(name: string): { textContent: string }[] {
      const value = name === 'ele' ? coordinate.ele : name === 'time' ? coordinate.time : undefined
      return value === undefined ? [] : [{ textContent: value }]
    },
  }))
  vi.stubGlobal('DOMParser', class {
    parseFromString() {
      return { querySelector: () => null, getElementsByTagName: () => nodes }
    }
  })
}

describe('GPX valid-point aggregation with DOM element fixtures', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('rejects two nodes when both omit their coordinates', () => {
    stubTrackDocument([{}, {}])
    expect(() => parseGpx('')).toThrow('有效轨迹点不足')
  })

  it('rejects a track with only one valid point after filtering', () => {
    stubTrackDocument([
      { lat: '0', lon: '0' }, { lat: '', lon: '0' }, { lat: '91', lon: '0' },
    ])
    expect(() => parseGpx('')).toThrow('至少 2 个；请检查经纬度是否缺失、无效或越界')
  })

  it('preserves zero-valued valid points, elevations and times, and skips invalid nodes', () => {
    stubTrackDocument([
      { lat: '0', lon: '0', ele: '0', time: '2026-10-26T00:00:00Z' },
      { lat: ' ', lon: '0' },
      { lat: '0', lon: '181' },
      { lat: 'bad', lon: '0' },
      { lat: '0', lon: '0.001', ele: '10', time: '2026-10-26T00:01:00Z' },
    ])
    const result = parseGpx('')
    expect(result.points).toEqual([
      { lat: 0, lng: 0, ele: 0, time: '2026-10-26T00:00:00Z' },
      { lat: 0, lng: 0.001, ele: 10, time: '2026-10-26T00:01:00Z' },
    ])
    expect(result.startPoint).toEqual(result.points[0])
    expect(result.endPoint).toEqual(result.points[1])
    expect(result.stats).toEqual({ pointCount: 2, distanceMeters: 111, elevationGainMeters: 10 })
  })

  it('keeps the existing error for fewer than two raw track nodes', () => {
    stubTrackDocument([{ lat: '0', lon: '0' }])
    expect(() => parseGpx('')).toThrow('轨迹点不足（至少 2 个）')
  })
})
