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
    <div v-if="showConfirm" class="highlight-confirm" :style="{ left: `${confirmPos.left}px`, top: `${confirmPos.top}px` }">
      <button @click="confirmHighlight">Highlight</button>
      <button @click="clearPendingConfirm" style="margin-left:.25rem;">Cancel</button>
    </div>
    <div v-if="showRemoveConfirm" class="remove-confirm" :style="{ left: `${removeConfirmPos.left}px`, top: `${removeConfirmPos.top}px` }">
      <button @click="confirmRemove">Remove</button>
      <button @click="clearRemoveConfirm" style="margin-left:.25rem;">Cancel</button>
    </div>
    <div v-if="annotationsList.length" style="width: min(88vw, 960px); align-self:center; margin-top:.5rem;">
      <strong style="display:block; margin-bottom:.25rem;">Highlights</strong>
      <ul style="margin:0; padding:0 0 0 1rem; max-height:120px; overflow:auto;">
        <li v-for="(a, idx) in annotationsList" :key="a.cfi" style="margin:.25rem 0;">
          <button @click="goToAnnotation(a.cfi)" style="margin-right:.5rem;">Go</button>
          <span style="color:var(--muted);">{{ a.text }}</span>
        </li>
      </ul>
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

// Simple in-memory list of user highlights for this session. Each item contains
// the CFI range and the selected text. Persistence can be added later.
const annotationsList = ref<Array<{ cfi: string; text: string }>>([])
const pendingHighlight = ref<{ cfi: string; text: string } | null>(null)
let pendingSelectionWindow: Window | null = null
const showConfirm = ref(false)
const confirmPos = ref({ left: 0, top: 0 })
let confirmTimer: any = null
let iframeDocListenerTargets: Document[] = []
let iframeWinListenerTargets: Window[] = []
const removePendingElement = ref<Element | null>(null)
const showRemoveConfirm = ref(false)
const removeConfirmPos = ref({ left: 0, top: 0 })

function clearRemoveConfirm() {
  showRemoveConfirm.value = false
  removePendingElement.value = null
  try { window.removeEventListener('mousedown', onGlobalMouseDown) } catch {}
}

function clearPendingConfirm() {
  showConfirm.value = false
  pendingHighlight.value = null
  try { pendingSelectionWindow?.getSelection?.()?.removeAllRanges() } catch {}
  pendingSelectionWindow = null
  if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null }
  try { window.removeEventListener('mousedown', onGlobalMouseDown) } catch {}
  // keep iframe listeners attached for highlight/remove interactions; they
  // will be torn down in cleanup when the rendition is destroyed.
}

function onGlobalMouseDown(e: MouseEvent) {
  console.debug('[reader] onGlobalMouseDown target=', e.target)
  const el = document.querySelector('.highlight-confirm, .remove-confirm')
  if (!el) return clearPendingConfirm()
  if (e.target && el.contains(e.target as Node)) return
  clearPendingConfirm()
}

function findHighlightElement(startNode: Node | null): Element | null {
  let node = startNode
  const doc = (startNode && (startNode as any).ownerDocument) || document
  const bodyBg = (() => {
    try { return (doc && doc.body) ? (doc.defaultView ? (doc.defaultView.getComputedStyle(doc.body).backgroundColor || '') : '') : '' } catch { return '' }
  })()
  let depth = 0
  while (node && depth < 12) {
    depth++
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element
      const cls = (el.className || '') as string
      // direct markers: classes or data attrs we use for highlights
      if (
        el.getAttribute('data-user-highlight') ||
        cls.includes('user-highlight') ||
        cls.includes('highlight') ||
        cls.includes('epubjs') ||
        el.getAttribute('data-annotation') ||
        el.hasAttribute('data-highlight')
      ) return el

      // avoid selecting structural block elements like <p>, <h1>, <div>, etc.
      try {
        const disp = (doc.defaultView?.getComputedStyle(el).display || '')
        if (disp && !disp.startsWith('inline')) {
            node = (node as Node).parentNode
            continue
          }
      } catch {}

      // fallback: detect inline element with a background different from the page
      try {
        const bg = (doc.defaultView?.getComputedStyle(el).backgroundColor || '')
        const normalizedBg = (bg || '').trim()
        if (
          normalizedBg &&
          normalizedBg !== 'transparent' &&
          normalizedBg !== 'rgba(0, 0, 0, 0)' &&
          normalizedBg !== bodyBg &&
          normalizedBg !== 'rgb(255, 255, 255)'
        ) return el
      } catch {}
    }
    node = (node as Node).parentNode
  }
  return null
}

