import { describe, expect, it } from 'vitest'
import { filterOverviewMembers, getAncestorIds, getBranchTreeMembers } from '../../src/services/overview'
import { buildTreeData, type TreeNode } from '../../src/services/treeBuilder'
import { familyFixture } from '../fixtures/familyData'
import type { Member } from '../../src/types/member'

const members: Member[] = [
  { id: 1, name: '始祖', gender: '男', parentId: null, generationNumber: 9 },
  { id: 2, name: '太琳', gender: '男', parentId: 1, lineageBranch: '长房' },
  { id: 3, name: '太璘', gender: '男', parentId: 1, lineageBranch: '二房' },
  { id: 4, name: '宝秀', gender: '女', parentId: 2, lineageBranch: '长房' },
  { id: 5, name: '太琳', gender: '男', parentId: null, lineageBranch: '二房' },
]
const ids = (items: Member[]) => items.map((item) => item.id)
const treeIds = (node: TreeNode): TreeNode['id'][] => [node.id, ...(node.children ?? []).flatMap(treeIds)]

describe('只读总览检索与图谱范围', () => {
  it('按姓名、ID、分支和别名检索，不改变原始成员', () => {
    const fixture = familyFixture()
    expect(ids(filterOverviewMembers(fixture.members, fixture.aliases, { keyword: ' 玉公 ' }))).toEqual([1])
    expect(ids(filterOverviewMembers(members, [], { keyword: '4' }))).toEqual([4])
    expect(ids(filterOverviewMembers(members, [], { keyword: '长房' }))).toEqual([2, 4])
    expect(ids(filterOverviewMembers(members, [], { keyword: '', gender: '女', branch: '长房' }))).toEqual([4])
    expect(ids(members)).toEqual([1, 2, 3, 4, 5])
  })

  it('保留同名人物和同音异字，不推断合并', () => {
    expect(ids(filterOverviewMembers(members, [], { keyword: '太琳' }))).toEqual([2, 5])
    expect(ids(filterOverviewMembers(members, [], { keyword: '太璘' }))).toEqual([3])
  })

  it('分支图保留实际祖先作为上下文，不包含其他分支的旁系', () => {
    const branch = getBranchTreeMembers(members, '长房')
    expect(ids(branch)).toEqual([1, 2, 4])
    expect(treeIds(buildTreeData(branch))).toEqual(['root', 1, 2, 4])
    expect(branch[1].parentId).toBe(1)
  })

  it('全部分支、无分支记录与不存在分支各有独立语义', () => {
    expect(getBranchTreeMembers(members)).toBe(members)
    expect(ids(getBranchTreeMembers(members, ''))).toEqual([1])
    expect(ids(filterOverviewMembers(members, [], { keyword: '', branch: '' }))).toEqual([1])
    expect(getBranchTreeMembers(members, '不存在')).toEqual([])
  })

  it('选中深层后代能找出完整路径，但不打开旁系', () => {
    expect([...getAncestorIds(members, [4])]).toEqual([4, 2, 1])
    expect([...getAncestorIds(members, [4, 3])]).toEqual([4, 2, 1, 3])
    expect([...getAncestorIds(members, [999])]).toEqual([])
  })

  it('选定子树仅展示所选成员及后代，保留原始世代与父亲', () => {
    expect(treeIds(buildTreeData(members, 2))).toEqual(['root', 2, 4])
    expect(members[1].parentId).toBe(1)
    expect(members[0].generationNumber).toBe(9)
  })

  it('空库与已删除的子树成员不意外回退为全图', () => {
    expect(buildTreeData([]).children).toEqual([])
    expect(buildTreeData(members, 999).children).toEqual([])
  })

  it('多个始祖和缺失父亲按独立分支展示，不伪造关系', () => {
    const withMissingParent = [...members, { id: 6, name: '未录父系', gender: '男' as const, parentId: 999 }]
    expect(buildTreeData(withMissingParent).children?.map((node) => node.id)).toEqual([1, 5, 6])
  })

  it('五百节点可完整建图、定位与检索，互不遗漏', () => {
    const large: Member[] = Array.from({ length: 500 }, (_, index) => ({
      id: index + 1, name: `成员${index + 1}`, gender: '男',
      parentId: index === 0 ? null : Math.floor((index - 1) / 3) + 1,
      lineageBranch: '测试分支',
    }))
    expect(treeIds(buildTreeData(large))).toHaveLength(501)
    expect(getAncestorIds(large, [500]).has(1)).toBe(true)
    expect(ids(filterOverviewMembers(large, [], { keyword: '成员500' }))).toEqual([500])
  })
})
