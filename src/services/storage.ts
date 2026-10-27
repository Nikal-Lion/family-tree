import type { FamilyData } from '../types/member'
import { loadFamilyDataFromD1, saveFamilyDataToD1 } from './d1ApiService'
import { createEmptyFamilyData, normalizeFamilyData } from './importExport'

export const STORAGE_KEY = 'family_tree_app_data'

export async function initializeStorage(): Promise<FamilyData> {
  const data = await loadFamilyDataFromD1()
  return data ? normalizeFamilyData(data) : createEmptyFamilyData()
}

export async function saveFamilyData(data: FamilyData): Promise<void> {
  await saveFamilyDataToD1(normalizeFamilyData(data))
}

export { createSqliteBackup as exportSqliteData, readSqliteBackup as importSqliteData } from './backupService'
