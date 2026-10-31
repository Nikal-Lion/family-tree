interface RateLimitDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ results?: T[] }>
    }
  }
}

export interface AuthPayload {
  mobile: string
  password: string
  newPassword?: string
}

const WINDOW_SECONDS = 15 * 60
const SOURCE_LIMIT = 30
const ACCOUNT_LIMIT = 10
const MAX_BODY_BYTES = 4096

function reject(message: string, status: number, code: string, retryAfter?: number): Response {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' }
  if (retryAfter !== undefined) headers['Retry-After'] = String(retryAfter)
  return Response.json({ error: message, code }, { status, headers })
}

function sourceIdentity(request: Request): string {
  // Only Cloudflare supplies request.cf. Local/non-Cloudflare requests share a
  // conservative bucket; user-supplied forwarding headers must not select it.
  const cf = (request as Request & { cf?: unknown }).cf
  if (!cf || typeof cf !== 'object') return 'unknown-source'
  const address = request.headers.get('CF-Connecting-IP')?.trim() ?? ''
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) {
    const parts = address.split('.').map(Number)
    if (parts.every((part) => part <= 255)) return parts.join('.')
  }
  if (address.length <= 45 && /^[0-9a-f:.]+$/i.test(address) && address.includes(':')) {
    try {
      return new URL(`http://[${address}]/`).hostname.toLowerCase()
    } catch {
      // Missing or malformed platform source metadata shares the fallback.
    }
  }
  return 'unknown-source'
}

async function consume(
  db: RateLimitDatabase,
  dimension: string,
  identity: string,
  limit: number,
): Promise<Response | null> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${dimension}:${identity}`))
  const key = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const now = Math.floor(Date.now() / 1000)
  // Reservation and decision use the same SQLite write, not a read-then-write.
  const result = await db.prepare(`
    INSERT INTO auth_rate_limits (bucket_key, attempts, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(bucket_key) DO UPDATE SET
      attempts = CASE WHEN expires_at <= ? THEN 1 ELSE MIN(attempts + 1, ?) END,
      expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
    RETURNING attempts, expires_at
  `).bind(key, now + WINDOW_SECONDS, now, limit + 1, now)
    .all<{ attempts: number; expires_at: number }>()
  const row = result.results?.[0]
  if (!row || !Number.isInteger(row.attempts) || !Number.isInteger(row.expires_at)) {
    throw new Error('Rate limit reservation unavailable')
  }
  if (row.attempts <= limit) return null
  return reject('登录尝试过于频繁，请稍后重试', 429, 'AUTH_RATE_LIMITED', Math.max(1, row.expires_at - now))
}

export async function readAuthJson(request: Request): Promise<Record<string, unknown> | Response> {
  if (Number(request.headers.get('Content-Length')) > MAX_BODY_BYTES) {
    return reject('登录请求体过大', 413, 'AUTH_BODY_TOO_LARGE')
  }
  const reader = request.body?.getReader()
  if (!reader) return reject('请求体格式错误', 400, 'BAD_REQUEST')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {})
        return reject('登录请求体过大', 413, 'AUTH_BODY_TOO_LARGE')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  let payload: unknown
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return reject('请求体格式错误', 400, 'BAD_REQUEST')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return reject('请求体格式错误', 400, 'BAD_REQUEST')
  }
  return payload as Record<string, unknown>
}

async function readPayload(request: Request, accountMobile?: string): Promise<AuthPayload | Response> {
  const payload = await readAuthJson(request)
  if (payload instanceof Response) return payload
  const rawMobile = accountMobile ?? payload.mobile
  const password = (accountMobile === undefined ? payload.password : payload.currentPassword) ?? ''
  if (typeof rawMobile !== 'string' || rawMobile.length > 64) {
    return reject('手机号格式无效', 400, 'INVALID_MOBILE')
  }
  const mobile = rawMobile.trim().replace(/\s+/g, '')
  if (!/^\+?[0-9]{6,20}$/.test(mobile)) {
    return reject('手机号格式无效', 400, 'INVALID_MOBILE')
  }
  if (typeof password !== 'string' || password.length > 1024) {
    return reject('密码必须为不超过 1024 字符的文本', 400, 'INVALID_PASSWORD')
  }
  if (accountMobile !== undefined && typeof payload.newPassword !== 'string') {
    return reject('请输入新密码', 400, 'INVALID_PASSWORD')
  }
  return { mobile, password, ...(accountMobile === undefined ? {} : { newPassword: payload.newPassword as string }) }
}

export async function guardAuthentication(
  request: Request,
  db: RateLimitDatabase,
  accountMobile?: string,
): Promise<AuthPayload | Response> {
  try {
    // Kept ahead of the application's schema/auth queries and password work.
    await db.prepare(`CREATE TABLE IF NOT EXISTS auth_rate_limits (
      bucket_key TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`).bind().all()
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_expiry ON auth_rate_limits(expires_at)').bind().all()
    await db.prepare(`DELETE FROM auth_rate_limits WHERE bucket_key IN (
      SELECT bucket_key FROM auth_rate_limits WHERE expires_at <= ? LIMIT 100
    )`).bind(Math.floor(Date.now() / 1000)).all()
    const sourceDenied = await consume(db, 'source', sourceIdentity(request), SOURCE_LIMIT)
    if (sourceDenied) return sourceDenied
    const payload = await readPayload(request, accountMobile)
    if (payload instanceof Response) return payload
    const accountDenied = await consume(db, 'account', payload.mobile, ACCOUNT_LIMIT)
    return accountDenied ?? payload
  } catch {
    return reject('登录限流服务暂不可用，请稍后重试', 503, 'AUTH_RATE_LIMIT_UNAVAILABLE', 60)
  }
}
