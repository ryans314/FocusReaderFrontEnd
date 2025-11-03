<template>
  <div class="card" style="min-height: calc(100vh - 180px); display:flex; flex-direction: column;">
    <div style="display:flex; align-items:center; gap:.75rem;">
      <button @click="goBack">← Back</button>
      <h2 style="margin:0;">{{ title }}</h2>
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

      <div class="toolbar-section">
        <span style="color:var(--muted);">Line height</span>
        <button @click="decreaseLineHeight">−</button>
        <span aria-live="polite" style="min-width:3ch; text-align:center;">{{ lineHeightRatio.toFixed(1) }}×</span>
        <button @click="increaseLineHeight">+</button>
      </div>

      <div class="toolbar-section">
        <span style="color:var(--muted);">Font</span>
        <select class="toc-select" v-model="fontFamily" @change="onFontChange">
          <option v-for="opt in fontOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
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
      <!-- Stacked layout: textarea on top, colors in 1-2 rows beneath, actions below -->
      <div style="display:flex; flex-direction:column; gap:.5rem; min-width:240px; max-width:360px;">
        <textarea class="highlight-note-textarea" v-model="pendingNote" rows="3" placeholder="Add a note (optional)" style="width:100%; resize:vertical; font-size:.9rem;"></textarea>

        <div class="color-palette" style="display:flex; flex-wrap:wrap; gap:.375rem; align-items:center;">
          <button v-for="c in highlightColors" :key="c" class="color-button" :style="{ background: c, width: '28px', height: '28px', borderRadius: '6px', border: pendingNoteColor === c ? '2px solid #111' : '1px solid #ddd' }" @click="pendingNoteColor = c" :title="c"></button>
        </div>

        <div class="highlight-actions" style="display:flex; gap:.5rem; align-items:center;">
          <button @click="addAnnotation">Add annotation</button>
          <button @click="clearPendingConfirm" style="margin-left:.25rem;">Cancel</button>
        </div>
      </div>
    </div>
    <div v-if="showRemoveConfirm" class="remove-confirm" :style="{ left: `${removeConfirmPos.left}px`, top: `${removeConfirmPos.top}px` }">
      <template v-if="!editingAnnotation">
        <div style="display:flex; gap:.375rem; min-width:220px;">
          <button @click="startEditAnnotation" style="flex:1;">Edit</button>
          <button @click="confirmRemove" style="flex:1;">Remove</button>
        </div>
      </template>
      <template v-else>
        <div style="display:flex; flex-direction:column; gap:.375rem; min-width:220px;">
          <textarea v-model="editNote" ref="editTextarea" rows="3" placeholder="Edit note (optional)" style="width:100%; font-size:.9rem; resize:vertical;"></textarea>
          <div style="display:flex; gap:.35rem; flex-wrap:wrap;">
            <button v-for="c in highlightColors" :key="c" class="color-button" :style="{ background: c, width: '24px', height: '24px', borderRadius: '6px', border: editColor === c ? '2px solid #111' : '1px solid #ddd' }" @click="editColor = c" :title="c"></button>
          </div>
          <div style="display:flex; gap:.375rem; margin-top:.25rem;">
            <button @click="confirmEditAnnotation" style="flex:1;">Confirm edit</button>
            <button @click="cancelEditAnnotation" style="flex:1;">Cancel</button>
          </div>
        </div>
      </template>
    </div>
    <!-- Floating tooltip for annotation notes (positioned relative to viewport, computed from iframe coordinates) -->
    <div v-if="tooltipVisible" class="annotation-tooltip" :style="{ left: `${tooltipPos.left}px`, top: `${tooltipPos.top}px` }">{{ tooltipText }}</div>
    
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getDocumentDetails, openDocument, closeDocument, createAnnotation, updateAnnotation, deleteAnnotation, registerDocumentWithAnnotationConcept, searchAnnotations, getDocumentCurrentSettings, editSettings } from '@/lib/api/endpoints'
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
const fontPx = ref<number | null>(null)
const lineHeightPx = ref<number | null>(null)
const lineHeightRatio = ref<number>(1.5)
const currentTextSettingsId = ref<string | null>(null)
// Default to Times New Roman for a book-like appearance
const fontFamily = ref<string>('"Times New Roman", Times, serif')
const fontOptions = [
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Garamond', value: 'Garamond, serif' },
  { label: 'Segoe UI', value: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Monospace', value: 'monospace' }
]

const pagesPerSpread = ref(2)
const locationsPerSpread = ref(1)

// Simple in-memory list of user highlights for this session. Each item contains
// the CFI range, the selected text, and an optional color. Persistence can be added later.
// annotationsList stores session-visible annotations. When persisted, items
// may include an `id` field returned by the backend so future edits/deletes
// can be sent to the server.
const annotationsList = ref<Array<{ id?: string; cfi: string; text: string; color?: string; note?: string }>>([])
// A small Notability-like palette for users to pick highlight colors.
const highlightColors = ['#fff176', '#ffd54f', '#ffab91', '#f48fb1', '#b39ddb', '#80cbc4', '#c5e1a5']
const pendingHighlight = ref<{ cfi: string; text: string } | null>(null)
let pendingSelectionWindow: Window | null = null
const showConfirm = ref(false)
const confirmPos = ref({ left: 0, top: 0 })
const pendingNote = ref('')
// Default the selected palette color to the yellow swatch so the selection
// indicator is visible immediately when the confirm popup appears.
const pendingNoteColor = ref<string | null>('#fff176')
let iframeDocListenerTargets: Document[] = []
let iframeWinListenerTargets: Window[] = []
// Tooltip state for showing annotation text on hover (positioned in host document)
const tooltipVisible = ref(false)
const tooltipText = ref('')
const tooltipPos = ref({ left: 0, top: 0 })
const removePending = ref<{ element: Element; cfi: string | null } | null>(null)
const showRemoveConfirm = ref(false)
const removeConfirmPos = ref({ left: 0, top: 0 })
// Editing state when the user chooses to edit an existing annotation
const editingAnnotation = ref(false)
const editNote = ref('')
const editColor = ref<string | null>(null)
const editTextarea = ref<HTMLTextAreaElement | null>(null)
const annotationAttachTimers = new Map<string, number>()

function clearRemoveConfirm() {
  showRemoveConfirm.value = false
  removePending.value = null
  try { window.removeEventListener('mousedown', onGlobalMouseDown) } catch {}
  // reset edit mode when closing
  editingAnnotation.value = false
  editNote.value = ''
  editColor.value = null
}

function clearPendingConfirm() {
  showConfirm.value = false
  pendingHighlight.value = null
  pendingNote.value = ''
  pendingNoteColor.value = null
  try { pendingSelectionWindow?.getSelection?.()?.removeAllRanges() } catch {}
  pendingSelectionWindow = null
  try { window.removeEventListener('mousedown', onGlobalMouseDown) } catch {}
  // keep iframe listeners attached for highlight/remove interactions; they
  // will be torn down in cleanup when the rendition is destroyed.
}

function showTooltipForIframeElement(el: Element | null) {
  try {
    if (!el) { tooltipVisible.value = false; return }
    // Prefer the in-memory annotation text (so multiline/newlines are preserved).
    // Fall back to the element attribute when necessary.
    let note = ''
    try {
      const cfi = getHighlightCfi(el)
      if (cfi) {
        const match = annotationsList.value.find(a => a.cfi === cfi)
        if (match && match.note) note = match.note
      }
    } catch {}
    if (!note) {
      try { note = (el.getAttribute && el.getAttribute('data-annotation-note')) || '' } catch {}
    }
    if (!note) { tooltipVisible.value = false; return }

    // Compute position relative to host document using iframe frameElement
    const doc = (el as any).ownerDocument as Document | null
    const win = doc?.defaultView as Window | null
    const iframeEl = (win as any)?.frameElement as HTMLElement | null
    const elRect = el.getBoundingClientRect()
    if (!iframeEl) {
      // fallback: position near element's rect in global coords
      tooltipPos.value.left = Math.max(8, elRect.left)
      tooltipPos.value.top = Math.max(8, elRect.top - 28)
    } else {
      const iframeRect = iframeEl.getBoundingClientRect()
      // position tooltip above the element inside the iframe
      tooltipPos.value.left = Math.max(8, iframeRect.left + elRect.left)
      tooltipPos.value.top = Math.max(8, iframeRect.top + elRect.top - 36)
    }
    tooltipText.value = note
    tooltipVisible.value = true
  } catch (err) {
    tooltipVisible.value = false
  }
}

function hideTooltip() {
  tooltipVisible.value = false
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

function getHighlightCfi(el: Element | null): string | null {
  if (!el) return null
  try {
    const attrNames = ['data-annotation-cfi', 'data-epubcfi', 'data-cfi', 'data-ePubCFI']
    for (const name of attrNames) {
      const value = el.getAttribute?.(name)
      if (value) return value
    }
  } catch {}
  try {
    const text = (el.textContent || '').trim()
    if (!text) return null
    const match = annotationsList.value.find((a) => (a.text || '').trim() === text)
    return match?.cfi || null
  } catch {}
  return null
}

function syncHighlightAttributes(targetDoc?: Document) {
  try {
    // Include host document to catch epub.js SVG overlays placed outside iframes
    const docs = targetDoc
      ? [targetDoc]
      : [document, ...(iframeDocListenerTargets.length ? iframeDocListenerTargets.slice() : [])]
    if (!docs.length) return
    const textToCfi = new Map<string, string>()
    // Map multiple normalized CFI variants to color/note so epub.js attribute styles are matched
    const cfiVariantToMeta = new Map<string, { color?: string; note?: string; canonical: string }>()
    const canonicalToAnn = new Map<string, { id?: string; cfi: string; text: string; note?: string; color?: string }>()
    for (const ann of annotationsList.value) {
      try {
        const text = (ann.text || '').trim()
        if (text && !textToCfi.has(text)) textToCfi.set(text, ann.cfi)
        const variants = generateCfiVariants(ann.cfi)
        for (const v of variants) {
          cfiVariantToMeta.set(v, { color: ann.color, note: ann.note, canonical: normalizeCfi(ann.cfi) })
        }
        canonicalToAnn.set(normalizeCfi(ann.cfi), ann)
      } catch {}
    }
    for (const doc of docs) {
      if (!doc) continue
      const seenCanonical = new Set<string>()
      const elements = Array.from(doc.querySelectorAll('[data-user-highlight], .user-highlight, .epubjs-hl, [data-annotation-cfi], [data-epubcfi], [data-cfi]')) as Element[]
      for (const el of elements) {
        try {
          if (!el.getAttribute('data-user-highlight')) el.setAttribute('data-user-highlight', '1')
          ;(el as HTMLElement).style.pointerEvents = 'auto'
          const existingCfiRaw = getHighlightCfi(el)
          if (existingCfiRaw) {
            const norm = normalizeCfi(existingCfiRaw)
            if (norm) seenCanonical.add(norm)
            // Set/normalize our canonical attribute so later handlers work consistently
            try { el.setAttribute('data-annotation-cfi', norm) } catch {}
            const meta = cfiVariantToMeta.get(norm) || cfiVariantToMeta.get(existingCfiRaw) || cfiVariantToMeta.get(`epubcfi(${norm})`)
            if (meta) {
              if (meta.color) {
                try { el.setAttribute('data-annotation-color', meta.color) } catch {}
                try { (el as HTMLElement).style.background = meta.color } catch {}
                try { (el as HTMLElement).style.color = getContrastColor(meta.color) } catch {}
              }
              if (meta.note) {
                try { el.setAttribute('data-annotation-note', meta.note) } catch {}
              }
              continue
            }
          }
          const text = (el.textContent || '').trim()
          if (!text) continue
          const cfi = textToCfi.get(text)
          if (cfi) el.setAttribute('data-annotation-cfi', normalizeCfi(cfi))
        } catch {}
      }
    }
  } catch (err) {
    console.debug('[reader] syncHighlightAttributes failed', err)
  }
}

/**
 * Fetch persisted annotations for the current user+document and render them.
 */
async function loadPersistedAnnotations() {
  try {
    if (!userId.value || !documentId || !renditionInstance) return
    // Make sure iframe listeners are attached so we can find highlight nodes
    // inside each iframe document. attachIframeDocListeners is idempotent.
    try { attachIframeDocListeners() } catch {}

    const res = await searchAnnotations(userId.value, documentId, '')
    if (!res) return
    if ('error' in res) return
    const anns = Array.isArray(res) ? (res[0]?.annotations ?? []) : ((res as any)?.annotations ?? [])
    if (!Array.isArray(anns) || anns.length === 0) return

    for (const a of anns) {
      const id = a._id || a.id || a.annotation?.id
      const cfi = a.location || a.cfi || a.annotation?.location
      const color = a.color || a.annotation?.color
      const content = a.content ?? a.annotation?.content ?? ''
      if (!cfi) continue

      // avoid duplicating existing entries
      if (annotationsList.value.some(x => (id && x.id === id) || x.cfi === cfi)) continue

      const note = typeof content === 'string' && content.trim() ? content.trim() : undefined
      const highlightText = ((a as any)?.text || (a as any)?.annotation?.text || '').trim()
      const item = {
        id,
        cfi,
        text: highlightText || note || '',
        note,
        color: color || undefined
      }
      annotationsList.value.push(item)

      // Do not add epub.js overlay highlights for persisted annotations; we render
      // interactive spans directly from CFIs for accurate placement and interactivity.

      // After a short delay (allow epub.js to insert the nodes), ensure
      // the created DOM elements inside each iframe receive our attributes
      // (data-annotation-note, data-annotation-color, data-annotation-cfi)
      // so tooltip, edit and remove flows can find them.
      scheduleAnnotationAttributeAttach(item)
    }

    // ensure DOM nodes receive our data attributes and colors (additional sync)
    setTimeout(() => syncHighlightAttributes(), 200)
  } catch (err) {
    console.debug('[reader] loadPersistedAnnotations failed', err)
  }
}

function scheduleAnnotationAttributeAttach(ann: { id?: string; cfi: string; text: string; note?: string; color?: string }, attempt = 0) {
  try {
    if (!ann || !ann.cfi) return
    const key = ann.id || `${ann.cfi}::${ann.text || ''}::${ann.note || ''}`
    const maxAttempts = 7
    const baseDelay = attempt === 0 ? 80 : 140 + attempt * 160
    const delay = Math.min(baseDelay, 900)
    const existing = annotationAttachTimers.get(key)
    if (typeof existing === 'number') clearTimeout(existing)
    const timer = window.setTimeout(() => {
      annotationAttachTimers.delete(key)
      let success = false
      try {
        success = applyAnnotationAttributesToIframes(ann)
      } catch (err) {
        console.debug('[reader] applyAnnotationAttributesToIframes threw during schedule', err)
      }
      if (!success && attempt + 1 < maxAttempts) {
        scheduleAnnotationAttributeAttach(ann, attempt + 1)
      } else if (success) {
        try { syncHighlightAttributes() } catch {}
      }
    }, delay)
    annotationAttachTimers.set(key, timer)
  } catch (err) {
    console.debug('[reader] scheduleAnnotationAttributeAttach failed', err)
  }
}

/**
 * Walk each iframe document and attach attributes/styles for a single annotation.
 * Ensures programmatic highlights get data-annotation-note and color so
 * hover/edit/remove logic can find and operate on them.
 */
function applyAnnotationAttributesToIframes(ann: { id?: string; cfi: string; text: string; note?: string; color?: string }): boolean {
  try {
    if (!readerEl.value) return false
    const frames = Array.from(readerEl.value.querySelectorAll('iframe')) as HTMLIFrameElement[]
    let updated = false
    for (const frame of frames) {
      try {
        const doc = frame.contentDocument
        if (!doc) continue


        const els = findAnnotationElementsInDocument(doc, ann)
        if (!els.length) continue

        for (const el of els) {
          try {
            if (!el.getAttribute('data-user-highlight')) el.setAttribute('data-user-highlight', '1')
            try { el.classList?.add('user-highlight') } catch {}
            if (ann.cfi) el.setAttribute('data-annotation-cfi', ann.cfi)
            if (ann.id) {
              try { el.setAttribute('data-annotation-id', ann.id) } catch {}
            }
            if (ann.note) el.setAttribute('data-annotation-note', ann.note)
            else try { el.removeAttribute('data-annotation-note') } catch {}
            if (ann.color) {
              el.setAttribute('data-annotation-color', ann.color)
              try { (el as HTMLElement).style.background = ann.color } catch {}
              try { (el as HTMLElement).style.color = getContrastColor(ann.color) } catch {}
            } else {
              try { el.removeAttribute('data-annotation-color') } catch {}
              try { (el as HTMLElement).style.background = '' } catch {}
            }
            try { (el as HTMLElement).style.pointerEvents = 'auto' } catch {}
            updated = true
          } catch {}
        }
      } catch {}
    }
    return updated
  } catch (err) {
    console.debug('[reader] applyAnnotationAttributesToIframes error', err)
    return false
  }
}

/** Ensure annotations for the currently visible chapter(s) are rendered in their iframe docs.
 * Runs on section render and on each relocation so persisted annotations show up reliably.
 */
function ensureCurrentSectionAnnotations() {
  try {
    const iframes = readerEl.value?.querySelectorAll('iframe') || []
    const docs: Document[] = []
    ;(Array.from(iframes) as HTMLIFrameElement[]).forEach((iframe) => {
      try {
        const d = iframe.contentDocument
        if (d) docs.push(d)
      } catch {}
    })
    if (!docs.length) return

    const anns = Array.isArray(annotationsList.value) ? annotationsList.value : []
    for (const doc of docs) {
      for (const ann of anns) {
        try {
          if (!ann || !ann.cfi) continue
          // Only attempt annotations whose base id exists in this doc
          let baseId: string | null | undefined = undefined
          try {
            const det = parseDetailedCfi(ann.cfi)
            baseId = det.baseId || parseLooseEpubCfi(ann.cfi).id
          } catch {}
          if (!baseId) continue
          if (!doc.getElementById(baseId)) continue

          // If not already present, try to render from CFI
          let present: Element[] = []
          try { present = findAnnotationElementsInDocument(doc, ann) } catch {}
          if (!present || present.length === 0) {
            const created = tryRenderHighlightFromCfi(doc, ann as any)
            if (created) {
              try { created.setAttribute('data-annotation-cfi', normalizeCfi(ann.cfi)) } catch {}
              if ((ann as any).id) { try { created.setAttribute('data-annotation-id', (ann as any).id) } catch {} }
              if ((ann as any).note) { try { created.setAttribute('data-annotation-note', (ann as any).note) } catch {} }
              if ((ann as any).color) {
                try {
                  ;(created as HTMLElement).style.background = (ann as any).color
                  ;(created as HTMLElement).style.color = getContrastColor((ann as any).color)
                  created.setAttribute('data-annotation-color', (ann as any).color)
                } catch {}
              }
              try { (created as HTMLElement).style.pointerEvents = 'auto' } catch {}
            }
          }
        } catch {}
      }
    }
  } catch {}
}

/** Update all visible DOM elements that represent an annotation (by id or CFI)
 * to reflect new color/note values immediately across iframes.
 */
function updateAnnotationElementsInDocs(target: { id?: string | null; cfi?: string | null }, updates: { color?: string | null; note?: string | null }) {
  try {
    const normCfi = target.cfi ? normalizeCfi(target.cfi) : ''
    const iframes = readerEl.value?.querySelectorAll('iframe') || []
    const docs: Document[] = []
    ;(Array.from(iframes) as HTMLIFrameElement[]).forEach((iframe) => {
      try { const d = iframe.contentDocument; if (d) docs.push(d) } catch {}
    })
    const applyToEl = (el: Element) => {
      try {
        if (target.id) { try { el.setAttribute('data-annotation-id', target.id) } catch {} }
        const color = updates.color ?? null
        const note = (updates.note ?? '') as string | null
        if (color) {
          try { el.setAttribute('data-annotation-color', color) } catch {}
          try { (el as HTMLElement).style.background = color } catch {}
          try { (el as HTMLElement).style.color = getContrastColor(color) } catch {}
        } else {
          try { el.removeAttribute('data-annotation-color') } catch {}
          try { (el as HTMLElement).style.background = '' } catch {}
        }
        if (note && note.trim()) {
          try { el.setAttribute('data-annotation-note', note) } catch {}
        } else {
          try { el.removeAttribute('data-annotation-note') } catch {}
        }
        try { (el as HTMLElement).style.pointerEvents = 'auto' } catch {}
      } catch {}
    }
    for (const doc of docs) {
      try {
        const candidates: Element[] = []
        if (target.id) {
          try { candidates.push(...Array.from(doc.querySelectorAll(`[data-annotation-id="${CSS.escape(target.id)}"]`))) } catch {}
        }
        if (normCfi) {
          try {
            const els = Array.from(doc.querySelectorAll('[data-annotation-cfi]')) as Element[]
            for (const el of els) {
              const val = el.getAttribute('data-annotation-cfi') || ''
              if (val && normalizeCfi(val) === normCfi) candidates.push(el)
            }
          } catch {}
        }
        // Also update epubjs-hl or generic highlight spans that carry CFI in various attrs
        if (!target.id && normCfi) {
          try {
            const altEls = Array.from(doc.querySelectorAll('[data-epubcfi], [data-cfi], [data-ePubCFI]')) as Element[]
            for (const el of altEls) {
              const v = el.getAttribute('data-epubcfi') || el.getAttribute('data-cfi') || el.getAttribute('data-ePubCFI') || ''
              if (v && normalizeCfi(v) === normCfi) candidates.push(el)
            }
          } catch {}
        }
        if (candidates.length) {
          const seen = new Set<Element>()
          for (const el of candidates) {
            if (seen.has(el)) continue
            seen.add(el)
            applyToEl(el)
          }
        }
      } catch {}
    }
  } catch {}
}

/** Remove all visible DOM elements that represent an annotation (by id or CFI)
 * across iframes by unwrapping their content and normalizing parents.
 */
function removeAnnotationElementsInDocs(target: { id?: string | null; cfi?: string | null }) {
  try {
    const normCfi = target.cfi ? normalizeCfi(target.cfi) : ''
    const iframes = readerEl.value?.querySelectorAll('iframe') || []
    const docs: Document[] = []
    ;(Array.from(iframes) as HTMLIFrameElement[]).forEach((iframe) => {
      try { const d = iframe.contentDocument; if (d) docs.push(d) } catch {}
    })
    const unwrapEl = (el: Element) => {
      try {
        const parent = el.parentNode
        if (!parent) return
        while (el.firstChild) parent.insertBefore(el.firstChild, el)
        parent.removeChild(el)
        try { (parent as any).normalize?.() } catch {}
      } catch {}
    }
    for (const doc of docs) {
      try {
        const candidates: Element[] = []
        if (target.id) {
          try { candidates.push(...Array.from(doc.querySelectorAll(`[data-annotation-id="${CSS.escape(target.id)}"]`))) } catch {}
        }
        if (normCfi) {
          try {
            const els = Array.from(doc.querySelectorAll('[data-annotation-cfi], [data-epubcfi], [data-cfi], [data-ePubCFI]')) as Element[]
            for (const el of els) {
              const v = el.getAttribute('data-annotation-cfi') || el.getAttribute('data-epubcfi') || el.getAttribute('data-cfi') || el.getAttribute('data-ePubCFI') || ''
              if (v && normalizeCfi(v) === normCfi) candidates.push(el)
            }
          } catch {}
        }
        if (!candidates.length) continue
        const seen = new Set<Element>()
        for (const el of candidates) {
          if (seen.has(el)) continue
          seen.add(el)
          unwrapEl(el)
        }
        try { syncHighlightAttributes(doc) } catch {}
      } catch {}
    }
  } catch {}
}

function findAnnotationElementsInDocument(doc: Document, ann: { id?: string; cfi: string; text: string; note?: string; color?: string }): Element[] {
  const found: Element[] = []
  const seen = new Set<Element>()
  const push = (el: Element | null | undefined) => {
    if (!el || seen.has(el)) return
    seen.add(el)
    found.push(el)
  }

  try {
    const cfiVariants = generateCfiVariants(ann.cfi)
    const attrNames = ['data-annotation-cfi', 'data-epubcfi', 'data-cfi', 'data-ePubCFI']
    for (const attr of attrNames) {
      try {
        const elements = Array.from(doc.querySelectorAll(`[${attr}]`)) as Element[]
        for (const el of elements) {
          const value = el.getAttribute(attr)
          if (value && cfiMatches(value, cfiVariants)) push(el)
        }
      } catch {}
    }

    if (ann.id) {
      try {
        const elements = Array.from(doc.querySelectorAll('[data-annotation-id]')) as Element[]
        for (const el of elements) {
          const value = el.getAttribute('data-annotation-id')
          if (value && value === ann.id) push(el)
        }
      } catch {}
    }

    if (!found.length && cfiVariants.length) {
      try {
        const elements = Array.from(doc.querySelectorAll('[data-annotation]')) as Element[]
        for (const el of elements) {
          const raw = el.getAttribute('data-annotation') || ''
          if (!raw) continue
          let parsed: any = null
          try { parsed = JSON.parse(raw) } catch {}
          if (parsed && parsed.cfi && cfiMatches(String(parsed.cfi), cfiVariants)) {
            push(el)
            continue
          }
          if (cfiVariants.some((variant) => raw.includes(variant))) push(el)
        }
      } catch {}
    }

    const textCandidates = Array.from(new Set([ann.text, ann.note].filter((v): v is string => typeof v === 'string' && v.trim().length > 0)))

    if (!found.length && textCandidates.length) {
      const selector = '[data-user-highlight], .user-highlight, .highlight, .epubjs-hl'
      try {
        const elements = Array.from(doc.querySelectorAll(selector)) as Element[]
        for (const el of elements) {
          const text = el.textContent || ''
          if (!text) continue
          if (textCandidates.some(candidate => textsRoughlyEqual(text, candidate))) push(el)
        }
      } catch {}
    }

    if (!found.length && textCandidates.length) {
      for (const candidate of textCandidates) {
        try {
          const wrapped = tryWrapTextInDocument(doc, candidate)
          if (wrapped) {
            push(wrapped)
            break
          }
        } catch (err) {
          console.debug('[reader] tryWrapTextInDocument failed', err)
        }
      }
    }

    // As a last resort, render directly from the CFI when no existing element matches
    if (!found.length) {
      const created = tryRenderHighlightFromCfi(doc, ann)
      if (created) push(created)
    }
  } catch (err) {
    console.debug('[reader] findAnnotationElementsInDocument failed', err)
  }

  return found
}

/** Parse a subset of EPUB CFI to extract an element id (if present) and character offsets.
 * Example: epubcfi(/6/8!/4/4[id440]/6,/1:95,/1:116) -> id: id440, start:95, end:116
 */
function parseLooseEpubCfi(cfi: string): { id?: string | null; start?: number | null; end?: number | null } {
  const out: { id?: string | null; start?: number | null; end?: number | null } = {}
  try {
    let body = normalizeCfi(cfi)
    // Split package/content paths
    const bangIdx = body.indexOf('!')
    const content = bangIdx >= 0 ? body.slice(bangIdx + 1) : body
    // Extract id from any [id] step before the first comma
    const firstComma = content.indexOf(',')
    const pre = firstComma >= 0 ? content.slice(0, firstComma) : content
    const idMatch = pre.match(/\[([^\]]+)\]/)
    if (idMatch) out.id = idMatch[1]
    // Extract start/end offsets like \/1:95, \/1:116
    const parts = content.split(',').map(s => s.trim()).filter(Boolean)
    if (parts.length >= 2) {
      const startMatch = parts[1].match(/:(\d+)/)
      if (startMatch) out.start = parseInt(startMatch[1], 10)
    }
    if (parts.length >= 3) {
      const endMatch = parts[2].match(/:(\d+)/)
      if (endMatch) out.end = parseInt(endMatch[1], 10)
    }
  } catch {}
  return out
}

/** Parse a more detailed subset of EPUB CFI to navigate within the id scope.
 * Returns element steps after the id (even numbers: 2->first, 4->second, ...),
 * and text position hints for start/end (e.g., /1:offset -> textIndex=1, charOffset=offset).
 */
function parseDetailedCfi(cfi: string): {
  baseId?: string | null
  elementSteps: number[]
  start?: { textIndex: number; charOffset: number } | null
  end?: { textIndex: number; charOffset: number } | null
} {
  const out: {
    baseId?: string | null
    elementSteps: number[]
    start?: { textIndex: number; charOffset: number } | null
    end?: { textIndex: number; charOffset: number } | null
  } = { elementSteps: [] }
  try {
    let body = normalizeCfi(cfi)
    const bangIdx = body.indexOf('!')
    const content = bangIdx >= 0 ? body.slice(bangIdx + 1) : body
    const [pathPart, startPart, endPart] = content.split(',')
    const segments = (pathPart || '').split('/').filter(Boolean)
    // find the segment containing [id]
    let idIdx = segments.findIndex(seg => /\[[^\]]+\]/.test(seg))
    if (idIdx >= 0) {
      const m = segments[idIdx].match(/\[([^\]]+)\]/)
      if (m) out.baseId = m[1]
      // steps after id segment
      const after = segments.slice(idIdx + 1)
      out.elementSteps = after.map(s => parseInt(s, 10)).filter(n => Number.isFinite(n))
    }
    const parseTextHint = (part?: string) => {
      if (!part) return null
      const m = part.match(/\/(\d+):(\d+)/)
      if (!m) return null
      return { textIndex: Math.max(1, parseInt(m[1], 10)), charOffset: Math.max(0, parseInt(m[2], 10)) }
    }
    out.start = parseTextHint(startPart)
    out.end = parseTextHint(endPart)
  } catch {}
  return out
}

