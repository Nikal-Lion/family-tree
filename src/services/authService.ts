import { computed, readonly, ref } from 'vue'
import {
  bootstrapSysadmin,
  changePassword,
  fetchCurrentSession,
  loginAsSysadmin,
  loginWithMobile,
  logoutCurrentSession,
  setSessionToken,
} from './d1ApiService'
import type { LoginUser, UserRole } from '../types/auth'
import { getDefaultAppPath } from './accessControl'
import { validateNewPassword } from './passwordPolicy'

const STORAGE_KEY_SESSION_TOKEN = 'family_auth_session_token'

const role = ref<UserRole>('anonymous')
const user = ref<LoginUser | null>(null)
const ready = ref(false)
let restorePromise: Promise<void> | null = null

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

export function updateCurrentLoginUser(nextUser: LoginUser): boolean {
  if (user.value?.id !== nextUser.id) return false
  if (user.value.mobile !== nextUser.mobile || user.value.role !== nextUser.role || !nextUser.enabled) {
    clearAuthState()
    return true
  }
  applyAuthenticatedUser(nextUser)
  return false
}

function clearAuthState(): void {
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
    try {
      const currentUser = await fetchCurrentSession()
      applyAuthenticatedUser(currentUser)
    } catch {
      clearAuthState()
    } finally {
      ready.value = true
    }
  })()

  return restorePromise
}

export async function loginAsUserByMobile(mobile: string, password: string): Promise<{ ok: boolean; message: string }> {
  const normalized = mobile.trim()
  if (!normalized) {
    return { ok: false, message: '手机号不能为空' }
  }
  if (!password) return { ok: false, message: '密码不能为空' }

  try {
    const session = await loginWithMobile(normalized, password)
    setSessionToken(session.token)
    persistToken(session.token)
    applyAuthenticatedUser(session.user)
    ready.value = true
    return { ok: true, message: '登录成功' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '登录失败' }
  }
}

export async function loginWithSysadminPassword(
  mobile: string,
  password: string,
): Promise<{ ok: boolean; message: string }> {
  const normalizedMobile = mobile.trim()
  if (!normalizedMobile) {
    return { ok: false, message: '手机号不能为空' }
  }
  if (!password) {
    return { ok: false, message: '密码不能为空' }
  }

  try {
    const session = await loginAsSysadmin(normalizedMobile, password)
    if (session.user.role !== 'sysadmin') {
      return { ok: false, message: '当前手机号不是 sysadmin 账号' }
    }

    setSessionToken(session.token)
    persistToken(session.token)
    applyAuthenticatedUser(session.user)
    ready.value = true
    return { ok: true, message: 'sysadmin 登录成功' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '登录失败' }
  }
}

export async function initializeFirstSysadmin(
  mobile: string,
  password: string,
): Promise<{ ok: boolean; message: string }> {
  const normalizedMobile = mobile.trim()
  if (!normalizedMobile) {
    return { ok: false, message: '手机号不能为空' }
  }
  if (!password) {
    return { ok: false, message: '密码不能为空' }
  }

  try {
    const session = await bootstrapSysadmin(normalizedMobile, password)
    setSessionToken(session.token)
    persistToken(session.token)
    applyAuthenticatedUser(session.user)
    ready.value = true
    return { ok: true, message: 'sysadmin 初始化并登录成功' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'sysadmin 初始化失败' }
  }
}

export async function logout(): Promise<void> {
  try {
    await logoutCurrentSession()
  } catch {
    // ignore
  }

  clearAuthState()
  ready.value = true
}

export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean; message: string }> {
  if (!currentPassword) return { ok: false, message: '请输入当前密码' }
  const invalid = validateNewPassword(newPassword)
  if (invalid) return { ok: false, message: invalid }
  if (currentPassword === newPassword) return { ok: false, message: '新密码不能与当前密码相同' }
  try {
    await changePassword(currentPassword, newPassword)
    clearAuthState()
    return { ok: true, message: '密码已修改，请使用新密码重新登录' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '密码修改失败' }
  }
}

export function useAuth() {
  const isAuthenticated = computed(() => role.value !== 'anonymous')
  const needsPasswordChange = computed(() => user.value?.passwordChangeRequired === true)
  const isMaintainer = computed(() => role.value === 'maintainer')
  const isSysadmin = computed(() => role.value === 'sysadmin' && !needsPasswordChange.value)
  const canMaintain = computed(() => !needsPasswordChange.value && (role.value === 'maintainer' || role.value === 'sysadmin'))

  function resolveDefaultAppPath(): string {
    return needsPasswordChange.value ? '/change-password' : getDefaultAppPath(role.value)
  }

  return {
    role: readonly(role),
    user: readonly(user),
    ready: readonly(ready),
    isAuthenticated: readonly(isAuthenticated),
    needsPasswordChange: readonly(needsPasswordChange),
    isMaintainer: readonly(isMaintainer),
    isSysadmin: readonly(isSysadmin),
    canMaintain: readonly(canMaintain),
    resolveDefaultAppPath,
  }
}
