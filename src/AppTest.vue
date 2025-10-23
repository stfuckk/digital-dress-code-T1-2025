<template>
  <div style="padding: 50px; background: white; color: black; min-height: 100vh;">
    <h1>✅ Vue работает!</h1>
    <p>Если вы видите этот текст, значит Vue загружен корректно.</p>
    <button @click="count++" style="padding: 10px 20px; font-size: 18px; cursor: pointer;">
      Кликов: {{ count }}
    </button>
    <p>Текущее время: {{ time }}</p>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'

const count = ref(0)
const time = ref(new Date().toLocaleTimeString())

onMounted(() => {
  setInterval(() => {
    time.value = new Date().toLocaleTimeString()
  }, 1000)
})
</script>

