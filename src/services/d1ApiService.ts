import type { LoginUser, LoginUserRole } from '../types/auth'
import type { FamilyData } from '../types/member'
import type { ChildClaim } from '../types/childClaim'
import type { Spouse } from '../types/spouse'

const API_BASE_URL = import.meta.env.VITE_D1_API_BASE_URL?.trim()

let sessionToken: string | null = null

export interface D1SelfCheckResult {
  ok: boolean
  status: 'ok' | 'warning' | 'error'
  checkedAt: string
  tokenConfigured: boolean
  httpStatus: number | null
  message: string
  memberCount: number
  trackCount: number
  eventCount: number
  schemaVersion: number | null
}

interface ApiErrorPayload {
  error?: string
}

function resolveApiUrl(pathname: string): string {
  const base = API_BASE_URL && API_BASE_URL.length > 0 ? API_BASE_URL : location.origin
  return new URL(pathname, base).toString()
}

function buildHeaders(options?: { includeAuth?: boolean; extra?: HeadersInit }): Headers {
  const headers = new Headers(options?.extra)
  headers.set('Content-Type', 'application/json')

  if (options?.includeAuth === false) {
    return headers
  }

  if (sessionToken) {
    headers.set('Authorization', `Bearer ${sessionToken}`)
  }

  return headers
}

async function parseError(response: Response): Promise<string> {
  const fallback = `请求失败（${response.status}）`
  const text = await response.text()
  if (!text) {
    return fallback
  }

  try {
    const payload = JSON.parse(text) as ApiErrorPayload
    if (payload.error && payload.error.trim()) {
      return payload.error
    }
  } catch {
    // Keep plain text fallback.
  }

  return text || fallback
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(await parseError(response))
  }
  return (await response.json()) as T
}

function buildFamilyDataUrl(): string {
  const url = new URL(resolveApiUrl('/api/family-data'))
  url.searchParams.set('_ts', Date.now().toString())
  return url.toString()
}

export function setSessionToken(token: string | null): void {
  sessionToken = token?.trim() || null
}

export function getD1ApiDiagnosticsConfig(): { tokenConfigured: boolean } {
  return {
    tokenConfigured: Boolean(sessionToken),
  }
}

