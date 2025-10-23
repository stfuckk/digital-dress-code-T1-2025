<template>
  <div class="full-interface">
    <header class="header">
      <h1>🎥 Цифровой дресс-код</h1>
      <button @click="$emit('toggle-mode')" class="presentation-btn">
        📽️ Режим презентации
      </button>
    </header>

    <div class="content">
      <div class="controls-panel">
        <div class="control-group">
          <h3>👤 Информация о пользователе</h3>
          <input v-model="userInfo.name" placeholder="ФИО" class="input" />
          <input v-model="userInfo.position" placeholder="Должность" class="input" />
          <input v-model="userInfo.company" placeholder="Компания" class="input" />
        </div>

        <div class="control-group">
          <h3>🎨 Настройки фона</h3>
          <select v-model="backgroundConfig.type" class="select">
            <option value="blur">Размытие</option>
            <option value="color">Цвет</option>
            <option value="none">Без фона</option>
          </select>
          
          <div v-if="backgroundConfig.type === 'blur'" class="slider-group">
            <label>Сила размытия: {{ backgroundConfig.blurAmount }}px</label>
            <input 
              v-model.number="backgroundConfig.blurAmount" 
              type="range" 
              min="0" 
              max="50" 
              class="slider"
            />
          </div>

          <div v-if="backgroundConfig.type === 'color'" class="color-group">
            <label>Цвет фона</label>
            <input v-model="backgroundConfig.color" type="color" class="color-picker" />
          </div>

          <label class="checkbox">
            <input type="checkbox" v-model="backgroundEnabled" />
            <span>Включить замену фона</span>
          </label>
        </div>

        <div class="control-group">
          <h3>⚡ Пресеты</h3>
          <div class="presets">
            <button 
              v-for="preset in presets" 
              :key="preset.id"
              @click="applyPreset(preset)"
              class="preset-btn"
            >
              {{ preset.icon }} {{ preset.name }}
            </button>
          </div>
        </div>

        <div class="action-buttons">
          <button 
            @click="toggleCamera" 
            :class="['btn', isRunning ? 'btn-danger' : 'btn-primary']"
          >
            {{ isRunning ? '⏹️ Остановить' : '📹 Запустить' }}
          </button>
        </div>
      </div>

      <div class="video-panel">
        <VideoCanvas
          ref="videoCanvas"
          :user-info="userInfo"
          :background-enabled="backgroundEnabled"
          :background-config="backgroundConfig"
          :show-stats="true"
          @ready="onReady"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import VideoCanvas from './VideoCanvas.vue'

defineEmits(['toggle-mode'])

const videoCanvas = ref(null)
const isRunning = ref(false)
const backgroundEnabled = ref(true)

const userInfo = ref({
  name: 'Кутырин Максим Алексеевич',
  position: 'Frontend Developer',
  company: 'Hackathon Team'
})

const backgroundConfig = ref({
  type: 'blur',
  blurAmount: 15,
  color: '#00ff00'
})

const presets = [
  { id: 'work', name: 'Работа', icon: '💼', config: { type: 'blur', blurAmount: 25 } },
  { id: 'interview', name: 'Интервью', icon: '🎤', config: { type: 'color', color: '#2c3e50' } },
  { id: 'streaming', name: 'Стриминг', icon: '🎮', config: { type: 'color', color: '#8e44ad' } },
  { id: 'presentation', name: 'Презентация', icon: '📊', config: { type: 'blur', blurAmount: 15 } }
]

const onReady = () => {
  console.log('VideoCanvas готов')
}

const toggleCamera = async () => {
  if (isRunning.value) {
    videoCanvas.value.stop()
    isRunning.value = false
  } else {
    try {
      await videoCanvas.value.start()
      isRunning.value = true
    } catch (error) {
      console.error('Ошибка запуска:', error)
      alert('Не удалось запустить камеру: ' + error.message)
    }
  }
}

const applyPreset = (preset) => {
  Object.assign(backgroundConfig.value, preset.config)
  backgroundEnabled.value = true
}
</script>

<style scoped>
.full-interface {
  min-height: 100vh;
  background: white;
}

.header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 20px 30px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
}

.header h1 {
  font-size: 1.8rem;
  margin: 0;
}

.presentation-btn {
  padding: 10px 20px;
  background: rgba(255, 255, 255, 0.2);
  color: white;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.3s;
}

.presentation-btn:hover {
  background: rgba(255, 255, 255, 0.3);
  border-color: white;
}

.content {
  display: grid;
  grid-template-columns: 350px 1fr;
  gap: 20px;
  padding: 20px;
  height: calc(100vh - 80px);
}

.controls-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
  overflow-y: auto;
}

.control-group {
  background: #f8f9fa;
  padding: 20px;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.control-group h3 {
  color: #667eea;
  margin-bottom: 15px;
  font-size: 1.1rem;
}

.input,
.select {
  width: 100%;
  padding: 10px;
  margin-bottom: 10px;
  border: 2px solid #dee2e6;
  border-radius: 8px;
  font-size: 1rem;
  transition: border-color 0.3s;
}

.input:focus,
.select:focus {
  outline: none;
  border-color: #667eea;
}

.slider-group,
.color-group {
  margin: 15px 0;
}

.slider-group label,
.color-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 600;
  color: #333;
}

.slider {
  width: 100%;
}

.color-picker {
  width: 100%;
  height: 40px;
  border: 2px solid #dee2e6;
  border-radius: 8px;
  cursor: pointer;
}

.checkbox {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  margin-top: 10px;
}

.checkbox input {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.presets {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.preset-btn {
  padding: 12px;
  background: white;
  border: 2px solid #dee2e6;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.3s;
}

.preset-btn:hover {
  border-color: #667eea;
  background: #f0f4ff;
  transform: translateY(-2px);
}

.action-buttons {
  display: flex;
  gap: 10px;
}

.btn {
  flex: 1;
  padding: 15px;
  border: none;
  border-radius: 10px;
  font-size: 1.1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
}

.btn-primary {
  background: #667eea;
  color: white;
}

.btn-primary:hover {
  background: #5568d3;
}

.btn-danger {
  background: #e74c3c;
  color: white;
}

.btn-danger:hover {
  background: #d62c1a;
}

.video-panel {
  background: #000;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

@media (max-width: 1024px) {
  .content {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }
  
  .controls-panel {
    max-height: 300px;
  }
}
</style>

