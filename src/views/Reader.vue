<template>
  <div class="card">
    <h2>Reader Session</h2>
    <div v-if="!userId" style="color: var(--muted)">Login to start a session.</div>
    <div v-else>
      <form @submit.prevent>
        <label>Document ID <input v-model="documentId" placeholder="document id" /></label>
        <label>Library ID <input v-model="libraryId" placeholder="library id" /></label>
        <div style="display:flex; gap:.5rem;">
          <button @click="start">Start Session</button>
          <button @click="end">End Session</button>
        </div>
      </form>
      <p v-if="sessionId">Active session: {{ sessionId }}</p>
      <div v-if="error" style="color:#f87171">{{ error }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { openDocument, closeDocument } from '@/lib/api/endpoints'
import { startSession, endSession } from '@/lib/api/endpoints'

const auth = useAuthStore()
const { userId } = storeToRefs(auth)

const documentId = ref('')
const libraryId = ref('')
const sessionId = ref('')
const error = ref('')

async function start() {
  error.value = ''
  if (!userId.value || !documentId.value || !libraryId.value) return
  try {
    const open = await openDocument(userId.value, documentId.value)
    if ('error' in open) throw new Error(open.error)
    const res = await startSession(userId.value, documentId.value, libraryId.value)
    if ('error' in res) throw new Error(res.error)
    sessionId.value = res.focusSession
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to start session'
  }
}

async function end() {
  error.value = ''
  if (!sessionId.value || !documentId.value || !userId.value) return
  try {
    const res = await endSession(sessionId.value)
    if ('error' in res) throw new Error(res.error)
    await closeDocument(userId.value, documentId.value)
    sessionId.value = ''
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to end session'
  }
}
</script>
