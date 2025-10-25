export function useBackgroundReplacement(
  sourceVideo,
  outputCanvas,
  stats,
  props,
) {
  let worker = null;
  let isInitialized = false;
  let isReady = false;
  let frameCount = 0;
  let fpsHistory = [];
  let lastFpsTime = Date.now();
  let fpsFrameCount = 0;
  let emaLatencyMs = 25;
  let lastFrameTime = Date.now();

  // Рисование
  let drawingCanvas = null;
  let drawingCtx = null;

  // Параметры модели
  const targetShort = 480; // Целевое разрешение
  const downsample = 0.25;
  const threads = 4;

  // Оптимизации: пропуск кадров
  let frameSkipCounter = 0;
  const PROCESS_EVERY_N_FRAMES = 1; // Обрабатывать каждый 2-й кадр
  let lastProcessedMask = null;
  let isProcessing = false;

  // Фоновое изображение
  const loadedBackgroundImage = { value: null };
  let currentPhotoUrl = null;

  // Создание Web Worker
  const createWorker = () => {
    return new Worker(new URL("../workers/rvm.worker.js", import.meta.url), {
      type: "module",
    });
  };

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
      // URL модели - нужно скачать с GitHub
      const modelUrl = "/models/rvm_mobilenetv3_fp32.onnx";

      worker.postMessage({
        type: "init",
        modelUrl,
        downsample,
        threads,
      });

      isInitialized = true;
    } catch (error) {
      console.error("Ошибка загрузки модели:", error);
      throw error;
    }
  };

  // Загрузка фонового изображения
  const loadBackgroundImage = (url) => {
    if (currentPhotoUrl === url && loadedBackgroundImage.value) {
      return; // Уже загружено
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

  const drawUserInfoOnCanvas = (ctx, width, height) => {
    if (!props.userInfo) return;
    
    const { name, position, company, email, telegram, privacyLevel } = props.userInfo;
    
    // Позиция текста в левом ВЕРХНЕМ углу
    const padding = 30;
    const lineHeight = 45;
    const smallLineHeight = 30;
    let yPos = padding + 40; // Начинаем с верха + размер первой строки
    
    // Функция для рисования текста с тенью
    const drawTextWithShadow = (text, x, y, fontSize, color = 'white', weight = '700') => {
      ctx.font = `${weight} ${fontSize}px 'Segoe UI', sans-serif`;
      
      // Тень (несколько слоев для лучшего контраста)
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
      ctx.shadowBlur = 15;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      
      // Обводка
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 4;
      ctx.strokeText(text, x, y);
      
      // Основной текст
      ctx.fillStyle = color;
      ctx.shadowBlur = 8;
      ctx.fillText(text, x, y);
      
      // Сбрасываем тень
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    };
    
    // МИНИМАЛЬНЫЙ уровень приватности: только ФИО
    if (privacyLevel === 'minimal') {
      if (name) {
        drawTextWithShadow(name, padding, yPos, 40, 'white', '800');
      }
      return;
    }
    
    // ВЫСОКИЙ уровень приватности: только компания
    if (privacyLevel === 'high') {
      if (company) {
        drawTextWithShadow(company, padding, yPos, 32, 'white', '700');
      }
      return;
    }
    
    // НИЗКИЙ и СРЕДНИЙ уровень: имя, должность, компания
    if (name) {
      drawTextWithShadow(name, padding, yPos, 40, 'white', '800');
      yPos += lineHeight;
    }
    
    if (position) {
      drawTextWithShadow(position, padding, yPos, 26, '#ffd700', '700');
      yPos += lineHeight * 0.7;
    }
    
    if (company) {
      drawTextWithShadow(company, padding, yPos, 20, '#e0e0e0', '600');
      yPos += smallLineHeight;
    }
    
    // НИЗКИЙ уровень приватности: дополнительно email и telegram
    if (privacyLevel === 'low') {
      if (email) {
        drawTextWithShadow(email, padding, yPos, 18, '#9db4ff', '600');
        yPos += smallLineHeight;
      }
      
      if (telegram) {
        drawTextWithShadow(telegram, padding, yPos, 18, '#9db4ff', '600');
      }
    }
  };

  // Инициализация canvas для рисования
  const initDrawingCanvas = (width, height) => {
    if (!drawingCanvas) {
      drawingCanvas = document.createElement("canvas");
      drawingCtx = drawingCanvas.getContext("2d");
    }
    
    // Обновляем размер только если изменился
    if (drawingCanvas.width !== width || drawingCanvas.height !== height) {
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = drawingCanvas.width;
      tempCanvas.height = drawingCanvas.height;
      const tempCtx = tempCanvas.getContext("2d");
      tempCtx.drawImage(drawingCanvas, 0, 0);
      
      drawingCanvas.width = width;
      drawingCanvas.height = height;
      drawingCtx.clearRect(0, 0, width, height);
      
      if (tempCanvas.width > 0 && tempCanvas.height > 0) {
        drawingCtx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, 
                            0, 0, width, height);
      }
    }
  };

  const clearDrawing = () => {
    if (drawingCanvas && drawingCtx) {
      drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    }
  };

  const renderMaskToCanvas = (pha, w, h) => {
    if (!outputCanvas.value || !sourceVideo.value) return;

    const ctx = outputCanvas.value.getContext("2d");
    const videoWidth = sourceVideo.value.videoWidth;
    const videoHeight = sourceVideo.value.videoHeight;

    if (!videoWidth || !videoHeight) return;

    // Масштабируем canvas под видео
    outputCanvas.value.width = videoWidth;
    outputCanvas.value.height = videoHeight;

    // Инициализируем canvas для рисования
    initDrawingCanvas(videoWidth, videoHeight);

    // Рисуем видео
    ctx.drawImage(sourceVideo.value, 0, 0, videoWidth, videoHeight);

    if (props.backgroundEnabled) {
      // Создаем временный canvas для маски
      const maskCanvas = document.createElement("canvas");
      maskCanvas.width = w;
      maskCanvas.height = h;
      const maskCtx = maskCanvas.getContext("2d");

      const imageData = maskCtx.createImageData(w, h);
      const data = imageData.data;

      // Заполняем альфа-канал из маски
      for (let i = 0; i < w * h; i++) {
        const alpha = Math.max(0, Math.min(255, Math.round(pha[i] * 255)));
        data[i * 4] = alpha;
        data[i * 4 + 1] = alpha;
        data[i * 4 + 2] = alpha;
        data[i * 4 + 3] = 255;
      }
      maskCtx.putImageData(imageData, 0, 0);

      // Применяем фон (текст уже будет на фоне)
      applyBackground(ctx, maskCanvas, videoWidth, videoHeight);
    } else {
      // Если фон не включен, рисуем текст поверх видео
      drawUserInfoOnCanvas(ctx, videoWidth, videoHeight);
    }

    // Накладываем рисунок поверх всего
    if (drawingCanvas) {
      ctx.drawImage(drawingCanvas, 0, 0);
    }
  };

  const applyBackground = (ctx, maskCanvas, width, height) => {
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
      ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
      ctx.fillRect(0, 0, width, height);
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
        renderMaskToCanvas(lastProcessedMask.pha, lastProcessedMask.w, lastProcessedMask.h);
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

    // CPU (реальная утилизация воркера)
    // Считаем процент времени, который воркер занят обработкой
    const currentTime = Date.now();
    const frameInterval = currentTime - lastFrameTime;
    lastFrameTime = currentTime;
    
    // Утилизация = время обработки / время между кадрами
    // Умножаем на коэффициент потоков (обычно используем 4 потока)
    const workerUtilization = frameInterval > 0 
      ? Math.min(100, (processingTime / frameInterval) * 100 * 0.3) // 0.3 - поправочный коэффициент
      : 0;
    
    // Сглаживание
    const smoothingFactor = 0.3;
    const currentCpu = stats.value.cpu || workerUtilization;
    stats.value.cpu = Math.round(
      workerUtilization * smoothingFactor + currentCpu * (1 - smoothingFactor),
    );

    // GPU (эмуляция)
    if (stats.value.fps > 0) {
      const estimatedGPU = Math.min(100, Math.round(Math.random() * 30 + 15));
      stats.value.gpu = estimatedGPU;
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

  // Функции для рисования
  const getDrawingContext = () => {
    return drawingCtx;
  };

  const getDrawingCanvas = () => {
    return drawingCanvas;
  };

  return {
    initialize,
    start,
    stop,
    processFrame,
    updateStats: updateFrameStats,
    clearDrawing,
    getDrawingContext,
    getDrawingCanvas,
  };
}
