<template>
    <div class="video-canvas-container">
        <video
            ref="sourceVideo"
            autoplay
            playsinline
            style="display: none"
        ></video>

        <canvas ref="outputCanvas" class="output-canvas"></canvas>

        <!-- Drawing Canvas Overlay -->
        <canvas 
            ref="drawingCanvas" 
            class="drawing-canvas"
            v-show="isDrawingMode"
            @mousedown="startDrawing"
            @mousemove="draw"
            @mouseup="stopDrawing"
            @mouseleave="stopDrawing"
            @touchstart="startDrawingTouch"
            @touchmove="drawTouch"
            @touchend="stopDrawing"
        ></canvas>

        <!-- Drawing Controls -->
        <div v-if="isRunning" class="drawing-controls">
            <button 
                @click="toggleDrawingMode" 
                :class="['draw-btn', { active: isDrawingMode }]"
                title="Toggle Drawing Mode"
            >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 19l7-7 3 3-7 7-3-3z"/>
                    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
                    <path d="M2 2l7.586 7.586"/>
                </svg>
            </button>
            
            <div v-if="isDrawingMode" class="draw-options">
                <input 
                    type="color" 
                    v-model="drawColor" 
                    class="color-picker"
                    title="Drawing Color"
                />
                <input 
                    type="range" 
                    v-model="brushSize" 
                    min="2" 
                    max="50" 
                    class="brush-slider"
                    title="Brush Size"
                />
                <button @click="clearDrawing" class="clear-btn" title="Clear Drawing">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </div>
        </div>

        <!-- Performance Overlay -->
        <PerformanceOverlay
            v-if="showStats && isRunning"
            :fps="stats.fps"
            :backend="stats.backend || 'wasm'"
            :metrics="stats.metrics || {}"
            :dropped-frames="stats.droppedFrames || 0"
        />
    </div>
</template>
 
<script setup>
import { ref, onMounted, onUnmounted, watch } from "vue";
import StatsPanel from "./StatsPanel.vue";
import PerformanceOverlay from "./PerformanceOverlay.vue";
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
const drawingCanvas = ref(null);
const isRunning = ref(false);

// Drawing state
const isDrawingMode = ref(false);
const isDrawing = ref(false);
const drawColor = ref('#ff0000');
const brushSize = ref(5);
let drawingCtx = null;

const stats = ref({
    cpu: 0,
    gpu: 0,
    fps: 0,
    avgFps: 0,
    latency: 0,
    metrics: { preprocess: 0, inference: 0, postprocess: 0, total: 0 },
    backend: 'wasm',
    droppedFrames: 0
});

const {
    initialize,
    start: startProcessing,
    stop: stopProcessing,
    processFrame,
    setDrawingCanvas,
    enableDrawing,
    clearDrawing: clearDrawingComposable,
} = useBackgroundReplacement(sourceVideo, outputCanvas, stats, props);

let stream = null;
let frameCallbackHandle = null;

const start = async () => {
    try {
        // Start camera with 720p resolution (lower than 1080p for better performance)
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280, max: 1280 },
                height: { ideal: 720, max: 720 },
                facingMode: "user",
                frameRate: { ideal: 30, max: 30 }
            },
            audio: false,
        });

        sourceVideo.value.srcObject = stream;

        await new Promise((resolve) => {
            sourceVideo.value.onloadedmetadata = resolve;
        });

        // Setup output canvas
        outputCanvas.value.width = sourceVideo.value.videoWidth;
        outputCanvas.value.height = sourceVideo.value.videoHeight;

        // Setup drawing canvas
        drawingCanvas.value.width = sourceVideo.value.videoWidth;
        drawingCanvas.value.height = sourceVideo.value.videoHeight;
        drawingCtx = drawingCanvas.value.getContext('2d');
        drawingCtx.lineCap = 'round';
        drawingCtx.lineJoin = 'round';

        // Connect drawing canvas to composable
        setDrawingCanvas(drawingCanvas.value);

        // Initialize ML model
        await initialize();

        isRunning.value = true;

        // Start processing
        startProcessing();
        processLoop();
    } catch (error) {
        console.error("Startup error:", error);
        throw error;
    }
};

const stop = () => {
    isRunning.value = false;

    if (frameCallbackHandle !== null && sourceVideo.value) {
        sourceVideo.value.cancelVideoFrameCallback?.(frameCallbackHandle);
        frameCallbackHandle = null;
    }

    if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
    }

    stopProcessing();
    
    // Clear canvas
    try {
        const ctx = outputCanvas.value?.getContext('2d');
        if (ctx && outputCanvas.value) {
            ctx.fillStyle = '#0f0f10';
            ctx.fillRect(0, 0, outputCanvas.value.width, outputCanvas.value.height);
        }
    } catch(e) {}
};

const processLoop = async () => {
    if (!isRunning.value) return;

    await processFrame();
    
    // Use requestVideoFrameCallback if available, fallback to rAF
    if (sourceVideo.value && 'requestVideoFrameCallback' in sourceVideo.value) {
        frameCallbackHandle = sourceVideo.value.requestVideoFrameCallback(processLoop);
    } else {
        frameCallbackHandle = requestAnimationFrame(processLoop);
    }
};

