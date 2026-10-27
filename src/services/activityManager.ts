import type { FamilyEvent, FamilyEventType, Member, Track } from '../types/member'
import { trackMemberIds } from './trackService'

export const ACTIVITY_EVENT_TYPES: FamilyEventType[] = ['婚', '丧', '嫁', '娶', '生', '卒', '其他']
export type ActivityMemberFilter = number | 'unlinked' | undefined

export function activityMemberName(members: Member[], id: number | null): string {
  return id === null ? '未关联成员' : members.find((member) => member.id === id)?.name ?? `成员#${id}`
}

function matchesMember(id: number | null, filter: ActivityMemberFilter): boolean {
  return filter === undefined || (filter === 'unlinked' ? id === null : id === filter)
}

export function filterActivityEvents(
  events: FamilyEvent[], members: Member[], keyword: string,
  type: FamilyEventType | undefined, member: ActivityMemberFilter,
): FamilyEvent[] {
  const query = keyword.trim().toLocaleLowerCase()
  return events.filter((event) => matchesMember(event.memberId, member)
    && (!type || event.type === type)
    && (!query || [event.title, event.description ?? '', event.date, event.type,
      activityMemberName(members, event.memberId), String(event.id),
    ].some((value) => value.toLocaleLowerCase().includes(query))))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
}

export function filterActivityTracks(
  tracks: Track[], members: Member[], keyword: string, member: ActivityMemberFilter,
): Track[] {
  const query = keyword.trim().toLocaleLowerCase()
  return tracks.filter((track) => (member === undefined || (member === 'unlinked'
    ? trackMemberIds(track).length === 0 : trackMemberIds(track).includes(member)))
    && (!query || [track.name, ...trackMemberIds(track).map((id) => activityMemberName(members, id)), String(track.id)]
      .some((value) => value.toLocaleLowerCase().includes(query))))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
}
