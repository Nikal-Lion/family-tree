import type { ChildClaim, ChildClaimInput } from '../types/childClaim'
import type { KinshipRelation } from '../types/member'

export function childClaimAdoptionLabel(state: { relations: KinshipRelation[] }, claim: ChildClaim): string {
  if (!claim.isAdoptive) return ''
  const relation = state.relations.find((item) => item.fromMemberId === claim.resolvedMemberId
    && item.toMemberId === claim.parentId && (item.type === 'father' || item.type === 'adoptive-parent'))
  if (relation?.type === 'father') return '出继（生父记载）'
  if (relation?.type === 'adoptive-parent') return '承继（继父记载）'
  return '过继 / 承嗣（方向待核对）'
}

export function createChildClaim(
  state: { childClaims: ChildClaim[]; nextChildClaimId: number },
  input: ChildClaimInput,
): ChildClaim {
  const claim: ChildClaim = {
    id: state.nextChildClaimId,
    ...input,
    resolvedMemberId: null,
    status: 'missing',
  }
  state.childClaims.push(claim)
  state.nextChildClaimId += 1
  return claim
}

export function deleteChildClaimsByParent(state: { childClaims: ChildClaim[] }, parentId: number): number {
  const before = state.childClaims.length
  state.childClaims = state.childClaims.filter((c) => c.parentId !== parentId)
  return before - state.childClaims.length
}

export function findChildClaimsByParent(state: { childClaims: ChildClaim[] }, parentId: number): ChildClaim[] {
  return state.childClaims
    .filter((c) => c.parentId === parentId)
    .sort((a, b) => a.ordinalIndex - b.ordinalIndex)
}
