import { describe, expect, it } from 'vitest'
import { createEmptyFamilyData, exportAsJson, normalizeFamilyData, parseImportedJson } from '../../src/services/importExport'
import { familyFixture } from '../fixtures/familyData'

describe('complete family backups', () => {
  it('round-trips every v4 collection, absolute generation and ID counter', () => {
    const data = familyFixture()
    expect(parseImportedJson(exportAsJson(data))).toEqual(data)
    expect(data.nextSpouseId).toBe(5)
    expect(data.nextChildClaimId).toBe(6)
    expect(data.members[0]?.generationNumber).toBe(9)
  })
  it.each([2, 3])('accepts schema %s and preserves old member-to-member spouse links', (version) => {
    const data = { ...familyFixture(), schemaVersion: version, relations: [] }
    const legacy = { ...data, members: data.members.map((member) => ({ ...member, spouseIds: member.id === 1 ? [2] : member.id === 2 ? [1] : [] })) }
    const imported = normalizeFamilyData(legacy)
    expect(imported.relations.filter((item) => item.type === 'spouse')).toHaveLength(1)
    expect(imported.members[0]).not.toHaveProperty('spouseIds')
  })
  it('supports an explicitly empty family without injecting sample members', () => {
    const empty = createEmptyFamilyData()
    expect(parseImportedJson(exportAsJson(empty))).toEqual(empty)
    expect(empty.members).toEqual([])
    expect(empty.nextId).toBe(1)
  })
  it('preserves standalone public events and tracks without members', () => {
    const data = familyFixture()
    const empty = { ...createEmptyFamilyData(), events: data.events.map((item) => ({ ...item, memberId: null })), tracks: data.tracks.map((item) => ({ ...item, memberId: null })) }
    expect(parseImportedJson(exportAsJson(empty)).events).toHaveLength(1)
    expect(parseImportedJson(exportAsJson(empty)).tracks).toHaveLength(1)
  })
  it.each([
    ['members', (data: ReturnType<typeof familyFixture>) => { data.members.push({ ...data.members[0]! }) }],
    ['cycle', (data: ReturnType<typeof familyFixture>) => { data.members[0]!.parentId = 3 }],
    ['parent', (data: ReturnType<typeof familyFixture>) => { data.members[0]!.parentId = 999 }],
    ['spouse', (data: ReturnType<typeof familyFixture>) => { data.spouses[0]!.husbandId = 999 }],
    ['claim', (data: ReturnType<typeof familyFixture>) => { data.childClaims[0]!.resolvedMemberId = 999 }],
    ['event', (data: ReturnType<typeof familyFixture>) => { data.events[0]!.memberId = 999 }],
    ['temporal', (data: ReturnType<typeof familyFixture>) => { data.relations[0]!.temporalId = 999 }],
    ['generation', (data: ReturnType<typeof familyFixture>) => { data.members[0]!.generationNumber = -1 }],
    ['coordinate', (data: ReturnType<typeof familyFixture>) => { data.tracks[0]!.points[0]!.lat = NaN }],
  ] as const)('rejects invalid %s records instead of silently dropping them', (_, corrupt) => {
    const data = familyFixture()
    corrupt(data)
    expect(() => normalizeFamilyData(data)).toThrow('数据无效')
  })
  it('rejects unsupported versions, malformed JSON, and invalid collections', () => {
    expect(() => parseImportedJson('{')).toThrow('JSON')
    expect(() => normalizeFamilyData({ ...familyFixture(), schemaVersion: 5 })).toThrow('schemaVersion')
    expect(() => normalizeFamilyData({ ...familyFixture(), aliases: 'invalid' })).toThrow('aliases')
    expect(() => normalizeFamilyData({ ...familyFixture(), members: [{ id: 1, name: 'valid' }, { id: 'bad', name: 'invalid' }] })).toThrow('成员 ID')
  })
})