function onIframeMouseDown(e: MouseEvent) {
  // Handle clicks inside the iframe: detect highlight elements by walking
  // up the DOM and looking for common annotation classes or inline
  // highlight styles. If found, show the remove confirmation popup.
  try {
    console.debug('[reader] onIframeMouseDown', { target: e.target, clientX: (e as any).clientX, clientY: (e as any).clientY })
    const node = e.target as Node | null
    if (!node) { clearPendingConfirm(); clearRemoveConfirm(); return }
    // If the event target (or its ancestors) is already a highlight, prefer
    // that immediately instead of running elementFromPoint which may return
    // a parent like <body> or <p> in some cases. This avoids overwriting a
    // correct direct match with a less useful hit-test result.
    try {
      const direct = findHighlightElement(node)
      if (direct) {
        console.debug('[reader] direct highlight element matched (early)', { tag: direct.tagName, class: direct.className, outer: (direct.outerHTML || '').slice(0,200) })
        removePendingElement.value = direct
        showRemoveConfirm.value = true
        try {
          const doc = e.currentTarget as Document
          const win = doc?.defaultView
          const iframeEl = (win as any)?.frameElement as HTMLElement | null
          const clientX = (e as any).clientX
          const clientY = (e as any).clientY
          if (typeof clientX === 'number' && iframeEl) {
            const iframeRect = iframeEl.getBoundingClientRect()
            removeConfirmPos.value.left = Math.max(8, iframeRect.left + clientX)
            removeConfirmPos.value.top = Math.max(8, iframeRect.top + clientY - 24)
          } else {
            const containerRect = readerEl.value?.getBoundingClientRect()
            if (containerRect) {
              removeConfirmPos.value.left = containerRect.left + containerRect.width / 2 - 24
              removeConfirmPos.value.top = containerRect.top + 12
            }
          }
        } catch (err) { console.debug('[reader] compute remove pos failed (early)', err) }
        return
      }
    } catch {}
    // Try a precise hit-test inside the iframe document to find the exact element
    let searchStart: Node | null = node
    try {
      const doc = (e.currentTarget as Document) || (node && (node as any).ownerDocument)
      const cx = (e as any).clientX
      const cy = (e as any).clientY
      if (doc && typeof cx === 'number' && typeof cy === 'number') {
        try {
          // Translate outer client coordinates into iframe-local coordinates
          const win = doc.defaultView as Window | null
          const iframeEl = (win as any)?.frameElement as HTMLElement | null
          if (iframeEl) {
            const iframeRect = iframeEl.getBoundingClientRect()
            const localX = cx - iframeRect.left
            const localY = cy - iframeRect.top
            console.debug('[reader] elementFromPoint local coords', { iframeRect, localX, localY })
            // Prefer elementsFromPoint which returns all stacked elements at the
            // coordinates; scan for any element that is or contains a user
            // highlight. Fallback to elementFromPoint when elementsFromPoint
            // is not available.
            let matched: Element | null = null
            try {
              const list = (doc as Document).elementsFromPoint(localX, localY) as Element[]
              console.debug('[reader] elementsFromPoint count', list?.length)
              if (list && list.length) {
                for (const el of list) {
                  try {
                    // if this element itself is a highlight marker, pick it
                    if (el.getAttribute && (el.getAttribute('data-user-highlight') || el.classList?.contains('user-highlight') || el.className?.includes('highlight'))) {
                      matched = el
                      break
                    }
                    // otherwise try to find a highlight ancestor starting from this element
                    const found = findHighlightElement(el)
                    if (found) { matched = found; break }
                  } catch {}
                }
              }
            } catch (err) {
              // elementsFromPoint may not be supported in some environments
            }
            if (!matched) {
              const precise = doc.elementFromPoint(localX, localY)
              if (precise) matched = precise
            }
            if (matched) {
              // If the matched element isn't itself a highlight marker, try
              // searching its descendants for highlight elements whose
              // bounding box contains the local click coordinates. This
              // handles cases where the highlight span is nested inside a
              // block-level parent that elementFromPoint returns.
              try {
                const isDirect = matched.getAttribute && (matched.getAttribute('data-user-highlight') || matched.classList?.contains('user-highlight') || matched.className?.includes('highlight'))
                if (!isDirect) {
                  try {
                    const candidates = Array.from((matched as Element).querySelectorAll('[data-user-highlight], .user-highlight, .highlight'))
                    for (const cand of candidates) {
                      try {
                        const r = cand.getBoundingClientRect()
                        if (typeof localX === 'number' && typeof localY === 'number' && localX >= r.left && localX <= r.right && localY >= r.top && localY <= r.bottom) {
                          matched = cand
                          break
                        }
                      } catch {}
                    }
                  } catch {}
                }
              } catch {}
              console.debug('[reader] hit-test matched element', { tag: matched.tagName, class: matched.className })
              searchStart = matched as Node
            }
          } else {
            // fallback to using doc.elementFromPoint with global coords (may be off)
            const precise = doc.elementFromPoint(cx, cy)
            if (precise) {
              console.debug('[reader] elementFromPoint (fallback) found', { tag: precise.tagName, class: precise.className })
              searchStart = precise as Node
            }
          }
        } catch (err) { /* ignore elementFromPoint errors */ }
      }
    } catch {}
    const hl = findHighlightElement(searchStart)
    if (hl) {
      console.debug('[reader] highlight element matched', { tag: hl.tagName, class: hl.className, outer: (hl.outerHTML || '').slice(0,200) })
      removePendingElement.value = hl
      showRemoveConfirm.value = true
      try {
        const doc = e.currentTarget as Document
        const win = doc?.defaultView
        const iframeEl = (win as any)?.frameElement as HTMLElement | null
        const clientX = (e as any).clientX
        const clientY = (e as any).clientY
        if (typeof clientX === 'number' && iframeEl) {
          const iframeRect = iframeEl.getBoundingClientRect()
          removeConfirmPos.value.left = Math.max(8, iframeRect.left + clientX)
          removeConfirmPos.value.top = Math.max(8, iframeRect.top + clientY - 24)
        } else {
          const containerRect = readerEl.value?.getBoundingClientRect()
          if (containerRect) {
            removeConfirmPos.value.left = containerRect.left + containerRect.width / 2 - 24
            removeConfirmPos.value.top = containerRect.top + 12
          }
        }
      } catch (err) { console.debug('[reader] compute remove pos failed', err) }
      return
    }
    clearPendingConfirm()
    clearRemoveConfirm()
  } catch (err) {
    clearPendingConfirm(); clearRemoveConfirm()
  }
}

