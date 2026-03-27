import type { Member } from '../types/member'

export function validateName(name: string): string | null {
  if (!name.trim()) {
    return '姓名不能为空'
  }
  return null
}

export function canAssignParent(members: Member[], memberId: number, newParentId: number | null): boolean {
  if (newParentId === null) {
    return true
  }

  if (memberId === newParentId) {
    return false
  }

  return !isDescendant(members, memberId, newParentId)
}

function isDescendant(members: Member[], ancestorId: number, candidateId: number): boolean {
  const childrenMap = new Map<number, number[]>()

  for (const member of members) {
    if (member.parentId === null) {
      continue
    }

    const children = childrenMap.get(member.parentId) ?? []
    children.push(member.id)
    childrenMap.set(member.parentId, children)
  }

  const stack = [...(childrenMap.get(ancestorId) ?? [])]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === candidateId) {
      return true
    }
    stack.push(...(childrenMap.get(current) ?? []))
  }

  return false
}
