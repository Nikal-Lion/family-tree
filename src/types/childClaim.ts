export type ChildClaimStatusFlag = 'no-grandchildren' | 'unmarried' | 'out-married' | 'lost-record'
export type ChildClaimGender = '男' | '女' | 'unknown'
export type ChildClaimStatus = 'matched' | 'missing' | 'ambiguous'

export interface ChildClaim {
  id: number
  parentId: number
  claimedName: string
  ordinalIndex: number
  gender: ChildClaimGender
  isAdoptive: boolean
  outAdoptedToHint: string
  resolvedMemberId: number | null
  status: ChildClaimStatus
  statusFlags: ChildClaimStatusFlag[]
  rawText: string
}

export interface ChildClaimInput {
  parentId: number
  claimedName: string
  ordinalIndex: number
  gender: ChildClaimGender
  isAdoptive: boolean
  outAdoptedToHint: string
  statusFlags: ChildClaimStatusFlag[]
  rawText: string
}
