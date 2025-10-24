<template>
  <div class="perf-overlay">
    <div class="perf-header">Performance Monitor</div>
    <div class="perf-grid">
      <div class="perf-item">
        <span class="perf-label">FPS:</span>
        <span class="perf-value" :class="getFpsClass(fps)">{{ fps }}</span>
      </div>
      <div class="perf-item">
        <span class="perf-label">Backend:</span>
        <span class="perf-value">{{ backend }}</span>
      </div>
      <div class="perf-item">
        <span class="perf-label">Total:</span>
        <span class="perf-value" :class="getLatencyClass(metrics.total)">{{ metrics.total.toFixed(1) }}ms</span>
      </div>
      <div class="perf-item">
        <span class="perf-label">Preprocess:</span>
        <span class="perf-value">{{ metrics.preprocess.toFixed(1) }}ms</span>
      </div>
      <div class="perf-item">
        <span class="perf-label">Inference:</span>
        <span class="perf-value">{{ metrics.inference.toFixed(1) }}ms</span>
      </div>
      <div class="perf-item">
        <span class="perf-label">Postprocess:</span>
        <span class="perf-value">{{ metrics.postprocess.toFixed(1) }}ms</span>
      </div>
      <div class="perf-item">
        <span class="perf-label">Dropped:</span>
        <span class="perf-value">{{ droppedFrames }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  fps: {
    type: Number,
    default: 0
  },
  backend: {
    type: String,
    default: 'wasm'
  },
  metrics: {
    type: Object,
    default: () => ({
      preprocess: 0,
      inference: 0,
      postprocess: 0,
      total: 0
    })
  },
  droppedFrames: {
    type: Number,
    default: 0
  }
});

function getFpsClass(fps) {
  if (fps >= 28) return 'perf-good';
  if (fps >= 20) return 'perf-warn';
  return 'perf-bad';
}

function getLatencyClass(ms) {
  if (ms <= 33) return 'perf-good';
  if (ms <= 50) return 'perf-warn';
  return 'perf-bad';
}
</script>

<style scoped>
.perf-overlay {
  position: absolute;
  top: 10px;
  right: 10px;
  background: rgba(0, 0, 0, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  padding: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  color: #fff;
  min-width: 220px;
  backdrop-filter: blur(10px);
  z-index: 1000;
}

.perf-header {
  font-weight: bold;
  margin-bottom: 8px;
  font-size: 13px;
  color: #4fc3f7;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.perf-grid {
  display: grid;
  gap: 6px;
}

.perf-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.perf-label {
  color: #aaa;
  font-size: 11px;
}

.perf-value {
  font-weight: bold;
  font-size: 13px;
  color: #fff;
}

.perf-good {
  color: #4caf50;
}

.perf-warn {
  color: #ff9800;
}

.perf-bad {
  color: #f44336;
}
</style>

