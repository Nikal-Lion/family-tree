import type { FamilyData } from '../types/member'

const D1_API_BASE_URL = import.meta.env.VITE_D1_API_BASE_URL?.trim()
const D1_API_TOKEN = import.meta.env.VITE_D1_API_TOKEN?.trim()

function requireApiBaseUrl(): string {
  if (!D1_API_BASE_URL) {
    throw new Error('未配置 D1 API 地址，请设置 VITE_D1_API_BASE_URL')
  }
  return D1_API_BASE_URL.replace(/\/$/, '')
}

function buildHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra)
  headers.set('Content-Type', 'application/json')
  if (D1_API_TOKEN) {
    headers.set('Authorization', `Bearer ${D1_API_TOKEN}`)
  }
  return headers
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `D1 请求失败（${response.status}）`)
  }
  return (await response.json()) as T
}

export async function loadFamilyDataFromD1(): Promise<FamilyData | null> {
  const base = requireApiBaseUrl()
  const response = await fetch(`${base}/api/family-data`, {
    method: 'GET',
    headers: buildHeaders(),
  })

  const payload = await parseJsonResponse<{ data: FamilyData | null }>(response)
  return payload.data
}

export async function saveFamilyDataToD1(data: FamilyData): Promise<void> {
  const base = requireApiBaseUrl()
  const response = await fetch(`${base}/api/family-data`, {
    method: 'PUT',
    headers: buildHeaders(),
    body: JSON.stringify({ data }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `D1 写入失败（${response.status}）`)
  }
}

export async function exportD1BackupBinary(): Promise<Uint8Array> {
  const data = await loadFamilyDataFromD1()
  const encoded = new TextEncoder().encode(JSON.stringify(data ?? null, null, 2))
  return encoded
}

export async function importD1BackupBinary(binary: Uint8Array): Promise<FamilyData> {
  const raw = new TextDecoder().decode(binary)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('导入失败：备份文件不是有效 JSON')
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('导入失败：备份数据结构错误')
  }

  const data = parsed as FamilyData
  await saveFamilyDataToD1(data)
  return data
}