<template>
  <div class="card">
    <h2>Focus Stats</h2>
    <div v-if="!userId" style="color: var(--muted)">Login to view stats.</div>
    <div v-else>
      <div style="display:flex; gap:1rem; flex-wrap: wrap; align-items:flex-start;">
        <div class="card" style="min-width: 280px; flex: 1 1 320px;">
          <h3 style="margin-top:0">Overview</h3>
          <button @click="load">Refresh</button>
          <div v-if="statsSummary" style="margin-top:.5rem;">
            <div>Total sessions: <strong>{{ statsSummary.totalSessions }}</strong></div>
            <div>Total time: <strong>{{ formatDuration(statsSummary.totalMs) }}</strong></div>
            <div>Average session: <strong>{{ formatDuration(statsSummary.avgMs) }}</strong></div>
            <div>Last session: <strong>{{ statsSummary.lastSessionDate }}</strong></div>
          </div>
        </div>
        <div class="card" style="min-width: 380px; flex: 2 1 520px;">
          <h3 style="margin-top:0">Sessions</h3>
          <div style="margin:.5rem 0; display:flex; gap:.5rem; align-items:center; flex-wrap:wrap;">
            <label style="font-size:.9rem; color:var(--muted);">Filter:</label>
            <select v-model="selectedDocId" style="padding:.25rem; font-size:.95rem;">
              <option value="">All documents</option>
              <option v-for="d in docList" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
          </div>
          <div v-if="sessionsSorted.length === 0" style="color:var(--muted)">No sessions yet.</div>
          <ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:.5rem;">
            <li v-for="s in sessionsSorted" :key="s._id" style="display:flex; gap:.75rem; align-items:baseline; border-bottom:1px dashed #e5e7eb; padding:.4rem 0;">
              <div style="flex:1 1 auto;">
                <div style="font-weight:600;">{{ docName(s.document) }}</div>
                <div style="color:var(--muted); font-size:.9rem; line-height:1.1;">
                  <div>{{ formatDateOnly(s.startTime) }}</div>
                  <div>{{ formatTimeRange(s.startTime, s.endTime) }}</div>
                </div>
              </div>
              <div style="min-width: 140px; text-align:right; display:flex; flex-direction:column; gap:.25rem; align-items:flex-end;">
                <div>
                  <span v-if="s.endTime">{{ formatDuration(sessionDurationMs(s)) }}</span>
                  <span v-else style="color:#d97706">active…</span>
                </div>
                <div>
                  <button @click="onDeleteSession(s._id)" :disabled="deletingSessions[s._id]" style="font-size:.8rem; padding:.2rem .5rem;">
                    <span v-if="!deletingSessions[s._id]">Delete</span>
                    <span v-else>Deleting…</span>
                  </button>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </div>
      <div v-if="error" style="color:#f87171; margin-top:.5rem;">{{ error }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { viewStats, getSessions, getDocumentDetails, removeSession } from '@/lib/api/endpoints'
import type { FocusSession, FocusStats } from '@/lib/api/types'
import { options } from 'node_modules/axios/index.cjs'

const auth = useAuthStore()
const { userId } = storeToRefs(auth)

const overview = ref<FocusStats | null>(null)
const sessions = ref<FocusSession[]>([])
const error = ref('')
const docNames = ref<Record<string, string>>({})
const deletingSessions = ref<Record<string, boolean>>({})

const selectedDocId = ref('')

const sessionsFiltered = computed(() => {
  if (!selectedDocId.value) return sessions.value
  return sessions.value.filter(s => s.document === selectedDocId.value)
})

const sessionsSorted = computed(() => {
  const copy = [...sessionsFiltered.value]
  copy.sort((a, b) => {
    const aEnd = a.endTime ? new Date(a.endTime).getTime() : new Date(a.startTime).getTime()
    const bEnd = b.endTime ? new Date(b.endTime).getTime() : new Date(b.startTime).getTime()
    return bEnd - aEnd
  })
  return copy
})

  const statsSummary = computed(() => {
  if (!sessionsFiltered.value.length) return null
  const ended = sessionsFiltered.value.filter(s => !!s.endTime)
  const totalMs = ended.reduce((acc, s) => acc + (new Date(s.endTime as string).getTime() - new Date(s.startTime).getTime()), 0)
  const avgMs = ended.length ? Math.round(totalMs / ended.length) : 0
  const last = sessionsSorted.value[0]
  return {
    totalSessions: sessionsFiltered.value.length,
    totalMs,
    avgMs,
    lastSessionDate: last ? formatShortDate(last.endTime || last.startTime) : '—'
  }
})

const docList = computed(() => {
  // produce a sorted array of { id, name }
  const entries = Object.entries(docNames.value)
  const arr = entries.map(([id, name]) => ({ id, name }))
  arr.sort((a, b) => a.name.localeCompare(b.name))
  return arr
})

function formatDuration(ms: number) {
  if (!ms || ms < 0) return '0m'
  const sec = Math.floor(ms / 1000)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m ${s}s`
  return `${s}s`
}

function formatShortDate(d: string | Date | undefined | null) {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  try {
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }
    const parts = new Intl.DateTimeFormat(undefined, opts).formatToParts(date as Date)
    const map: Record<string, string> = {}
    for (const p of parts) {
      if (p.type && p.value) map[p.type] = p.value
    }
    const month = map.month || ''
    const day = map.day || ''
    const year = map.year || ''
    const hour = map.hour || ''
    const minute = map.minute || ''
    const dayPeriod = (map.dayPeriod || '').toLowerCase()
    const time = `${hour}:${minute}${dayPeriod ? dayPeriod : ''}`
    return `${month} ${day}, ${year} ${time}`
  } catch {
    return new Date(d as string).toLocaleString()
  }
}

function formatDateOnly(d: string | Date | undefined | null) {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  try {
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
    const parts = new Intl.DateTimeFormat(undefined, opts).formatToParts(date as Date)
    const map: Record<string, string> = {}
    for (const p of parts) if (p.type && p.value) map[p.type] = p.value
    const month = map.month || ''
    const day = map.day || ''
    const year = map.year || ''
    return `${month} ${day}, ${year}`
  } catch {
    return new Date(d as string).toLocaleDateString()
  }
}

function formatTimeShort(d: string | Date | undefined | null) {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  try {
    const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true }
    const parts = new Intl.DateTimeFormat(undefined, opts).formatToParts(date as Date)
    const map: Record<string, string> = {}
    for (const p of parts) if (p.type && p.value) map[p.type] = p.value
    const hour = map.hour || ''
    const minute = map.minute || ''
    const dayPeriod = (map.dayPeriod || '').toLowerCase()
    return `${hour}:${minute}${dayPeriod ? dayPeriod : ''}`
  } catch {
    return new Date(d as string).toLocaleTimeString()
  }
}

function formatTimeRange(start: string | Date | undefined | null, end: string | Date | undefined | null) {
  const s = formatTimeShort(start)
  if (!end) return `${s} - active…`
  const e = formatTimeShort(end)
  return `${s} - ${e}`
}

function sessionDurationMs(s: FocusSession) {
  if (!s.endTime) return 0
  return new Date(s.endTime).getTime() - new Date(s.startTime).getTime()
}

function docName(id: string) {
  return docNames.value[id] || id
}

async function onDeleteSession(id: string) {
  if (!id) return
  try {
    if (!confirm('Delete this session? This cannot be undone.')) return
    deletingSessions.value[id] = true
    const res: any = await removeSession(id)
    if (res && (res.error)) {
      throw new Error(res.error)
    }
    // remove locally
    sessions.value = sessions.value.filter(s => s._id !== id)
  } catch (e: any) {
    error.value = e?.message || 'Failed to delete session'
  } finally {
    try { delete deletingSessions.value[id] } catch {}
  }
}

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

    // Fetch document names for all referenced documents (deduped)
    const ids = Array.from(new Set(sessions.value.map(ss => ss.document)))
    const nameMap: Record<string, string> = { ...docNames.value }
    for (const id of ids) {
      if (nameMap[id]) continue
      try {
        const dres = await getDocumentDetails(id)
        if (Array.isArray(dres) && dres[0]?.document) {
          nameMap[id] = dres[0].document.name
        }
      } catch {}
    }
    docNames.value = nameMap
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to load stats'
  }
}

onMounted(load)
</script>
