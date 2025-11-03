import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'library', component: () => import('@/views/Library.vue') },
  { path: '/login', name: 'login', component: () => import('@/views/Login.vue') },
  { path: '/signup', name: 'signup', component: () => import('@/views/Signup.vue') },
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

export default router
