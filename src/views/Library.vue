<template>
  <div class="card-no-background">
    <h2 style="margin-top: 0;">Library</h2>
    <div v-if="!userId" style="color: var(--muted)">Please log in to view your library.</div>

    <div v-else>
      <div style="display:flex; gap: 1rem; align-items: center; justify-content: space-between;">
        <div style="display:flex; gap:.5rem; align-items:center;">
          <h3 style="margin:0">Your Documents</h3>
        </div>
        <div>
          <button @click="showCreate = true" title="Add document" style="">＋ Add Document</button>
        </div>
      </div>
      <div style="margin-top:.5rem">
        <div class="card-no-background" style="min-width: 300px; flex: 1;">
          <div v-if="pending">Loading…</div>
          <div v-else-if="hasLibrary && docs.length === 0" class="" style=" text-align:center;">
            <div style="font-weight:600">No documents uploaded yet</div>
            <div style="color:var(--muted); margin-top:.5rem">Add a document to get started.</div>
            <div style="margin-top:.75rem"><button @click="showCreate = true">＋ Add document</button></div>
          </div>
          <div v-else class="docs-grid">
            <div v-for="doc in docs" :key="doc._id" class="doc-card card">
              <div class="doc-card-inner">
                <div class="doc-preview-area">
                  <div class="doc-preview" :ref="el => setPreviewEl(el, doc._id)"></div>
                  <div v-if="!previewLoaded[doc._id]" class="doc-preview-placeholder">
                    <div style="padding:8px; color:var(--muted); font-size:.9rem;">No preview</div>
                    <div style="display:flex; gap:.5rem;">
                      <button @click="togglePreview(doc)">{{ previewLoading[doc._id] ? 'Loading…' : 'Show preview' }}</button>
                    </div>
                  </div>
                </div>
                <div style="padding:.5rem; display:flex; flex-direction:column; gap:.5rem;">
                  <div style="font-weight:600;">{{ doc.name }}</div>
                  <div style="display:flex; gap:.5rem;">
                    <button @click="openDoc(doc._id)">Open</button>
                    <button @click="renameDoc(doc._id)">Rename</button>
                    <button @click="removeDoc(doc._id)">Remove</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Create modal overlay (with fade transition) -->
      <transition name="fade">
        <div v-if="showCreate" @click.self="showCreate = false" class="create-overlay">
          <div class="card create-panel">
            <button type="button" class="create-close" style="color: var(--muted);" @click="showCreate = false" aria-label="Close">✕</button>
            <form @submit.prevent="createDoc">
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

              <div style="display:flex; gap:.5rem; margin-top:.5rem;">
                <button :disabled="pending || creating || !hasLibrary" type="submit">{{ creating ? 'Creating…' : 'Create' }}</button>
                <button type="button" @click="showCreate = false">Cancel</button>
              </div>
              <p v-if="!hasLibrary" style="color:#fbbf24; margin:.5rem 0 0 0;">
                You don't have a library yet. Create one below to enable document uploads.
              </p>
            </form>
          </div>
        </div>
      </transition>
      <div v-if="error" style="color:#f87171; margin-top:.5rem;">{{ error }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { createDocument, createLibrary, getDocumentsInLibrary, getLibraryByUser, removeDocument, getUserDefaultSettings, createDocumentSettings, renameDocument } from '@/lib/api/endpoints'
import type { Document } from '@/lib/api/types'
import JSZip from 'jszip'
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
const showCreate = ref(false)
// Preview state and helpers
const previewEls = new Map<string, HTMLElement | null>()
const previewRenditions = new Map<string, { book?: any; rendition?: any }>()
const previewLoading = ref<Record<string, boolean>>({})
const previewLoaded = ref<Record<string, boolean>>({})
const previewError = ref<Record<string, string | undefined>>({})
let previewObserver: IntersectionObserver | null = null

function setPreviewEl(el: any | null, id: string) {
  try {
    if (!id) return
    const h = (el as HTMLElement) || null
    previewEls.set(id, h)
    if (h) {
      try { h.dataset.previewId = id } catch {}
    } else {
      // removed element
      try { previewEls.delete(id) } catch {}
    }
    // If the observer exists and we have an element, start observing it so
    // previews auto-load when the card enters the viewport.
    try { if (h && previewObserver) previewObserver.observe(h) } catch {}
  } catch {}
}

function togglePreview(doc: Document) {
  // Fallback/manual trigger in case auto-load hasn't fired yet
  try {
    loadPreviewForDoc(doc).catch(() => {})
  } catch {}
}

onBeforeUnmount(() => {
  try {
    for (const [id, entry] of previewRenditions.entries()) {
      try { entry.rendition?.destroy?.() } catch {}
      try { entry.book?.destroy?.() } catch {}
      const el = previewEls.get(id)
      if (el) el.innerHTML = ''
    }
    previewRenditions.clear()
    previewEls.clear()
    try { previewObserver?.disconnect() } catch {}
  } catch {}
})

async function loadPreviewForDoc(doc: Document) {
  const id = doc._id
  if (!id) return
  if (previewLoaded.value[id] || previewLoading.value[id]) return
  previewLoading.value = { ...previewLoading.value, [id]: true }
  previewError.value = { ...previewError.value, [id]: undefined }
  try {
    const container = previewEls.get(id)
    if (!container) throw new Error('Preview container not available')
    // clear any existing content
    container.innerHTML = ''

    // First try: extract a cover image from the EPUB zip (cover href or first image)
    try {
      const zip = await JSZip.loadAsync(sanitizeBase64(doc.epubContent), { base64: true })
      const containerXmlFile = zip.file('META-INF/container.xml')
      let rootPath = ''
      if (containerXmlFile) {
        const containerXml = await containerXmlFile.async('string')
        const m = containerXml.match(/full-path="([^"]+)"/)
        if (m) rootPath = m[1]
      }
      if (!rootPath) {
        // fallback: try to find an OPF file in the zip
        const opfCandidate = Object.keys(zip.files).find(p => p.toLowerCase().endsWith('.opf'))
        if (opfCandidate) rootPath = opfCandidate
      }
      let coverFound = false
      if (rootPath) {
        const opfFile = zip.file(rootPath)
        if (opfFile) {
          const opfXml = await opfFile.async('string')
          const parser = new DOMParser()
          const docOpf = parser.parseFromString(opfXml, 'application/xml')
          // 1) look for <meta name="cover" content="cover-image-id"/>
          const metaCover = Array.from(docOpf.getElementsByTagName('meta')).find(m => (m.getAttribute('name') || '').toLowerCase() === 'cover')
          let href: string | null = null
          const rootDir = rootPath.includes('/') ? rootPath.slice(0, rootPath.lastIndexOf('/') + 1) : ''
          if (metaCover && metaCover.getAttribute('content')) {
            const coverId = metaCover.getAttribute('content') || ''
            const item = Array.from(docOpf.getElementsByTagName('item')).find(it => (it.getAttribute('id') || '') === coverId)
            if (item && item.getAttribute('href')) href = item.getAttribute('href') || null
          }
          // 2) if no cover meta, pick first manifest item that is an image
          if (!href) {
            const imageItem = Array.from(docOpf.getElementsByTagName('item')).find(it => {
              const mt = (it.getAttribute('media-type') || '')
              return mt.startsWith('image/')
            })
            if (imageItem && imageItem.getAttribute('href')) href = imageItem.getAttribute('href') || null
          }
          if (href) {
            // resolve relative to OPF root
            const resolved = (rootDir + href).replace(/\\/g, '/')
            const imgFile = zip.file(resolved) || zip.file(href)
            if (imgFile) {
              const imgBase64 = await imgFile.async('base64')
              // try to determine mime from media-type in manifest if available
              let mime = ''
              const manifestItem = Array.from(docOpf.getElementsByTagName('item')).find(it => (it.getAttribute('href') || '') === href || (rootDir + (it.getAttribute('href') || '')).replace(/\\/g, '/') === resolved)
              if (manifestItem && manifestItem.getAttribute('media-type')) mime = manifestItem.getAttribute('media-type') || ''
              if (!mime) {
                // fallback based on file extension
                const ext = href.split('.').pop()?.toLowerCase() || ''
                if (ext === 'png') mime = 'image/png'
                else if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg'
                else if (ext === 'gif') mime = 'image/gif'
              }
              const src = `data:${mime || 'image/*'};base64,${imgBase64}`
              const img = document.createElement('img')
              img.src = src
              img.style.maxWidth = '100%'
              img.style.maxHeight = '100%'
              img.style.objectFit = 'contain'
              container.appendChild(img)
              previewLoaded.value = { ...previewLoaded.value, [id]: true }
              coverFound = true
            }
          }
        }
      }
      if (coverFound) {
        return
      }
    } catch (zipErr) {
      // if anything fails while extracting a cover, we'll fall back to rendering via epub.js
      // ignore and continue
    }

    // Fallback: render first page using epub.js as before
    const mod: any = await import('epubjs')
    const ePub = mod && mod.default ? mod.default : mod
    const book = ePub()
    const rendition = book.renderTo(container, {
      width: '180px',
      height: '240px',
      flow: 'paginated',
      spread: 'none'
    })
    previewRenditions.set(id, { book, rendition })
    // open as base64 (server stores base64)
    await book.open(sanitizeBase64(doc.epubContent), 'base64')
    await rendition.display()
    previewLoaded.value = { ...previewLoaded.value, [id]: true }
  } catch (err: any) {
    previewError.value = { ...previewError.value, [id]: err?.message || 'Preview failed' }
  } finally {
    previewLoading.value = { ...previewLoading.value, [id]: false }
  }
}
async function load() {
  if (!userId.value) {
    libraryId.value = null
    docs.value = []
    return
  }
  pending.value = true
  error.value = null
  try {
    const libRes: any = await getLibraryByUser(userId.value)
    if (Array.isArray(libRes) && libRes[0]?.library) {
      libraryId.value = libRes[0].library._id
    } else {
      libraryId.value = null
      docs.value = []
      return
    }
    const docsRes: any = await getDocumentsInLibrary(libraryId.value!)
    if (Array.isArray(docsRes)) {
      docs.value = docsRes.map((d: any) => d.document)
    } else {
      docs.value = []
    }
    // Ensure the observer watches any preview elements already mounted
    try {
      for (const d of docs.value) {
        const el = previewEls.get(d._id)
        if (el && previewObserver) previewObserver.observe(el)
      }
    } catch {}
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
    let content = epubBase64.value || newDocContent.value
    if (!content) throw new Error('Please upload an .epub file or paste Base64 content.')
    approximateBytes = Math.ceil((content.length * 3) / 4)
    // Ensure EPUB has stable element ids (inject if necessary) so annotations
    // can include [id...] steps in CFIs and rehydrate reliably.
    try {
      content = await ensureEpubHasIds(content)
    } catch (err) { /* proceed with original content on failure */ }

    const res = await createDocument(newDocName.value, content, libraryId.value)
    if ('error' in res) throw new Error(res.error)
    const createdDocId = res.document

    // Create document settings from the user's default settings (best-effort)
    try {
      const def = await getUserDefaultSettings(userId.value)
      if (Array.isArray(def) && def[0]?.settings) {
        const s = def[0].settings
        const setRes = await createDocumentSettings(s.font, s.fontSize, s.lineHeight, createdDocId)
        if ('error' in setRes) {
          console.warn('createDocumentSettings failed:', setRes.error)
        }
      }
    } catch (err) {
      console.warn('Failed to create document settings:', err)
    }

    newDocName.value = ''
    newDocContent.value = ''
    epubBase64.value = ''
    fileInfo.value = null
    if (fileInput.value) fileInput.value.value = ''
    await load()
    // close the modal if open
    try { showCreate.value = false } catch {}
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

async function renameDoc(id: string) {
  if (!userId.value) return
  const current = docs.value.find(d => d._id === id)?.name || ''
  const newName = prompt('Rename document', current)
  if (newName === null) return
  const trimmed = newName.trim()
  if (!trimmed) {
    error.value = 'Name cannot be empty'
    return
  }
  if (trimmed === current) return
  pending.value = true
  try {
    const res = await renameDocument(userId.value, trimmed, id)
    if ('error' in res) throw new Error(res.error)
    await load()
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to rename document'
  } finally {
    pending.value = false
  }
}

onMounted(() => {
  // Create IntersectionObserver to lazy-load previews when card enters viewport
  try {
    previewObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        try {
          if (!entry.isIntersecting) continue
          const el = entry.target as HTMLElement
          const id = el?.dataset?.previewId
          if (!id) continue
          const doc = docs.value.find(d => d._id === id)
          if (doc) loadPreviewForDoc(doc).catch(() => {})
          try { previewObserver?.unobserve(el) } catch {}
        } catch {}
      }
    }, { root: null, rootMargin: '200px', threshold: 0.05 })
  } catch {}
  load()
})

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

