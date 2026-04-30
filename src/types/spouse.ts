export type SpouseRelation = '配' | '继配' | '妣' | '继妣' | '三妣' | '四妣' | '娶' | '其他'
// 注：不收录裸 `继`，避免与主语行 `继子`、子女声明 `（出继）` 冲突；后续配偶仅识别 `继配`/`继妣`

export type SpouseStatusFlag = 'early-deceased' | 'lost-record' | 'out-married'

export interface Spouse {
  id: number
  husbandId: number
  surname: string
  fullName: string | null
  aliases: string[]
  relationLabel: SpouseRelation
  order: number
  birthDate: string
  deathDate: string
  burialPlace: string
  biography: string
  statusFlags: SpouseStatusFlag[]
  rawText: string
  createdAt: string
  updatedAt: string
}

export interface SpouseInput {
  husbandId: number
  surname: string
  fullName: string | null
  aliases: string[]
  relationLabel: SpouseRelation
  order: number
  birthDate: string
  deathDate: string
  burialPlace: string
  biography: string
  statusFlags: SpouseStatusFlag[]
  rawText: string
}
