import { computed, readonly, ref } from 'vue'
import {
  bootstrapSysadmin,
  ApiError,
  fetchCurrentSession,
  loginAsSysadmin,
  loginWithMobile,
  logoutCurrentSession,
  setSessionToken,
} from './d1ApiService'
import type { LoginUser, UserRole } from '../types/auth'
import { getDefaultAppPath } from './accessControl'

const STORAGE_KEY_SESSION_TOKEN = 'family_auth_session_token'

const role = ref<UserRole>('anonymous')
const user = ref<LoginUser | null>(null)
const ready = ref(false)
let restorePromise: Promise<void> | null = null
let authEpoch = 0

export interface LoginResult {
  ok: boolean
  message: string
  code?: string
}

export function cancelPendingLogin(): void {
  ++authEpoch
}

function loginFailure(error: unknown, fallback: string): LoginResult {
  return {
    ok: false,
    message: error instanceof Error ? error.message : fallback,
    ...(error instanceof ApiError && error.code ? { code: error.code } : {}),
  }
}

function restorePersistedToken(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY_SESSION_TOKEN)
    return value && value.trim() ? value.trim() : null
  } catch {
    return null
  }
}

function persistToken(token: string | null): void {
  try {
    if (token && token.trim()) {
      localStorage.setItem(STORAGE_KEY_SESSION_TOKEN, token.trim())
    } else {
      localStorage.removeItem(STORAGE_KEY_SESSION_TOKEN)
    }
  } catch {
    // ignore
  }
}

function applyAuthenticatedUser(nextUser: LoginUser): void {
  user.value = nextUser
  role.value = nextUser.role
}

export function updateCurrentLoginUser(nextUser: LoginUser): void {
  const current = user.value
  if (current?.id !== nextUser.id) return
  if (current.role !== nextUser.role || current.mobile !== nextUser.mobile || current.enabled !== nextUser.enabled) {
    clearAuthState()
    return
  }
  applyAuthenticatedUser(nextUser)
}

function clearAuthState(): void {
  cancelPendingLogin()
  user.value = null
  role.value = 'anonymous'
  setSessionToken(null)
  persistToken(null)
}

export async function initAuthSession(): Promise<void> {
  if (ready.value) {
    return
  }

  if (restorePromise) {
    return restorePromise
  }

  restorePromise = (async () => {
    const token = restorePersistedToken()
    if (!token) {
      clearAuthState()
      ready.value = true
      return
    }

    setSessionToken(token)
    const started = authEpoch
    try {
      const currentUser = await fetchCurrentSession()
      if (started !== authEpoch) return
      applyAuthenticatedUser(currentUser)
    } catch {
      if (started === authEpoch) clearAuthState()
    } finally {
      ready.value = true
    }
  })()

  return restorePromise
}

export async function loginAsUserByMobile(mobile: string, password?: string): Promise<LoginResult> {
  return authenticate(mobile, password, 'login')
}

async function authenticate(mobile: string, password: string | undefined, mode: 'login' | 'sysadmin' | 'bootstrap'): Promise<LoginResult> {
  const started = ++authEpoch
  const normalized = mobile.trim().replace(/\s+/g, '')
  if (!normalized) {
    return { ok: false, message: '手机号不能为空' }
  }
  if (!/^\+?\d{6,20}$/.test(normalized)) {
    return { ok: false, message: '请输入有效的手机号（可含国际区号，6–20 位数字）' }
  }
  if (mode !== 'login' && !password) return { ok: false, message: '密码不能为空' }

  try {
    const session = mode === 'bootstrap'
      ? await bootstrapSysadmin(normalized, password!)
      : mode === 'sysadmin'
        ? await loginAsSysadmin(normalized, password!)
        : await loginWithMobile(normalized, password)
    if (started !== authEpoch) return { ok: false, message: '登录信息已更改，请重新登录', code: 'AUTH_REQUEST_CANCELLED' }
    if (mode === 'sysadmin' && session.user.role !== 'sysadmin') {
      return { ok: false, message: '当前手机号不是 sysadmin 账号' }
    }
    setSessionToken(session.token)
    persistToken(session.token)
    applyAuthenticatedUser(session.user)
    ready.value = true
    return { ok: true, message: '登录成功' }
  } catch (error) {
    if (started !== authEpoch) return { ok: false, message: '登录信息已更改，请重新登录', code: 'AUTH_REQUEST_CANCELLED' }
    return loginFailure(error, '登录失败')
  }
}

export async function loginWithSysadminPassword(
  mobile: string,
  password: string,
): Promise<LoginResult> {
  return authenticate(mobile, password, 'sysadmin')
}

export async function initializeFirstSysadmin(
  mobile: string,
  password: string,
): Promise<LoginResult> {
  return authenticate(mobile, password, 'bootstrap')
}

export async function logout(): Promise<void> {
  cancelPendingLogin()
  try {
    await logoutCurrentSession()
  } catch {
    // ignore
  }
  clearAuthState()
  ready.value = true
}

export function useAuth() {
  const isAuthenticated = computed(() => role.value !== 'anonymous')
  const isMaintainer = computed(() => role.value === 'maintainer')
  const isSysadmin = computed(() => role.value === 'sysadmin')
  const canMaintain = computed(() => role.value === 'maintainer' || role.value === 'sysadmin')

  function resolveDefaultAppPath(): string {
    return getDefaultAppPath(role.value)
  }

  return {
    role: readonly(role),
    user: readonly(user),
    ready: readonly(ready),
    isAuthenticated: readonly(isAuthenticated),
    isMaintainer: readonly(isMaintainer),
    isSysadmin: readonly(isSysadmin),
    canMaintain: readonly(canMaintain),
    resolveDefaultAppPath,
  }
}
