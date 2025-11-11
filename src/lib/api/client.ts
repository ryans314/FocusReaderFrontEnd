import axios from 'axios'

export const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'

export const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' }
})

// Attach simple logging in development
api.interceptors.response.use(
  (resp: any) => resp,
  (err: any) => {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error('API error:', err?.response?.data || err.message)
    }
    return Promise.reject(err)
  }
)
