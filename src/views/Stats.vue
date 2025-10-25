<template>
  <div class="card">
    <h2>Focus Stats</h2>
    <div v-if="!userId" style="color: var(--muted)">Login to view stats.</div>
    <div v-else>
      <div style="display:flex; gap:1rem; flex-wrap: wrap;">
        <div class="card" style="min-width: 280px;">
          <h3 style="margin-top:0">Overview</h3>
          <button @click="load">Refresh</button>
          <pre v-if="overview" style="white-space: pre-wrap">{{ overview }}</pre>
        </div>
        <div class="card" style="min-width: 320px; flex:1;">
          <h3 style="margin-top:0">Sessions</h3>
          <ul>
            <li v-for="s in sessions" :key="s._id">
              <code>{{ s._id }}</code>
              <span> — {{ new Date(s.startTime).toLocaleString() }} → {{ s.endTime ? new Date(s.endTime).toLocaleString() : 'active' }}</span>
            </li>
          </ul>
        </div>
      </div>
      <div v-if="error" style="color:#f87171">{{ error }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { viewStats, getSessions } from '@/lib/api/endpoints'
import type { FocusSession, FocusStats } from '@/lib/api/types'

const auth = useAuthStore()
const { userId } = storeToRefs(auth)

const overview = ref<FocusStats | null>(null)
const sessions = ref<FocusSession[]>([])
const error = ref('')

async function load() {
  if (!userId.value) return
  error.value = ''
  try {
    const o = await viewStats(userId.value)
    if ('error' in o) throw new Error(o.error)
    overview.value = o[0]?.focusStats ?? null

    const s = await getSessions(userId.value)
    if ('error' in s) throw new Error(s.error)
    sessions.value = s.map((x) => x.focusSession)
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to load stats'
  }
}

onMounted(load)
</script>