export async function runD1SelfCheck(): Promise<D1SelfCheckResult> {
  const checkedAt = new Date().toISOString()

  try {
    const response = await fetch(buildFamilyDataUrl(), {
      method: 'GET',
      headers: buildHeaders(),
      cache: 'no-store',
    })

    if (!response.ok) {
      return {
        ok: false,
        status: 'error',
        checkedAt,
        tokenConfigured: Boolean(sessionToken),
        httpStatus: response.status,
        message: await parseError(response),
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
      tokenConfigured: Boolean(sessionToken),
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
      tokenConfigured: Boolean(sessionToken),
      httpStatus: null,
      message: error instanceof Error ? error.message : '无法连接到 D1 Worker。',
      memberCount: 0,
      trackCount: 0,
      eventCount: 0,
      schemaVersion: null,
    }
  }
}

// TODO Worker side: /api/spouses route not yet implemented in cloudflare-d1-worker repo
async function fetchSpousesFromD1(): Promise<Spouse[]> {
  try {
    const response = await fetch(resolveApiUrl('/api/spouses'), {
      method: 'GET',
      headers: buildHeaders(),
      cache: 'no-store',
    })
    if (!response.ok) {
      console.warn(`[D1] /api/spouses responded ${response.status} — using empty spouses array`)
      return []
    }
    const payload = (await response.json()) as { spouses?: Spouse[] }
    return Array.isArray(payload.spouses) ? payload.spouses : []
  } catch (error) {
    console.warn('[D1] fetchSpousesFromD1 failed, using empty array:', error)
    return []
  }
}

// TODO Worker side: /api/child-claims route not yet implemented in cloudflare-d1-worker repo
async function fetchChildClaimsFromD1(): Promise<ChildClaim[]> {
  try {
    const response = await fetch(resolveApiUrl('/api/child-claims'), {
      method: 'GET',
      headers: buildHeaders(),
      cache: 'no-store',
    })
    if (!response.ok) {
      console.warn(`[D1] /api/child-claims responded ${response.status} — using empty childClaims array`)
      return []
    }
    const payload = (await response.json()) as { childClaims?: ChildClaim[] }
    return Array.isArray(payload.childClaims) ? payload.childClaims : []
  } catch (error) {
    console.warn('[D1] fetchChildClaimsFromD1 failed, using empty array:', error)
    return []
  }
}

export async function loadFamilyDataFromD1(): Promise<FamilyData | null> {
  const response = await fetch(buildFamilyDataUrl(), {
    method: 'GET',
    headers: buildHeaders(),
    cache: 'no-store',
  })

  const payload = await parseJsonResponse<{ data: FamilyData | null }>(response)
  if (!payload.data) {
    return null
  }

  // Fetch spouses and child_claims in parallel from dedicated endpoints.
  // If Worker endpoints are not yet deployed (404 / network error), fall back to
  // whatever the main payload already contains (or empty arrays).
  const [spouses, childClaims] = await Promise.all([
    fetchSpousesFromD1(),
    fetchChildClaimsFromD1(),
  ])

  return {
    ...payload.data,
    // Strip legacy spouse_ids field from each member if present (v3 payload compat).
    members: payload.data.members.map(({ ...member }) => {
      delete (member as Record<string, unknown>)['spouseIds']
      return member
    }),
    spouses: spouses.length > 0 ? spouses : (payload.data.spouses ?? []),
    childClaims: childClaims.length > 0 ? childClaims : (payload.data.childClaims ?? []),
  }
}

// TODO Worker side: /api/sync-spouses route not yet implemented in cloudflare-d1-worker repo
export async function syncSpousesToD1(spouses: Spouse[]): Promise<void> {
  try {
    const response = await fetch(resolveApiUrl('/api/sync-spouses'), {
      method: 'PUT',
      headers: buildHeaders(),
      body: JSON.stringify({ spouses }),
    })
    if (!response.ok) {
      console.warn(`[D1] syncSpousesToD1 responded ${response.status} — spouses not persisted to D1`)
    }
  } catch (error) {
    console.warn('[D1] syncSpousesToD1 failed (Worker endpoint not yet available):', error)
  }
}

// TODO Worker side: /api/sync-child-claims route not yet implemented in cloudflare-d1-worker repo
export async function syncChildClaimsToD1(childClaims: ChildClaim[]): Promise<void> {
  try {
    const response = await fetch(resolveApiUrl('/api/sync-child-claims'), {
      method: 'PUT',
      headers: buildHeaders(),
      body: JSON.stringify({ childClaims }),
    })
    if (!response.ok) {
      console.warn(`[D1] syncChildClaimsToD1 responded ${response.status} — childClaims not persisted to D1`)
    }
  } catch (error) {
    console.warn('[D1] syncChildClaimsToD1 failed (Worker endpoint not yet available):', error)
  }
}

export async function saveFamilyDataToD1(data: FamilyData): Promise<void> {
  const response = await fetch(resolveApiUrl('/api/family-data'), {
    method: 'PUT',
    headers: buildHeaders(),
    body: JSON.stringify({ data }),
  })

  if (!response.ok) {
    throw new Error(await parseError(response))
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

interface LoginResponsePayload {
  ok: boolean
  token: string
  expiresAt: string
  user: LoginUser
}

interface LoginUserListPayload {
  users: LoginUser[]
}

interface LoginUserPayload {
  ok: boolean
  user: LoginUser
}

export async function loginWithMobile(mobile: string): Promise<{ user: LoginUser; token: string; expiresAt: string }> {
  const response = await fetch(resolveApiUrl('/api/auth/login'), {
    method: 'POST',
    headers: buildHeaders({ includeAuth: false }),
    body: JSON.stringify({ mobile }),
  })

  const payload = await parseJsonResponse<LoginResponsePayload>(response)
  return { user: payload.user, token: payload.token, expiresAt: payload.expiresAt }
}

export async function loginAsSysadmin(
  mobile: string,
  password: string,
): Promise<{ user: LoginUser; token: string; expiresAt: string }> {
  const response = await fetch(resolveApiUrl('/api/auth/login'), {
    method: 'POST',
    headers: buildHeaders({ includeAuth: false }),
    body: JSON.stringify({ mobile, password }),
  })

  const payload = await parseJsonResponse<LoginResponsePayload>(response)
  return { user: payload.user, token: payload.token, expiresAt: payload.expiresAt }
}

export async function bootstrapSysadmin(
  mobile: string,
  password: string,
): Promise<{ user: LoginUser; token: string; expiresAt: string }> {
  const response = await fetch(resolveApiUrl('/api/auth/bootstrap-sysadmin'), {
    method: 'POST',
    headers: buildHeaders({ includeAuth: false }),
    body: JSON.stringify({ mobile, password }),
  })

  const payload = await parseJsonResponse<LoginResponsePayload>(response)
  return { user: payload.user, token: payload.token, expiresAt: payload.expiresAt }
}

export async function fetchCurrentSession(): Promise<LoginUser> {
  const response = await fetch(resolveApiUrl('/api/auth/session'), {
    method: 'GET',
    headers: buildHeaders(),
  })

  const payload = await parseJsonResponse<{ ok: boolean; user: LoginUser }>(response)
  return payload.user
}

export async function logoutCurrentSession(): Promise<void> {
  await fetch(resolveApiUrl('/api/auth/logout'), {
    method: 'POST',
    headers: buildHeaders(),
  })
}

export async function listLoginUsers(): Promise<LoginUser[]> {
  const response = await fetch(resolveApiUrl('/api/login-users'), {
    method: 'GET',
    headers: buildHeaders(),
  })

  const payload = await parseJsonResponse<LoginUserListPayload>(response)
  return payload.users
}

export async function createLoginUser(input: {
  mobile: string
  role: LoginUserRole
}): Promise<LoginUser> {
  const response = await fetch(resolveApiUrl('/api/login-users'), {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(input),
  })

  const payload = await parseJsonResponse<LoginUserPayload>(response)
  return payload.user
}

export async function updateLoginUser(
  id: number,
  input: Partial<{ mobile: string; role: LoginUserRole; enabled: boolean }>,
): Promise<LoginUser> {
  const response = await fetch(resolveApiUrl(`/api/login-users/${id}`), {
    method: 'PUT',
    headers: buildHeaders(),
    body: JSON.stringify(input),
  })

  const payload = await parseJsonResponse<LoginUserPayload>(response)
  return payload.user
}

export async function deleteLoginUser(id: number): Promise<void> {
  const response = await fetch(resolveApiUrl(`/api/login-users/${id}`), {
    method: 'DELETE',
    headers: buildHeaders(),
  })

  if (!response.ok) {
    throw new Error(await parseError(response))
  }
}
