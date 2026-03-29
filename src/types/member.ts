export type Gender = '男' | '女'

export const APP_SCHEMA_VERSION = 2

export interface Member {
  id: number
  name: string
  parentId: number | null
  gender: Gender
  spouseIds: number[]
}

export interface GpxPoint {
  lat: number
  lng: number
  ele?: number
  time?: string
}

export interface TrackStats {
  distanceMeters: number
  pointCount: number
  elevationGainMeters: number | null
}

export interface Track {
  id: number
  name: string
  memberId: number | null
  points: GpxPoint[]
  startPoint: GpxPoint
  endPoint: GpxPoint
  stats: TrackStats
  createdAt: string
  updatedAt: string
}

export interface FamilyData {
  schemaVersion: number
  members: Member[]
  tracks: Track[]
  nextId: number
  nextTrackId: number
}

export interface MemberInput {
  name: string
  parentId: number | null
  gender: Gender
  spouseIds: number[]
}