/** Attempt to render a highlight span directly from the backend CFI inside the given document.
 * Returns the created span when successful, otherwise null.
 */
function tryRenderHighlightFromCfi(doc: Document, ann: { cfi: string; color?: string; note?: string }): HTMLElement | null {
  try {
    if (!doc || !ann || !ann.cfi) return null
    // Parse base id first; if this section doesn't contain the target element, skip
    const detailedPre = parseDetailedCfi(ann.cfi)
    const preBaseId = detailedPre.baseId || parseLooseEpubCfi(ann.cfi).id
    if (!preBaseId) return null
    const preContainer = doc.getElementById(preBaseId)
    if (!preContainer) return null
    // 1) Best-effort: ask epub.js for the DOM Range for this CFI
    try {
      const range: Range | null | undefined = (renditionInstance as any)?.getRange?.(ann.cfi) || (bookInstance as any)?.getRange?.(ann.cfi)
      if (range && range.startContainer) {
        const rdoc = (range.startContainer as any).ownerDocument as Document | null
        if (rdoc === doc) {
          const span = doc.createElement('span')
          try {
            // Prefer extract+insert to keep nested structure intact
            span.appendChild(range.extractContents())
            range.insertNode(span)
          } catch {
            try { range.surroundContents(span) } catch {}
          }
          if (span.parentNode) {
            try { span.classList.add('user-highlight') } catch {}
            span.setAttribute('data-user-highlight', '1')
            span.setAttribute('data-annotation-cfi', normalizeCfi(ann.cfi))
            if (ann.note) span.setAttribute('data-annotation-note', ann.note)
            if (ann.color) {
              span.setAttribute('data-annotation-color', ann.color)
              ;(span as HTMLElement).style.background = ann.color
              try { (span as HTMLElement).style.color = getContrastColor(ann.color) } catch {}
            }
            ;(span as HTMLElement).style.pointerEvents = 'auto'
            return span
          }
        }
      }
    } catch (e) {
      // ignore getRange failures; fall back to loose parser below
    }

    // 2) Fallback: loose parse of id + (start,end) offsets under that id's subtree
    // Use a more targeted resolver: navigate to element step(s) after ID,
    // then index text only within that container so offsets map correctly.
    const detailed = detailedPre
    const baseId = preBaseId
    let container: Element | null = preContainer
    // Navigate even-number element steps: 2->first element child, 4->second, etc.
    if (detailed.elementSteps && detailed.elementSteps.length) {
      for (const step of detailed.elementSteps) {
        if (!container) break
        if (!Number.isFinite(step) || step < 2) continue
        const idx = Math.floor(step / 2) - 1
  const elChildren = Array.from(container.children) as Element[]
        container = elChildren[idx] || container
      }
    }
    if (!container) return null
    const index = buildTextIndex(container)
    if (!index || !index.totalLength) return null
    const textNodes = index.runs
    const startHint = detailed.start || null
    const endHint = detailed.end || startHint
    if (!startHint || !endHint) return null
    const startTextIdx0 = Math.max(0, (startHint.textIndex || 1) - 1)
    const endTextIdx0 = Math.max(0, (endHint.textIndex || 1) - 1)
    // Compute absolute positions relative to container's consecutive text runs
    const absOffsetFor = (ti0: number, char: number) => {
      let acc = 0
      for (let i = 0; i < index.runs.length && i < ti0; i++) acc += index.runs[i].node.length
      return acc + Math.max(0, char)
    }
    const startAbs = absOffsetFor(startTextIdx0, startHint.charOffset || 0)
    const endAbs = absOffsetFor(endTextIdx0, endHint.charOffset || 0)
    const start = Math.max(0, Math.min(index.totalLength - 1, startAbs))
    const end = Math.max(start + 1, Math.min(index.totalLength, endAbs))
    const span = wrapAbsoluteTextRange(doc, index, start, end)
    if (!span) return null
    try { span.classList.add('user-highlight') } catch {}
    span.setAttribute('data-user-highlight', '1')
    span.setAttribute('data-annotation-cfi', normalizeCfi(ann.cfi))
    if (ann.note) span.setAttribute('data-annotation-note', ann.note)
    if (ann.color) {
      span.setAttribute('data-annotation-color', ann.color)
      ;(span as HTMLElement).style.background = ann.color
      try { (span as HTMLElement).style.color = getContrastColor(ann.color) } catch {}
    }
    ;(span as HTMLElement).style.pointerEvents = 'auto'
    return span
  } catch (err) {
    console.debug('[reader] tryRenderHighlightFromCfi failed', err)
    return null
  }
}

