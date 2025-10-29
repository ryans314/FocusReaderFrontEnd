<template>
  <div class="card" style="min-height: calc(100vh - 180px); display:flex; flex-direction: column;">
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

      <div class="toolbar-section" v-if="tocOptions.length">
        <select class="toc-select" v-model="selectedToc" @change="onTocChange">
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
    <div v-if="rendered" class="reader-progress-wrapper">
        <input
          class="reader-slider"
          type="range"
          min="0"
          max="100"
          step="0.1"
          v-model.number="sliderValue"
          :disabled="!totalPages"
        />
      <span class="progress-label">{{ progressLabel }}</span>
    </div>
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
import type Rendition from 'epubjs/types/rendition'
import type Book from 'epubjs/types/book'

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
const sliderValue = ref(0) // percentage 0..100 representing progress through the current chapter
const currentPageStart = ref(0)
const currentPageEnd = ref(0)
const totalPages = ref(0)
const totalSpreads = ref(1)
const currentSpread = ref(1)
const currentChapter = ref('')
const selectedToc = ref('')
const tocOptions = ref<Array<{ label: string; href: string }>>([])
const fontScale = ref(100)
const pagesPerSpread = ref(2)
const locationsPerSpread = ref(1)

const locationSpanSamples: number[] = []

const progressLabel = computed(() => {
  const total = totalPages.value
  const start = currentPageStart.value
  if (!total || !start) return 'Page ?'
  const end = currentPageEnd.value && currentPageEnd.value !== start ? currentPageEnd.value : start
  const range = end === start ? `${start}` : `${start}-${end}`
  const base = `Page ${range} / ${total}`
  return currentChapter.value ? `${base} · ${currentChapter.value}` : base
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
  window.addEventListener('keydown', onKeyDown)
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
  window.removeEventListener('keydown', onKeyDown)
  if (userId.value && documentId) {
    try { await closeDocument(userId.value, documentId) } catch {}
  }
})

/**
 * Decode, validate, and render an EPUB payload into the reader container.
 */
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
  const rendition = book.renderTo(container, {
    width: '100%',
    height: '100%',
    flow: 'paginated',
    spread: 'always'
  })
  bookInstance = book
  renditionInstance = rendition
  applyFont()
  rendition.flow('paginated')
  rendition.spread('always')
  applyTheme()
  updateSpreadDivisor(rendition)
  rendition.on('layout', () => updateSpreadDivisor(rendition))
  rendition.on('relocated', () => updateSpreadDivisor(rendition))
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
    updateSpreadDivisor(rendition)
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

/**
 * Normalize Base64 strings, handling URL-safe alphabets and padding issues.
 */
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

/**
 * Inspect the EPUB zip for required files (mimetype, container.xml, OPF manifest).
 */
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

/**
 * Ensure the OPF manifest has valid hrefs and matching spine references.
 */
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

/**
 * Convert Base64 strings into raw byte arrays.
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Allow the user to download the currently loaded EPUB for offline inspection.
 */
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

/**
 * Re-fetch document details and attempt to render again.
 */
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

/**
 * Reset pagination and navigation state when (re)loading content.
 */
function resetNavigationState() {
  canGoPrev.value = false
  canGoNext.value = false
  locationsAvailable.value = false
  sliderValue.value = 1
  currentSpread.value = 1
  totalSpreads.value = 1
  currentPageStart.value = 0
  currentPageEnd.value = 0
  totalPages.value = 0
  currentChapter.value = ''
  selectedToc.value = ''
  tocOptions.value = []
  currentCfi = ''
  pagesPerSpread.value = 2
  locationsPerSpread.value = 1
  locationSpanSamples.length = 0
}

/**
 * Respond to rendition relocation events, updating page numbers and chapter info.
 */
