import type { Spouse } from './spouse'
import type { ChildClaim } from './childClaim'

export type Gender = '男' | '女'

export const APP_SCHEMA_VERSION = 4

export type UncertaintyFlag = 'missing' | 'estimated' | 'conflicting' | 'unverified'

export type NameAliasType = 'primary' | 'given' | 'courtesy' | 'art' | 'taboo' | 'alias' | 'other'

export interface NameAlias {
  id: number
  memberId: number
  name: string
  type: NameAliasType
  isPreferred: boolean
  note?: string
  rawText?: string
}

export type KinshipRelationType =
  | 'father'
  | 'mother'
  | 'spouse'
  | 'step-parent'
  | 'adoptive-parent'
  | 'adopted-child'
  | 'successor'
  | 'other'

export type KinshipRelationStatus = 'active' | 'ended' | 'uncertain'

export interface KinshipRelation {
  id: number
  fromMemberId: number
  toMemberId: number
  type: KinshipRelationType
  status: KinshipRelationStatus
  temporalId: number | null
  note?: string
  rawText?: string
}

export type TemporalCalendarType = 'gregorian' | 'lunar-era' | 'ganzhi' | 'mixed' | 'unknown'
export type TemporalPrecision = 'year' | 'month' | 'day' | 'hour' | 'unknown'

export interface TemporalExpression {
  id: number
  memberId: number | null
  label: string
  rawText: string
  calendarType: TemporalCalendarType
  normalizedDate?: string
  precision: TemporalPrecision
  confidence: number
}

export interface BurialRecord {
  id: number
  memberId: number
  temporalId: number | null
  placeRaw: string
  mountainDirection?: string
  fenjin?: string
  note?: string
  rawText?: string
}

export interface Member {
  id: number
  name: string
  parentId: number | null
  gender: Gender
  birthDate?: string
  photoUrl?: string
  biography?: string
  generationLabelRaw?: string
  generationNumber?: number
  lineageBranch?: string
  rawNotes?: string
  uncertaintyFlags?: UncertaintyFlag[]
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
  aliases: NameAlias[]
  relations: KinshipRelation[]
  temporals: TemporalExpression[]
  burials: BurialRecord[]
  spouses: Spouse[]
  childClaims: ChildClaim[]
  nextId: number
  nextTrackId: number
  nextEventId: number
  nextAliasId: number
  nextRelationId: number
  nextTemporalId: number
  nextBurialId: number
  nextSpouseId: number
  nextChildClaimId: number
}

export interface MemberInput {
  name: string
  parentId: number | null
  gender: Gender
  birthDate: string
  photoUrl: string
  biography: string
  generationLabelRaw: string
  generationNumber: number
  lineageBranch: string
  rawNotes: string
  uncertaintyFlags: UncertaintyFlag[]
}

export interface FamilyEventInput {
  memberId: number | null
  type: FamilyEventType
  title: string
  date: string
  description: string
}