function buildTextIndex(root: Element): { runs: Array<{ node: Text; start: number; end: number }>; totalLength: number } {
  const runs: Array<{ node: Text; start: number; end: number }> = []
  let total = 0
  try {
    const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node: Node) {
        const parent = node.parentElement
        if (!parent) return NodeFilter.FILTER_REJECT
        const tag = parent.tagName?.toLowerCase()
        if (tag === 'script' || tag === 'style' || tag === 'noscript') return NodeFilter.FILTER_REJECT
        const val = node.nodeValue || ''
        if (!val.trim()) return NodeFilter.FILTER_REJECT
        // Skip text already inside an existing highlight to avoid nesting
        if (parent.closest && parent.closest('[data-user-highlight], .user-highlight')) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      }
    } as any)
    let tn: Text | null = walker.nextNode() as Text | null
    while (tn) {
      const len = (tn.nodeValue || '').length
      if (len > 0) {
        runs.push({ node: tn, start: total, end: total + len })
        total += len
      }
      tn = walker.nextNode() as Text | null
    }
  } catch {}
  return { runs, totalLength: total }
}

function wrapAbsoluteTextRange(doc: Document, index: { runs: Array<{ node: Text; start: number; end: number }>; totalLength: number }, absStart: number, absEnd: number): HTMLElement | null {
  try {
    if (absEnd <= absStart) return null
    // Find first run containing absStart and last run containing absEnd-1
    const runs = index.runs
    if (!runs.length) return null
    let startRunIdx = runs.findIndex(r => absStart >= r.start && absStart < r.end)
    let endRunIdx = runs.findIndex(r => (absEnd - 1) >= r.start && (absEnd - 1) < r.end)
    if (startRunIdx === -1) startRunIdx = 0
    if (endRunIdx === -1) endRunIdx = runs.length - 1
    // Create a Range covering the target span across runs
    const range = doc.createRange()
    const startRun = runs[startRunIdx]
    const endRun = runs[endRunIdx]
    const startOffsetInNode = absStart - startRun.start
    const endOffsetInNode = (absEnd - endRun.start)
    range.setStart(startRun.node, Math.max(0, Math.min(startRun.node.length, startOffsetInNode)))
    range.setEnd(endRun.node, Math.max(0, Math.min(endRun.node.length, endOffsetInNode)))
    // Wrap the range in a span, using surroundContents when possible
    const span = doc.createElement('span')
    try {
      span.appendChild(range.extractContents())
      range.insertNode(span)
    } catch {
      try {
        range.surroundContents(span)
      } catch (e) {
        return null
      }
    }
    return span
  } catch (err) {
    console.debug('[reader] wrapAbsoluteTextRange failed', err)
    return null
  }
}