function attachIframeDocListeners() {
  try {
    const iframes = readerEl.value?.querySelectorAll('iframe') || []
    console.debug('[reader] attachIframeDocListeners found', iframes.length, 'iframes')
    iframes.forEach((iframe) => {
      try {
        const frame = iframe as HTMLIFrameElement
        const attach = (doc: Document | null) => {
          if (!doc) return
          if (!iframeDocListenerTargets.includes(doc)) {
            // use capture so we see events even if inner handlers stopPropagation
            console.debug('[reader] attaching doc listeners to iframe doc', doc)
            doc.addEventListener('mousedown', onIframeMouseDown, true)
            doc.addEventListener('click', onIframeMouseDown, true)
            // pointer events can be more reliable in some user agents; attach them too
            try { doc.addEventListener('pointerdown', onIframeMouseDown, true) } catch {}
            try { doc.addEventListener('pointerup', onIframeMouseDown, true) } catch {}
            iframeDocListenerTargets.push(doc)
            try {
              const win = doc.defaultView
              if (win && !iframeWinListenerTargets.includes(win)) {
                console.debug('[reader] attaching window listeners to iframe window', win)
                win.addEventListener('mousedown', onIframeMouseDown, true)
                win.addEventListener('click', onIframeMouseDown, true)
                try { win.addEventListener('pointerdown', onIframeMouseDown, true) } catch {}
                try { win.addEventListener('pointerup', onIframeMouseDown, true) } catch {}
                iframeWinListenerTargets.push(win)
              }
            } catch (e) { console.debug('[reader] failed to attach window listeners', e) }
          }
        }
        const doc = frame.contentDocument
        if (doc) {
          attach(doc)
        } else {
          // If the iframe hasn't loaded yet, attach on load
          const onLoad = () => {
            try { attach(frame.contentDocument) } catch {}
            try { frame.removeEventListener('load', onLoad) } catch {}
          }
          frame.addEventListener('load', onLoad)
        }
      } catch {}
    })
  } catch {}
}

