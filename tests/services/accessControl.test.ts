import { describe, expect, it } from 'vitest'
import { getDefaultAppPath, getWorkspaceEntries, resolveLoginRedirect } from '../../src/services/accessControl'
import type { UserRole } from '../../src/types/auth'

describe('workspace role access', () => {
  it.each<[UserRole, string[], string]>([
    ['anonymous', [], '/login'],
    ['user', ['overview'], '/app/overview'],
    ['maintainer', ['overview', 'manage'], '/app/manage'],
    ['sysadmin', ['overview', 'manage', 'system'], '/app/manage'],
  ])('%s gets only its permitted entries and default route', (role, modes, defaultPath) => {
    expect(getWorkspaceEntries(role).map((entry) => entry.mode)).toEqual(modes)
    expect(getDefaultAppPath(role)).toBe(defaultPath)
  })
})

describe('login redirects', () => {
  it.each([
    undefined,
    ['/app/manage'],
    'https://example.com',
    '//example.com/app/manage',
    '/login',
    '/app',
    '/unknown',
    '/app/manage/../system',
    '/\\example.com/app/manage',
    '/\\[',
    '/\n/example.com/app/overview',
    '/\t/example.com/app/overview',
  ])('falls back for invalid or unauthorized redirect %s', (redirect) => {
    expect(resolveLoginRedirect(redirect, 'user')).toBe('/app/overview')
  })

  it('preserves an allowed destination, query, and selected-member hash', () => {
    expect(resolveLoginRedirect('/app/overview?member=12#detail', 'user'))
      .toBe('/app/overview?member=12#detail')
  })

  it('rejects sysadmin routes for a maintainer', () => {
    expect(resolveLoginRedirect('/app/system', 'maintainer')).toBe('/app/manage')
  })

  it('restores sysadmin destinations after login', () => {
    expect(resolveLoginRedirect('/app/system', 'sysadmin')).toBe('/app/system')
  })

  it('rejects a backslash-normalized external address even for sysadmin', () => {
    expect(resolveLoginRedirect('/\\example.com/app/system', 'sysadmin')).toBe('/app/manage')
  })
})
