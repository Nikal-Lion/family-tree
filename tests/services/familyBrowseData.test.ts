import { describe, expect, it } from 'vitest'
import { isCompleteFamilySnapshot, normalizeFamilyBrowseData, toFamilyBrowseData } from '../../src/services/familyBrowseData'
import { familyFixture } from '../fixtures/familyData'

describe('separate family browsing data contract', () => {
  it('preserves every existing genealogy field while excluding maintenance counters', () => {
    const data = familyFixture()
    const before = JSON.stringify(data)
    const browse = toFamilyBrowseData(data)
    expect(normalizeFamilyBrowseData(browse)).toEqual(browse)
    expect(JSON.stringify(data)).toBe(before)
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith('next')) expect(browse).not.toHaveProperty(key)
      else expect(browse).toHaveProperty(key, value)
    }
    expect(isCompleteFamilySnapshot(data)).toBe(true)
    expect(isCompleteFamilySnapshot(browse)).toBe(false)
  })

  it.each(['members', 'tracks', 'events', 'aliases', 'relations', 'temporals', 'burials', 'spouses', 'childClaims'])('rejects a missing %s collection instead of showing an empty success', (key) => {
    const browse: Record<string, unknown> = { ...toFamilyBrowseData(familyFixture()) }
    delete browse[key]
    expect(() => normalizeFamilyBrowseData(browse)).toThrow('集合')
    expect(() => normalizeFamilyBrowseData({ ...browse, [key]: null })).toThrow('集合')
  })

  it.each([null, [], {}, { schemaVersion: 3 }, { schemaVersion: 5 }])('rejects unsupported browse shapes: %j', (invalid) => {
    expect(() => normalizeFamilyBrowseData(invalid)).toThrow('不兼容')
  })

  it('validates references using the existing canonical genealogy rules', () => {
    const browse = toFamilyBrowseData(familyFixture())
    browse.members[0]!.parentId = 99999
    expect(() => normalizeFamilyBrowseData(browse)).toThrow('关联成员不存在')
  })

  it('rejects incomplete or invalid maintenance counters before a browse response can be saved', () => {
    const data = familyFixture()
    expect(isCompleteFamilySnapshot({ ...data, nextId: undefined })).toBe(false)
    expect(isCompleteFamilySnapshot({ ...data, nextId: -1 })).toBe(false)
    expect(isCompleteFamilySnapshot({ ...data, nextId: '4' })).toBe(false)
    expect(isCompleteFamilySnapshot({ ...data, events: undefined })).toBe(false)
    expect(isCompleteFamilySnapshot({ ...data, schemaVersion: 3 })).toBe(false)
  })
})
