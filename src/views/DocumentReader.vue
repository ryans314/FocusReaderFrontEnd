<template>
  <div class="card" style="height: calc(100vh - 180px); display:flex; flex-direction: column;">
    <div style="display:flex; align-items:center; gap:.75rem;">
      <button @click="goBack">← Back</button>
      <h2 style="margin:0;">{{ title }}</h2>
      <span style="color:var(--muted)">({{ documentId }})</span>
      <span style="flex:1"></span>
      <button v-if="base64Content" @click="downloadEpub" type="button">Download EPUB</button>
      <span v-if="pending" style="color:var(--muted)">Loading… {{ status }}</span>
    </div>

    <div v-if="rendered" class="reader-toolbar">
      <div class="toolbar-section">
        <button @click="prevPage" :disabled="!canGoPrev">← Prev</button>
        <button @click="nextPage" :disabled="!canGoNext">Next →</button>
      </div>

      <div class="toolbar-section reader-progress">
        <input
          class="reader-slider"
          type="range"
          min="0"
          max="1000"
          v-model.number="sliderValue"
          :disabled="!locationsAvailable"
          @change="onSliderCommit"
        />
        <span class="progress-label">{{ progressLabel }}</span>
      </div>

      <div class="toolbar-section" v-if="tocOptions.length">
        <select v-model="selectedToc" @change="onTocChange">
          <option value="">Jump to chapter…</option>
          <option v-for="item in tocOptions" :key="item.href" :value="item.href">
            {{ item.label }}
          </option>
        </select>
      </div>

      <div class="toolbar-section">
        <span style="color:var(--muted);">Text size</span>
        <button @click="decreaseFont" :disabled="fontScale <= 70">A−</button>
        <button @click="increaseFont" :disabled="fontScale >= 160">A+</button>
      </div>
    </div>

    <div ref="readerEl" class="reader-container" />
    <div v-if="error" style="color:#f87171; margin-top:.5rem;">{{ error }}</div>
    <div v-if="integrity" style="color:#34d399; margin-top:.5rem;">Integrity: {{ integrity }}</div>
    <div v-if="integrityError" style="color:#f87171; margin-top:.5rem;">Integrity check failed: {{ integrityError }}</div>
    <div v-if="!pending && !error && !rendered" style="color:#fbbf24; margin-top:.5rem;">
      Still preparing the book… If this persists, the EPUB might be invalid or too large to process in-browser.
      <button @click="retry" style="margin-left:.5rem;">Try again</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getDocumentDetails, openDocument, closeDocument } from '@/lib/api/endpoints'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import ePub from 'epubjs'
import JSZip from 'jszip'
import type { Rendition, Book } from 'epubjs'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { userId } = storeToRefs(auth)

const documentId = String(route.params.documentId || '')
const title = ref('')
const pending = ref(false)
const error = ref('')
const readerEl = ref<HTMLDivElement | null>(null)
const status = ref('')
const rendered = ref(false)
const integrity = ref('')
const integrityError = ref('')
const base64Content = ref('')
const canGoPrev = ref(false)
const canGoNext = ref(false)
const locationsAvailable = ref(false)
const sliderValue = ref(0)
const currentPercent = ref(0)
const currentChapter = ref('')
const selectedToc = ref('')
const tocOptions = ref<Array<{ label: string; href: string }>>([])
const fontScale = ref(100)

const progressLabel = computed(() => {
  const percent = Math.round(currentPercent.value * 1000) / 10
  const percentText = Number.isFinite(percent) ? `${percent.toFixed(1)}%` : '0.0%'
  return currentChapter.value ? `${percentText} · ${currentChapter.value}` : percentText
})

let cleanup: (() => void) | null = null
let retryToken = 0
let bookInstance: Book | null = null
let renditionInstance: Rendition | null = null
let currentCfi = ''

function goBack() {
  router.back()
}

onMounted(async () => {
  if (!documentId) {
    error.value = 'Missing document id'
    return
  }
  try {
    pending.value = true
    status.value = 'Opening document'
    // Optional: mark as opened per API
    if (userId.value) {
      try { await openDocument(userId.value, documentId) } catch {}
    }

    status.value = 'Fetching details'
    const res = await getDocumentDetails(documentId)
    if ('error' in res) throw new Error(res.error)
    const doc = res[0]?.document
    if (!doc) throw new Error('Document not found')
    title.value = doc.name

    await renderEpubFromBase64(doc.epubContent)
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to open document'
  } finally {
    pending.value = false
  }
})

onBeforeUnmount(async () => {
  if (cleanup) cleanup()
  if (userId.value && documentId) {
    try { await closeDocument(userId.value, documentId) } catch {}
  }
})

