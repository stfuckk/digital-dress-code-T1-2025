<template>
  <div class="app-container">
    <!-- Режим презентации или полный интерфейс -->
    <PresentationMode 
      v-if="presentationMode"
      @toggle-mode="togglePresentationMode"
    />
    <FullInterface 
      v-else
      @toggle-mode="togglePresentationMode"
    />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import FullInterface from './components/FullInterface.vue'
import PresentationMode from './components/PresentationMode.vue'

const presentationMode = ref(false)

// Проверяем URL параметр для автозапуска презентации
onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  if (params.get('presentation') === 'true') {
    presentationMode.value = true
  }
})

const togglePresentationMode = () => {
  presentationMode.value = !presentationMode.value
}
</script>

<style scoped>
.app-container {
  width: 100%;
  min-height: 100vh;
}
</style>

