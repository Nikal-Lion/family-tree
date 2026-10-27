import type { FamilyData } from '../types/member'
import { createSqliteBackup, readSqliteBackup } from './backupService'
import { exportAsJson, parseImportedJson } from './importExport'

export type BackupFormat = 'json' | 'sqlite'
type BackupSource = Pick<File, 'name' | 'text' | 'arrayBuffer'>

export async function readBackupFile(file: BackupSource): Promise<FamilyData> {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'json') return parseImportedJson(await file.text())
  if (extension === 'sqlite' || extension === 'db') {
    return readSqliteBackup(new Uint8Array(await file.arrayBuffer()))
  }
  throw new Error('请选择本系统导出的 JSON 或 SQLite 备份；谱文请使用 Markdown 导入')
}

export async function createBackupDownload(data: FamilyData, format: BackupFormat, date = new Date()) {
  const stamp = date.toISOString().replace(/[:.]/g, '-')
  const blob = format === 'json'
    ? new Blob([exportAsJson(data)], { type: 'application/json;charset=utf-8' })
    : new Blob([new Uint8Array(await createSqliteBackup(data)).buffer], { type: 'application/vnd.sqlite3' })
  return { blob, filename: `family-tree-${stamp}.${format}` }
}

export function downloadBackup(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  try {
    anchor.href = url
    anchor.download = filename
    document.body.append(anchor)
    anchor.click()
  } finally {
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
