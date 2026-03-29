export type DuplicateAction = 'skip' | 'create'

export interface TempMember {
  tempId: string
  name: string
  fatherName: string
  motherName: string
  spouseName: string
  birthYear: string
  deathYear: string
  gender: '男' | '女'
  rawText: string
}

export interface OcrDuplicateCandidate {
  tempId: string
  tempName: string
  existingId: number
  existingName: string
  reason: string
}

export interface OcrImportOptions {
  duplicateAction: DuplicateAction
}