function detachAllIframeDocListeners() {
  try {
    for (const doc of iframeDocListenerTargets) {
  try { doc.removeEventListener('mousedown', onIframeMouseDown) } catch {}
  try { doc.removeEventListener('click', onIframeMouseDown) } catch {}
  try { doc.removeEventListener('pointerdown', onIframeMouseDown) } catch {}
  try { doc.removeEventListener('pointerup', onIframeMouseDown) } catch {}
    }
  } catch {}
  iframeDocListenerTargets.length = 0
  try {
    for (const win of iframeWinListenerTargets) {
  try { win.removeEventListener('mousedown', onIframeMouseDown, true) } catch {}
  try { win.removeEventListener('click', onIframeMouseDown, true) } catch {}
  try { win.removeEventListener('pointerdown', onIframeMouseDown, true) } catch {}
  try { win.removeEventListener('pointerup', onIframeMouseDown, true) } catch {}
    }
  } catch {}
  iframeWinListenerTargets.length = 0
}

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
  // Listen for text selection events inside the rendition so the user can
  // create quick highlights. epub.js fires `selected` with (cfiRange, contents).
  try {
    rendition.on('selected', (cfiRange: string, contents: any) => {
      try {
        const win = contents?.window as Window | undefined
        const doc = win?.document
        const selection = win?.getSelection?.()
        const selText = selection?.toString().trim() || ''
        if (!selText) return

        // Try to obtain the selection Range so we can detect overlap with
        // existing highlights (elements with class 'user-highlight'). If the
        // selection intersects any existing highlight node, do nothing.
        let selRange: Range | null = null
        try {
          if (selection && selection.rangeCount) selRange = selection.getRangeAt(0)
        } catch (e) { selRange = null }

        // Quick textual/Cfi-based dedupe: if we already have an annotation whose
        // text contains the new selection or vice-versa, or exact same CFI, skip.
        for (const existing of annotationsList.value) {
          try {
            if (!existing || !existing.text) continue
            if (existing.cfi === cfiRange) {
              try { selection?.removeAllRanges() } catch {}
              return
            }
            const a = existing.text.trim()
            const b = selText.trim()
            if (!a || !b) continue
            if (a.includes(b) || b.includes(a)) {
              try { selection?.removeAllRanges() } catch {}
              return
            }
          } catch (e) {
            // ignore errors comparing annotations
          }
        }

        if (selRange && doc) {
          const existing = Array.from(doc.querySelectorAll('.user-highlight'))
          for (const el of existing) {
            try {
              // If selection overlaps any existing highlight, abort
              if ((selRange as Range).intersectsNode(el)) {
                try { selection?.removeAllRanges() } catch {}
                return
              }
            } catch (e) {
              // ignore per-element errors
            }
          }
        }

        // Instead of creating the highlight immediately, show a small
        // confirmation button near the selection. If the user clicks it
        // within a short time, we will create the highlight. Otherwise
        // the selection is cleared and nothing happens.
  pendingHighlight.value = { cfi: cfiRange, text: selText }
  // Remember the iframe window so we can clear its selection later.
  pendingSelectionWindow = win || null

        // Compute a position for the confirm button using the iframe's
        // frameElement and the selection rect.
        try {
          const rangeRect = selRange?.getBoundingClientRect()
          const iframeEl = (win as any)?.frameElement as HTMLElement | null
          if (rangeRect && iframeEl) {
            const iframeRect = iframeEl.getBoundingClientRect()
            // place the button above the selection
            confirmPos.value.left = Math.max(8, iframeRect.left + rangeRect.left)
            confirmPos.value.top = Math.max(8, iframeRect.top + rangeRect.top - 36)
          } else {
            // fallback to container center
            const containerRect = readerEl.value?.getBoundingClientRect()
            if (containerRect) {
              confirmPos.value.left = containerRect.left + containerRect.width / 2 - 24
              confirmPos.value.top = containerRect.top + 12
            }
          }
        } catch (e) {
          // ignore positioning errors
        }

        showConfirm.value = true
        try { window.addEventListener('mousedown', onGlobalMouseDown) } catch {}
        try {
          // Also listen for clicks inside the iframe so those can cancel the popup
          // or open the remove popup when clicking a highlight.
          attachIframeDocListeners()
        } catch {}
        if (confirmTimer) { clearTimeout(confirmTimer) }
        confirmTimer = setTimeout(() => clearPendingConfirm(), 6000)
      } catch (err) {
        // ignore selection errors
      }
    })
  } catch {
    // ignore if rendition doesn't support selected event
  }
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
    // Attach iframe listeners when a section is rendered so clicks on
    // highlights can be detected.
    setTimeout(() => attachIframeDocListeners(), 50)
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
    try { detachAllIframeDocListeners() } catch {}
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

/** Navigate the rendition to a saved annotation CFI. */
function goToAnnotation(cfi: string) {
  if (!cfi || !renditionInstance) return
  try { renditionInstance.display(cfi) } catch {}
}

