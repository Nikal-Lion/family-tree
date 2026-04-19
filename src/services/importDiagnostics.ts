import type { FamilyData, Member } from '../types/member'

export interface FamilyDataImportSummary {
  memberCount: number
  rootCount: number
  aliasCount: number
  temporalCount: number
  burialCount: number
  eventCount: number
  trackCount: number
}

function buildMemberMap(members: Member[]): Map<number, Member> {
  return new Map(members.map((member) => [member.id, member]))
}

export function summarizeFamilyDataImport(data: FamilyData): FamilyDataImportSummary {
  return {
    memberCount: data.members.length,
    rootCount: data.members.filter((member) => member.parentId === null).length,
    aliasCount: data.aliases.length,
    temporalCount: data.temporals.length,
    burialCount: data.burials.length,
    eventCount: data.events.length,
    trackCount: data.tracks.length,
  }
}

function detectParentCycles(members: Member[]): number {
  const memberMap = buildMemberMap(members)
  const color = new Map<number, 0 | 1 | 2>()
  const cycleNodes = new Set<number>()

  function visit(memberId: number): void {
    const status = color.get(memberId) ?? 0
    if (status === 2) {
      return
    }
    if (status === 1) {
      cycleNodes.add(memberId)
      return
    }

    color.set(memberId, 1)
    const member = memberMap.get(memberId)
    const parentId = member?.parentId
    if (typeof parentId === 'number') {
      const parentState = color.get(parentId) ?? 0
      if (parentState === 1) {
        cycleNodes.add(memberId)
        cycleNodes.add(parentId)
      } else if (parentState !== 2 && memberMap.has(parentId)) {
        visit(parentId)
      }
    }

    color.set(memberId, 2)
  }

  for (const member of members) {
    visit(member.id)
  }

  return cycleNodes.size
}

export function analyzeFamilyDataImport(data: FamilyData): string[] {
  const warnings: string[] = []
  const memberMap = buildMemberMap(data.members)

  const missingParentRefs = data.members.filter(
    (member) => member.parentId !== null && !memberMap.has(member.parentId),
  ).length
  if (missingParentRefs > 0) {
    warnings.push(`检测到 ${missingParentRefs} 条父节点引用不存在`) 
  }

  const selfParentRefs = data.members.filter((member) => member.parentId !== null && member.parentId === member.id).length
  if (selfParentRefs > 0) {
    warnings.push(`检测到 ${selfParentRefs} 条父节点自引用`) 
  }

  const cycleCount = detectParentCycles(data.members)
  if (cycleCount > 0) {
    warnings.push(`检测到 ${cycleCount} 位成员存在祖先环风险`) 
  }

  let missingSpouseRefs = 0
  let unpairedSpouseRefs = 0
  for (const member of data.members) {
    for (const spouseId of member.spouseIds) {
      const spouse = memberMap.get(spouseId)
      if (!spouse) {
        missingSpouseRefs += 1
        continue
      }
      if (!spouse.spouseIds.includes(member.id)) {
        unpairedSpouseRefs += 1
      }
    }
  }

  if (missingSpouseRefs > 0) {
    warnings.push(`检测到 ${missingSpouseRefs} 条配偶引用不存在`) 
  }
  if (unpairedSpouseRefs > 0) {
    warnings.push(`检测到 ${unpairedSpouseRefs} 条配偶关系未双向闭合`) 
  }

  const duplicateGroups = new Map<string, number>()
  for (const member of data.members) {
    const key = `${member.generationLabelRaw ?? '未知世代'}|${member.name}`
    duplicateGroups.set(key, (duplicateGroups.get(key) ?? 0) + 1)
  }
  const duplicatedNameGroups = [...duplicateGroups.values()].filter((count) => count > 1).length
  if (duplicatedNameGroups > 0) {
    warnings.push(`检测到 ${duplicatedNameGroups} 组同世代同名成员，建议人工复核`) 
  }

  const burialMissingMemberRefs = data.burials.filter((burial) => !memberMap.has(burial.memberId)).length
  if (burialMissingMemberRefs > 0) {
    warnings.push(`检测到 ${burialMissingMemberRefs} 条葬地记录关联成员不存在`) 
  }

  const temporalMissingMemberRefs = data.temporals.filter(
    (temporal) => temporal.memberId !== null && !memberMap.has(temporal.memberId),
  ).length
  if (temporalMissingMemberRefs > 0) {
    warnings.push(`检测到 ${temporalMissingMemberRefs} 条时间记录关联成员不存在`) 
  }

  return warnings
}