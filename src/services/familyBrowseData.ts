import { APP_SCHEMA_VERSION, type FamilyBrowseData, type FamilyData } from '../types/member'
import { FamilyDataValidationError, normalizeFamilyData } from './importExport'

export const FAMILY_BROWSE_CONTRACT_VERSION = 1

const collections = ['members', 'tracks', 'events', 'aliases', 'relations', 'temporals', 'burials', 'spouses', 'childClaims'] as const

export function toFamilyBrowseData(data: FamilyData): FamilyBrowseData {
  return {
    schemaVersion: data.schemaVersion,
    members: data.members,
    tracks: data.tracks,
    events: data.events,
    aliases: data.aliases,
    relations: data.relations,
    temporals: data.temporals,
    burials: data.burials,
    spouses: data.spouses,
    childClaims: data.childClaims,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeFamilyBrowseData(value: unknown): FamilyBrowseData {
  if (!isRecord(value) || value.schemaVersion !== APP_SCHEMA_VERSION) {
    throw new FamilyDataValidationError('浏览资料格式不兼容，请刷新页面或联系管理员')
  }
  for (const key of collections) {
    if (!Array.isArray(value[key])) throw new FamilyDataValidationError(`浏览资料缺少 ${key} 集合`)
  }
  return toFamilyBrowseData(normalizeFamilyData(value))
}

export function isCompleteFamilySnapshot(value: unknown): boolean {
  return isRecord(value) && value.schemaVersion === APP_SCHEMA_VERSION
    && collections.every((key) => Array.isArray(value[key]))
    && ['nextId', 'nextTrackId', 'nextEventId', 'nextAliasId', 'nextRelationId', 'nextTemporalId', 'nextBurialId', 'nextSpouseId', 'nextChildClaimId']
      .every((key) => typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && value[key] >= 1)
}