function updateNavigationState(location: any) {
  currentCfi = location?.start?.cfi || ''
  const atStart = Boolean(location?.atStart)
  const atEnd = Boolean(location?.atEnd)
  canGoPrev.value = !atStart
  canGoNext.value = !atEnd

  const locs = bookInstance?.locations
  if (locs && currentCfi) {
    const totalLocs = locs.length()
    locationsAvailable.value = totalLocs > 0
    if (locationsAvailable.value) {
      const startLoc = resolveLocationIndex(location?.start)
      const endLoc = resolveLocationIndex(location?.end ?? location?.start)
      if (Number.isFinite(startLoc)) {
        const span = Math.max(1, endLoc - startLoc + 1)
        locationSpanSamples.push(span)
        if (locationSpanSamples.length > 40) locationSpanSamples.shift()
        const medianSpan = Math.max(1, Math.round(computeMedian(locationSpanSamples)))
        locationsPerSpread.value = medianSpan

        const spreadIdx = Math.max(1, Math.round(startLoc / medianSpan))
        currentSpread.value = spreadIdx
        sliderValue.value = spreadIdx

        totalSpreads.value = Math.max(
          totalSpreads.value,
          Math.ceil(totalLocs / medianSpan),
          spreadIdx
        )
      }
    }
  }

  const displayedStart = location?.start?.displayed
  const displayedEnd =
  location?.end?.displayed &&
  location?.end?.displayed !== location?.start?.displayed
    ? location.end.displayed
    : null
  const startPage = toPositiveInt(displayedStart?.page)
  const endPageCandidate = toPositiveInt(displayedEnd?.page)
  const totalPage = toPositiveInt(displayedStart?.total ?? displayedEnd?.total)

  if (startPage && totalPage) {
    // Use the visible page range (min/max of displayed start/end) so two-page spreads
    // always show the correct low/high page numbers regardless of navigation direction.
    // const low = Math.min(startPage, endPageCandidate || startPage)
    // const high = Math.max(startPage, endPageCandidate || startPage)
    const low = startPage
    const high = endPageCandidate ? Math.max(startPage, endPageCandidate) : startPage
    const endPage = Math.min(totalPage, high)
    if (pagesPerSpread.value === 1) {
        currentPageStart.value = startPage
        currentPageEnd.value = startPage
    } else {
        currentPageStart.value = low
        currentPageEnd.value = endPage
    }
    totalPages.value = totalPage

    // compute chapter progress such that first page -> 0%, last page -> 100%.
    // Map page numbers (1..totalPage) to fraction (0..1) using (page-1)/(total-1).
    let progressFraction = 0
    if (totalPage <= 1) {
      progressFraction = 1
    } else {
      progressFraction = (endPage - 1) / (totalPage - 1)
      progressFraction = Math.max(0, Math.min(1, progressFraction))
    }
    sliderValue.value = Math.round(progressFraction * 100 * 10) / 10
  } else {
    currentPageStart.value = 0
    currentPageEnd.value = 0
    totalPages.value = 0
    sliderValue.value = 0
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

/**
 * Drop fragment identifiers so TOC hrefs can be compared reliably.
 */
function normalizeHref(href: string) {
  return href.split('#')[0]
}

/**
 * Tidy up nested TOC labels by removing leading hyphen markers.
 */
function stripPrefix(label: string) {
  return label.replace(/^-+\s*/, '')
}

/** Infer the current spread divisor (pages visible at once) from the rendition layout. */
function updateSpreadDivisor(rendition: Rendition) {
  try {
    const layout = (rendition as any).layout?.() ?? (rendition as any)._layout
    const divisor = layout?.divisor
    if (typeof divisor === 'number' && divisor >= 1) {
      pagesPerSpread.value = divisor
    }
  } catch {
    // Ignore layout probing issues
  }
}

/** Return the median value from a numeric list. */
function computeMedian(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

function toPositiveInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  const int = Math.floor(value)
  return int > 0 ? int : 0
}

/**
 * Extract a numeric location index from epub.js location objects.
 */
function resolveLocationIndex(loc: unknown): number {
  if (typeof loc === 'number' && Number.isFinite(loc)) return loc
  if (loc && typeof loc === 'object') {
    const candidate = loc as { location?: unknown; start?: { location?: unknown } }
    const direct = candidate.location
    if (typeof direct === 'number' && Number.isFinite(direct)) return direct
    const startLoc = candidate.start?.location
    if (typeof startLoc === 'number' && Number.isFinite(startLoc)) return startLoc
  }
  return 0
}

/**
 * Preload navigation data and generate location mappings for slider support.
 */
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
      const totalLocs = bookInstance.locations.length()
      locationsAvailable.value = totalLocs > 0
      const spanEstimate = Math.max(1, locationsPerSpread.value)
      totalSpreads.value = Math.max(totalSpreads.value, Math.ceil(totalLocs / spanEstimate))
      if (!currentCfi && totalSpreads.value > 0) {
        currentSpread.value = 1
        sliderValue.value = 1
      }
    })
    .catch(() => {
      locationsAvailable.value = false
    })
}

