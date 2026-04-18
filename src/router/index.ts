import { createRouter, createWebHistory } from 'vue-router'
import LoginPage from '../pages/LoginPage.vue'
import FamilyWorkspace from '../pages/FamilyWorkspace.vue'
import { initAuthSession, useAuth } from '../services/authService'

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
      component: FamilyWorkspace,
      meta: {
        requiresAuth: true,
      },
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/login',
    },
  ],
})

router.beforeEach(async (to) => {
  await initAuthSession()
  const { isAuthenticated } = useAuth()

  if (to.meta.requiresAuth && !isAuthenticated.value) {
    return {
      path: '/login',
      query: {
        redirect: to.fullPath,
      },
    }
  }

  if (to.path === '/login' && isAuthenticated.value) {
    const redirectRaw = typeof to.query.redirect === 'string' ? to.query.redirect : '/app'
    const redirectPath = redirectRaw.startsWith('/') ? redirectRaw : '/app'
    return redirectPath
  }

  return true
})

export default router
