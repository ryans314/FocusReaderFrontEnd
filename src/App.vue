<template>
  <nav v-if="route.name !== 'landing'">
    <h3 style="margin: 0;" class="logo">FocusReader</h3>
    <RouterLink to="/">Library</RouterLink>
    <!-- <RouterLink to="/reader">Reader</RouterLink> -->
    <!-- <RouterLink to="/annotations">Annotations</RouterLink> -->
    <RouterLink to="/stats">Stats</RouterLink>
  <RouterLink v-if="isAuthed" to="/profile">Profile</RouterLink>
    <span style="flex:1"></span>
  <RouterLink v-if="!isAuthed" to="/login">Login</RouterLink>
  <RouterLink v-if="!isAuthed" to="/signup">Sign Up</RouterLink>
    <button v-else @click="logout">Logout</button>
  </nav>
  <main>
    <RouterView />
  </main>

</template>

<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useAuthStore } from './stores/auth'

const auth = useAuthStore()
const { isAuthed } = storeToRefs(auth)
const route = useRoute()
const logout = () => { auth.logoutAndRedirect?.() }
</script>

<style scoped>
nav a.router-link-active {
  /* text-decoration: underline; */
  font-weight: 700;
}
</style>
