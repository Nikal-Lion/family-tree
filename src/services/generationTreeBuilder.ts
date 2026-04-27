import type { Member, KinshipRelation, NameAlias } from '../types/member'
import type {
  GenerationMember,
  GenerationLayer,
  GenerationTree,
  SpouseInfo,
} from '../types/generationTree'
import { computeGenerations } from './generationService'

// ----------------------------------------------------------------
// Chinese numerals for generation labels
// ----------------------------------------------------------------
const CHINESE_NUMERALS = [
  '',
  '一',
  '二',
  '三',
  '四',
  '五',
  '六',
  '七',
  '八',
  '九',
  '十',
  '十一',
  '十二',
  '十三',
  '十四',
  '十五',
  '十六',
  '十七',
  '十八',
  '十九',
  '二十',
  '廿一',
  '廿二',
  '廿三',
  '廿四',
  '廿五',
  '廿六',
  '廿七',
  '廿八',
  '廿九',
  '三十',
]

/**
 * 将世代序号（1-based，相对根节点）转换为中文世代标签。
 * 默认从第 8 世开始（八世祖），可根据数据自动偏移。
 */
export function generationToLabel(
  gen: number,
  baseGeneration: number = 8,
): string {
  const absoluteGen = baseGeneration + gen - 1
  if (absoluteGen >= 1 && absoluteGen < CHINESE_NUMERALS.length) {
    const suffix = absoluteGen <= 20 ? '世' : '世'
    return CHINESE_NUMERALS[absoluteGen] + suffix
  }
  return `第 ${gen} 代`
}

/**
 * 从中文标签反向解析世代绝对序号
 */
export function labelToGeneration(label: string): number | null {
  for (let i = 1; i < CHINESE_NUMERALS.length; i++) {
    if (label.startsWith(CHINESE_NUMERALS[i])) {
      return i
    }
  }
  return null
}

/**
 * 根据辈分用词推断基准世代。
 * 如果数据中有 "八世祖" 等标签，则基准世代为 8；
 * 否则默认为 1。
 */
export function inferBaseGeneration(
  generationLabels: string[],
): number {
  let base = 1
  for (const label of generationLabels) {
    const num = labelToGeneration(label)
    if (num !== null && num > base) {
      base = num
    }
  }
  // 如果最高标签 > 10，说明数据从更早的世代开始
  // 取最小的可用标签
  let minLabel = Infinity
  for (const label of generationLabels) {
    const num = labelToGeneration(label)
    if (num !== null && num < minLabel) {
      minLabel = num
    }
  }
  return minLabel < Infinity ? minLabel : 1
}

// ----------------------------------------------------------------
// Group members by parentId for child lookup
// ----------------------------------------------------------------
function groupByParentId(members: Member[]): Map<number, Member[]> {
  const map = new Map<number, Member[]>()
  for (const member of members) {
    const parentId = member.parentId
    if (parentId !== null) {
      const siblings = map.get(parentId) ?? []
      siblings.push(member)
      map.set(parentId, siblings)
    }
  }
  return map
}

// ----------------------------------------------------------------
// Spouse resolution helpers
// ----------------------------------------------------------------
function resolveSpouseInfo(
  member: Member,
  allMembers: Map<number, Member>,
  allRelations: KinshipRelation[],
): SpouseInfo[] {
  const spouses: SpouseInfo[] = []

  // Strategy 1: Use member.spouseIds (direct spouse references)
  if (member.spouseIds && member.spouseIds.length > 0) {
    for (const spouseId of member.spouseIds) {
      const spouse = allMembers.get(spouseId)
      if (spouse) {
        spouses.push({
          id: spouse.id,
          name: spouse.name,
          relationLabel: spouse.gender === '女' ? '配' : '夫',
        })
      }
    }
  }

  // Strategy 2: Use kinship relations
  for (const rel of allRelations) {
    if (rel.type === 'spouse') {
      if (rel.fromMemberId === member.id) {
        const spouse = allMembers.get(rel.toMemberId)
        if (spouse && !spouses.some((s) => s.id === spouse.id)) {
          spouses.push({
            id: spouse.id,
            name: spouse.name,
            relationLabel: rel.note ?? (spouse.gender === '女' ? '配' : '夫'),
          })
        }
      }
      if (rel.toMemberId === member.id) {
        const spouse = allMembers.get(rel.fromMemberId)
        if (spouse && !spouses.some((s) => s.id === spouse.id)) {
          spouses.push({
            id: spouse.id,
            name: spouse.name,
            relationLabel: rel.note ?? (spouse.gender === '女' ? '配' : '夫'),
          })
        }
      }
    }
  }

  return spouses
}