async function renderEpubFromBase64(b64: string) {
  rendered.value = false
  status.value = 'Decoding EPUB'
  const sanitized = sanitizeBase64(b64)
  if (!sanitized) throw new Error('Empty or invalid EPUB content')

  base64Content.value = sanitized
  integrity.value = ''
  resetNavigationState()
  integrityError.value = ''

  status.value = 'Validating EPUB structure'
  await validateEpubStructure(sanitized)

  status.value = 'Initializing renderer'
  const container = readerEl.value
  if (!container) throw new Error('Reader container not available')

  // Clean previous instance if any
  if (cleanup) cleanup()

  const book = ePub()
  const rendition = book.renderTo(container, { width: '100%', height: '100%' })
  bookInstance = book
  renditionInstance = rendition
  applyFont()
  const currentToken = ++retryToken

  const timeoutMs = 15000
  let timeoutId: any
  const clearTimer = () => { if (timeoutId) { clearTimeout(timeoutId); timeoutId = null } }

  // Mark rendered on first section render
  rendition.on('rendered', () => {
    rendered.value = true
    pending.value = false
    status.value = 'Rendered'
    clearTimer()
  })

  rendition.on('relocated', (location: any) => {
    if (!location || currentToken !== retryToken) return
    updateNavigationState(location)
  })

  // Time out if it takes too long; race the display promise so we don't hang
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Render timed out. The EPUB may be invalid or too large to process.'))
    }, timeoutMs)
  })

  pending.value = true
  status.value = 'Rendering…'
  try {
    await book.open(sanitized, 'base64')
    prepareNavigation(book)
    await Promise.race([rendition.display(), timeoutPromise])
  } catch (e: any) {
    clearTimer()
    // eslint-disable-next-line no-console
    console.error('EPUB render error:', e)
    throw new Error(e?.message || 'Failed to render EPUB')
  } finally {
    clearTimer()
  }

  cleanup = () => {
    try { rendition.destroy() } catch {}
    try { book.destroy() } catch {}
    bookInstance = null
    renditionInstance = null
    resetNavigationState()
  }
}

function sanitizeBase64(b64: string): string {
  // Handle URL-safe base64 and strip data URL prefix if present
  const sanitized = b64.includes(',') ? b64.split(',')[1] : b64
  let base64 = sanitized.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/')
  const remainder = base64.length % 4
  if (remainder === 1) throw new Error('Invalid base64 content length')
  if (remainder > 0) {
    base64 = base64.padEnd(base64.length + (4 - remainder), '=')
  }
  return base64
}

async function validateEpubStructure(base64: string) {
  try {
    const zip = await JSZip.loadAsync(base64, { base64: true })

    const mimetypeFile = zip.file('mimetype')
    if (mimetypeFile) {
      const mimetype = (await mimetypeFile.async('string')).trim()
      if (!mimetype.startsWith('application/epub+zip')) {
        throw new Error(`Invalid mimetype file contents: ${mimetype || '[empty]'}`)
      }
    }

    const container = zip.file('META-INF/container.xml')
    if (!container) throw new Error('Missing META-INF/container.xml')
    const containerXml = await container.async('string')
    const match = containerXml.match(/full-path="([^"]+)"/)
    if (!match) throw new Error('Unable to locate rootfile in container.xml')
    const rootPath = match[1]
    const rootFile = zip.file(rootPath)
    if (!rootFile) throw new Error(`Rootfile referenced in container.xml not found: ${rootPath}`)
    const opfXml = await rootFile.async('string')
    const opfValidation = validateOpfManifest(opfXml, rootPath)
    integrity.value = `Rootfile located at ${rootPath}; manifest OK (${opfValidation.manifestCount} items, ${opfValidation.spineCount} spine refs)`
  } catch (err: any) {
    integrityError.value = err?.message ?? 'Unknown EPUB validation error'
    throw err
  }
}

