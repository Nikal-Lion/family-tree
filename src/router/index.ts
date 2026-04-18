import { createRouter, createWebHistory } from 'vue-router'
import LoginPage from '../pages/LoginPage.vue'
import FamilyWorkspace from '../pages/FamilyWorkspace.vue'
import { initAuthSession, useAuth } from '../services/authService'
import type { UserRole } from '../types/auth'

interface RouteMetaWithRoles {
  requiresAuth?: boolean
  allowedRoles?: UserRole[]
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/login',
    },
    {
      path: '/login',
      component: LoginPage,
    },
    {
      path: '/app',
      redirect: '/app/overview',
    },
    {
      path: '/app/overview',
      component: FamilyWorkspace,
      props: {
        mode: 'overview',
      },
      meta: {
        requiresAuth: true,
        allowedRoles: ['user', 'maintainer', 'sysadmin'],
      } satisfies RouteMetaWithRoles,
    },
    {
      path: '/app/manage',
      component: FamilyWorkspace,
      props: {
        mode: 'manage',
      },
      meta: {
        requiresAuth: true,
        allowedRoles: ['maintainer', 'sysadmin'],
      } satisfies RouteMetaWithRoles,
    },
    {
      path: '/app/system',
      component: FamilyWorkspace,
      props: {
        mode: 'system',
      },
      meta: {
        requiresAuth: true,
        allowedRoles: ['sysadmin'],
      } satisfies RouteMetaWithRoles,
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/login',
    },
  ],
})

router.beforeEach(async (to) => {
  await initAuthSession()
  const { isAuthenticated, role, resolveDefaultAppPath } = useAuth()

  if (to.path === '/app') {
    if (!isAuthenticated.value) {
      return {
        path: '/login',
        query: {
          redirect: to.fullPath,
        },
      }
    }
    return resolveDefaultAppPath()
  }

  if (to.meta.requiresAuth && !isAuthenticated.value) {
    return {
      path: '/login',
      query: {
        redirect: to.fullPath,
      },
    }
  }

  const routeMeta = (to.meta ?? {}) as RouteMetaWithRoles
  if (routeMeta.allowedRoles?.length) {
    const currentRole = role.value
    if (!routeMeta.allowedRoles.includes(currentRole)) {
      return resolveDefaultAppPath()
    }
  }

  if (to.path === '/login' && isAuthenticated.value) {
    const redirectRaw = typeof to.query.redirect === 'string' ? to.query.redirect : resolveDefaultAppPath()
    const redirectPath = redirectRaw.startsWith('/') ? redirectRaw : resolveDefaultAppPath()
    return redirectPath
  }

  return true
})

export default router
