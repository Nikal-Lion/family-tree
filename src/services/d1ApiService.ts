import type { FamilyData } from '../types/member'

const D1_API_BASE_URL = import.meta.env.VITE_D1_API_BASE_URL?.trim()
const D1_API_TOKEN = import.meta.env.VITE_D1_API_TOKEN?.trim()

export interface D1SelfCheckResult {
  ok: boolean
  status: 'ok' | 'warning' | 'error'
  checkedAt: string
  apiBaseUrl: string | null
  tokenConfigured: boolean
  httpStatus: number | null
  message: string
  memberCount: number
  trackCount: number
  eventCount: number
  schemaVersion: number | null
}

function getApiBaseUrl(): string | null {
  if (!D1_API_BASE_URL) {
    return null
  }
  return D1_API_BASE_URL.replace(/\/$/, '')
}

function requireApiBaseUrl(): string {
  const baseUrl = getApiBaseUrl()
  if (!baseUrl) {
    throw new Error('未配置 D1 API 地址，请设置 VITE_D1_API_BASE_URL')
  }
  return baseUrl
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

function buildFamilyDataRequestUrl(base: string): string {
  const requestUrl = new URL(`${base}/api/family-data`)
  requestUrl.searchParams.set('_ts', Date.now().toString())
  return requestUrl.toString()
}

export function getD1ApiDiagnosticsConfig(): { apiBaseUrl: string | null; tokenConfigured: boolean } {
  return {
    apiBaseUrl: getApiBaseUrl(),
    tokenConfigured: Boolean(D1_API_TOKEN),
  }
}

export async function runD1SelfCheck(): Promise<D1SelfCheckResult> {
  const checkedAt = new Date().toISOString()
  const base = getApiBaseUrl()

  if (!base) {
    return {
      ok: false,
      status: 'error',
      checkedAt,
      apiBaseUrl: null,
      tokenConfigured: Boolean(D1_API_TOKEN),
      httpStatus: null,
      message: '未配置 VITE_D1_API_BASE_URL，前端当前无法访问 D1 Worker。',
      memberCount: 0,
      trackCount: 0,
      eventCount: 0,
      schemaVersion: null,
    }
  }

  try {
    const response = await fetch(buildFamilyDataRequestUrl(base), {
      method: 'GET',
      headers: buildHeaders(),
      cache: 'no-store',
    })

    if (!response.ok) {
      const text = await response.text()
      const unauthorized = response.status === 401
      return {
        ok: false,
        status: 'error',
        checkedAt,
        apiBaseUrl: base,
        tokenConfigured: Boolean(D1_API_TOKEN),
        httpStatus: response.status,
        message: text || (unauthorized ? 'Worker 已响应，但鉴权失败。' : `Worker 请求失败（${response.status}）`),
        memberCount: 0,
        trackCount: 0,
        eventCount: 0,
        schemaVersion: null,
      }
    }

    const payload = (await response.json()) as { data: FamilyData | null }
    const data = payload.data

    return {
      ok: true,
      status: data ? 'ok' : 'warning',
      checkedAt,
      apiBaseUrl: base,
      tokenConfigured: Boolean(D1_API_TOKEN),
      httpStatus: response.status,
      message: data ? '已连接到 D1，且成功读取到云端数据。' : '已连接到 D1，但数据库当前为空。',
      memberCount: data?.members.length ?? 0,
      trackCount: data?.tracks.length ?? 0,
      eventCount: data?.events.length ?? 0,
      schemaVersion: data?.schemaVersion ?? null,
    }
  } catch (error) {
    return {
      ok: false,
      status: 'error',
      checkedAt,
      apiBaseUrl: base,
      tokenConfigured: Boolean(D1_API_TOKEN),
      httpStatus: null,
      message: error instanceof Error ? error.message : '无法连接到 D1 Worker。',
      memberCount: 0,
      trackCount: 0,
      eventCount: 0,
      schemaVersion: null,
    }
  }
}

export async function loadFamilyDataFromD1(): Promise<FamilyData | null> {
  const base = requireApiBaseUrl()
  const response = await fetch(buildFamilyDataRequestUrl(base), {
    method: 'GET',
    headers: buildHeaders(),
    cache: 'no-store',
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