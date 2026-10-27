import type { Member } from '../types/member'

export interface TreeNode {
  id: number | 'root'
  name: string
  value?: number
  gender?: string
  children?: TreeNode[]
}

export function buildTreeData(members: Member[], rootId: number | null = null): TreeNode {
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

  const buildNode = (member: Member): TreeNode => ({
    id: member.id,
    name: member.name,
    value: member.id,
    gender: member.gender,
    children: (byParent.get(member.id) ?? []).map(buildNode),
  })

  const root = rootId === null ? undefined : byId.get(rootId)
  const roots = (root ? [root] : rootId !== null ? [] : members
    .filter((member) => member.parentId === null || !byId.has(member.parentId)))
    .sort((a, b) => a.id - b.id)
    .map(buildNode)

  return {
    id: 'root',
    name: root ? `${root.name}及后代` : '族谱总览',
    children: roots,
  }
}
