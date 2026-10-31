import { createRouter, createWebHistory } from 'vue-router'
import { getDefaultAppPath, resolveLoginRedirect, workspaceEntries } from '../services/accessControl'
import { initAuthSession, useAuth } from '../services/authService'
import type { UserRole } from '../types/auth'

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: (_to, _from, savedPosition) => savedPosition ?? { left: 0, top: 0 },
  routes: [
    { path: '/', redirect: '/app' },
    { path: '/login', component: () => import('../pages/LoginPage.vue'), meta: { title: '登录' } },
    { path: '/change-password', component: () => import('../pages/ChangePasswordPage.vue'), meta: { title: '修改密码', requiresAuth: true } },
    {
      path: '/app',
      component: () => import('../layouts/WorkspaceLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', name: 'AppEntry', component: { render: () => null } },
        ...workspaceEntries.map((entry) => ({
          path: entry.mode,
          component: entry.mode === 'manage'
            ? () => import('../pages/ManagePage.vue')
            : entry.mode === 'system'
              ? () => import('../pages/SystemPage.vue')
              : () => import('../pages/FamilyWorkspace.vue'),
          meta: { title: entry.title, description: entry.description, allowedRoles: entry.roles },
        })),
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/app' },
  ],
})

router.beforeEach(async (to) => {
  await initAuthSession()
  const { isAuthenticated, role, needsPasswordChange } = useAuth()
  if (to.meta.requiresAuth && !isAuthenticated.value) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  if (isAuthenticated.value && needsPasswordChange.value && to.path !== '/change-password') {
    return '/change-password'
  }
  if (to.name === 'AppEntry') return getDefaultAppPath(role.value)
  const allowedRoles = to.meta.allowedRoles as UserRole[] | undefined
  if (allowedRoles && !allowedRoles.includes(role.value)) return getDefaultAppPath(role.value)
  if (to.path === '/login' && isAuthenticated.value) {
    return resolveLoginRedirect(to.query.redirect, role.value)
  }
  return true
})

router.afterEach((to) => {
  document.title = `${to.meta.title ?? '族谱'} · 家族云谱`
})

export default router
