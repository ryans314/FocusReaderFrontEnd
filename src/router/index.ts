import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const routes: RouteRecordRaw[] = [
  { path: '/', alias: ['/library'], name: 'library', component: () => import('@/views/Library.vue') },
  { path: '/landing', name: 'landing', component: () => import('@/views/Landing.vue') },
  { path: '/login', name: 'login', redirect: { name: 'landing', query: { modal: 'login' } } },
  { path: '/signup', name: 'signup', redirect: { name: 'landing', query: { modal: 'signup' } } },
  { path: '/reader', name: 'reader', component: () => import('@/views/Reader.vue') },
  { path: '/reader/:documentId', name: 'reader-doc', component: () => import('@/views/DocumentReader.vue') },
  { path: '/annotations', name: 'annotations', component: () => import('@/views/Annotations.vue') },
  { path: '/stats', name: 'stats', component: () => import('@/views/Stats.vue') }
  ,{ path: '/profile', name: 'profile', component: () => import('@/views/Profile.vue') }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// Global auth guard: unauthenticated users can only access landing, login, signup
router.beforeEach((to) => {
  const auth = useAuthStore()
  const isAuthed = !!auth.userId
  if (!isAuthed) {
    const allowed = new Set(['landing', 'login', 'signup'])
    if (!allowed.has(String(to.name || ''))) {
      return { name: 'landing' }
    }
  } else {
    // Authenticated users should not see landing; redirect to library
    if (to.name === 'landing') {
      return { name: 'library' }
    }
  }
})

export default router
