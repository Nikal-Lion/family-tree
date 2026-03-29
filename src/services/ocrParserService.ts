import type { TempMember } from '../types/ocr'

function makeTempId(index: number): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `tmp-${Date.now()}-${index}`
}

function extract(pattern: RegExp, line: string): string {
  const match = line.match(pattern)
  return match?.[1]?.trim() ?? ''
}

function inferGender(line: string): '男' | '女' {
  if (/妻|母|女|氏/.test(line)) {
    return '女'
  }
  return '男'
}

function parseLineToTempMember(line: string, index: number): TempMember | null {
  const name = extract(/(?:姓名|名)[:：]?\s*([\u4e00-\u9fa5]{2,6})/, line)
  const fallbackName = extract(/^([\u4e00-\u9fa5]{2,6})[，,\s]/, `${line} `)
  const resolvedName = name || fallbackName

  if (!resolvedName) {
    return null
  }

  const fatherName = extract(/(?:父|父亲)[:：]?\s*([\u4e00-\u9fa5]{2,6})/, line)
  const motherName = extract(/(?:母|母亲)[:：]?\s*([\u4e00-\u9fa5]{2,6})/, line)
  const spouseName = extract(/(?:配偶|配|妻|夫|娶)[:：]?\s*([\u4e00-\u9fa5]{2,6})/, line)
  const birthYear = extract(/(?:生于|生年|出生)[:：]?\s*([^，,；;\s]+)/, line)
  const deathYear = extract(/(?:卒于|卒年|去世)[:：]?\s*([^，,；;\s]+)/, line)

  return {
    tempId: makeTempId(index),
    name: resolvedName,
    fatherName,
    motherName,
    spouseName,
    birthYear,
    deathYear,
    gender: inferGender(line),
    rawText: line,
  }
}

export function parseTempMembersFromText(rawText: string): TempMember[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const parsed = lines
    .map((line, index) => parseLineToTempMember(line, index))
    .filter((item): item is TempMember => item !== null)

  if (parsed.length > 0) {
    return parsed
  }

  const fallback = rawText.trim()
  if (!fallback) {
    return []
  }

  return [
    {
      tempId: makeTempId(0),
      name: '',
      fatherName: '',
      motherName: '',
      spouseName: '',
      birthYear: '',
      deathYear: '',
      gender: '男',
      rawText: fallback,
    },
  ]
}