/** User confirmed creating the pending highlight; apply and record it. */
function confirmHighlight() {
  if (!pendingHighlight.value || !renditionInstance) { clearPendingConfirm(); return }
  const { cfi, text } = pendingHighlight.value
  // Try to wrap the selection in the iframe first. If that succeeds
  // we will skip calling epub.js annotation APIs to avoid duplicate
  // highlights. This is best-effort and may silently fail on complex DOM.
  let wrapped = false
  try {
    const win = pendingSelectionWindow
    const sel = win?.getSelection?.()
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0)
      const doc = (range.startContainer && (range.startContainer as any).ownerDocument) || win?.document
      if (doc) {
        try {
          const span = doc.createElement('span')
          span.className = 'user-highlight'
          span.setAttribute('data-user-highlight', '1')
          span.style.background = '#fff176'
          span.style.color = '#000'
          span.style.pointerEvents = 'auto'
          try {
            range.surroundContents(span)
            wrapped = true
          } catch (err) {
            // fallback when surroundContents cannot be used
            try {
              const frag = range.extractContents()
              span.appendChild(frag)
              range.insertNode(span)
              wrapped = true
            } catch {}
          }
        } catch {}
      }
    }
  } catch {}

  // If we didn't wrap the selection directly, fall back to epub.js annotation
  // APIs (older epub.js versions) so the user still gets a highlight.
  if (!wrapped) {
    try {
      try { (renditionInstance as any).annotations.add('highlight', cfi, {}, () => {}, 'user-highlight') } catch (err) {
        try { (renditionInstance as any).annotations.highlight(cfi, {}, undefined, 'user-highlight') } catch {}
      }
    } catch (e) {
      // ignore annotation errors
    }
  }

  // Record the annotation once
  annotationsList.value.push({ cfi, text })

  // Ensure any highlights present in iframe docs have the deterministic attribute
  try {
    const docs = iframeDocListenerTargets.length ? iframeDocListenerTargets.slice() : []
    for (const doc of docs) {
      try {
        const els = Array.from(doc.querySelectorAll('.user-highlight, .highlight'))
        for (const el of els) {
          try {
            if (!el.getAttribute('data-user-highlight')) {
              el.setAttribute('data-user-highlight', '1')
              ;(el as HTMLElement).style.pointerEvents = 'auto'
            }
          } catch {}
        }
      } catch {}
    }
  } catch {}
  // Clear selection inside the iframe (if we recorded it) so the blue selection
  // is removed and only the yellow highlight remains visible.
  try { pendingSelectionWindow?.getSelection?.()?.removeAllRanges() } catch {}
  pendingSelectionWindow = null
  clearPendingConfirm()
}

/** Confirm and remove the pending highlighted element. */
function confirmRemove() {
  const el = removePendingElement.value
  if (!el) { clearRemoveConfirm(); return }
  // Only allow removing elements that were explicitly marked as highlights.
  // This avoids accidentally unwrapping large structural elements.
  try {
    const hasMarker = el.getAttribute && (el.getAttribute('data-user-highlight') || el.classList?.contains('user-highlight'))
    if (!hasMarker) { clearRemoveConfirm(); return }
  } catch { clearRemoveConfirm(); return }
  try {
    // Unwrap the highlight element so text remains but highlight styling is gone.
    const parent = el.parentNode
    if (parent) {
      while (el.firstChild) parent.insertBefore(el.firstChild, el)
      parent.removeChild(el)
    }
  } catch {}

  // Remove matching entries from annotationsList (by text equality or empty cfi)
  try {
    const text = (el.textContent || '').trim()
    annotationsList.value = annotationsList.value.filter((a) => a.text !== text)
  } catch {}

  clearRemoveConfirm()
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
      ,
      '.user-highlight': {
        background: '#fff176',
        color: '#000'
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

.highlight-confirm {
  position: fixed;
  z-index: 1200;
  background: white;
  border: 1px solid #d1d5db;
  padding: .25rem;
  border-radius: .25rem;
  box-shadow: 0 6px 18px rgba(0,0,0,0.08);
}

.remove-confirm {
  position: fixed;
  z-index: 1200;
  background: white;
  border: 1px solid #fca5a5;
  padding: .25rem;
  border-radius: .25rem;
  box-shadow: 0 6px 18px rgba(0,0,0,0.08);
}

/* Make sure highlight elements accept pointer events so clicks reach our handlers */
.user-highlight, .highlight {
  pointer-events: auto;
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
