import type { Member } from '../types/member'

/**
 * 计算每个成员的世代数（第 N 代）。
 * 始祖（无父亲）为第 1 代，其子女为第 2 代，依此类推。
 */
export function computeGenerations(members: Member[]): Map<number, number> {
  const byId = new Map<number, Member>()
  for (const m of members) {
    byId.set(m.id, m)
  }

  const cache = new Map<number, number>()

  function resolve(id: number): number {
    if (cache.has(id)) {
      return cache.get(id)!
    }

    const member = byId.get(id)
    if (!member || member.parentId === null || !byId.has(member.parentId)) {
      cache.set(id, 1)
      return 1
    }

    // Guard against cycles (should not happen with valid data)
    cache.set(id, 1) // temporary
    const parentGen = resolve(member.parentId)
    const gen = parentGen + 1
    cache.set(id, gen)
    return gen
  }

  for (const m of members) {
    resolve(m.id)
  }

  return cache
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