/**
 * Ensure the EPUB package contains stable element ids that epub.js can reference.
 * This function unpacks the base64 EPUB, inspects XHTML/HTML files for missing
 * id (or xml:id) attributes, injects deterministic ids where absent, and
 * re-packages the EPUB to base64. If any error occurs we return the original
 * base64 so upload remains non-blocking.
 */
async function ensureEpubHasIds(b64: string): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(sanitizeBase64(b64), { base64: true })
    let changed = false
    const candidates = Object.keys(zip.files).filter(p => {
      const lower = p.toLowerCase()
      return lower.endsWith('.xhtml') || lower.endsWith('.html') || lower.endsWith('.htm')
    })
    for (const path of candidates) {
      try {
        const file = zip.file(path)
        if (!file) continue
        const txt = await file.async('string')
        // quick check: if the file already has id= or xml:id= we still may need to
        // add ids to elements that don't have them; parse and inspect DOM.
        const parser = new DOMParser()
        // Parse as XML to preserve XHTML semantics; fallback to text/html
        const doc = parser.parseFromString(txt, 'application/xml')
        const parseError = doc.getElementsByTagName('parsererror')
        const root = parseError && parseError.length ? parser.parseFromString(txt, 'text/html') : doc

        // Choose elements likely relevant for highlighting; keep it conservative
        const selectors = ['p','div','span','h1','h2','h3','h4','h5','section','article','li']
        let counter = 0
        const fileSafe = path.replace(/[^a-z0-9]+/gi, '-')
        for (const sel of selectors) {
          const els = Array.from((root as any).getElementsByTagName ? (root as any).getElementsByTagName(sel) : (root as any).querySelectorAll(sel)) as Element[]
          for (const el of els) {
            try {
              const hasId = el.getAttribute && (el.getAttribute('id') || el.getAttribute('xml:id'))
              if (!hasId) {
                counter += 1
                const gen = `fr-${fileSafe}-${counter}`
                try { el.setAttribute('id', gen) } catch {}
                changed = true
              }
            } catch {}
          }
        }
        if (changed) {
          try {
            const serializer = new XMLSerializer()
            const out = serializer.serializeToString(root)
            zip.file(path, out)
          } catch {}
        }
      } catch {}
    }
    if (!changed) return b64
    // generate new base64 zip
    const newBase64 = await zip.generateAsync({ type: 'base64' })
    return sanitizeBase64(newBase64)
  } catch (err) {
    // If anything goes wrong, fall back to original payload so uploads don't
    // fail unexpectedly.
    try { console.warn('[library] ensureEpubHasIds failed, proceeding with original EPUB', err) } catch {}
    return b64
  }
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

