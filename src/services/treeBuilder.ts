import type { Member } from '../types/member'
import { computeGenerations } from './generationService'

export interface TreeNode {
  id: number | 'root' | `gap:${number}:${number}`
  name: string
  level: number
  placeholder?: boolean
  value?: number
  gender?: string
  children?: TreeNode[]
}

export function buildTreeData(
  members: Member[], rootId: number | null = null,
  generations: ReadonlyMap<number, number> = computeGenerations(members),
): TreeNode {
  const byParent = new Map<number | null, Member[]>()
  const byId = new Map(members.map((member) => [member.id, member]))

  for (const member of members) {
    const key = member.parentId
    const group = byParent.get(key) ?? []
    group.push(member)
    byParent.set(key, group)
  }

  for (const list of byParent.values()) {
    list.sort((a, b) => a.id - b.id)
  }

  const root = rootId === null ? undefined : byId.get(rootId)
  const offset = root ? (generations.get(root.id) ?? 1) - 1 : 0
  const buildNode = (member: Member): TreeNode => ({
    id: member.id,
    name: member.name,
    level: (generations.get(member.id) ?? 1) - offset,
    value: member.id,
    gender: member.gender,
    children: (byParent.get(member.id) ?? []).map(buildNode),
  })

  const roots = (root ? [root] : rootId !== null ? [] : members
    .filter((member) => member.parentId === null || !byId.has(member.parentId)))
    .sort((a, b) => a.id - b.id)
    .map((member) => {
      let node = buildNode(member)
      // 占位仅用于辈分排版；不作为人物展示，也不绘制父系连线。
      for (let level = node.level - 1; level > 0; level--) {
        node = { id: `gap:${member.id}:${level}`, name: '', level, placeholder: true, children: [node] }
      }
      return node
    })

  return {
    id: 'root',
    level: 0,
    name: root ? `${root.name}及后代` : '族谱总览',
    children: roots,
  }
}