function validateOpfManifest(opfXml: string, path: string) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(opfXml, 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    const message = parseError.textContent?.replace(/\s+/g, ' ').trim() || 'Unknown parser error'
    throw new Error(`Invalid OPF XML in ${path}: ${message}`)
  }

  const manifestItems = Array.from(doc.getElementsByTagName('item'))
  const missingHref = manifestItems.filter((item) => !item.getAttribute('href'))
  if (missingHref.length) {
    const ids = missingHref.map((item) => item.getAttribute('id') || '[no id]').join(', ')
    throw new Error(`OPF manifest entries missing href attribute: ${ids}`)
  }

  const manifestMap = new Map(
    manifestItems.map((item) => [item.getAttribute('id') || '', item.getAttribute('href') || ''])
  )

  const spineItems = Array.from(doc.getElementsByTagName('itemref'))
  const missingSpineRefs = spineItems.filter((item) => {
    const idref = item.getAttribute('idref')
    if (!idref) return true
    const href = manifestMap.get(idref)
    return !href
  })
  if (missingSpineRefs.length) {
    const refs = missingSpineRefs
      .map((item) => item.getAttribute('idref') || '[no idref]')
      .join(', ')
    throw new Error(`OPF spine references missing corresponding manifest href: ${refs}`)
  }

  return {
    manifestCount: manifestItems.length,
    spineCount: spineItems.length,
  }
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function downloadEpub() {
  if (!base64Content.value) return
  try {
    const bytes = base64ToUint8Array(base64Content.value)
    const buffer = bytes.buffer.slice(0, bytes.byteLength) as ArrayBuffer
    const blob = new Blob([buffer], { type: 'application/epub+zip' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title.value || 'document'}.epub`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to download EPUB', err)
  }
}

async function retry() {
  error.value = ''
  rendered.value = false
  pending.value = true
  status.value = 'Retrying render'
  // Re-fetch in case content changed
  const res = await getDocumentDetails(documentId)
  if ('error' in res) {
    error.value = res.error
    pending.value = false
    return
  }
  const doc = res[0]?.document
  if (!doc) {
    error.value = 'Document not found'
    pending.value = false
    return
  }
  try {
    await renderEpubFromBase64(doc.epubContent)
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to render EPUB'
  } finally {
    pending.value = false
  }
}

function resetNavigationState() {
  canGoPrev.value = false
  canGoNext.value = false
  locationsAvailable.value = false
  sliderValue.value = 0
  currentPercent.value = 0
  currentChapter.value = ''
  selectedToc.value = ''
  tocOptions.value = []
  currentCfi = ''
}

function updateNavigationState(location: any) {
  currentCfi = location?.start?.cfi || ''
  const atStart = Boolean(location?.atStart)
  const atEnd = Boolean(location?.atEnd)
  canGoPrev.value = !atStart
  canGoNext.value = !atEnd

  if (bookInstance?.locations && currentCfi) {
    const percentage = bookInstance.locations.percentageFromCfi(currentCfi)
    if (Number.isFinite(percentage)) {
      currentPercent.value = Math.max(0, Math.min(1, Number(percentage)))
      sliderValue.value = Math.round(currentPercent.value * 1000)
    }
    locationsAvailable.value = bookInstance.locations.length() > 0
  }

  const href: string = location?.start?.href || ''
  if (href && tocOptions.value.length) {
    const normalized = normalizeHref(href)
    const match = tocOptions.value.find((item) => normalizeHref(item.href) === normalized)
    if (match) {
      selectedToc.value = match.href
      currentChapter.value = stripPrefix(match.label)
    } else if (!currentChapter.value) {
      currentChapter.value = location?.start?.displayed?.title || ''
    }
  } else if (!currentChapter.value) {
    currentChapter.value = location?.start?.displayed?.title || ''
  }
}

function normalizeHref(href: string) {
  return href.split('#')[0]
}

function stripPrefix(label: string) {
  return label.replace(/^-+\s*/, '')
}

function prepareNavigation(book: Book) {
  book.loaded.navigation
    .then((nav: any) => {
      tocOptions.value = flattenNavigation(nav.toc || [])
    })
    .catch(() => {
      tocOptions.value = []
    })

  book.ready
    .then(() => book.locations.generate(1200))
    .then(() => {
      if (!bookInstance || !bookInstance.locations) return
      locationsAvailable.value = bookInstance.locations.length() > 0
      if (currentCfi) {
        const percentage = bookInstance.locations.percentageFromCfi(currentCfi)
        if (Number.isFinite(percentage)) {
          currentPercent.value = Math.max(0, Math.min(1, Number(percentage)))
          sliderValue.value = Math.round(currentPercent.value * 1000)
        }
      }
    })
    .catch(() => {
      locationsAvailable.value = false
    })
}

function flattenNavigation(items: any[], level = 0, acc: Array<{ label: string; href: string }> = []) {
  items.forEach((item: any) => {
    const prefix = level > 0 ? `${'- '.repeat(level)} ` : ''
    acc.push({ label: `${prefix}${item.label}`, href: item.href })
    if (item.subitems?.length) flattenNavigation(item.subitems, level + 1, acc)
  })
  return acc
}

function nextPage() {
  renditionInstance?.next()
}

function prevPage() {
  renditionInstance?.prev()
}

function onSliderCommit() {
  if (!bookInstance || !bookInstance.locations || !renditionInstance) return
  const percentage = sliderValue.value / 1000
  const cfi = bookInstance.locations.cfiFromPercentage(percentage)
  if (cfi) renditionInstance.display(cfi)
}

function onTocChange() {
  if (!selectedToc.value || !renditionInstance) return
  renditionInstance.display(selectedToc.value)
}

function increaseFont() {
  if (fontScale.value >= 160) return
  fontScale.value += 10
  applyFont()
}

function decreaseFont() {
  if (fontScale.value <= 70) return
  fontScale.value -= 10
  applyFont()
}

function applyFont() {
  if (!renditionInstance) return
  renditionInstance.themes.fontSize(`${fontScale.value}%`)
}
</script>

<style scoped>
.reader-container {
  flex: 1;
  min-height: 300px;
  border: 1px solid #1f2937;
  border-radius: .5rem;
  margin-top: .75rem;
  overflow: hidden;
}

.reader-toolbar {
  display: flex;
  align-items: center;
  gap: .75rem;
  flex-wrap: wrap;
  margin-top: .75rem;
}

.toolbar-section {
  display: flex;
  align-items: center;
  gap: .5rem;
}

.reader-progress {
  flex: 1;
  min-width: 220px;
}

.reader-slider {
  width: 100%;
}

.progress-label {
  min-width: 110px;
  text-align: right;
  color: var(--muted);
}
</style>
