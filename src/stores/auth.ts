import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authenticate } from '@/lib/api/endpoints'

/** Auth store: provides userId, pending, error, and login/logout actions. */
export const useAuthStore = defineStore('auth', () => {
  const userId = ref<string | null>(null)
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
  }

  function setUser(id: string | null) {
    userId.value = id
  }

  return { userId, pending, error, isAuthed, login, logout, setUser }
})

export default useAuthStore