function cfiMatches(value: string, variants: string[]): boolean {
  if (!value || !variants.length) return false
  const trimmed = value.trim()
  const normalized = normalizeCfi(trimmed)
  for (const variant of variants) {
    const variantTrimmed = variant.trim()
    if (variantTrimmed && (variantTrimmed === trimmed || `epubcfi(${variantTrimmed})` === trimmed || variantTrimmed === normalized)) return true
    const normalizedVariant = normalizeCfi(variantTrimmed)
    if (normalized && normalizedVariant && normalized === normalizedVariant) return true
    if (normalizedVariant && normalizedVariant.endsWith(':0') && normalized === normalizedVariant.slice(0, -2)) return true
  }
  return false
}

function generateCfiVariants(cfi: string): string[] {
  const variants = new Set<string>()
  const add = (value: string | null | undefined) => {
    if (!value) return
    variants.add(value)
    const normalized = normalizeCfi(value)
    if (normalized) variants.add(normalized)
    if (normalized.endsWith(':0')) variants.add(normalized.slice(0, -2))
  }
  add(cfi)
  return Array.from(variants)
}

function normalizeCfi(value: string): string {
  let result = (value || '').trim()
  if (!result) return ''
  if (result.startsWith('epubcfi(') && result.endsWith(')')) {
    result = result.slice(8, -1)
  }
  if (result.endsWith('!')) {
    result = result.slice(0, -1)
  }
  return result
}

