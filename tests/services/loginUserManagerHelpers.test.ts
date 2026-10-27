import { describe, expect, it } from 'vitest'
import { filterLoginUsers, isLastEnabledSysadmin, normalizeLoginMobile } from '../../src/components/loginUserManagerHelpers'
import type { LoginUser } from '../../src/types/auth'

function account(id: number, role: LoginUser['role'], enabled = true): LoginUser {
  return { id, mobile: `+85212345${id}`, role, enabled, createdAt: '', updatedAt: '' }
}

describe('login account management presentation', () => {
  it('keeps old and international account formats without an eleven-digit restriction', () => {
    expect(normalizeLoginMobile(' 123456 ')).toBe('123456')
    expect(normalizeLoginMobile(' +852 1234 5678 ')).toBe('+85212345678')
    expect(normalizeLoginMobile(' legacy-account ')).toBe('legacy-account')
    expect(normalizeLoginMobile('   ')).toBe('')
  })

  it('protects the last enabled administrator, excluding disabled administrators', () => {
    const admin = account(1, 'sysadmin')
    const disabled = account(2, 'sysadmin', false)
    expect(isLastEnabledSysadmin([admin, disabled], admin)).toBe(true)
    expect(isLastEnabledSysadmin([admin, disabled], disabled)).toBe(false)
    expect(isLastEnabledSysadmin([admin, account(3, 'sysadmin')], admin)).toBe(false)
    expect(isLastEnabledSysadmin([account(4, 'maintainer')], account(4, 'maintainer'))).toBe(false)
    expect(isLastEnabledSysadmin([], admin)).toBe(true)
  })

  it('searches all accounts before pagination and sorts without mutating input', () => {
    const users = [account(7, 'user'), account(3, 'maintainer'), account(2, 'sysadmin', false), account(1, 'sysadmin')]
    expect(filterLoginUsers(users, '').map((user) => user.id)).toEqual([1, 2, 3, 7])
    expect(users.map((user) => user.id)).toEqual([7, 3, 2, 1])
    expect(filterLoginUsers(users, ' 系统管理员 ').map((user) => user.id)).toEqual([1, 2])
    expect(filterLoginUsers(users, 'MAINTAINER').map((user) => user.id)).toEqual([3])
    expect(filterLoginUsers(users, '禁用').map((user) => user.id)).toEqual([2])
    expect(filterLoginUsers(users, '+852123457').map((user) => user.id)).toEqual([7])
    expect(filterLoginUsers(users, '不存在')).toEqual([])
  })
})
