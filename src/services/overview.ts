import type { Member, NameAlias } from '../types/member'

export interface OverviewFilter {
  keyword: string
  branch?: string
  gender?: Member['gender']
}

export function filterOverviewMembers(
  members: Member[], aliases: NameAlias[], filter: OverviewFilter,
): Member[] {
  const query = filter.keyword.trim().toLocaleLowerCase()
  const aliasesByMember = new Map<number, string[]>()
  for (const alias of aliases) {
    const names = aliasesByMember.get(alias.memberId) ?? []
    names.push(alias.name)
    aliasesByMember.set(alias.memberId, names)
  }
  return members.filter((member) => (
    (filter.branch === undefined || (member.lineageBranch ?? '') === filter.branch)
    && (!filter.gender || member.gender === filter.gender)
    && (!query || [member.name, String(member.id), member.lineageBranch ?? '',
      ...(aliasesByMember.get(member.id) ?? []),
    ].some((value) => value.toLocaleLowerCase().includes(query)))
  ))
}

// Keep recorded ancestors as context; filtering never promotes a descendant to an ancestor.
export function getBranchTreeMembers(members: Member[], branch?: string): Member[] {
  if (branch === undefined) return members
  const byId = new Map(members.map((member) => [member.id, member]))
  const included = new Set<number>()
  for (const member of members) {
    if ((member.lineageBranch ?? '') !== branch) continue
    let current: Member | undefined = member
    while (current && !included.has(current.id)) {
      included.add(current.id)
      current = current.parentId === null ? undefined : byId.get(current.parentId)
    }
  }
  return members.filter((member) => included.has(member.id))
}

export function getAncestorIds(members: Member[], targetIds: number[]): Set<number> {
  const byId = new Map(members.map((member) => [member.id, member]))
  const ids = new Set<number>()
  for (const id of targetIds) {
    let member = byId.get(id)
    while (member && !ids.has(member.id)) {
      ids.add(member.id)
      member = member.parentId === null ? undefined : byId.get(member.parentId)
    }
  }
  return ids
}
