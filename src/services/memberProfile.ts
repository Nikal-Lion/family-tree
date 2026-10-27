import type { Member, MemberInput } from '../types/member'

export function createMemberInput(member?: Member, parentId: number | null = null): MemberInput {
  return {
    name: member?.name ?? '',
    parentId: member?.parentId ?? parentId,
    gender: member?.gender ?? '男',
    birthDate: member?.birthDate ?? '',
    photoUrl: member?.photoUrl ?? '',
    biography: member?.biography ?? '',
    generationLabelRaw: member?.generationLabelRaw ?? '',
    generationNumber: member?.generationNumber ?? 0,
    lineageBranch: member?.lineageBranch ?? '',
    rawNotes: member?.rawNotes ?? '',
    uncertaintyFlags: [...(member?.uncertaintyFlags ?? [])],
  }
}
