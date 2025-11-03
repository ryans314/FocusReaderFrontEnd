import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authenticate } from '@/lib/api/endpoints'
import router from '@/router'

/** Auth store: provides userId, pending, error, and login/logout actions. */
export const useAuthStore = defineStore('auth', () => {
  const STORAGE_KEY = 'focusReader.auth.userId'
  const initial = (typeof window !== 'undefined') ? window.localStorage.getItem(STORAGE_KEY) : null
  const userId = ref<string | null>(initial)
  const pending = ref(false)
  const error = ref('')

  const isAuthed = computed(() => !!userId.value)

  async function login(username: string, password: string) {
    pending.value = true
    error.value = ''
    try {
      const res: any = await authenticate(username, password)
      if (res && res.user) {
        userId.value = res.user
        try { window.localStorage.setItem(STORAGE_KEY, res.user) } catch {}
        return res
      }
      if (res && res.error) {
        error.value = res.error
      } else {
        error.value = 'Authentication failed'
      }
    } catch (e: any) {
      error.value = e?.message || 'Network error'
    } finally {
      pending.value = false
    }
  }

  function logout() {
    userId.value = null
    try { window.localStorage.removeItem(STORAGE_KEY) } catch {}
  }

  // Ensure logout also redirects to the landing page for safety when called from
  // places other than the main nav. Keep routing logic here to centralize behavior.
  function logoutAndRedirect() {
    logout()
    try { router.push({ name: 'landing' }) } catch {}
  }

  function setUser(id: string | null) {
    userId.value = id
    try {
      if (id) {
        window.localStorage.setItem(STORAGE_KEY, id)
      } else {
        window.localStorage.removeItem(STORAGE_KEY)
      }
    } catch {}
  }

  return { userId, pending, error, isAuthed, login, logout, logoutAndRedirect, setUser }
})

export default useAuthStore
