import { normalizeFamilyData } from '../../src/services/importExport'

export function familyFixture() {
  return normalizeFamilyData({
    schemaVersion: 4,
    members: [
      { id: 1, name: '朝玉', gender: '男', parentId: null, birthDate: '1888-01-02', photoUrl: 'https://example.invalid/portrait.jpg', biography: '成员生平', generationNumber: 9, generationLabelRaw: '九世', lineageBranch: '测试房', rawNotes: '谱文原句', uncertaintyFlags: ['unverified'] },
      { id: 2, name: '孔氏', gender: '女', parentId: null },
      { id: 3, name: '太琼', gender: '男', parentId: 1, generationNumber: 10 },
    ],
    spouses: [{ id: 4, husbandId: 1, surname: '孔', fullName: '孔氏', relationLabel: '配', order: 1, aliases: ['孔夫人'], birthDate: '1890', deathDate: '1950', burialPlace: '祖山', biography: '配偶生平', statusFlags: ['early-deceased'], rawText: '配孔氏', createdAt: '2026-01-01', updatedAt: '2026-01-02' }],
    childClaims: [{ id: 5, parentId: 1, claimedName: '太琼', ordinalIndex: 1, gender: '男', isAdoptive: true, outAdoptedToHint: '旁支', resolvedMemberId: 3, status: 'matched', statusFlags: ['no-grandchildren'], rawText: '生子太琼' }],
    aliases: [{ id: 6, memberId: 1, name: '玉公', type: 'alias', isPreferred: false, note: '旧称', rawText: '名朝玉' }],
    temporals: [{ id: 7, memberId: 1, label: '出生', rawText: '甲子年', calendarType: 'ganzhi', normalizedDate: '1888', precision: 'year', confidence: 0.8 }],
    relations: [
      { id: 8, fromMemberId: 3, toMemberId: 1, type: 'father', status: 'active', temporalId: null, rawText: '生子太琼' },
      { id: 9, fromMemberId: 1, toMemberId: 2, type: 'spouse', status: 'active', temporalId: 7, note: '保留旧谱关系', rawText: '配孔氏' },
    ],
    burials: [{ id: 10, memberId: 1, temporalId: 7, placeRaw: '祖山', mountainDirection: '坐北朝南', fenjin: '子午', note: '待核实', rawText: '葬祖山' }],
    events: [{ id: 11, memberId: 3, type: '生', title: '出生', date: '1900-01-01', description: '谱载', createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
    tracks: [{ id: 12, memberId: 3, name: '寻墓', points: [{ lat: 26, lng: 119, ele: 10, time: '2026-01-01T00:00:00Z' }, { lat: 26.001, lng: 119.001, ele: 12, time: '2026-01-01T00:01:00Z' }], startPoint: { lat: 26, lng: 119, ele: 10, time: '2026-01-01T00:00:00Z' }, endPoint: { lat: 26.001, lng: 119.001, ele: 12, time: '2026-01-01T00:01:00Z' }, stats: { distanceMeters: 100, pointCount: 2, elevationGainMeters: 2 }, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
    nextId: 4,
    nextSpouseId: 5,
    nextChildClaimId: 6,
    nextAliasId: 20,
    nextTemporalId: 30,
    nextRelationId: 40,
    nextBurialId: 50,
    nextEventId: 60,
    nextTrackId: 70,
  })
}