<style scoped>
.create-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
}
.create-panel { width: 520px; max-width: 95%; position: relative; }
.create-panel .create-close { position: absolute; top: 8px; right: 8px; background: transparent; border: none; font-size: 1.15rem; cursor: pointer; padding: 6px; }
.create-panel .create-close:hover { background: rgba(0,0,0,0.04); border-radius: 4px; }

/* Fade transition -- quick and subtle */
.fade-enter-active, .fade-leave-active {
  transition: opacity .18s ease;
}
.fade-enter-from, .fade-leave-to { opacity: 0; }
.fade-enter-to, .fade-leave-from { opacity: 1; }

.docs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 1rem;
}
.doc-card { 
    padding: 0; 
    display:flex; 
    overflow: hidden;
    box-shadow: 1px 1px 3px rgba(0, 0, 0, 0.1);
}
.doc-card-inner { display:flex; flex-direction:column; width:100%; }
.doc-preview-area { height: 160px; background: var(--surface); display:flex; align-items:center; justify-content:center; border-bottom:1px solid var(--border); }
.doc-preview { width: 180px; height: 140px; overflow:hidden; display:flex; align-items:center; justify-content:center; }
.doc-preview-placeholder { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:.4rem; }
/* Ensure any inserted cover image is centered and maintains aspect ratio */
.doc-preview img {
  max-width: 100%;
  max-height: 100%;
  display: block;
  margin: auto;
  object-fit: contain;
  object-position: center;
}

</style>