/**
 * Flatten the nested TOC structure into a simple array for dropdown use.
 */
function flattenNavigation(items: any[], level = 0, acc: Array<{ label: string; href: string }> = []) {
  items.forEach((item: any) => {
    const prefix = level > 0 ? `${'- '.repeat(level)} ` : ''
    acc.push({ label: `${prefix}${item.label}`, href: item.href })
    if (item.subitems?.length) flattenNavigation(item.subitems, level + 1, acc)
  })
  return acc
}

/** Advance the rendition to the next page spread. */
function nextPage() {
  renditionInstance?.next()
}

/** Move the rendition back to the previous page spread. */
function prevPage() {
  renditionInstance?.prev()
}

/**
 * Seek to the page represented by the slider position using estimated locations.
 */
// Slider is now a read-only chapter progress indicator; navigation via slider has been removed.

/** Jump directly to the selected TOC item. */
function onTocChange() {
  if (!selectedToc.value || !renditionInstance) return
  renditionInstance.display(selectedToc.value)
}

/** Incrementally enlarge the rendition font size. */
function increaseFont() {
  if (fontScale.value >= 160) return
  fontScale.value += 10
  applyFont()
}

/** Incrementally reduce the rendition font size. */
function decreaseFont() {
  if (fontScale.value <= 70) return
  fontScale.value -= 10
  applyFont()
}

/** Apply the current font size value to the rendition theme. */
function applyFont() {
  if (!renditionInstance) return
  renditionInstance.themes.fontSize(`${fontScale.value}%`)
  // Re-apply theme after font changes to ensure colors persist
  applyTheme()
}

/** Apply a simple, high-contrast theme to the book content (black on white). */
function applyTheme() {
  if (!renditionInstance) return
  try {
    // Register a small theme that forces page body color and background
    // epub.js theme API supports registering named themes and selecting them.
    const theme = {
      body: {
        color: '#000000',
        background: '#ffffff'
      },
      '::selection': {
        background: '#b3d4ff'
      }
    }
    try { renditionInstance.themes.register('reader-high-contrast', theme) } catch { /* ignore if already registered */ }
    try { renditionInstance.themes.select('reader-high-contrast') } catch { /* fallback if select fails */ }
  } catch {
    // ignore theme application errors
  }
}

/**
 * Handle global keyboard shortcuts for page navigation while respecting focus.
 */
function onKeyDown(event: KeyboardEvent) {
  if (!renditionInstance) return
  const target = event.target as HTMLElement | null
  const tagName = target?.tagName?.toLowerCase()
  if (tagName && ['input', 'textarea', 'select'].includes(tagName)) return
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    nextPage()
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    prevPage()
  }
}
</script>

<style scoped>
.reader-container {
  flex: 1;
  min-height: 620px;
  border: 1px solid #1f2937;
  border-radius: .5rem;
  margin-top: .75rem;
  overflow: visible;
  width: min(88vw, 960px);
  align-self: center;
  background: #ffffff;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.08);
  aspect-ratio: 5 / 3;
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

.reader-progress-wrapper {
  width: min(88vw, 960px);
  align-self: center;
  display: flex;
  align-items: center;
  gap: .75rem;
  margin-top: .75rem;
}

.reader-slider {
  width: 100%;
}

.reader-progress-wrapper .reader-slider {
  flex: 1;
}

.progress-label {
  min-width: 110px;
  text-align: right;
  color: var(--muted);
}

.toc-select {
  width: 150px;
  font-size: .85rem;
  padding: .3rem .35rem;
}
</style>
