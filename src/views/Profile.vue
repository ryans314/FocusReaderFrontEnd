<template>
  <div class="card" style="max-width: 860px; margin: 0 auto;">
    <h2 style="margin-top:0;">Profile</h2>

    <section>
      <h3>Account</h3>
      <div style="display:flex; align-items:center; gap:.75rem;">
        <label style="color:var(--muted);">Username:</label>
        <strong>{{ username || '—' }}</strong>
      </div>
    </section>

    <section>
      <h3>Change password</h3>
      <div style="display:grid; grid-template-columns: 160px 1fr; gap:.5rem 1rem; align-items:center; max-width:600px;">
        <label for="current">Current password</label>
        <input id="current" type="password" v-model="currentPassword" autocomplete="current-password" />
        <label for="new">New password</label>
        <input id="new" type="password" v-model="newPassword" autocomplete="new-password" />
        <label for="confirm">Confirm new password</label>
        <input id="confirm" type="password" v-model="confirmPassword" autocomplete="new-password" />
      </div>
      <div style="margin-top:.5rem; display:flex; gap:.5rem; align-items:center;">
        <button :disabled="pwdPending" @click="onChangePassword">Change Password</button>
        <span v-if="pwdPending" style="color:var(--muted);">Saving…</span>
        <span v-if="pwdError" style="color:#b00020;">{{ pwdError }}</span>
        <span v-if="pwdSuccess" style="color:#2e7d32;">Password updated.</span>
      </div>
    </section>

    <section>
      <h3>Default text settings</h3>
      <div v-if="settingsPending" style="color:var(--muted);">Loading…</div>
      <template v-else>
        <div style="display:grid; grid-template-columns: 160px 1fr; gap:.5rem 1rem; align-items:center; max-width:640px;">
          <label>Font</label>
          <select v-model="font">
            <option v-for="opt in fontOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>

          <label>Font size</label>
          <div style="display:flex; gap:.5rem; align-items:center;">
            <button @click="decFont" :disabled="fontSize <= 10">A−</button>
            <input type="number" v-model.number="fontSize" min="10" max="48" step="1" style="width:80px;" />
            <button @click="incFont" :disabled="fontSize >= 48">A+</button>
            <span style="color:var(--muted);">{{ fontSize }}px</span>
          </div>

          <label>Line height</label>
          <div style="display:flex; gap:.5rem; align-items:center;">
            <button @click="decRatio" :disabled="lineHeightRatio <= 1.0">−</button>
            <span>{{ lineHeightRatio.toFixed(1) }}×</span>
            <button @click="incRatio" :disabled="lineHeightRatio >= 3.0">+</button>
            <span style="color:var(--muted);">≈ {{ Math.round(lineHeightPx) }}px</span>
          </div>
        </div>
        <div style="margin-top:.75rem; display:flex; gap:.5rem; align-items:center;">
          <button :disabled="savePending" @click="onSaveSettings">Save settings</button>
          <span v-if="savePending" style="color:var(--muted);">Saving…</span>
          <span v-if="saveError" style="color:#b00020;">{{ saveError }}</span>
          <span v-if="saveSuccess" style="color:#2e7d32;">Saved.</span>
        </div>
        <div v-if="!settingsId" style="margin-top:.5rem; color:var(--muted);">No defaults yet — saving will create them.</div>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { getUserDetails, changePassword, getUserDefaultSettings, editSettings } from '@/lib/api/endpoints'

const auth = useAuthStore()
const { userId, sessionId } = storeToRefs(auth)

const username = ref('')
const pwdPending = ref(false)
const pwdError = ref('')
const pwdSuccess = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')

const settingsPending = ref(true)
const settingsId = ref<string | null>(null)
const font = ref<string>('"Times New Roman", Times, serif')
const fontSize = ref<number>(16)
const lineHeightRatio = ref<number>(1.5)
const lineHeightPx = computed(() => Math.max(10, Math.round(fontSize.value * lineHeightRatio.value)))

const savePending = ref(false)
const saveError = ref('')
const saveSuccess = ref(false)

