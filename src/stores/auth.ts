import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authLogin, authLogout } from '@/lib/api/endpoints'
import router from '@/router'

/** Auth store: provides userId, pending, error, and login/logout actions. */
export const useAuthStore = defineStore('auth', () => {
  const STORAGE_KEY_USER = 'focusReader.auth.userId'
  const STORAGE_KEY_SESSION = 'focusReader.auth.sessionId'
  const initial = (typeof window !== 'undefined') ? window.localStorage.getItem(STORAGE_KEY_USER) : null
  const initialSession = (typeof window !== 'undefined') ? window.localStorage.getItem(STORAGE_KEY_SESSION) : null
  const userId = ref<string | null>(initial)
  const sessionId = ref<string | null>(initialSession)
  const pending = ref(false)
  const error = ref('')

  const isAuthed = computed(() => !!userId.value)

  async function login(username: string, password: string) {
    pending.value = true
    error.value = ''
    try {
      const res: any = await authLogin(username, password)
      if (res && res.user && res.session) {
        userId.value = res.user
        sessionId.value = res.session
        try { window.localStorage.setItem(STORAGE_KEY_USER, res.user) } catch {}
        try { window.localStorage.setItem(STORAGE_KEY_SESSION, res.session) } catch {}
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

  async function logout() {
    const sid = sessionId.value
    try {
      if (sid) {
        await authLogout(sid).catch(() => {})
      }
    } catch {}
    userId.value = null
    sessionId.value = null
    try { window.localStorage.removeItem(STORAGE_KEY_USER) } catch {}
    try { window.localStorage.removeItem(STORAGE_KEY_SESSION) } catch {}
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
        window.localStorage.setItem(STORAGE_KEY_USER, id)
      } else {
        window.localStorage.removeItem(STORAGE_KEY_USER)
      }
    } catch {}
  }

  function setSession(id: string | null) {
    sessionId.value = id
    try {
      if (id) {
        window.localStorage.setItem(STORAGE_KEY_SESSION, id)
      } else {
        window.localStorage.removeItem(STORAGE_KEY_SESSION)
      }
    } catch {}
  }

  return { userId, sessionId, pending, error, isAuthed, login, logout, logoutAndRedirect, setUser, setSession }
})

export default useAuthStore
