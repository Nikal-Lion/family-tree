export type UserRole = 'admin' | 'viewer'

export interface AuthState {
  role: UserRole
  /** 管理员会话是否已通过密码验证 */
  authenticated: boolean
}

/**
 * 存储在 localStorage 中的管理员密码哈希。
 * 首次使用时由管理员设置，后续登录需验证。
 */
export interface AuthConfig {
  /** SHA-256 hex of the admin password */
  passwordHash: string
}
