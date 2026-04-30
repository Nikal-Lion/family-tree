import type { ChildClaim, ChildClaimInput } from '../types/childClaim'

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
