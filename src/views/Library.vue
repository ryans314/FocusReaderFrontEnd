<template>
  <div class="card">
    <h2>Library</h2>
    <div v-if="!userId" style="color: var(--muted)">Please log in to view your library.</div>

    <div v-else>
      <div style="display:flex; gap: 1rem; align-items: end; flex-wrap: wrap;">
        <form @submit.prevent="createDoc" class="card" style="min-width: 280px;">
          <h3 style="margin-top:0">Create Document</h3>
          <label>Name <input v-model="newDocName" placeholder="Document name" required /></label>

          <label>Upload EPUB
            <input ref="fileInput" type="file" accept=".epub,application/epub+zip" @change="onFileChosen" />
          </label>
          <div v-if="fileInfo" style="font-size: .9rem; color: var(--muted); display:flex; align-items:center; gap:.5rem;">
            <span>Selected: {{ fileInfo.name }} ({{ prettyBytes(fileInfo.size) }})</span>
            <button type="button" @click="clearFile">Clear</button>
          </div>

          <div v-if="reading" style="color: var(--muted);">
            Reading file… {{ Math.round(readProgress * 100) }}%
          </div>

          <label v-if="!fileInfo">EPUB Content (advanced)
            <textarea v-model="newDocContent" rows="3" placeholder="Paste Base64 (optional if uploading file)"></textarea>
          </label>

          <button :disabled="pending || creating || !hasLibrary">{{ creating ? 'Creating…' : 'Create' }}</button>
          <p v-if="!hasLibrary" style="color:#fbbf24; margin:.5rem 0 0 0;">
            You don't have a library yet. Create one below to enable document uploads.
          </p>
        </form>

        <div class="card" style="min-width: 300px; flex: 1;">
          <h3 style="margin-top:0">Your Documents</h3>
          <div v-if="pending">Loading…</div>
          <ul>
            <li v-for="doc in docs" :key="doc._id" style="display:flex; gap:.5rem; align-items:center;">
              <strong>{{ doc.name }}</strong>
              <span style="color:var(--muted)">({{ doc._id }})</span>
              <span style="flex:1"></span>
              <button @click="openDoc(doc._id)">Open</button>
              <button @click="removeDoc(doc._id)">Remove</button>
            </li>
          </ul>
        </div>
      </div>
      <div v-if="!hasLibrary" class="card" style="margin-top:1rem;">
        <h3 style="margin-top:0">Set up your library</h3>
        <p>Create your personal library to store documents.</p>
        <button :disabled="pending || creatingLib" @click="createLib">{{ creatingLib ? 'Creating…' : 'Create Library' }}</button>
      </div>
      <div v-if="error" style="color:#f87171; margin-top:.5rem;">{{ error }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { createDocument, createLibrary, getDocumentsInLibrary, getLibraryByUser, removeDocument } from '@/lib/api/endpoints'
import type { Document } from '@/lib/api/types'
import type { AxiosError } from 'axios'

const auth = useAuthStore()
const { userId } = storeToRefs(auth)
const router = useRouter()

const libraryId = ref<string | null>(null)
const docs = ref<Document[]>([])
const pending = ref(false)
const error = ref<string | null>(null)

const newDocName = ref('')
const newDocContent = ref('')
const epubBase64 = ref('')
const fileInfo = ref<{ name: string; size: number } | null>(null)
const creating = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const creatingLib = ref(false)
const readProgress = ref(0)
const reading = ref(false)

const hasLibrary = computed(() => !!libraryId.value)

async function load() {
  if (!userId.value) return
  pending.value = true
  error.value = null
  try {
    const libRes = await getLibraryByUser(userId.value)
    if ('error' in libRes) throw new Error(libRes.error)
    libraryId.value = libRes[0]?.library?._id ?? null
    if (libraryId.value) {
      const docsRes = await getDocumentsInLibrary(libraryId.value)
      if ('error' in docsRes) throw new Error(docsRes.error)
      docs.value = docsRes.map((d) => d.document)
    } else {
      docs.value = []
    }
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to load library'
  } finally {
    pending.value = false
  }
}

async function createDoc() {
  if (!userId.value || !libraryId.value) return
  pending.value = true
  creating.value = true
  error.value = null
  let approximateBytes = 0
  try {
    const content = epubBase64.value || newDocContent.value
    if (!content) throw new Error('Please upload an .epub file or paste Base64 content.')
    approximateBytes = Math.ceil((content.length * 3) / 4)
    const res = await createDocument(newDocName.value, content, libraryId.value)
    if ('error' in res) throw new Error(res.error)
    newDocName.value = ''
    newDocContent.value = ''
    epubBase64.value = ''
    fileInfo.value = null
    if (fileInput.value) fileInput.value.value = ''
    await load()
  } catch (e: any) {
    const apiError = (e as AxiosError<{ error?: string }>)
    const backendMessage = apiError.response?.data?.error
    if (backendMessage) {
      error.value = backendMessage
    } else if (apiError.response?.status === 413) {
      error.value = 'Uploaded file is too large for the server to accept.'
    } else if (apiError.response?.status === 500 && approximateBytes) {
      const mb = (approximateBytes / (1024 * 1024)).toFixed(2)
      error.value = `Server encountered an error processing the EPUB (approx ${mb} MB). Try a smaller file or verify the backend limits.`
    } else {
      error.value = e?.message ?? 'Failed to create document'
    }
  } finally {
    pending.value = false
    creating.value = false
  }
}

async function removeDoc(id: string) {
  if (!libraryId.value) return
  pending.value = true
  try {
    const res = await removeDocument(libraryId.value, id)
    if ('error' in res) throw new Error(res.error)
    await load()
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to remove document'
  } finally {
    pending.value = false
  }
}

onMounted(load)

function prettyBytes(bytes: number) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

async function onFileChosen(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  fileInfo.value = { name: file.name, size: file.size }
  if (!newDocName.value) {
    newDocName.value = file.name.replace(/\.epub$/i, '')
  }
  try {
    const base64 = await readFileAsBase64(file)
    epubBase64.value = base64
  } catch (err: any) {
    error.value = err?.message ?? 'Failed to read file'
  }
}

function clearFile() {
  epubBase64.value = ''
  fileInfo.value = null
  if (fileInput.value) fileInput.value.value = ''
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    readProgress.value = 0
    reading.value = true
    reader.onprogress = (ev) => {
      if (ev.lengthComputable) {
        readProgress.value = ev.loaded / ev.total
      }
    }
    reader.onload = () => {
      reading.value = false
      const result = typeof reader.result === 'string' ? reader.result : ''
      const base64 = result.includes(',') ? result.split(',')[1] : result
      try {
        const sanitized = sanitizeBase64(base64)
        if (!sanitized) {
          reject(new Error('Read empty EPUB content'))
          return
        }
        resolve(sanitized)
      } catch (err: any) {
        reject(err instanceof Error ? err : new Error('Failed to sanitize EPUB Base64'))
      }
    }
    reader.onerror = () => reject(new Error('File read error'))
    reader.readAsDataURL(file)
  })
}

function sanitizeBase64(b64: string): string {
  const trimmed = b64.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!trimmed) return ''
  const remainder = trimmed.length % 4
  if (remainder === 1) throw new Error('Invalid base64 content length')
  if (remainder === 0) return trimmed
  return trimmed.padEnd(trimmed.length + (4 - remainder), '=')
}

async function createLib() {
  if (!userId.value) return
  creatingLib.value = true
  error.value = null
  try {
    const res = await createLibrary(userId.value)
    if ('error' in res) throw new Error(res.error)
    await load()
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to create library'
  } finally {
    creatingLib.value = false
  }
}

function openDoc(id: string) {
  router.push({ name: 'reader-doc', params: { documentId: id } })
}
</script>
