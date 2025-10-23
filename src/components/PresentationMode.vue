<template>
  <div class="presentation-mode">
    <!-- Видео канвас на весь экран -->
    <VideoCanvas
      ref="videoCanvas"
      :user-info="userInfo"
      :background-enabled="backgroundEnabled"
      :show-stats="true"
      :presentation-mode="true"
      @ready="onReady"
    />

    <!-- Минималистичный контрол -->
    <div class="presentation-controls" v-if="!isStarted">
      <div class="control-card">
        <h2>🎥 Цифровой дресс-код</h2>
        <p>Готовы начать презентацию?</p>
        
        <div class="user-inputs">
          <input 
            v-model="userInfo.name" 
            placeholder="ФИО"
            class="input-field"
          />
          <input 
            v-model="userInfo.position" 
            placeholder="Должность"
            class="input-field"
          />
          <input 
            v-model="userInfo.company" 
            placeholder="Компания"
            class="input-field"
          />
        </div>

        <label class="checkbox-label">
          <input type="checkbox" v-model="backgroundEnabled" />
          <span>Включить персонализированный фон</span>
        </label>

        <button @click="startPresentation" class="start-btn">
          📹 Запустить
        </button>

        <button @click="$emit('toggle-mode')" class="mode-btn">
          ⚙️ Полный режим
        </button>
      </div>
    </div>

    <!-- Кнопка выхода во время презентации -->
    <button 
      v-if="isStarted" 
      @click="stopPresentation"
      class="exit-btn"
    >
      ✕
    </button>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import VideoCanvas from './VideoCanvas.vue'

defineEmits(['toggle-mode'])

const videoCanvas = ref(null)
const isStarted = ref(false)
const backgroundEnabled = ref(true)

const userInfo = ref({
  name: 'Кутырин Максим Алексеевич',
  position: 'Frontend Developer',
  company: 'Hackathon Team'
})

const onReady = () => {
  console.log('VideoCanvas готов')
}

const startPresentation = async () => {
  if (videoCanvas.value) {
    await videoCanvas.value.start()
    isStarted.value = true
  }
}

const stopPresentation = () => {
  if (videoCanvas.value) {
    videoCanvas.value.stop()
  }
  isStarted.value = false
}
</script>

<style scoped>
.presentation-mode {
  width: 100vw;
  height: 100vh;
  background: #000;
  position: relative;
  overflow: hidden;
}

.presentation-controls {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.95) 0%, rgba(118, 75, 162, 0.95) 100%);
  z-index: 1000;
}

.control-card {
  background: white;
  padding: 40px;
  border-radius: 20px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  max-width: 500px;
  width: 90%;
  text-align: center;
}

.control-card h2 {
  color: #667eea;
  margin-bottom: 10px;
  font-size: 2rem;
}

.control-card p {
  color: #666;
  margin-bottom: 30px;
}

.user-inputs {
  display: flex;
  flex-direction: column;
  gap: 15px;
  margin-bottom: 25px;
}

.input-field {
  padding: 12px 15px;
  border: 2px solid #dee2e6;
  border-radius: 8px;
  font-size: 1rem;
  transition: border-color 0.3s;
}

.input-field:focus {
  outline: none;
  border-color: #667eea;
}

.checkbox-label {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-bottom: 25px;
  cursor: pointer;
  font-size: 1rem;
  color: #333;
}

.checkbox-label input[type="checkbox"] {
  width: 20px;
  height: 20px;
  cursor: pointer;
}

.start-btn {
  width: 100%;
  padding: 15px;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 10px;
  font-size: 1.2rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
  margin-bottom: 15px;
}

.start-btn:hover {
  background: #5568d3;
  transform: translateY(-2px);
  box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
}

.mode-btn {
  width: 100%;
  padding: 12px;
  background: #f8f9fa;
  color: #666;
  border: 2px solid #dee2e6;
  border-radius: 10px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
}

.mode-btn:hover {
  background: #e9ecef;
  border-color: #667eea;
  color: #667eea;
}

.exit-btn {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 50px;
  height: 50px;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  border: none;
  border-radius: 50%;
  font-size: 1.5rem;
  cursor: pointer;
  transition: all 0.3s;
  z-index: 100;
  backdrop-filter: blur(10px);
}

.exit-btn:hover {
  background: rgba(255, 0, 0, 0.8);
  transform: scale(1.1);
}
</style>

