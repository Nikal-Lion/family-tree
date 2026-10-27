import type { UserRole } from '../types/auth'

export type WorkspaceMode = 'overview' | 'manage' | 'system'

export interface WorkspaceEntry {
  mode: WorkspaceMode
  path: string
  title: string
  description: string
  roles: UserRole[]
}

export const workspaceEntries: WorkspaceEntry[] = [
  {
    mode: 'overview',
    path: '/app/overview',
    title: '族谱总览',
    description: '浏览家族世系、人物档案与家族记事',
    roles: ['user', 'maintainer', 'sysadmin'],
  },
  {
    mode: 'manage',
    path: '/app/manage',
    title: '数据维护',
    description: '维护族人、事件与轨迹，核对和导入谱文资料',
    roles: ['maintainer', 'sysadmin'],
  },
  {
    mode: 'system',
    path: '/app/system',
    title: '系统管理',
    description: '管理登录账号与角色，查看云端存储连接状态',
    roles: ['sysadmin'],
  },
]

export function getWorkspaceEntries(role: UserRole): WorkspaceEntry[] {
  return workspaceEntries.filter((entry) => entry.roles.includes(role))
}

export function getDefaultAppPath(role: UserRole): string {
  if (role === 'sysadmin' || role === 'maintainer') return '/app/manage'
  return role === 'user' ? '/app/overview' : '/login'
}

export function resolveLoginRedirect(redirect: unknown, role: UserRole): string {
  if (
    typeof redirect !== 'string'
    || !redirect.startsWith('/')
    || redirect.startsWith('//')
    || /[\\\u0000-\u0020]/.test(redirect)
  ) {
    return getDefaultAppPath(role)
  }

  const url = new URL(redirect, 'https://family-tree.invalid')
  const allowed = getWorkspaceEntries(role).some((entry) => entry.path === url.pathname)
  return allowed ? `${url.pathname}${url.search}${url.hash}` : getDefaultAppPath(role)
}
