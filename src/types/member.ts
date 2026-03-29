export type Gender = '男' | '女'

export const APP_SCHEMA_VERSION = 2

export interface Member {
  id: number
  name: string
  parentId: number | null
  gender: Gender
  spouseIds: number[]
  birthDate?: string
  photoUrl?: string
  biography?: string
}

export type FamilyEventType = '婚' | '丧' | '嫁' | '娶' | '生' | '卒' | '其他'

export interface FamilyEvent {
  id: number
  memberId: number | null
  type: FamilyEventType
  title: string
  date: string
  description?: string
  createdAt: string
  updatedAt: string
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
  events: FamilyEvent[]
  nextId: number
  nextTrackId: number
  nextEventId: number
}

export interface MemberInput {
  name: string
  parentId: number | null
  gender: Gender
  spouseIds: number[]
  birthDate: string
  photoUrl: string
  biography: string
}

export interface FamilyEventInput {
  memberId: number | null
  type: FamilyEventType
  title: string
  date: string
  description: string
}
