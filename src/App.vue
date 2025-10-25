<template>
  <nav>
    <RouterLink to="/">Library</RouterLink>
    <RouterLink to="/reader">Reader</RouterLink>
    <RouterLink to="/annotations">Annotations</RouterLink>
    <RouterLink to="/stats">Stats</RouterLink>
    <span style="flex:1"></span>
  <RouterLink v-if="!isAuthed" to="/login">Login</RouterLink>
  <RouterLink v-if="!isAuthed" to="/signup">Sign Up</RouterLink>
    <button v-else @click="logout">Logout</button>
  </nav>
  <main>
    <RouterView />
  </main>
  <footer style="text-align:center; padding: 1rem; color: var(--muted);">
    Focus Reader
  </footer>
  
</template>

<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useAuthStore } from './stores/auth'

const auth = useAuthStore()
const { isAuthed } = storeToRefs(auth)
const logout = () => auth.logout()
</script>

<style scoped>
nav a.router-link-active {
  text-decoration: underline;
}
</style>
