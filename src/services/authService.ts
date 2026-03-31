import { ref, readonly } from 'vue'
import type { UserRole } from '../types/auth'

const STORAGE_KEY_HASH = 'family_admin_password_hash'
const STORAGE_KEY_SESSION = 'family_auth_session'

// --------------- Reactive state ---------------

const currentRole = ref<UserRole>(restoreSession())
const isAdmin = ref(currentRole.value === 'admin')

function restoreSession(): UserRole {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY_SESSION)
    if (saved === 'admin') return 'admin'
  } catch {
    // ignore
  }
  return 'viewer'
}

function persistSession(role: UserRole): void {
  try {
    if (role === 'admin') {
      sessionStorage.setItem(STORAGE_KEY_SESSION, 'admin')
    } else {
      sessionStorage.removeItem(STORAGE_KEY_SESSION)
    }
  } catch {
    // ignore
  }
}

// --------------- Password helpers ---------------

async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

function getSavedHash(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_HASH)
  } catch {
    return null
  }
}

function saveHash(hash: string): void {
  try {
    localStorage.setItem(STORAGE_KEY_HASH, hash)
  } catch {
    // ignore
  }
}

// --------------- Public API ---------------

/**
 * 检查是否已设置过管理员密码
 */
export function hasAdminPassword(): boolean {
  return getSavedHash() !== null
}

/**
 * 首次设置管理员密码（仅在尚未设置时可用）
 */
export async function setupAdminPassword(password: string): Promise<{ ok: boolean; message: string }> {
  if (!password || password.length < 4) {
    return { ok: false, message: '密码不能少于 4 个字符' }
  }

  if (hasAdminPassword()) {
    return { ok: false, message: '管理员密码已设置，请使用登录功能' }
  }

  const hash = await sha256Hex(password)
  saveHash(hash)

  currentRole.value = 'admin'
  isAdmin.value = true
  persistSession('admin')

  return { ok: true, message: '管理员密码设置成功' }
}

/**
 * 管理员登录验证
 */
export async function loginAsAdmin(password: string): Promise<{ ok: boolean; message: string }> {
  const savedHash = getSavedHash()
  if (!savedHash) {
    return { ok: false, message: '尚未设置管理员密码' }
  }

  const hash = await sha256Hex(password)
  if (hash !== savedHash) {
    return { ok: false, message: '密码错误' }
  }

  currentRole.value = 'admin'
  isAdmin.value = true
  persistSession('admin')

  return { ok: true, message: '登录成功' }
}

/**
 * 修改管理员密码（需要验证旧密码）
 */
export async function changeAdminPassword(
  oldPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; message: string }> {
  const savedHash = getSavedHash()
  if (!savedHash) {
    return { ok: false, message: '尚未设置管理员密码' }
  }

  const oldHash = await sha256Hex(oldPassword)
  if (oldHash !== savedHash) {
    return { ok: false, message: '旧密码错误' }
  }

  if (!newPassword || newPassword.length < 4) {
    return { ok: false, message: '新密码不能少于 4 个字符' }
  }

  const newHash = await sha256Hex(newPassword)
  saveHash(newHash)

  return { ok: true, message: '密码修改成功' }
}

/**
 * 退出管理员身份，切换为浏览者
 */
export function logout(): void {
  currentRole.value = 'viewer'
  isAdmin.value = false
  persistSession('viewer')
}

/**
 * 获取当前角色（只读响应式）
 */
export function useAuth() {
  return {
    role: readonly(currentRole),
    isAdmin: readonly(isAdmin),
  }
}
