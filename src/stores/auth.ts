import { defineStore } from 'pinia'
import { authenticate } from '@/lib/api/endpoints'
import type { ID } from '@/lib/api/types'

interface AuthState {
  userId: ID | null
  username: string | null
  pending: boolean
  error: string | null
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({ userId: null, username: null, pending: false, error: null }),
  getters: {
    isAuthed: (s: AuthState) => !!s.userId
  },
  actions: {
    async login(username: string, password: string) {
      this.pending = true
      this.error = null
      try {
        const res = await authenticate(username, password)
        if ('error' in res) throw new Error(res.error)
        this.userId = res.user
        this.username = username
      } catch (e: any) {
        this.error = e?.message ?? 'Login failed'
        this.userId = null
        this.username = null
        throw e
      } finally {
        this.pending = false
      }
    },
    logout() {
      this.userId = null
      this.username = null
      this.error = null
    }
  }
})
