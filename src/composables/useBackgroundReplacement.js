export function useBackgroundReplacement(
  sourceVideo,
  outputCanvas,
  stats,
  props,
) {
  // Worker and runtime state
  let worker = null;
  let isInitialized = false;
  let isReady = false;
  let backendType = "wasm";
  let emaLatencyMs = 28;

  // Frame statistics
  let frameCount = 0;
  let fpsHistory = [];
  let lastFpsTime = Date.now();
  let fpsFrameCount = 0;
  let droppedFrames = 0;

  const TARGET_FPS = 30;

  const BASE_TARGET_SHORT = 256;
  let currentTargetShort = BASE_TARGET_SHORT;

  const BASE_DOWNSAMPLE = 0.45;
  let currentDownsample = BASE_DOWNSAMPLE;
  const threads = 4;
  const PROCESS_EVERY_N_FRAMES = props.presentationMode ? 1 : 2;

  const supportsOffscreenCanvas = typeof OffscreenCanvas !== "undefined";

  const processingSurface = createCanvasCache(supportsOffscreenCanvas);
  const maskSurface = createCanvasCache();
  const scaledMaskSurface = createCanvasCache();
  const backgroundSurface = createCanvasCache();
  const foregroundSurface = createCanvasCache();

  const loadedBackgroundImage = { value: null };
  let currentPhotoUrl = null;

  let lastProcessedMask = null;
  let isProcessing = false;
  let frameSequence = 0;

  let drawingCanvas = null;
  let isDrawingEnabled = false;

  // Background blur helper
  function renderBlur(ctx, width, height) {
    const blurAmount = props.backgroundConfig.blurAmount || 15;
    ctx.filter = `blur(${blurAmount}px)`;
    ctx.drawImage(sourceVideo.value, 0, 0, width, height);
    ctx.filter = "none";
  }

  function createWorker() {
    return new Worker(new URL("../workers/rvm.worker.js", import.meta.url), {
      type: "module",
    });
  }

  const initialize = async () => {
    if (isInitialized) return;

    try {
      console.log("🚀 Initializing background replacement pipeline...");
      worker = createWorker();

      worker.onmessage = (e) => {
        const msg = e.data;

        if (msg.type === "ready") {
          isReady = true;
          backendType = msg.config?.backend || "wasm";
          currentDownsample = msg.config?.downsample ?? currentDownsample;
          console.log(
            `✓ Model ready (backend: ${backendType}, downsample: ${currentDownsample.toFixed(2)})`,
          );
          stats.value.backend = backendType;
          stats.value.downsample = currentDownsample;
          stats.value.inferenceShortSide = currentTargetShort;
          syncWorkerDownsample(true);
          return;
        }

        if (msg.type === "config-ok") {
          const newDownsample = msg.config?.downsample;
          if (typeof newDownsample === "number" && !Number.isNaN(newDownsample)) {
            currentDownsample = newDownsample;
            stats.value.downsample = newDownsample;
          }
          if (msg.config?.reset) {
            lastProcessedMask = null;
          }
          return;
        }

        if (msg.type === "reset-ok") {
          return;
        }

        if (msg.type === "error") {
          console.error("Worker error:", msg.message);
          stats.value.error = msg.message;
          isProcessing = false;
          return;
        }

        if (msg.type === "result") {
          const pha = new Float32Array(msg.pha);
          const dims = msg.shape;
          const h = dims[2];
          const w = dims[3];
          const metrics = msg.metrics || {
            total: emaLatencyMs,
            preprocess: 0,
            inference: 0,
            postprocess: 0,
          };

          emaLatencyMs = 0.8 * emaLatencyMs + 0.2 * (metrics.total || emaLatencyMs);

          lastProcessedMask = { pha, w, h };
          renderMaskToCanvas(pha, w, h);
          updateFrameStats(metrics);

          isProcessing = false;
        }
      };

      const modelUrl = "/models/rvm_mobilenetv3_fp32.onnx";
      worker.postMessage({
        type: "init",
        modelUrl,
        downsample: currentDownsample,
        threads,
      });

      isInitialized = true;
    } catch (error) {
      console.error("❌ Model initialization error:", error);
      throw error;
    }
  };

  const loadBackgroundImage = (url) => {
    if (currentPhotoUrl === url && loadedBackgroundImage.value) {
      return;
    }

    currentPhotoUrl = url;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      loadedBackgroundImage.value = img;
      console.log("Фоновое изображение загружено:", url);
    };
    img.onerror = () => {
      console.error("Ошибка загрузки фонового изображения:", url);
      loadedBackgroundImage.value = null;
    };
    img.src = url;
  };

  const renderMaskToCanvas = (pha, w, h) => {
    if (!outputCanvas.value || !sourceVideo.value) return;

    const ctx = outputCanvas.value.getContext("2d");
    const videoWidth = sourceVideo.value.videoWidth;
    const videoHeight = sourceVideo.value.videoHeight;

    if (!videoWidth || !videoHeight) return;

    outputCanvas.value.width = videoWidth;
    outputCanvas.value.height = videoHeight;

    ctx.drawImage(sourceVideo.value, 0, 0, videoWidth, videoHeight);

    if (!props.backgroundEnabled) {
      drawUserInfoOnCanvas(ctx, videoWidth, videoHeight);
      return;
    }

    const mask = ensureMaskImageData(maskSurface, w, h);
    const data = mask.data;

    const SOFT_START = 0.08;
    const HARD_START = 0.4;
    for (let i = 0; i < w * h; i++) {
      let alpha = pha[i];
      if (alpha <= SOFT_START) {
        alpha = 0;
      } else if (alpha >= HARD_START) {
        alpha = 1;
      } else {
        alpha = (alpha - SOFT_START) / (HARD_START - SOFT_START);
      }
      const byte = Math.round(alpha * 255);
      const idx = i * 4;
      data[idx] = 0;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
      data[idx + 3] = byte;
    }

    maskSurface.ctx.putImageData(mask, 0, 0);
    applyBackground(ctx, maskSurface.canvas, videoWidth, videoHeight);
  };

  const applyBackground = (ctx, maskCanvas, width, height) => {
    const bgSurface = ensureCanvas(backgroundSurface, width, height);
    const bgCtx = bgSurface.ctx;
    const bgType = props.backgroundConfig.type;

    if (bgType === "blur") {
      renderBlur(bgCtx, width, height);
    } else if (bgType === "color") {
      const color = hexToRgb(props.backgroundConfig.color);
      bgCtx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
      bgCtx.fillRect(0, 0, width, height);
    } else if (bgType === "photo" && props.backgroundConfig.photo) {
      const bgImage = loadedBackgroundImage.value;
      if (bgImage && bgImage.complete) {
        bgCtx.drawImage(bgImage, 0, 0, width, height);
      } else {
        bgCtx.fillStyle = "#2e2e2e";
        bgCtx.fillRect(0, 0, width, height);
      }
    } else {
      bgCtx.fillStyle = "#111";
      bgCtx.fillRect(0, 0, width, height);
    }

    if (isDrawingEnabled && drawingCanvas) {
      bgCtx.drawImage(drawingCanvas, 0, 0, width, height);
    }

    drawUserInfoOnCanvas(bgCtx, width, height);

    const maskScaledSurface = ensureCanvas(scaledMaskSurface, width, height);
    const scaledCtx = maskScaledSurface.ctx;
    scaledCtx.imageSmoothingEnabled = true;
    scaledCtx.imageSmoothingQuality = "medium";
    scaledCtx.clearRect(0, 0, width, height);
    scaledCtx.filter = "blur(0.8px)";
    scaledCtx.drawImage(maskCanvas, 0, 0, width, height);
    scaledCtx.filter = "none";

    const fgSurface = ensureCanvas(foregroundSurface, width, height);
    const fgCtx = fgSurface.ctx;
    fgCtx.clearRect(0, 0, width, height);
    fgCtx.globalCompositeOperation = "source-over";
    fgCtx.drawImage(sourceVideo.value, 0, 0, width, height);
    fgCtx.globalCompositeOperation = "destination-in";
    fgCtx.drawImage(maskScaledSurface.canvas, 0, 0);
    fgCtx.globalCompositeOperation = "source-over";

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(bgSurface.canvas, 0, 0);
    ctx.drawImage(fgSurface.canvas, 0, 0);
  };

  const processFrame = async () => {
    if (!worker || !isReady || !sourceVideo.value || !outputCanvas.value) {
      return;
    }

    if (
      props.backgroundConfig.type === "photo" &&
      props.backgroundConfig.photo
    ) {
      loadBackgroundImage(props.backgroundConfig.photo);
    }

    if (isProcessing) {
      droppedFrames++;
      if (lastProcessedMask) {
        renderMaskToCanvas(
          lastProcessedMask.pha,
          lastProcessedMask.w,
          lastProcessedMask.h,
        );
      }
      return;
    }

    frameSequence++;
    if (PROCESS_EVERY_N_FRAMES > 1 && frameSequence % PROCESS_EVERY_N_FRAMES !== 0) {
      if (lastProcessedMask) {
        renderMaskToCanvas(
          lastProcessedMask.pha,
          lastProcessedMask.w,
          lastProcessedMask.h,
        );
      }
      return;
    }

    isProcessing = true;

    const video = sourceVideo.value;
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 360;

    if (!vw || !vh) {
      isProcessing = false;
      return;
    }

    const { w, h } = calcScaledSize(vw, vh, currentTargetShort);
    const processing = ensureCanvas(processingSurface, w, h);

    stats.value.inferenceShortSide = Math.min(w, h);
    stats.value.inferenceResolution = `${w}x${h}`;
    stats.value.downsample = currentDownsample;
    stats.value.backend = backendType;

    processing.ctx.drawImage(video, 0, 0, w, h);

    let bitmap;
    if (supportsOffscreenCanvas && "transferToImageBitmap" in processing.canvas) {
      bitmap = processing.canvas.transferToImageBitmap();
    } else {
      bitmap = await createImageBitmap(processing.canvas);
    }

    worker.postMessage({ type: "run", bitmap }, [bitmap]);
  };

  const calcScaledSize = (videoWidth, videoHeight, targetShortSide) => {
    const aspectRatio = videoWidth / videoHeight;
    const shortSide = Math.min(videoWidth, videoHeight);
    const target = Math.max(1, Math.min(targetShortSide, shortSide));
    let width;
    let height;

    if (videoWidth <= videoHeight) {
      width = target;
      height = Math.round(target / aspectRatio);
    } else {
      height = target;
      width = Math.round(target * aspectRatio);
    }

    const align = (value) => {
      const STEP = 16;
      const aligned = Math.floor(value / STEP) * STEP;
      return Math.max(STEP, aligned);
    };

    width = align(width);
    height = align(height);

    return { w: width, h: height };
  };

  const updateFrameStats = (metrics) => {
    frameCount++;
    fpsFrameCount++;

    stats.value.metrics = {
      preprocess: metrics.preprocess ?? 0,
      inference: metrics.inference ?? 0,
      postprocess: metrics.postprocess ?? 0,
      total: metrics.total ?? 0,
    };
    stats.value.backend = backendType;
    stats.value.downsample = currentDownsample;
    stats.value.droppedFrames = droppedFrames;

    const now = Date.now();
    if (now - lastFpsTime >= 1000) {
      const fps = fpsFrameCount;
      stats.value.fps = fps;

      fpsHistory.push(fps);
      if (fpsHistory.length > 10) {
        fpsHistory.shift();
      }

      const avgFps = Math.round(
        fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length,
      );
      stats.value.avgFps = avgFps;

      fpsFrameCount = 0;
      lastFpsTime = now;
    }

    stats.value.latency = Math.round(emaLatencyMs);

    const targetFrameTime = 1000 / TARGET_FPS;
    const loadRatio = Math.min(1, emaLatencyMs / targetFrameTime);
    const estimatedCPU = Math.round(loadRatio * 100);
    const smoothingFactor = 0.18;
    stats.value.cpu = Math.round(
      estimatedCPU * smoothingFactor +
        (stats.value.cpu || 0) * (1 - smoothingFactor),
    );

    const gpuEstimate =
      backendType === "webgl"
        ? Math.min(100, Math.round(35 + loadRatio * 55))
        : Math.min(100, Math.round(20 + loadRatio * 45));
    stats.value.gpu = Math.round(
      gpuEstimate * smoothingFactor +
        (stats.value.gpu || 0) * (1 - smoothingFactor),
    );

    stats.value.downsample = currentDownsample;

    // Fixed resolution mode – no dynamic scaling
  };

  const start = () => {
    console.log("✓ Processing started");
  };

  const stop = () => {
    console.log("✓ Processing stopped");
    if (worker) {
      worker.postMessage({ type: "reset" });
    }
    frameCount = 0;
    fpsHistory = [];
    droppedFrames = 0;
    lastProcessedMask = null;
    isProcessing = false;
    emaLatencyMs = 28;
    currentTargetShort = BASE_TARGET_SHORT;
    currentDownsample = BASE_DOWNSAMPLE;
    stats.value = {
      cpu: 0,
      gpu: 0,
      fps: 0,
      avgFps: 0,
      latency: 0,
      metrics: { preprocess: 0, inference: 0, postprocess: 0, total: 0 },
      backend: backendType,
      downsample: currentDownsample,
      droppedFrames: 0,
      inferenceShortSide: currentTargetShort,
      inferenceResolution: null,
    };
    frameSequence = 0;
  };

  const setDrawingCanvas = (canvas) => {
    drawingCanvas = canvas || null;
    console.log("✓ Drawing canvas set");
  };

  const enableDrawing = (enabled) => {
    isDrawingEnabled = !!enabled;
    console.log(`✓ Drawing ${enabled ? "enabled" : "disabled"}`);
  };

  const clearDrawing = () => {
    if (drawingCanvas) {
      const ctx = drawingCanvas.getContext("2d");
      ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
      console.log("✓ Drawing cleared");
    }
  };

  const syncWorkerDownsample = (force = false) => {
    if (!worker || !isReady) return;
    const desired = BASE_DOWNSAMPLE;
    if (force || Math.abs(desired - currentDownsample) > 1e-6) {
      currentDownsample = desired;
      stats.value.downsample = currentDownsample;
      worker.postMessage({
        type: "config",
        downsample: currentDownsample,
        resetState: true,
      });
      lastProcessedMask = null;
    }
  };

  function computeDownsampleForShortSide(shortSide) {
    return BASE_DOWNSAMPLE;
  }

  function createCanvasCache(useOffscreen = false) {
    return {
      useOffscreen,
      canvas: null,
      ctx: null,
      imageData: null,
    };
  }

  function ensureCanvas(surface, width, height, contextOptions) {
    if (!surface.canvas) {
      surface.canvas = createCanvas(surface.useOffscreen, width, height);
    }

    if (
      surface.canvas.width !== width ||
      surface.canvas.height !== height
    ) {
      surface.canvas.width = width;
      surface.canvas.height = height;
      surface.imageData = null;
    }

    if (!surface.ctx) {
      surface.ctx = surface.canvas.getContext("2d", contextOptions || undefined);
      if (!surface.ctx) {
        throw new Error("Не удалось получить контекст Canvas");
      }
    }

    surface.ctx.setTransform(1, 0, 0, 1, 0, 0);
    surface.ctx.clearRect(0, 0, width, height);
    return surface;
  }

  function ensureMaskImageData(surface, width, height) {
    ensureCanvas(surface, width, height, { willReadFrequently: true });
    if (
      !surface.imageData ||
      surface.imageData.width !== width ||
      surface.imageData.height !== height
    ) {
      surface.imageData = surface.ctx.createImageData(width, height);
    }
    return surface.imageData;
  }

  function createCanvas(useOffscreen, width, height) {
    if (useOffscreen && supportsOffscreenCanvas) {
      return new OffscreenCanvas(width, height);
    }
    if (typeof document === "undefined") {
      throw new Error("Canvas API недоступна в текущей среде");
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  const drawUserInfoOnCanvas = (ctx, width, height) => {
    if (!props.userInfo) return;

    const { name, position, company, email, telegram, privacyLevel } =
      props.userInfo;

    const padding = 30;
    const lineHeight = 45;
    const smallLineHeight = 30;
    let yPos = padding + 40;

    const drawTextWithShadow = (
      text,
      x,
      y,
      fontSize,
      color = "white",
      weight = "700",
    ) => {
      ctx.font = `${weight} ${fontSize}px 'Segoe UI', sans-serif`;

      ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
      ctx.shadowBlur = 15;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      ctx.strokeStyle = "#000";
      ctx.lineWidth = 4;
      ctx.strokeText(text, x, y);

      ctx.fillStyle = color;
      ctx.shadowBlur = 8;
      ctx.fillText(text, x, y);

      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
    };

    if (privacyLevel === "minimal") {
      if (name) {
        drawTextWithShadow(name, padding, yPos, 40, "white", "800");
      }
      return;
    }

    if (privacyLevel === "high") {
      if (company) {
        drawTextWithShadow(company, padding, yPos, 32, "white", "700");
      }
      return;
    }

    if (name) {
      drawTextWithShadow(name, padding, yPos, 40, "white", "800");
      yPos += lineHeight;
    }

    if (position) {
      drawTextWithShadow(position, padding, yPos, 26, "#ffd700", "700");
      yPos += lineHeight * 0.7;
    }

    if (company) {
      drawTextWithShadow(company, padding, yPos, 20, "#e0e0e0", "600");
      yPos += smallLineHeight;
    }

    if (privacyLevel === "low") {
      if (email) {
        drawTextWithShadow(email, padding, yPos, 18, "#9db4ff", "600");
        yPos += smallLineHeight;
      }

      if (telegram) {
        drawTextWithShadow(telegram, padding, yPos, 18, "#9db4ff", "600");
      }
    }
  };

  const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : { r: 0, g: 255, b: 0 };
  };

  return {
    initialize,
    start,
    stop,
    processFrame,
    setDrawingCanvas,
    enableDrawing,
    clearDrawing,
  };
}
