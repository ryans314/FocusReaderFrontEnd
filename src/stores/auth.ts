import { defineStore } from 'pinia'
import { authenticate } from '@/lib/api/endpoints'
import type { ID } from '@/lib/api/types'

interface AuthState {
  userId: ID | null
  username: string | null
  pending: boolean
  error: string | null
}

const STORAGE_KEY = 'focus-reader-auth'

function loadPersistedAuth() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { userId?: ID | null; username?: string | null }
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.userId || typeof parsed.userId !== 'string') return null
    return {
      userId: parsed.userId as ID,
      username: typeof parsed.username === 'string' ? parsed.username : null
    }
  } catch {
    return null
  }
}

function persistAuth(payload: { userId: ID | null; username: string | null }) {
  if (typeof window === 'undefined') return
  try {
    if (payload.userId) {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ userId: payload.userId, username: payload.username })
      )
    } else {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // Swallow storage errors (quota/private mode etc.)
  }
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => {
    const persisted = loadPersistedAuth()
    return {
      userId: persisted?.userId ?? null,
      username: persisted?.username ?? null,
      pending: false,
      error: null
    }
  },
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
        persistAuth({ userId: this.userId, username: this.username })
      } catch (e: any) {
        this.error = e?.message ?? 'Login failed'
        this.userId = null
        this.username = null
        persistAuth({ userId: null, username: null })
        throw e
      } finally {
        this.pending = false
      }
    },
    logout() {
      this.userId = null
      this.username = null
      this.error = null
      persistAuth({ userId: null, username: null })
    },
    hydrate() {
      const persisted = loadPersistedAuth()
      if (persisted) {
        this.userId = persisted.userId
        this.username = persisted.username
      }
    }
  }
})