// Drawing functions
const toggleDrawingMode = () => {
    isDrawingMode.value = !isDrawingMode.value;
    enableDrawing(isDrawingMode.value);
};

const getCoordinates = (e) => {
    const rect = drawingCanvas.value.getBoundingClientRect();
    const scaleX = drawingCanvas.value.width / rect.width;
    const scaleY = drawingCanvas.value.height / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
};

const startDrawing = (e) => {
    if (!isDrawingMode.value) return;
    isDrawing.value = true;
    const coords = getCoordinates(e);
    drawingCtx.beginPath();
    drawingCtx.moveTo(coords.x, coords.y);
};

const draw = (e) => {
    if (!isDrawing.value || !isDrawingMode.value) return;
    const coords = getCoordinates(e);
    drawingCtx.strokeStyle = drawColor.value;
    drawingCtx.lineWidth = brushSize.value;
    drawingCtx.lineTo(coords.x, coords.y);
    drawingCtx.stroke();
};

const stopDrawing = () => {
    isDrawing.value = false;
};

const startDrawingTouch = (e) => {
    if (!isDrawingMode.value) return;
    e.preventDefault();
    isDrawing.value = true;
    const touch = e.touches[0];
    const rect = drawingCanvas.value.getBoundingClientRect();
    const scaleX = drawingCanvas.value.width / rect.width;
    const scaleY = drawingCanvas.value.height / rect.height;
    const x = (touch.clientX - rect.left) * scaleX;
    const y = (touch.clientY - rect.top) * scaleY;
    drawingCtx.beginPath();
    drawingCtx.moveTo(x, y);
};

const drawTouch = (e) => {
    if (!isDrawing.value || !isDrawingMode.value) return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect = drawingCanvas.value.getBoundingClientRect();
    const scaleX = drawingCanvas.value.width / rect.width;
    const scaleY = drawingCanvas.value.height / rect.height;
    const x = (touch.clientX - rect.left) * scaleX;
    const y = (touch.clientY - rect.top) * scaleY;
    drawingCtx.strokeStyle = drawColor.value;
    drawingCtx.lineWidth = brushSize.value;
    drawingCtx.lineTo(x, y);
    drawingCtx.stroke();
};

const clearDrawing = () => {
    clearDrawingComposable();
};

onMounted(() => {
    emit("ready");
});

onUnmounted(() => {
    stop();
});

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

.drawing-canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    cursor: crosshair;
    z-index: 10;
}

.drawing-controls {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 12px;
    background: rgba(0, 0, 0, 0.8);
    padding: 12px 20px;
    border-radius: 50px;
    backdrop-filter: blur(10px);
    z-index: 100;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.draw-btn {
    background: rgba(255, 255, 255, 0.1);
    border: 2px solid rgba(255, 255, 255, 0.3);
    color: white;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s ease;
}

.draw-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    border-color: rgba(255, 255, 255, 0.5);
    transform: scale(1.05);
}

.draw-btn.active {
    background: #4fc3f7;
    border-color: #4fc3f7;
    box-shadow: 0 0 20px rgba(79, 195, 247, 0.5);
}

.draw-options {
    display: flex;
    align-items: center;
    gap: 12px;
    animation: slideIn 0.3s ease;
}

@keyframes slideIn {
    from {
        opacity: 0;
        transform: translateX(-10px);
    }
    to {
        opacity: 1;
        transform: translateX(0);
    }
}

.color-picker {
    width: 40px;
    height: 40px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-radius: 50%;
    cursor: pointer;
    background: none;
    transition: all 0.3s ease;
}

.color-picker:hover {
    transform: scale(1.1);
    border-color: rgba(255, 255, 255, 0.5);
}

.brush-slider {
    width: 100px;
    height: 6px;
    border-radius: 3px;
    outline: none;
    appearance: none;
    -webkit-appearance: none;
    background: rgba(255, 255, 255, 0.2);
    cursor: pointer;
}

.brush-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #4fc3f7;
    cursor: pointer;
    transition: all 0.3s ease;
}

.brush-slider::-webkit-slider-thumb:hover {
    transform: scale(1.2);
    box-shadow: 0 0 10px rgba(79, 195, 247, 0.5);
}

.brush-slider::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #4fc3f7;
    cursor: pointer;
    border: none;
    transition: all 0.3s ease;
}

.brush-slider::-moz-range-thumb:hover {
    transform: scale(1.2);
    box-shadow: 0 0 10px rgba(79, 195, 247, 0.5);
}

.clear-btn {
    background: rgba(244, 67, 54, 0.2);
    border: 2px solid rgba(244, 67, 54, 0.5);
    color: #ff5252;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s ease;
}

.clear-btn:hover {
    background: rgba(244, 67, 54, 0.4);
    border-color: #ff5252;
    transform: scale(1.05);
}
</style>