const fontOptions = [
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Special Elite', value: '"Special Elite", monospace' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Garamond', value: 'Garamond, serif' },
  { label: 'Segoe UI', value: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Monospace', value: 'monospace' }
]

onMounted(async () => {
  // Fetch username (session-based)
  if (sessionId.value) {
    try {
      const ures: any = await getUserDetails(sessionId.value)
      if (Array.isArray(ures) && ures[0]?.username) {
        username.value = ures[0].username
      } else if (ures && (ures.username || (ures[0] && ures[0].username))) {
        // handle server responses that return an object { username } or array
        username.value = ures.username || (Array.isArray(ures) ? ures[0]?.username : '')
      }
    } catch {}
  }

  // Fetch default text settings
  try {
    if (!userId.value) throw new Error('Not authenticated')
    const sres = await getUserDefaultSettings(userId.value)
    if (Array.isArray(sres) && sres[0]?.settings) {
      const s = sres[0].settings
      settingsId.value = s._id
      font.value = s.font || font.value
      fontSize.value = typeof s.fontSize === 'number' ? s.fontSize : 16
      if (typeof s.lineHeight === 'number' && s.fontSize) {
        lineHeightRatio.value = Math.max(1.0, Math.min(3.0, s.lineHeight / s.fontSize))
      }
    } else {
      settingsId.value = null
      font.value = font.value
      fontSize.value = 16
      lineHeightRatio.value = 1.5
    }
  } catch (e) {
    settingsId.value = null
  } finally {
    settingsPending.value = false
  }
})

function validatePasswordInputs(): string | null {
  if (!currentPassword.value || !newPassword.value || !confirmPassword.value) return 'Please fill in all password fields.'
  if (newPassword.value !== confirmPassword.value) return 'New passwords do not match.'
  if (newPassword.value.length < 8) return 'New password must be at least 8 characters.'
  return null
}

async function onChangePassword() {
  if (!sessionId.value) return
  pwdError.value = ''
  pwdSuccess.value = false
  const v = validatePasswordInputs()
  if (v) { pwdError.value = v; return }
  pwdPending.value = true
  try {
    if (!sessionId.value) throw new Error('Not authenticated')
    const res: any = await changePassword(sessionId.value, currentPassword.value, newPassword.value)
    if (res && (res.user || res.error === undefined)) {
      pwdSuccess.value = true
      currentPassword.value = ''
      newPassword.value = ''
      confirmPassword.value = ''
    } else if (res && res.error) {
      pwdError.value = res.error
    } else {
      pwdError.value = 'Unable to change password.'
    }
  } catch (e: any) {
    pwdError.value = e?.message || 'Network error'
  } finally {
    pwdPending.value = false
    setTimeout(() => { pwdSuccess.value = false }, 2500)
  }
}

function incFont() { fontSize.value = Math.min(48, fontSize.value + 1) }
function decFont() { fontSize.value = Math.max(10, fontSize.value - 1) }
function incRatio() { lineHeightRatio.value = Math.min(3.0, parseFloat((lineHeightRatio.value + 0.1).toFixed(1))) }
function decRatio() { lineHeightRatio.value = Math.max(1.0, parseFloat((lineHeightRatio.value - 0.1).toFixed(1))) }

async function onSaveSettings() {
  saveError.value = ''
  saveSuccess.value = false
  if (!userId.value) { saveError.value = 'Not authenticated.'; return }
  savePending.value = true
  try {
    const lh = Math.max(10, Math.round(fontSize.value * lineHeightRatio.value))
    if (settingsId.value) {
      const res = await editSettings(settingsId.value, font.value, fontSize.value, lh)
      if ((res as any)?.error) saveError.value = (res as any).error
      else saveSuccess.value = true
    }
  } catch (e: any) {
    saveError.value = e?.message || 'Network error'
  } finally {
    savePending.value = false
    setTimeout(() => { saveSuccess.value = false }, 2500)
  }
}
</script>

<style lang="css" scoped>
    section {
        margin-bottom: 2rem;
    }
</style>