function normalizeAnnotationText(value: string): string {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function textsRoughlyEqual(a: string, b: string): boolean {
  const na = normalizeAnnotationText(a).toLowerCase()
  const nb = normalizeAnnotationText(b).toLowerCase()
  if (!na || !nb) return false
  if (na === nb) return true
  return na.includes(nb) || nb.includes(na)
}

function collapseWhitespaceWithMap(value: string): { text: string; map: number[] } {
  const map: number[] = []
  let result = ''
  let lastSpace = false
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (/\s/.test(ch)) {
      if (!lastSpace) {
        result += ' '
        map.push(i)
        lastSpace = true
      }
    } else {
      result += ch
      map.push(i)
      lastSpace = false
    }
  }
  let start = 0
  while (start < result.length && result[start] === ' ') start++
  let end = result.length
  while (end > start && result[end - 1] === ' ') end--
  return { text: result.slice(start, end), map: map.slice(start, end) }
}

function findLooseTextMatch(source: string, target: string): { start: number; length: number } | null {
  const normalizedTarget = normalizeAnnotationText(target)
  if (!normalizedTarget) return null
  const collapsed = collapseWhitespaceWithMap(source)
  if (!collapsed.text) return null
  const haystack = collapsed.text.toLowerCase()
  const needle = normalizedTarget.toLowerCase()
  const idx = haystack.indexOf(needle)
  if (idx === -1) return null
  const start = collapsed.map[idx]
  const endIdx = idx + needle.length - 1
  const endMapIndex = Math.min(collapsed.map.length - 1, endIdx)
  let end = collapsed.map[endMapIndex] + 1
  while (end < source.length && /\s/.test(source[end])) end++
  const length = Math.max(1, end - start)
  return { start, length }
}

/** Try to locate the exact text inside the document and wrap the first match in a span.user-highlight.
 * Returns the created span when a wrap succeeds; null otherwise. This is a heuristic fallback when epub.js didn't create highlight nodes.
 */
function tryWrapTextInDocument(doc: Document, text: string): HTMLElement | null {
  try {
    if (!doc || !text || !doc.body) return null
    const normalizedSearch = normalizeAnnotationText(text)
    if (!normalizedSearch) return null

    // Walk text nodes under body looking for the first occurrence.
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node: Node) {
        const parent = node.parentElement
        if (!parent) return NodeFilter.FILTER_REJECT
        const tag = parent.tagName?.toLowerCase()
        if (tag === 'script' || tag === 'style' || tag === 'noscript') return NodeFilter.FILTER_REJECT
        if (parent.closest && parent.closest('.user-highlight')) return NodeFilter.FILTER_REJECT
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT
        if ((node.nodeValue || '').trim().length === 0) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      }
    } as any)

    let tn: Text | null = walker.nextNode() as Text | null
    while (tn) {
      try {
        const nv = tn.nodeValue || ''
        const match = findLooseTextMatch(nv, normalizedSearch)
        if (match) {
          const span = wrapTextNodeRangeWithSpan(doc, tn, match.start, match.length)
          if (span) return span
        }
      } catch {}
      tn = walker.nextNode() as Text | null
    }
  } catch (err) {
    console.debug('[reader] tryWrapTextInDocument error', err)
  }
  return null
}

function wrapTextNodeRangeWithSpan(doc: Document, textNode: Text, start: number, length: number): HTMLElement | null {
  try {
    const val = textNode.nodeValue || ''
    const before = val.slice(0, start)
    const match = val.slice(start, start + length)
    const after = val.slice(start + length)
    const parent = textNode.parentNode
    if (!parent) return null
    const beforeNode = before ? doc.createTextNode(before) : null
    const span = doc.createElement('span')
    span.className = 'user-highlight'
    span.setAttribute('data-user-highlight', '1')
    // leave data-annotation-cfi to be set by caller
    span.textContent = match
    const afterNode = after ? doc.createTextNode(after) : null
    if (beforeNode) parent.insertBefore(beforeNode, textNode)
    parent.insertBefore(span, textNode)
    if (afterNode) parent.insertBefore(afterNode, textNode)
    parent.removeChild(textNode)
    return span
  } catch (err) {
    console.debug('[reader] wrapTextNodeRangeWithSpan failed', err)
    return null
  }
}

// Small helpers to determine readable text color against a background.
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  try {
    const h = hex.replace('#', '')
    if (h.length === 3) {
      return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) }
    }
    if (h.length === 6) {
      return { r: parseInt(h.slice(0,2), 16), g: parseInt(h.slice(2,4), 16), b: parseInt(h.slice(4,6), 16) }
    }
  } catch {}
  return null
}

function getContrastColor(bgHex: string): string {
  const rgb = hexToRgb(bgHex)
  if (!rgb) return '#000'
  // Perceived luminance formula
  const lum = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b
  return lum > 186 ? '#000' : '#fff'
}

/** Return true when a Range contains block-level elements or multiple top-level nodes. */
function isRangeMultiBlock(range: Range | null): boolean {
  if (!range) return false
  try {
    const frag = range.cloneContents()
    if (!frag) return false
    if (frag.childNodes.length > 1) return true
    const blockTags = /^(P|DIV|SECTION|LI|BLOCKQUOTE|H[1-6]|ARTICLE|HEADER|FOOTER|NAV)$/i
    const stack: Node[] = Array.from(frag.childNodes)
    while (stack.length) {
      const n = stack.shift() as Node
      if (!n) continue
      if (n.nodeType === Node.ELEMENT_NODE) {
        const el = n as Element
        try {
          if (el.tagName && blockTags.test(el.tagName)) return true
        } catch {}
        for (const c of Array.from(el.childNodes)) stack.push(c)
      }
    }
  } catch (e) {
    // conservatively treat unknown errors as multi-block to avoid bad wraps
    return true
  }
  return false
}