// ----------------------------------------------------------------
// Birth/death summary
// ----------------------------------------------------------------
function buildBirthDeathSummary(member: Member): string {
  const parts: string[] = []
  if (member.birthDate) {
    parts.push(`生:${member.birthDate}`)
  }
  // Death date would come from TemporalExpression, not Member directly
  return parts.join(' ')
}

// ----------------------------------------------------------------
// Main builder
// ----------------------------------------------------------------
export function buildGenerationTree(
  members: Member[],
  relations: KinshipRelation[],
  aliases: NameAlias[],
  baseGeneration?: number,
): GenerationTree {
  // Compute per-member generation relative to root (1-based)
  const genMap = computeGenerations(members)
  const allMembers = new Map<number, Member>()
  for (const member of members) {
    allMembers.set(member.id, member)
  }

  // Infer base generation if not provided
  const base = baseGeneration ?? 1

  // Child lookup
  const childrenByParent = groupByParentId(members)

  // Alias lookup
  const aliasesByMember = new Map<number, string[]>()
  for (const alias of aliases) {
    const existing = aliasesByMember.get(alias.memberId) ?? []
    existing.push(alias.name)
    aliasesByMember.set(alias.memberId, existing)
  }

  // Build GenerationMember list
  const genMembers: GenerationMember[] = members.map((member, index) => {
    const gen = genMap.get(member.id) ?? 1
    const childMembers = childrenByParent.get(member.id) ?? []
    // Sort children by ID or birth order (这里用ID作为稳定性排序)
    const sortedChildIds = childMembers
      .map((child) => ({ id: child.id, gen: genMap.get(child.id) ?? 1 }))
      .sort((a, b) => a.id - b.id)
      .map((c) => c.id)

    return {
      member,
      positionIndex: index,
      fatherId: member.parentId,
      motherId: null, // Mother info would come from spouse relations
      childIds: sortedChildIds,
      spouses: resolveSpouseInfo(member, allMembers, relations),
      collapsed: false,
      aliases: aliasesByMember.get(member.id) ?? [],
      birthDeathSummary: buildBirthDeathSummary(member),
      childOrder: 0,
    }
  })

  // Assign childOrder for each parent's children
  for (const gm of genMembers) {
    gm.childIds.forEach((childId, order) => {
      const child = genMembers.find((g) => g.member.id === childId)
      if (child) {
        child.childOrder = order
      }
    })
  }

  // Build member map
  const memberMap = new Map<number, GenerationMember>()
  for (const gm of genMembers) {
    memberMap.set(gm.member.id, gm)
  }

  // Group by generation
  const layerMap = new Map<number, GenerationMember[]>()
  let maxGen = 0
  let minGen = Infinity
  for (const gm of genMembers) {
    const gen = genMap.get(gm.member.id) ?? 1
    if (gen > maxGen) maxGen = gen
    if (gen < minGen) minGen = gen
    const layer = layerMap.get(gen) ?? []
    layer.push(gm)
    layerMap.set(gen, layer)
  }

  // Build layers sorted by generation
  const layers: GenerationLayer[] = []
  for (let gen = minGen; gen <= maxGen; gen++) {
    const layerMembers = layerMap.get(gen) ?? []
    // Sort members within a layer by parent's position then childOrder
    layerMembers.sort((a, b) => {
      // First, group by parent
      const parentA = a.fatherId;
      const parentB = b.fatherId;
      if (parentA !== parentB) {
        // Children of the same parent stay together
        if (parentA === null) return -1;
        if (parentB === null) return 1;
        // Sort by parent's positionIndex in previous generation
        const parentGmA = memberMap.get(parentA);
        const parentGmB = memberMap.get(parentB);
        if (parentGmA && parentGmB) {
          return parentGmA.positionIndex - parentGmB.positionIndex;
        }
      }
      // Within same parent, sort by childOrder
      return a.childOrder - b.childOrder;
    });

    layers.push({
      generation: gen,
      label: generationToLabel(gen, base),
      members: layerMembers,
    })
  }

  return {
    layers,
    memberMap,
    maxGeneration: maxGen,
    minGeneration: minGen,
    aliases,
  }
}