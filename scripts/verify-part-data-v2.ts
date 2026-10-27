import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parsePartDataMarkdownV2, type PartDataParsingNote } from '../src/services/partDataImportV2'
import { normalizeFamilyData } from '../src/services/importExport'
import { summarizePartDataImportV2 } from '../src/services/importDiagnostics'

try {
  if (process.argv.length > 3) throw new Error('用法：npm run verify:part-data-v2 -- [Markdown 文件路径]')
  const source = resolve(process.argv[2] ?? 'data/20260501.md')
  const raw = readFileSync(source, 'utf-8')
  const parsingNotes: PartDataParsingNote[] = []
  const data = normalizeFamilyData(parsePartDataMarkdownV2(raw, (note) => parsingNotes.push(note)))
  const report = summarizePartDataImportV2(data, parsingNotes)
  report.totalLines = raw.split(/\r?\n/).length
  console.log(JSON.stringify({
    source,
    summary: {
      members: data.members.length,
      spouses: data.spouses.length,
      childClaims: data.childClaims.length,
      matched: data.childClaims.filter((claim) => claim.status === 'matched').length,
      missing: data.childClaims.filter((claim) => claim.status === 'missing').length,
      ambiguous: data.childClaims.filter((claim) => claim.status === 'ambiguous').length,
      isolated: report.isolatedMembers.length,
      parsingNotes: parsingNotes.length,
    },
    report,
  }, null, 2))
} catch (error) {
  console.error('谱文校验失败：', error)
  process.exitCode = 1
}
