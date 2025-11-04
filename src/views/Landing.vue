<template>
  <div class="landing" style="max-width: 756px; margin-left: auto; margin-right: auto;">
    <div class="hero card">
      <h1>FocusReader</h1>
      <p class="tagline">Read with focus. Annotate with ease.</p>
      <div class="cta">
        <button class="btn" @click="openModal('login')">Log in</button>
        <button class="btn" @click="openModal('signup')">Sign up</button>
      </div>
    </div>

    <div class="features">
      <div class="feature card">
        <h3>Stay in the zone</h3>
        <p>Track focus sessions and see your reading stats.</p>
      </div>
      <div class="feature card">
        <h3>Your library</h3>
        <p>Upload EPUBs and keep them organized in one place.</p>
      </div>
      <div class="feature card">
        <h3>Make it yours</h3>
        <p>Customize text settings for a comfortable reading experience.</p>
      </div>
    </div>

    <!-- Modal overlay: shows login or signup over landing -->
    <transition name="fade">
      <div v-if="showLogin || showSignup" class="overlay" @click.self="closeModal">
        <div class="modal card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:.5rem;">
            <h3 style="margin:0">{{ showLogin ? 'Log in' : 'Sign up' }}</h3>
            <button @click="closeModal" title="Close">✕</button>
          </div>
          <div>
            <Login v-if="showLogin" />
            <Signup v-else />
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Login from '@/views/Login.vue'
import Signup from '@/views/Signup.vue'

const route = useRoute()
const router = useRouter()

const showLogin = computed(() => String(route.query.modal || '') === 'login')
const showSignup = computed(() => String(route.query.modal || '') === 'signup')

function openModal(which: 'login' | 'signup') {
  router.push({ name: 'landing', query: { modal: which } })
}

function closeModal() {
  router.push({ name: 'landing' })
}
</script>

<style scoped>
.landing {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.landing p {
    font-size: 0.875rem;
}

.hero {
  text-align: center;
  padding: 2rem 1.5rem;
}
.hero h1 {
  margin: 0 0 .25rem;
  font-size: 2.25rem;
}
.tagline {
  margin: 0 0 1rem;
  color: var(--muted);
}
.cta { display:flex; gap:.75rem; justify-content:center; }
.btn {
  display:inline-block;
  padding: .5rem .9rem;
  border: 1px solid currentColor;
  border-radius: 6px;
}
.btn.secondary { opacity: .85; }

.features { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px,1fr)); gap: 1rem; }
.feature h3 { margin: 0 0 .25rem; }
.feature p { margin: 0; color: var(--muted); }

/* Use Special Elite for landing headings */
.hero h1, .feature h3 {
  font-family: 'Special Elite', Georgia, serif;
}

/* Modal overlay styles */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  display:flex;
  align-items:center;
  justify-content:center;
  z-index: 80;
}
.modal { width: 520px; max-width: 95%; }

/* Reuse simple fade */
.fade-enter-active, .fade-leave-active { transition: opacity .18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.fade-enter-to, .fade-leave-from { opacity: 1; }
</style>
