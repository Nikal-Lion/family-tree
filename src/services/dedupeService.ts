import type { Member } from '../types/member'
import type { OcrDuplicateCandidate, TempMember } from '../types/ocr'

function parentNameOf(member: Member, members: Member[]): string {
  if (member.parentId === null) {
    return ''
  }
  return members.find((m) => m.id === member.parentId)?.name ?? ''
}

export function detectOcrDuplicates(
  tempMembers: TempMember[],
  existingMembers: Member[],
): OcrDuplicateCandidate[] {
  const result: OcrDuplicateCandidate[] = []

  for (const temp of tempMembers) {
    const name = temp.name.trim()
    if (!name) {
      continue
    }

    const candidates = existingMembers.filter((member) => member.name === name)
    for (const candidate of candidates) {
      const parentName = parentNameOf(candidate, existingMembers)
      const reason =
        temp.fatherName && parentName && temp.fatherName === parentName
          ? '姓名和父亲姓名均一致'
          : '姓名一致'

      result.push({
        tempId: temp.tempId,
        tempName: temp.name,
        existingId: candidate.id,
        existingName: candidate.name,
        reason,
      })
    }
  }

  return result
}
