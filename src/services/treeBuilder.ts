import type { Member } from '../types/member'

export interface TreeNode {
  id: number | 'root'
  name: string
  value?: number
  gender?: string
  children?: TreeNode[]
}

export function buildTreeData(members: Member[]): TreeNode {
  const byParent = new Map<number | null, Member[]>()

  for (const member of members) {
    const key = member.parentId
    const group = byParent.get(key) ?? []
    group.push(member)
    byParent.set(key, group)
  }

  for (const list of byParent.values()) {
    list.sort((a, b) => a.id - b.id)
  }

  const buildNode = (member: Member): TreeNode => ({
    id: member.id,
    name: member.name,
    value: member.id,
    gender: member.gender,
    children: (byParent.get(member.id) ?? []).map(buildNode),
  })

  const roots = members
    .filter((member) => member.parentId === null || !members.some((m) => m.id === member.parentId))
    .sort((a, b) => a.id - b.id)
    .map(buildNode)

  return {
    id: 'root',
    name: '族谱总览',
    children: roots,
  }
}
