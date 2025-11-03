<template>
  <div class="card">
    <h2>Create Account</h2>
    <form @submit.prevent="onSubmit">
      <label>Username <input v-model.trim="username" required /></label>
      <label>Password <input type="password" v-model="password" required minlength="8" /></label>
      <label>Confirm Password <input type="password" v-model="confirm" required minlength="8" /></label>
      <div style="display:flex; gap:.5rem; align-items:center;">
        <button :disabled="pending" type="submit">{{ pending ? 'Creating…' : 'Create Account' }}</button>
        <RouterLink to="/login">Have an account? Log in</RouterLink>
      </div>
      <p v-if="hint" style="color: var(--muted); margin:.5rem 0 0 0;">{{ hint }}</p>
      <p v-if="error" style="color:#f87171; margin:.5rem 0 0 0;">{{ error }}</p>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { createAccount, createLibrary, initUserFocusStats, createUserSettings } from '@/lib/api/endpoints'
import { useAuthStore } from '@/stores/auth'

const username = ref('')
const password = ref('')
const confirm = ref('')
const pending = ref(false)
const error = ref('')
const hint = ref('Password must be at least 8 characters (per API spec).')

const router = useRouter()
const auth = useAuthStore()

async function onSubmit() {
  error.value = ''
  if (password.value.length < 8) {
    error.value = 'Password must be at least 8 characters.'
    return
  }
  if (password.value !== confirm.value) {
    error.value = 'Passwords do not match.'
    return
  }
  pending.value = true
  try {
    const res = await createAccount(username.value, password.value)
    if ('error' in res) throw new Error(res.error)
    const createdUserId = res.user

    // Best-effort: create Library and initialize FocusStats for the new user
    try {
      const libRes = await createLibrary(createdUserId)
      if ('error' in libRes) {
        // Non-fatal: continue, the user can create it manually later
        // eslint-disable-next-line no-console
        console.warn('createLibrary failed:', libRes.error)
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('createLibrary error:', e)
    }

    try {
      const fsRes = await initUserFocusStats(createdUserId)
      if ('error' in fsRes) {
        // eslint-disable-next-line no-console
        console.warn('initUserFocusStats failed:', fsRes.error)
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('initUserFocusStats error:', e)
    }

    // Create default TextSettings for the new user (Times New Roman, 16px, 24px line height)
    try {
      const settingsRes = await createUserSettings('"Times New Roman", Times, serif', 16, 24, createdUserId)
      if ('error' in settingsRes) {
        // Non-fatal
        console.warn('createUserSettings failed:', settingsRes.error)
      }
    } catch (e) {
      console.warn('createUserSettings error:', e)
    }
    // Optionally auto-login the new account
    try {
      await auth.login(username.value, password.value)
      router.replace('/')
    } catch {
      // If authenticate fails for any reason, fall back to Login page.
      router.replace('/login')
    }
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to create account.'
  } finally {
    pending.value = false
  }
}
</script>