function onIframeMouseDown(e: MouseEvent) {
  // Handle clicks inside the iframe: detect highlight elements by walking
  // up the DOM and looking for common annotation classes or inline
  // highlight styles. If found, show the remove confirmation popup.
  try {
    // If the user is releasing the mouse (pointerup) but the highlight
    // confirmation popup is visible, ignore pointerup so the popup isn't
    // dismissed immediately after appearing due to a long-press.
    if ((e.type === 'pointerup' || e.type === 'mouseup') && showConfirm.value) {
        e.stopPropagation()
        return
    }
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
        const cfi = getHighlightCfi(direct)
        removePending.value = { element: direct, cfi }
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
          // Translate client coordinates into iframe-local coordinates while
          // staying inside the iframe viewport so hit-testing never receives
          // negative positions that lead to empty results.
          const win = doc.defaultView as Window | null
          const iframeEl = (win as any)?.frameElement as HTMLElement | null
          if (iframeEl) {
            const iframeRect = iframeEl.getBoundingClientRect()
            let localX = typeof cx === 'number' ? cx - iframeRect.left : 0
            let localY = typeof cy === 'number' ? cy - iframeRect.top : 0
            if (localX < 0) localX = 0
            if (localY < 0) localY = 0
            try {
              const docEl = doc.documentElement
              const maxX = docEl?.clientWidth || iframeRect.width
              const maxY = docEl?.clientHeight || iframeRect.height
              if (maxX && localX > maxX) localX = Math.max(0, maxX - 1)
              if (maxY && localY > maxY) localY = Math.max(0, maxY - 1)
            } catch {}
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
              // Verify the matched element is actually at the precise point we
              // queried. elementsFromPoint can return stacked elements; prefer
              // the element directly under the coordinates or a closely
              // related ancestor/descendant. This avoids selecting highlights
              // that are present elsewhere in the same section.
              try {
                const precise = (doc as Document).elementFromPoint(localX, localY)
                if (precise && precise !== matched) {
                  // accept matched only if it's the precise element or closely
                  // related (ancestor/descendant) to the precise element.
                  if (!(matched.contains(precise) || precise.contains(matched))) {
                    // not related; treat as no match so later fallback can run
                    matched = null
                  }
                }
              } catch (err) {
                // if elementFromPoint fails, continue with matched
              }
              if (!matched) {
                // fallback: prefer the precise element from elementFromPoint
                try {
                  const precise2 = (doc as Document).elementFromPoint(localX, localY)
                  if (precise2) matched = precise2
                } catch {}
              }
              // If the matched element isn't itself a highlight marker, try
              // searching its descendants for highlight elements whose
              // bounding box contains the local click coordinates. This
              // handles cases where the highlight span is nested inside a
              // block-level parent that elementFromPoint returns.
              // Use a local variable to avoid TS 'possibly null' issues and to
              // allow replacing matched with a candidate descendant if needed.
              let matchedEl = matched as Element | null
              if (matchedEl) {
                try {
                  const isDirect = matchedEl.getAttribute && (matchedEl.getAttribute('data-user-highlight') || matchedEl.classList?.contains('user-highlight') || matchedEl.className?.includes('highlight'))
                  if (!isDirect) {
                    try {
                      const candidates = Array.from(matchedEl.querySelectorAll('[data-user-highlight], .user-highlight, .highlight'))
                      for (const cand of candidates) {
                        try {
                          const r = cand.getBoundingClientRect()
                          if (localX >= r.left && localX <= r.right && localY >= r.top && localY <= r.bottom) {
                            matchedEl = cand
                            break
                          }
                        } catch {}
                      }
                    } catch {}
                  }
                } catch {}
                try { console.debug('[reader] hit-test matched element', { tag: matchedEl.tagName, class: matchedEl.className }) } catch {}
                searchStart = matchedEl as Node
              }
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
      const cfi = getHighlightCfi(hl)
      removePending.value = { element: hl, cfi }
      showRemoveConfirm.value = true
        // populate edit fields with existing annotation values so the Edit flow
        // starts with current values
        try {
          editingAnnotation.value = false
          // Try several strategies to find the existing note/color: by CFI,
          // by element attribute, then by matching annotation text.
          let foundNote: string | undefined = undefined
          let foundColor: string | null = null
          try {
            const match = annotationsList.value.find(a => a.cfi === cfi)
            if (match) {
              foundNote = match.note
              foundColor = match.color || null
            }
          } catch {}

          // If not found via CFI, try reading attributes from the element
          if (!foundNote) {
            try { foundNote = hl.getAttribute?.('data-annotation-note') || undefined } catch {}
          }
          if (!foundColor) {
            try { foundColor = hl.getAttribute?.('data-annotation-color') || null } catch {}
          }

          // As a last resort, try matching annotationsList by text content
          if (!foundNote || foundNote === '') {
            try {
              const text = (hl.textContent || '').trim()
              if (text) {
                const byText = annotationsList.value.find(a => (a.text || '').trim() === text || (a.text || '').includes(text) || text.includes((a.text || '').trim()))
                if (byText) {
                  if (!foundNote) foundNote = byText.note
                  if (!foundColor) foundColor = byText.color || null
                }
              }
            } catch {}
          }

          editNote.value = (foundNote || '')
          editColor.value = foundColor || null
        } catch {}
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

function onIframePointerOver(e: PointerEvent) {
  try {
    const node = e.target as Node | null
    if (!node) return
    // find the highlight element starting from the event target
    const hl = findHighlightElement(node)
    if (!hl) { hideTooltip(); return }
    // Show tooltip only if annotation has note text
    const note = (hl.getAttribute && hl.getAttribute('data-annotation-note')) || ''
    if (note) {
      showTooltipForIframeElement(hl)
    } else {
      hideTooltip()
    }
  } catch (err) {
    hideTooltip()
  }
}

function onIframePointerOut(e: PointerEvent) {
  try {
    // pointerout may include relatedTarget; if leaving into another highlight,
    // let the pointerover handler show the new tooltip. For simplicity, hide on out.
    hideTooltip()
  } catch {
    hideTooltip()
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
            // doc.addEventListener('mousedown', onIframeMouseDown, true)
            // doc.addEventListener('click', onIframeMouseDown, true)
            // pointer events can be more reliable in some user agents; attach them too
            try { doc.addEventListener('pointerdown', onIframeMouseDown, true) } catch {}
            try { doc.addEventListener('pointerup', onIframeMouseDown, true) } catch {}
            // Hover handlers for annotation note tooltip
            try { doc.addEventListener('pointerover', onIframePointerOver, true) } catch {}
            try { doc.addEventListener('pointerout', onIframePointerOut, true) } catch {}
            iframeDocListenerTargets.push(doc)
            try {
              const win = doc.defaultView
              if (win && !iframeWinListenerTargets.includes(win)) {
                console.debug('[reader] attaching window listeners to iframe window', win)
                // win.addEventListener('mousedown', onIframeMouseDown, true)
                // win.addEventListener('click', onIframeMouseDown, true)
                try { win.addEventListener('pointerdown', onIframeMouseDown, true) } catch {}
                try { win.addEventListener('pointerup', onIframeMouseDown, true) } catch {}
                iframeWinListenerTargets.push(win)
              }
            } catch (e) { console.debug('[reader] failed to attach window listeners', e) }
            setTimeout(() => syncHighlightAttributes(doc), 20)
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
  try { doc.removeEventListener('pointerover', onIframePointerOver) } catch {}
  try { doc.removeEventListener('pointerout', onIframePointerOut) } catch {}
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
    // Load and apply document text settings
    try {
      const sres = await getDocumentCurrentSettings(documentId)
      if (Array.isArray(sres) && sres[0]?.settings) {
        const s = sres[0].settings
        currentTextSettingsId.value = s._id
        if (s.font) fontFamily.value = s.font
        fontPx.value = Number.isFinite(s.fontSize as any) ? s.fontSize : 16
        if (Number.isFinite(s.lineHeight as any) && Number.isFinite(s.fontSize as any) && s.fontSize) {
          lineHeightRatio.value = Math.max(1.0, Math.min(3.0, (s.lineHeight as number) / (s.fontSize as number)))
        } else {
          lineHeightRatio.value = 1.5
        }
        lineHeightPx.value = Math.max(10, Math.round((fontPx.value || 16) * lineHeightRatio.value))
        try { applyTheme(); applyFont() } catch {}
        }
    } catch {}
    // FRONT-END SYNC: temporarily register the document with the Annotation
    // concept so the backend accepts annotation creates for this document.
    // This should be removed once server-side sync is in place.
    try {
      if (userId.value && documentId) {
        // await registration so that subsequent load of persisted annotations
        // sees a registered document when the backend requires it.
        await registerDocumentWithAnnotationConcept(userId.value, documentId).catch((err) => console.debug('[reader] registerDocumentWithAnnotationConcept failed on open', err))
        // Now fetch persisted annotations and render them into the rendition
        try { await loadPersistedAnnotations() } catch (err) { console.debug('[reader] loadPersistedAnnotations error', err) }
      }
    } catch (err) {
      console.debug('[reader] registerDocumentWithAnnotationConcept call error on open', err)
    }
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to open document'
  } finally {
    pending.value = false
  }
})

onBeforeUnmount(async () => {
  if (cleanup) cleanup()
  window.removeEventListener('keydown', onKeyDown)
  try {
    annotationAttachTimers.forEach((timer) => { try { clearTimeout(timer) } catch {} })
    annotationAttachTimers.clear()
  } catch {}
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
          const existing = Array.from(doc.querySelectorAll('.user-highlight, [data-user-highlight], .epubjs-hl'))
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

        // Disallow multi-paragraph (multi-block) selections — clear and ignore.
        try {
          if (selRange && isRangeMultiBlock(selRange)) {
            console.debug('[reader] multi-block selection ignored')
            try { selection?.removeAllRanges() } catch {}
            return
          }
        } catch {}

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
    // Ensure chapter-specific annotations get created when their section loads
    setTimeout(() => ensureCurrentSectionAnnotations(), 70)
    setTimeout(() => syncHighlightAttributes(), 80)
  })

  rendition.on('relocated', (location: any) => {
    if (!location || currentToken !== retryToken) return
    updateNavigationState(location)
    // After navigating to a new section, re-attach listeners and resync attributes
    setTimeout(() => attachIframeDocListeners(), 30)
    setTimeout(() => ensureCurrentSectionAnnotations(), 40)
    setTimeout(() => syncHighlightAttributes(), 50)
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
function confirmHighlight(color?: string, note?: string) {
  if (!pendingHighlight.value || !renditionInstance) { clearPendingConfirm(); return }
  const { cfi, text } = pendingHighlight.value
  const chosenColor = color || pendingNoteColor.value || '#fff176'
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
          span.setAttribute('data-annotation-cfi', cfi)
              if (note) span.setAttribute('data-annotation-note', note)
          span.style.background = chosenColor
          // choose a readable text color against the chosen background
          try { span.style.color = getContrastColor(chosenColor) } catch { span.style.color = '#000' }
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

  // Record the annotation once (including chosen color and optional note)
  const ann: { id?: string; cfi: string; text: string; color?: string; note?: string } = { cfi, text, color: chosenColor }
  if (note) ann.note = note
  // Optimistically add to local list so UI updates immediately
  annotationsList.value.push(ann)

  // Persist to backend (best-effort). Attach returned annotation id when available.
    try {
      if (userId.value && documentId) {
        const payload = {
          creator: userId.value,
          document: documentId,
          color: chosenColor,
          content: note ?? '',
          location: cfi,
          tags: [] as string[],
        }
        console.debug('[reader] createAnnotation payload', payload)
        createAnnotation(payload).then((resp: any) => {
          if (resp && (resp as any).annotation) {
            const createdId = (resp as any).annotation as string
            // update the in-memory record with id so future edits/deletes can reference it
            const match = annotationsList.value.find((a) => a.cfi === cfi && (a.text || '').trim() === (text || '').trim())
            if (match) match.id = createdId
          }
        }).catch((err) => {
          console.debug('[reader] createAnnotation failed', err)
        })
      } else {
        console.warn('[reader] skipping createAnnotation: missing userId or documentId', { userId: userId.value, documentId })
      }
    } catch (err) {
      console.debug('[reader] createAnnotation call error', err)
    }

  // Ensure any highlights present in iframe docs keep consistent metadata.
  syncHighlightAttributes()
  setTimeout(() => syncHighlightAttributes(), 30)
  // Clear selection inside the iframe (if we recorded it) so the blue selection
  // is removed and only the yellow highlight remains visible.
  try { pendingSelectionWindow?.getSelection?.()?.removeAllRanges() } catch {}
  pendingSelectionWindow = null
  clearPendingConfirm()
}

/** Helper invoked by color buttons in the confirm popup. */
function addAnnotation() {
  try {
    const note = (pendingNote.value || '').trim()
    const color = pendingNoteColor.value || undefined
    confirmHighlight(color, note || undefined)
  } catch (e) {
    clearPendingConfirm()
  }
}

/** Confirm and remove the pending highlighted element. */
function confirmRemove() {
  const pending = removePending.value
  if (!pending) { clearRemoveConfirm(); return }
  const { element: el, cfi: cfiToRemove } = pending

  // Only allow removing elements that were explicitly marked as highlights.
  // This avoids accidentally unwrapping large structural elements.
  try {
    const hasMarker = el.getAttribute && (el.getAttribute('data-user-highlight') || el.classList?.contains('user-highlight'))
    if (!hasMarker) { clearRemoveConfirm(); return }
  } catch { clearRemoveConfirm(); return }

  // Resolve backend annotation id(s) up front when possible so we can
  // reliably delete even if text matching fails after DOM changes.
  const idsToDeleteSet = new Set<string>()
  try {
    const idAttr = el.getAttribute?.('data-annotation-id')
    if (idAttr) idsToDeleteSet.add(idAttr)
    // Also map from our in-memory list by CFI/text/id when available
    if (annotationsList.value.length) {
      for (const a of annotationsList.value) {
        try {
          if (a.id && idAttr && a.id === idAttr) idsToDeleteSet.add(a.id)
          if (cfiToRemove && a.cfi && normalizeCfi(a.cfi) === normalizeCfi(cfiToRemove) && a.id) idsToDeleteSet.add(a.id)
        } catch {}
      }
    }
  } catch {}

  // First, try to remove the annotation using the epub.js API if we have a CFI.
  // This is the most important step for clearing the library's internal state.
  if (cfiToRemove && renditionInstance) {
    try {
      const ann = (renditionInstance as any).annotations
      if (ann) {
        const variants = generateCfiVariants(cfiToRemove)
        console.debug('[reader] removing annotation via API with cfi', cfiToRemove, 'variants=', variants)
        let removedViaApi = false
        for (const v of variants) {
          try { ann.remove(v, 'highlight'); removedViaApi = true } catch {}
          if (!removedViaApi) { try { ann.remove(v); removedViaApi = true } catch {} }
          if (!removedViaApi) { try { ann.removeAnnotation(v); removedViaApi = true } catch {} }
          if (removedViaApi) break
        }
        if (!removedViaApi) {
          console.debug('[reader] annotation remove via API did not confirm; proceeding with DOM cleanup only')
        }
      }
    } catch (e) {
      console.debug('[reader] failed to access annotation manager', e)
    }
  }

  // Second, remove all DOM instances of this annotation across visible iframes.
  try {
    const idAttr = el.getAttribute?.('data-annotation-id') || undefined
    removeAnnotationElementsInDocs({ id: idAttr || undefined, cfi: cfiToRemove || undefined })
  } catch {}

  // Third, remove matching entries from our local annotationsList and ensure id(s) are collected.
  try {
    const text = (el.textContent || '').trim()
    const idsToDelete: string[] = []
    // seed from earlier resolved ids
    try { idsToDelete.push(...Array.from(idsToDeleteSet)) } catch {}
    if (text) {
      // collect ids that match this text or cfi
      for (const a of annotationsList.value) {
        const at = (a.text || '').trim()
        if (!at) continue
        if (cfiToRemove && a.cfi === cfiToRemove) {
          if (a.id) idsToDelete.push(a.id)
          continue
        }
        if (at === text || at.includes(text) || text.includes(at)) {
          if (a.id) idsToDelete.push(a.id)
        }
      }
      annotationsList.value = annotationsList.value.filter((a) => {
        const at = (a.text || '').trim()
        if (!at) return true
        if (cfiToRemove && a.cfi === cfiToRemove) return false
        return !(at === text || at.includes(text) || text.includes(at))
      })
    } else if (cfiToRemove) {
      // Fallback to removing by CFI if text is empty
      for (const a of annotationsList.value) if (a.cfi === cfiToRemove && a.id) idsToDelete.push(a.id)
      annotationsList.value = annotationsList.value.filter(a => a.cfi !== cfiToRemove)
    }

    // Tell backend to delete matching annotations (best-effort)
    try {
      if (userId.value) {
        const uniqueIds = Array.from(new Set(idsToDelete.filter(Boolean)))
        if (uniqueIds.length) {
          for (const id of uniqueIds) {
            deleteAnnotation(userId.value, id).catch((err) => console.debug('[reader] deleteAnnotation failed', err))
          }
        } else if (cfiToRemove) {
          // As a last resort, query backend and try to resolve id by CFI
          try {
            searchAnnotations(userId.value, documentId, '').then((res: any) => {
              try {
                const anns = Array.isArray(res) ? (res[0]?.annotations ?? []) : (res?.annotations ?? [])
                const target = (anns || []).find((a: any) => normalizeCfi(a?.location || a?.cfi || '') === normalizeCfi(cfiToRemove))
                const id = target?._id || target?.id || target?.annotation?.id
                if (id) deleteAnnotation(userId.value!, id).catch((err) => console.debug('[reader] deleteAnnotation failed (resolved via search)', err))
              } catch {}
            }).catch(() => {})
          } catch {}
        }
      }
    } catch (err) { console.debug('[reader] deleteAnnotation call error', err) }
  } catch {}

  // Clear any selection inside the iframe so future selections are fresh
  try { pendingSelectionWindow?.getSelection?.()?.removeAllRanges() } catch {}

  clearRemoveConfirm()
  // Avoid forcing a re-display here; re-rendering immediately can cause
  // epub.js to recreate the highlight if its internal cache wasn't updated yet.
  // We rely on API removal + DOM cleanup above.
  try { syncHighlightAttributes() } catch {}
}

function startEditAnnotation() {
  try {
    if (!removePending.value) return
    editingAnnotation.value = true
    // autofocus the textarea after it is rendered
    try {
      nextTick(() => {
        const el = editTextarea.value
        if (el) {
          el.focus()
          try { const len = el.value.length; el.setSelectionRange(len, len) } catch {}
        }
      })
    } catch {}
  } catch {}
}

function cancelEditAnnotation() {
  // cancel editing and close the popup
  editingAnnotation.value = false
  clearRemoveConfirm()
}

function confirmEditAnnotation() {
  const pending = removePending.value
  if (!pending) { clearRemoveConfirm(); return }
  const { element: el, cfi: cfiToEdit } = pending
  try {
    const color = editColor.value || undefined
    const note = (editNote.value || '').trim() || undefined

    // Update DOM element styling and attributes immediately for instant feedback
    try {
      if (el && el instanceof HTMLElement) {
        if (color) {
          el.style.background = color
          try { el.style.color = getContrastColor(color) } catch {}
          try { el.setAttribute('data-annotation-color', color) } catch {}
        } else {
          try { el.removeAttribute('data-annotation-color') } catch {}
          el.style.background = ''
        }
        if (note) {
          try { el.setAttribute('data-annotation-note', note) } catch {}
        } else {
          try { el.removeAttribute('data-annotation-note') } catch {}
        }
      }
    } catch {}

    // Update our in-memory annotations list
    try {
      let found = false
      annotationsList.value = annotationsList.value.map(a => {
        if (cfiToEdit && a.cfi === cfiToEdit) {
          found = true
          return { ...a, color: color, note: note }
        }
        return a
      })
      // If not found by CFI, try matching by text and update the first match
      if (!found && el) {
        const text = (el.textContent || '').trim()
        if (text) {
          for (let i = 0; i < annotationsList.value.length; i++) {
            if ((annotationsList.value[i].text || '').trim() === text) {
              annotationsList.value[i] = { ...annotationsList.value[i], color: color, note: note }
              break
            }
          }
        }
      }
    } catch {}

    // Immediately propagate edits to all iframe docs (not just the clicked element)
    try {
      const t: { id?: string | null; cfi?: string | null } = { cfi: cfiToEdit }
      // If we already know the id for this CFI in-memory, include it for stronger matching
      const known = annotationsList.value.find(a => (cfiToEdit && a.cfi === cfiToEdit))
      if (known?.id) t.id = known.id
      updateAnnotationElementsInDocs(t, { color: color ?? null, note: note ?? null })
    } catch {}

    // Re-sync attributes across iframes
    try { syncHighlightAttributes() } catch {}

    // Persist edit to backend: prefer update if we have an id, otherwise create.
    try {
      if (userId.value) {
        // find annotation by CFI first, then by text
        let target: { id?: string; cfi: string; text: string } | undefined
        if (cfiToEdit) target = annotationsList.value.find(a => a.cfi === cfiToEdit)
        if (!target && el) {
          const txt = (el.textContent || '').trim()
          if (txt) target = annotationsList.value.find(a => (a.text || '').trim() === txt)
        }
        if (target && target.id) {
          // update existing annotation
          updateAnnotation({ user: userId.value, annotation: target.id, newColor: color, newContent: note ?? '' }).catch((err) => {
            console.debug('[reader] updateAnnotation failed', err)
          })
          // We know the id; make sure all DOM instances carry it and reflect updates
          try { updateAnnotationElementsInDocs({ id: target.id, cfi: target.cfi }, { color: color ?? null, note: note ?? null }) } catch {}
        } else {
          // no persisted id: create a new annotation record for this highlight
          const loc = cfiToEdit || (target ? target.cfi : undefined)
          if (loc) {
            if (userId.value && documentId) {
              const payload = {
                creator: userId.value,
                document: documentId,
                color: color,
                content: note ?? '',
                location: loc,
                tags: [] as string[],
              }
              console.debug('[reader] createAnnotation (edit) payload', payload)
              createAnnotation(payload).then((resp: any) => {
                if (resp && (resp as any).annotation) {
                  const createdId = (resp as any).annotation as string
                  // attach id to the matching in-memory record
                  const match = annotationsList.value.find(a => a.cfi === loc || (a.text || '').trim() === (el.textContent || '').trim())
                  if (match) match.id = createdId
                  // Also mark DOM nodes with the new id so future edits/deletes sync instantly
                  try { updateAnnotationElementsInDocs({ id: createdId, cfi: loc }, { color: color ?? null, note: note ?? null }) } catch {}
                }
              }).catch((err) => console.debug('[reader] createAnnotation failed (edit)', err))
            } else {
              console.warn('[reader] skipping createAnnotation (edit): missing userId or documentId', { userId: userId.value, documentId })
            }
          }
        }
      }
    } catch (err) { console.debug('[reader] persist edit error', err) }
  } catch (err) {
    // ignore edit errors
  } finally {
    clearRemoveConfirm()
  }
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
  const anchorCfi = getCurrentStartCfi()
  if (fontPx.value == null) fontPx.value = 16
  fontPx.value = Math.min(48, fontPx.value + 2)
  // Always keep line-height synced to 1.5x the current font size
  lineHeightPx.value = Math.max(10, Math.round((fontPx.value || 16) * (lineHeightRatio.value || 1.5)))
  applyFont()
  persistTextSettings()
  restoreCfiAfterResize(anchorCfi)
}

/** Incrementally reduce the rendition font size. */
function decreaseFont() {
  const anchorCfi = getCurrentStartCfi()
  if (fontPx.value == null) fontPx.value = 16
  fontPx.value = Math.max(10, fontPx.value - 2)
  // Always keep line-height synced to 1.5x the current font size
  lineHeightPx.value = Math.max(10, Math.round((fontPx.value || 16) * (lineHeightRatio.value || 1.5)))
  applyFont()
  persistTextSettings()
  restoreCfiAfterResize(anchorCfi)
}

/** Apply the current font size value to the rendition theme. */
function applyFont() {
  if (!renditionInstance) return
  if (fontPx.value != null) {
    renditionInstance.themes.fontSize(`${fontPx.value}px`)
  } else {
    renditionInstance.themes.fontSize(`${fontScale.value}%`)
  }
  // Re-apply theme after font changes to ensure colors persist
  applyTheme()
}

function onFontChange() {
  // Apply the selected font family to the rendition using the theme
  const anchorCfi = getCurrentStartCfi()
  lineHeightPx.value = Math.max(10, Math.round((fontPx.value || 16) * (lineHeightRatio.value || 1.5)))
  applyTheme()
  restoreCfiAfterResize(anchorCfi)
  persistTextSettings()
}

/** Apply a simple, high-contrast theme to the book content (black on white). */
function applyTheme() {
  if (!renditionInstance) return
  try {
    // Register a small theme that forces page body color and background
    // epub.js theme API supports registering named themes and selecting them.
    const theme: any = {
      body: {
        color: '#000000',
        background: '#ffffff',
        ['font-family']: fontFamily.value
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
    const sizePx = fontPx.value ?? 16
    const lhPx = (lineHeightRatio.value ? sizePx * lineHeightRatio.value : (lineHeightPx.value ?? Math.round(sizePx * 1.5)))
    if (lhPx != null) theme.body['line-height'] = `${lhPx}px`
    try { renditionInstance.themes.register('reader-high-contrast', theme) } catch { /* ignore if already registered */ }
    try { renditionInstance.themes.select('reader-high-contrast') } catch { /* fallback if select fails */ }
    // Ensure live font changes take effect even if the theme was already registered
    try {
      (renditionInstance as any).themes.override('font-family', fontFamily.value, true)
    } catch {}
  } catch {
    // ignore theme application errors
  }
}

function persistTextSettings() {
  try {
    if (!currentTextSettingsId.value) return
    const size = fontPx.value != null ? fontPx.value : 16
    const ratio = lineHeightRatio.value || 1.5
    const lh = Math.max(10, Math.round(size * ratio))
    editSettings(currentTextSettingsId.value, fontFamily.value, size, lh).catch(() => {})
  } catch {}
}

function increaseLineHeight() {
  const anchorCfi = getCurrentStartCfi()
  // Step line-height ratio by 0.1 within sensible bounds
  lineHeightRatio.value = Math.min(3.0, parseFloat((lineHeightRatio.value + 0.1).toFixed(1)))
  const size = fontPx.value || 16
  lineHeightPx.value = Math.max(10, Math.round(size * lineHeightRatio.value))
  applyTheme()
  persistTextSettings()
  restoreCfiAfterResize(anchorCfi)
}

function decreaseLineHeight() {
  const anchorCfi = getCurrentStartCfi()
  lineHeightRatio.value = Math.max(1.0, parseFloat((lineHeightRatio.value - 0.1).toFixed(1)))
  const size = fontPx.value || 16
  lineHeightPx.value = Math.max(10, Math.round(size * lineHeightRatio.value))
  applyTheme()
  persistTextSettings()
  restoreCfiAfterResize(anchorCfi)
}

function getCurrentStartCfi(): string | null {
  try {
    const loc: any = (renditionInstance as any)?.currentLocation?.()
    return loc?.start?.cfi || null
  } catch {
    return null
  }
}

function restoreCfiAfterResize(anchorCfi: string | null) {
  if (!anchorCfi || !renditionInstance) return
  // Schedule a couple of attempts to restore after layout settles
  try { setTimeout(() => { try { renditionInstance!.display(anchorCfi) } catch {} }, 0) } catch {}
  try { setTimeout(() => { try { renditionInstance!.display(anchorCfi) } catch {} }, 120) } catch {}
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

.color-button {
  padding: 0;
  display: inline-block;
  cursor: pointer;
}

.color-button:focus {
  outline: 2px solid #2563eb33;
}

.annotation-tooltip {
  position: fixed;
  z-index: 1100; /* below remove-confirm (1200) so remove popup remains on top */
  max-width: 320px;
  background: rgba(20,20,20,0.9);
  color: #fff;
  padding: .4rem .6rem;
  border-radius: .375rem;
  box-shadow: 0 6px 18px rgba(0,0,0,0.18);
  font-size: .9rem;
  pointer-events: none; /* do not block pointer events to underlying content */
  white-space: pre-wrap; /* preserve newlines and spacing in annotation text */
  word-break: break-word;
}


</style>
