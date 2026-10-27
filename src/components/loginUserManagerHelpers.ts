import type { LoginUser, LoginUserRole } from '../types/auth'

const roleRank: Record<LoginUserRole, number> = { sysadmin: 0, maintainer: 1, user: 2 }
const roleSearch: Record<LoginUserRole, string> = {
  sysadmin: '系统管理员', maintainer: '数据维护人员', user: '普通用户',
}

export function normalizeLoginMobile(mobile: string): string {
  return mobile.trim().replace(/\s+/g, '')
}

export function isLastEnabledSysadmin(users: readonly LoginUser[], target: LoginUser): boolean {
  return target.role === 'sysadmin' && target.enabled
    && users.filter((user) => user.role === 'sysadmin' && user.enabled).length <= 1
}

export function filterLoginUsers(users: readonly LoginUser[], keyword: string): LoginUser[] {
  const query = keyword.trim().toLowerCase()
  return users.filter((user) => !query || [
    user.mobile, String(user.id), user.role, roleSearch[user.role], user.enabled ? '启用' : '禁用',
  ].some((value) => value.toLowerCase().includes(query)))
    .sort((a, b) => roleRank[a.role] - roleRank[b.role] || a.id - b.id)
}
