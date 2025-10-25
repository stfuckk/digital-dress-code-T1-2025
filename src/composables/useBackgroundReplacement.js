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
  let frameCount = 0;
  let fpsHistory = [];
  let lastFpsTime = Date.now();
  let fpsFrameCount = 0;
  let emaLatencyMs = 25;

  // Параметры модели
  const targetShort = 480; // Целевое разрешение
  const downsample = 0.25;
  const threads = 4;

  // Оптимизации: пропуск кадров
  let frameSkipCounter = 0;
  const PROCESS_EVERY_N_FRAMES = 1; // Обрабатывать каждый кадр
  let lastProcessedMask = null;
  let isProcessing = false;

  // Фоновое изображение
  const loadedBackgroundImage = { value: null };
  let currentPhotoUrl = null;

  // Drawing on background
  let drawingCanvas = null;
  let isDrawingEnabled = false;

  // Создание Web Worker
  const createWorker = () => {
    return new Worker(new URL("../workers/rvm.worker.js", import.meta.url), {
      type: "module",
    });
  }

  const initialize = async () => {
    if (isInitialized) return;

    try {
      console.log("Загрузка RVM модели...");

      // Создаем воркер
      worker = createWorker();

      // Настройка обработчиков сообщений от воркера
      worker.onmessage = (e) => {
        const msg = e.data;

        if (msg.type === "ready") {
          isReady = true;
          console.log("Модель загружена успешно!");
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
          // Обработка результата
          const pha = new Float32Array(msg.pha);
          const dims = msg.shape;
          const h = dims[2],
            w = dims[3];
          const timeMs = msg.timeMs;

          emaLatencyMs = 0.9 * emaLatencyMs + 0.1 * timeMs;

          // Сохраняем маску для повторного использования
          lastProcessedMask = { pha, w, h };

          // Рендеринг маски
          renderMaskToCanvas(pha, w, h);

          // Обновление статистики
          updateFrameStats(timeMs);
          
          // Разблокируем для следующего кадра
          isProcessing = false;
        }
      };

      // Инициализация модели
      const modelUrl = "/models/rvm_mobilenetv3_fp32.onnx";
      worker.postMessage({
        type: "init",
        modelUrl,
        downsample: currentDownsample,
        threads,
      });

      isInitialized = true;
    } catch (error) {
      console.error("Ошибка загрузки модели:", error);
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

    // Сохраняем оригинальное видео
    const videoData = ctx.getImageData(0, 0, width, height);

    // Создаем фон
    if (bgType === "blur") {
      // Размытый фон
      ctx.filter = `blur(${props.backgroundConfig.blurAmount}px)`;
      ctx.drawImage(sourceVideo.value, 0, 0, width, height);
      ctx.filter = "none";
    } else if (bgType === "color") {
      // Однотонный цвет
      const color = hexToRgb(props.backgroundConfig.color);
      bgCtx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
      bgCtx.fillRect(0, 0, width, height);
    } else if (bgType === "photo" && props.backgroundConfig.photo) {
      // Фоновое изображение
      const bgImage = loadedBackgroundImage.value;
      if (bgImage && bgImage.complete) {
        // Рисуем изображение, растягивая на весь canvas
        ctx.drawImage(bgImage, 0, 0, width, height);
      } else {
        // Fallback на цвет, если изображение не загружено
        ctx.fillStyle = "#2e2e2e";
        ctx.fillRect(0, 0, width, height);
      }
    } else {
      bgCtx.fillStyle = "#111";
      bgCtx.fillRect(0, 0, width, height);
    }

    if (isDrawingEnabled && drawingCanvas) {
      bgCtx.drawImage(drawingCanvas, 0, 0, width, height);
    }

    // РИСУЕМ ТЕКСТ НА ФОНЕ (до наложения человека)
    drawUserInfoOnCanvas(ctx, width, height);

    // Сохраняем фон с текстом
    const bgData = ctx.getImageData(0, 0, width, height);

    // Восстанавливаем видео
    ctx.putImageData(videoData, 0, 0);

    // Масштабируем маску до размера видео
    const scaledMaskCanvas = document.createElement("canvas");
    scaledMaskCanvas.width = width;
    scaledMaskCanvas.height = height;
    const scaledMaskCtx = scaledMaskCanvas.getContext("2d");
    scaledMaskCtx.drawImage(maskCanvas, 0, 0, width, height);
    const maskData = scaledMaskCtx.getImageData(0, 0, width, height);

    // Композитинг: смешиваем передний план и фон по маске
    const resultData = ctx.createImageData(width, height);
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      const alpha = maskData.data[idx] / 255; // Нормализуем альфу

      // Смешиваем по альфе
      resultData.data[idx] =
        videoData.data[idx] * alpha + bgData.data[idx] * (1 - alpha);
      resultData.data[idx + 1] =
        videoData.data[idx + 1] * alpha + bgData.data[idx + 1] * (1 - alpha);
      resultData.data[idx + 2] =
        videoData.data[idx + 2] * alpha + bgData.data[idx + 2] * (1 - alpha);
      resultData.data[idx + 3] = 255;
    }

    ctx.putImageData(resultData, 0, 0);
  };

  const processFrame = async () => {
    if (!worker || !isReady || !sourceVideo.value || !outputCanvas.value)
      return;

    // Загружаем фоновое изображение при необходимости
    if (props.backgroundConfig.type === "photo" && props.backgroundConfig.photo) {
      loadBackgroundImage(props.backgroundConfig.photo);
    }

    frameSkipCounter++;
    
    // Пропускаем кадры для оптимизации
    if (frameSkipCounter % PROCESS_EVERY_N_FRAMES !== 0) {
      // Используем последнюю обработанную маску
      if (lastProcessedMask) {
        renderMaskToCanvas(
          lastProcessedMask.pha,
          lastProcessedMask.w,
          lastProcessedMask.h,
        );
      }
      return;
    }

    // Не запускаем новую обработку если предыдущая еще идет
    if (isProcessing) return;
    
    isProcessing = true;

    const video = sourceVideo.value;
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 360;

    if (!vw || !vh) {
      isProcessing = false;
      return;
    }

    // Вычисляем размер для обработки
    const { w, h } = calcScaledSize(vw, vh, targetShort);

    // Создаем OffscreenCanvas для масштабирования
    const offscreen = new OffscreenCanvas(w, h);
    const offscreenCtx = offscreen.getContext("2d");
    offscreenCtx.drawImage(video, 0, 0, w, h);

    // Отправляем кадр воркеру
    const bitmap = offscreen.transferToImageBitmap();
    worker.postMessage({ type: "run", bitmap }, [bitmap]);
  };

  const calcScaledSize = (videoWidth, videoHeight, targetShortSide) => {
    let w = videoWidth;
    let h = videoHeight;

    if (videoWidth < videoHeight) {
      const scale = targetShortSide / videoWidth;
      w = Math.round(videoWidth * scale);
      h = Math.round(videoHeight * scale);
    } else {
      const scale = targetShortSide / videoHeight;
      w = Math.round(videoWidth * scale);
      h = Math.round(videoHeight * scale);
    }
    return { w, h };
  };

  const updateFrameStats = (processingTime) => {
    frameCount++;
    fpsFrameCount++;

    // FPS
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

    // Latency
    stats.value.latency = Math.round(emaLatencyMs);

    // CPU (оценка на основе времени обработки)
    const targetFrameTime = 1000 / (stats.value.fps || 30);
    const cpuUsageRatio = Math.min(1, processingTime / targetFrameTime);
    const estimatedCPU = Math.round(cpuUsageRatio * 100);
    
    // Сглаживание с более сильным коэффициентом
    const smoothingFactor = 0.15;
    stats.value.cpu = Math.round(
      estimatedCPU * smoothingFactor +
        (stats.value.cpu || 0) * (1 - smoothingFactor),
    );

    // GPU (эмуляция)
    if (stats.value.fps > 0) {
      const estimatedGPU = Math.min(100, Math.round(Math.random() * 30 + 15));
      stats.value.gpu = estimatedGPU;
    }
  };

    stats.value.downsample = currentDownsample;

    // Fixed resolution mode – no dynamic scaling
  };

  const start = () => {
    console.log("Обработка запущена");
  };

  const stop = () => {
    console.log("Обработка остановлена");
    if (worker) {
      worker.postMessage({ type: "reset" });
    }
    frameCount = 0;
    fpsHistory = [];
    stats.value = { cpu: 0, gpu: 0, fps: 0, avgFps: 0, latency: 0 };
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
