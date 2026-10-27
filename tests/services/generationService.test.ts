import { describe, expect, it } from 'vitest'
import { computeGenerations, countByGeneration, getMaxGeneration } from '../../src/services/generationService'
import type { Member } from '../../src/types/member'

function member(id: number, parentId: number | null, generationNumber = 0): Member {
  return { id, parentId, generationNumber, name: `族人${id}`, gender: '男' }
}

describe('缺失父系的相对树层级', () => {
  it('已知辈分但没有父亲的人物与同辈对齐，后代继续逐层展开', () => {
    const members = [member(1, null, 9), member(2, 1, 10), member(3, 2, 11),
      member(4, null, 11), member(5, 4, 12)]
    const original = structuredClone(members)
    expect([...computeGenerations(members)]).toEqual([[1, 1], [2, 2], [3, 3], [4, 3], [5, 4]])
    expect(members).toEqual(original)
  })

  it('未解析父亲和代际断档仍按已知代数对齐，不置顶或补造父亲', () => {
    const members = [member(1, null, 9), member(2, 999, 13)]
    expect([...computeGenerations(members)]).toEqual([[1, 1], [2, 5]])
    expect(members[1].parentId).toBe(999)
  })

  it('父亲未载代数时可从已知后代确定整条分支的位置', () => {
    const members = [member(1, null, 9), member(2, 1, 10), member(3, null), member(4, 3, 12)]
    expect([...computeGenerations(members)]).toEqual([[1, 1], [2, 2], [3, 3], [4, 4]])
  })

  it('未载代数的后代继承父系层级，无依据的独立分支保持第一层', () => {
    const members = [member(1, null, 9), member(2, null, 11), member(3, 2),
      member(4, null), member(5, 4)]
    expect([...computeGenerations(members)]).toEqual([[1, 1], [2, 3], [3, 4], [4, 1], [5, 2]])
  })

  it('没有谱载代数时兼容原有父系层级，空库与统计保持一致', () => {
    const generations = computeGenerations([member(1, null), member(2, 1), member(3, null)])
    expect([...generations]).toEqual([[1, 1], [2, 2], [3, 1]])
    expect([...countByGeneration(generations)]).toEqual([[1, 2], [2, 1]])
    expect(getMaxGeneration(generations)).toBe(2)
    expect(computeGenerations([]).size).toBe(0)
    expect(getMaxGeneration(computeGenerations([]))).toBe(0)
  })

  it('谱载代数冲突时不破坏父系层差，锚点不依赖输入顺序', () => {
    const members = [member(1, null, 9), member(2, 1, 15), member(3, null, 10)]
    const result = computeGenerations(members)
    expect([...result]).toEqual([[1, 1], [2, 2], [3, 2]])
    expect(computeGenerations([...members].reverse())).toEqual(result)
  })

  it('循环父系明确报错，不返回看似有效的层级', () => {
    expect(() => computeGenerations([member(1, 2), member(2, 1)])).toThrow('父系关系存在循环')
  })
})
