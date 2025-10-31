<template>
  <div class="card">
    <h2>Annotations</h2>
    <div v-if="!userId" style="color: var(--muted)">Login to manage annotations.</div>
    <div v-else>
      <form @submit.prevent="createAnno">
        <label>Document ID <input v-model="docId" required /></label>
        <label>Location (CFI) <input v-model="location" required /></label>
        <label>Content <input v-model="content" /></label>
        <label>Color <input v-model="color" placeholder="#ff0000" /></label>
        <label>Tags (comma-separated IDs) <input v-model="tagsCsv" /></label>
        <button>Create Annotation</button>
      </form>
      <div v-if="lastAnnoId" style="margin-top:.5rem">Created annotation: {{ lastAnnoId }}</div>

      <hr style="margin:1rem 0; border-color:#1f2937" />

      <form @submit.prevent="search">
        <label>Search Criteria <input v-model="criteria" placeholder="text or tag" /></label>
        <button>Search</button>
      </form>
      <ul>
        <li v-for="a in results" :key="a._id">
          <strong>{{ a.content || '(no content)' }}</strong>
          <span style="color:var(--muted)"> @ {{ a.location }}</span>
        </li>
      </ul>
      <div v-if="error" style="color:#f87171">{{ error }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { createAnnotation, searchAnnotations, registerDocumentWithAnnotationConcept } from '@/lib/api/endpoints'
import type { Annotation } from '@/lib/api/types'

const auth = useAuthStore()
const { userId } = storeToRefs(auth)

const docId = ref('')
const location = ref('')
const content = ref('')
const color = ref('')
const tagsCsv = ref('')
const lastAnnoId = ref('')
const criteria = ref('')
const results = ref<Annotation[]>([])
const error = ref('')

async function createAnno() {
  if (!userId.value) return
  error.value = ''
  try {
    // FRONT-END SYNC: ensure Annotation concept knows about this document
    // (temporary client-side registration until backend sync is in place)
    try {
      await registerDocumentWithAnnotationConcept(userId.value, docId.value)
    } catch (err) {
      console.debug('[annotations] registerDocumentWithAnnotationConcept failed', err)
    }

    const res = await createAnnotation({
      creator: userId.value,
      document: docId.value,
      color: color.value || undefined,
      content: content.value || undefined,
      location: location.value,
      tags: tagsCsv.value.split(',').map((s) => s.trim()).filter(Boolean)
    })
    if ('error' in res) throw new Error(res.error)
    lastAnnoId.value = res.annotation
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to create annotation'
  }
}

async function search() {
  if (!userId.value || !docId.value) return
  error.value = ''
  try {
    const res = await searchAnnotations(userId.value, docId.value, criteria.value)
    if ('error' in res) throw new Error(res.error)
    results.value = res[0]?.annotations ?? []
  } catch (e: any) {
    error.value = e?.message ?? 'Search failed'
  }
}
</script>
