<template>
    <div class="stats-panel">
        <div class="stat-item">
            <span class="label">CPU</span>
            <span class="value" :class="getCpuClass(cpu)">{{ cpu }}%</span>
        </div>
        <div class="stat-item">
            <span class="label">GPU</span>
            <span class="value" :class="getGpuClass(gpu)">{{
                gpu === 0 ? "N/A" : gpu + "%"
            }}</span>
        </div>
        <div class="stat-item">
            <span class="label">FPS</span>
            <span class="value" :class="getFpsClass(fps)">{{ fps }}</span>
        </div>
        <div class="stat-item">
            <span class="label">AVG</span>
            <span class="value">{{ avgFps }}</span>
        </div>
    </div>
</template>

<script setup>
defineProps({
    cpu: {
        type: Number,
        default: 0,
    },
    gpu: {
        type: Number,
        default: 0,
    },
    fps: {
        type: Number,
        default: 0,
    },
    avgFps: {
        type: Number,
        default: 0,
    },
});

const getCpuClass = (value) => {
    if (value > 80) return "danger";
    if (value > 60) return "warning";
    return "success";
};

const getGpuClass = (value) => {
    if (value === 0) return "";
    if (value > 80) return "danger";
    if (value > 60) return "warning";
    return "success";
};

const getFpsClass = (value) => {
    if (value < 15) return "danger";
    if (value < 25) return "warning";
    return "success";
};
</script>

<style scoped>
.stats-panel {
    position: absolute;
    top: 20px;
    right: 20px;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(15px);
    border-radius: 12px;
    padding: 15px 20px;
    min-width: 180px;
    z-index: 10;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    animation: slideInRight 0.5s ease-out;
}

.stat-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
    font-size: 0.95rem;
}

.stat-item:last-child {
    margin-bottom: 0;
}

.label {
    color: #aaa;
    font-weight: 600;
    letter-spacing: 0.5px;
}

.value {
    font-weight: 700;
    font-size: 1.1rem;
    color: #2ecc71;
    text-shadow: 0 0 10px rgba(46, 204, 113, 0.5);
}

.value.success {
    color: #2ecc71;
}

.value.warning {
    color: #f39c12;
    text-shadow: 0 0 10px rgba(243, 156, 18, 0.5);
}

.value.danger {
    color: #e74c3c;
    text-shadow: 0 0 10px rgba(231, 76, 60, 0.5);
}

@keyframes slideInRight {
    from {
        opacity: 0;
        transform: translateX(30px);
    }
    to {
        opacity: 1;
        transform: translateX(0);
    }
}

/* Адаптивность */
@media (max-width: 768px) {
    .stats-panel {
        top: 10px;
        right: 10px;
        padding: 10px 15px;
        min-width: 150px;
    }

    .stat-item {
        font-size: 0.85rem;
    }

    .value {
        font-size: 1rem;
    }
}
</style>
