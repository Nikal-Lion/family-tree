export type UserRole = 'anonymous' | 'user' | 'maintainer' | 'sysadmin'

export type LoginUserRole = 'user' | 'maintainer' | 'sysadmin'

export interface LoginUser {
  id: number
  mobile: string
  role: LoginUserRole
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface AuthState {
  role: UserRole
  authenticated: boolean
  user: LoginUser | null
}
