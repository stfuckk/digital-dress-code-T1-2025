<template>
    <div class="video-canvas-container">
        <video
            ref="sourceVideo"
            autoplay
            playsinline
            style="display: none"
        ></video>

        <canvas ref="outputCanvas" class="output-canvas"></canvas>

        <!-- Информация о пользователе теперь встроена в canvas -->

        <!-- Панель статистики -->
        <StatsPanel
            v-if="showStats && isRunning"
            :cpu="stats.cpu"
            :gpu="stats.gpu"
            :fps="stats.fps"
            :avg-fps="stats.avgFps"
        />
    </div>
</template>
 
<script setup>
import { ref, onMounted, onUnmounted, watch } from "vue";
import StatsPanel from "./StatsPanel.vue";
import { useBackgroundReplacement } from "../composables/useBackgroundReplacement";

const props = defineProps({
    userInfo: Object,
    backgroundEnabled: Boolean,
    showStats: {
        type: Boolean,
        default: true,
    },
    presentationMode: {
        type: Boolean,
        default: false,
    },
    backgroundConfig: {
        type: Object,
        default: () => ({
            type: "blur",
            blurAmount: 15,
            color: "#00ff00",
        }),
    },
});

const emit = defineEmits(["ready"]);

const sourceVideo = ref(null);
const outputCanvas = ref(null);
const isRunning = ref(false);

const stats = ref({
    cpu: 0,
    gpu: 0,
    fps: 0,
    avgFps: 0,
    latency: 0,
});

const {
    initialize,
    start: startProcessing,
    stop: stopProcessing,
    processFrame,
} = useBackgroundReplacement(sourceVideo, outputCanvas, stats, props);

let stream = null;
let animationId = null;

const start = async () => {
    try {
        // Запуск камеры
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: "user",
            },
            audio: false,
        });

        sourceVideo.value.srcObject = stream;

        await new Promise((resolve) => {
            sourceVideo.value.onloadedmetadata = resolve;
        });

        // Настройка canvas
        outputCanvas.value.width = sourceVideo.value.videoWidth;
        outputCanvas.value.height = sourceVideo.value.videoHeight;

        // Инициализация ML модели
        await initialize();

        isRunning.value = true;

        // Запуск обработки
        startProcessing();
        processLoop();
    } catch (error) {
        console.error("Ошибка запуска:", error);
        throw error;
    }
};

const stop = () => {
    isRunning.value = false;

    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
    }

    stopProcessing();
    
    // Очищаем canvas белым цветом вместо черного
    try {
        const ctx = outputCanvas.value?.getContext('2d');
        if (ctx && outputCanvas.value) {
            ctx.fillStyle = '#0f0f10'; // Темный фон приложения
            ctx.fillRect(0, 0, outputCanvas.value.width, outputCanvas.value.height);
        }
    } catch(e) {}
};

const processLoop = async () => {
    if (!isRunning.value) return;

    await processFrame();
    animationId = requestAnimationFrame(processLoop);
};

onMounted(() => {
    emit("ready");
});

onUnmounted(() => {
    stop();
});

// Watch для изменения конфига фона
watch(
    () => props.backgroundConfig,
    () => {
        // Реакция на изменение настроек фона
    },
    { deep: true },
);

defineExpose({
    start,
    stop,
});
</script>

<style scoped>
.video-canvas-container {
    position: relative;
    width: 100%;
    height: 100%;
    background: #000;
    overflow: hidden;
}

.output-canvas {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
}
</style>
