import type { Member } from '../types/member'

/**
 * 以谱载代数对齐独立父系分支，计算从最早可推知世代起的相对层级。
 * 没有代数依据的分支仍从第 1 层起算，不推断或修改父亲。
 */
export function computeGenerations(members: Member[]): Map<number, number> {
  const byId = new Map(members.map((member) => [member.id, member]))
  const positions = new Map<number, { rootId: number; depth: number }>()
  const resolving = new Set<number>()
  function resolve(member: Member): { rootId: number; depth: number } {
    const cached = positions.get(member.id)
    if (cached) return cached
    if (resolving.has(member.id)) throw new Error('父系关系存在循环，无法计算相对树层级')
    resolving.add(member.id)
    const parent = member.parentId === null ? undefined : byId.get(member.parentId)
    const ancestor = parent ? resolve(parent) : undefined
    const position = ancestor
      ? { rootId: ancestor.rootId, depth: ancestor.depth + 1 }
      : { rootId: member.id, depth: 0 }
    positions.set(member.id, position)
    resolving.delete(member.id)
    return position
  }

  const anchors = new Map<number, { id: number; depth: number; generation: number }>()
  for (const member of members) {
    const { rootId, depth } = resolve(member)
    const generation = member.generationNumber ?? 0
    if (generation <= 0) continue
    const anchor = anchors.get(rootId)
    // 冲突时保留父系层差，以最靠近分支根的人物为代数锚点。
    if (!anchor || depth < anchor.depth || (depth === anchor.depth && member.id < anchor.id)) {
      anchors.set(rootId, { id: member.id, depth, generation })
    }
  }
  let firstGeneration = Infinity
  for (const anchor of anchors.values()) {
    firstGeneration = Math.min(firstGeneration, anchor.generation - anchor.depth)
  }
  if (!Number.isFinite(firstGeneration)) firstGeneration = 1
  return new Map(members.map((member) => {
    const { rootId, depth } = positions.get(member.id)!
    const anchor = anchors.get(rootId)
    const rootGeneration = anchor ? anchor.generation - anchor.depth : firstGeneration
    return [member.id, rootGeneration - firstGeneration + depth + 1]
  }))
}

/**
 * 获取最大世代数
 */
export function getMaxGeneration(generationMap: Map<number, number>): number {
  let max = 0
  for (const gen of generationMap.values()) {
    if (gen > max) {
      max = gen
    }
  }
  return max
}

/**
 * 统计各世代人数
 */
export function countByGeneration(generationMap: Map<number, number>): Map<number, number> {
  const counts = new Map<number, number>()
  for (const gen of generationMap.values()) {
    counts.set(gen, (counts.get(gen) ?? 0) + 1)
  }
  return counts
}
