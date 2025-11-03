<template>
  <form @submit.prevent="onSubmit">
    <label>Username <input v-model="username" required /></label>
    <label>Password <input type="password" v-model="password" required /></label>
    <div style="display:flex; gap:.5rem; align-items:center;">
      <button :disabled="pending" type="submit">{{ pending ? 'Logging in…' : 'Login' }}</button>
      <RouterLink to="/signup">Create an account</RouterLink>
      <span v-if="error" style="color:#f87171">{{ error }}</span>
    </div>
  </form>
</template>

<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const { pending, error, isAuthed } = storeToRefs(auth)
const router = useRouter()

const username = ref('')
const password = ref('')

async function onSubmit() {
  try {
    await auth.login(username.value, password.value)
  } catch {}
}

watchEffect(() => {
  if (isAuthed.value) router.replace('/')
})
</script>
