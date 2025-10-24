export function useBackgroundReplacement(
  sourceVideo,
  outputCanvas,
  stats,
  props,
) {
  let worker = null;
  let composer = null;
  let isInitialized = false;
  let isReady = false;
  let isComposerReady = false;
  let frameCount = 0;
  let fpsHistory = [];
  let lastFpsTime = Date.now();
  let fpsFrameCount = 0;
  let emaLatencyMs = 25;

  // Оптимизированные параметры модели для производительности
  const targetShort = 480; // Уменьшаем разрешение для FPS
  const downsample = 0.7; // Увеличиваем для производительности
  const threads = 1; // Минимум потоков для стабильности
  
  // Параметры постобработки (отключены для FPS)
  const enablePostProcessing = false; // Отключаем для производительности
  const blurRadius = 0;
  const edgeThreshold = 0.1;
  const morphKernelSize = 3;

  // Адаптивные оптимизации
  let frameSkipCounter = 0;
  let PROCESS_EVERY_N_FRAMES = 1; // Адаптивный пропуск кадров
  let lastProcessedMask = null;
  let isProcessing = false;
  let performanceHistory = [];
  let adaptiveDownsample = downsample;
  let adaptiveFrameSkip = 1;
  
  // Режим "Турбо" для максимальной производительности
  let turboMode = true;

  // Фоновое изображение
  const loadedBackgroundImage = { value: null };
  let currentPhotoUrl = null;
  
  // Кэш для блюра фона
  let blurCache = null;
  let lastBlurTime = 0;
  let lastBlurFrame = null;
  let lastBlurConfig = null;
  const BLUR_CACHE_DURATION = 50; // Кэшируем блюр на 50мс
  
  // Адаптивное кэширование на основе движения
  let motionDetected = false;
  let staticFrameCount = 0;
  let lastMaskSum = 0;
  
  // Простая детекция движения по изменению маски
  function detectMotion(pha, w, h) {
    // Вычисляем сумму маски для детекции изменений
    let currentMaskSum = 0;
    for (let i = 0; i < w * h; i++) {
      currentMaskSum += pha[i];
    }
    
    // Сравниваем с предыдущим кадром
    const maskDifference = Math.abs(currentMaskSum - lastMaskSum);
    const motionThreshold = w * h * 0.01; // 1% от общего количества пикселей
    
    if (maskDifference > motionThreshold) {
      motionDetected = true;
      staticFrameCount = 0;
    } else {
      staticFrameCount++;
      if (staticFrameCount > 10) { // 10 кадров без движения
        motionDetected = false;
      }
    }
    
    lastMaskSum = currentMaskSum;
  }

  // Быстрая функция рендеринга кэшированного блюра
  function renderCachedBlur(ctx, width, height) {
    const now = Date.now();
    const blurAmount = props.backgroundConfig.blurAmount || 15;
    const currentConfig = JSON.stringify(props.backgroundConfig);
    
    // Адаптивное кэширование: дольше кэшируем при отсутствии движения
    const cacheDuration = motionDetected ? BLUR_CACHE_DURATION : BLUR_CACHE_DURATION * 3;
    
    // Проверяем, нужно ли обновить кэш
    const shouldUpdateCache = !blurCache || 
                             (now - lastBlurTime) > cacheDuration ||
                             lastBlurFrame !== sourceVideo.value ||
                             lastBlurConfig !== currentConfig;
    
    if (shouldUpdateCache) {
      // Создаем новый кэш блюра
      if (!blurCache) {
        blurCache = new OffscreenCanvas(width, height);
      }
      
      const blurCtx = blurCache.getContext("2d");
      
      // Применяем блюр к видео
      blurCtx.filter = `blur(${blurAmount}px)`;
      blurCtx.drawImage(sourceVideo.value, 0, 0, width, height);
      blurCtx.filter = "none";
      
      lastBlurTime = now;
      lastBlurFrame = sourceVideo.value;
      lastBlurConfig = currentConfig;
    }
    
    // Рисуем кэшированный блюр
    ctx.drawImage(blurCache, 0, 0, width, height);
  }

  // Функция адаптивной оптимизации производительности
  function adaptPerformance(processingTime) {
    if (!turboMode) return; // В турбо-режиме не адаптируем
    
    performanceHistory.push(processingTime);
    if (performanceHistory.length > 3) { // Еще меньше истории для мгновенной реакции
      performanceHistory.shift();
    }
    
    const avgTime = performanceHistory.reduce((a, b) => a + b, 0) / performanceHistory.length;
    
    // Сверх-агрессивная оптимизация для турбо-режима
    if (avgTime > 20) { // 20ms = 50 FPS - очень строгий порог
      adaptiveDownsample = Math.min(0.95, adaptiveDownsample + 0.2); // Максимально снижаем качество
      adaptiveFrameSkip = Math.min(5, adaptiveFrameSkip + 2); // Максимально пропускаем кадров
      console.log(`⚡ ТУРБО-оптимизация: downsample=${adaptiveDownsample.toFixed(2)}, skip=${adaptiveFrameSkip}`);
    }
    // Очень осторожно повышаем качество
    else if (avgTime < 10 && adaptiveDownsample > 0.6) { // 10ms = 100 FPS
      adaptiveDownsample = Math.max(0.6, adaptiveDownsample - 0.02);
      adaptiveFrameSkip = Math.max(1, adaptiveFrameSkip - 1);
      console.log(`🚀 Микроповышение: downsample=${adaptiveDownsample.toFixed(2)}, skip=${adaptiveFrameSkip}`);
    }
  }

  // Создание Web Workers
  const createWorker = () => {
    return new Worker(new URL("../workers/rvm.worker.js", import.meta.url), {
      type: "module",
    });
  };

  const createComposer = () => {
    try {
      return new Worker(new URL("../workers/simple-comp.worker.js", import.meta.url), {
        type: "module",
      });
    } catch (error) {
      console.warn('Не удалось создать композитор:', error);
      return null;
    }
  };

  const initialize = async () => {
    if (isInitialized) return;

    try {
      console.log("🚀 Инициализация оптимизированной RVM модели...");

      // Создаем воркеры
      worker = createWorker();
      // Отключаем композитор для максимальной производительности
      composer = null; // createComposer();
      
      console.log('⚡ Режим максимальной производительности: композитор отключен');

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
          const timeMs = msg.timeMs || msg.totalTimeMs || 0;
          const postProcessTimeMs = msg.postProcessTimeMs || 0;

          emaLatencyMs = 0.9 * emaLatencyMs + 0.1 * timeMs;

          // Адаптивная оптимизация производительности
          adaptPerformance(timeMs);
          
          // Детекция движения для умного кэширования
          detectMotion(pha, w, h);

          // Сохраняем маску для повторного использования
          lastProcessedMask = { pha, w, h };

          // Отправляем в композитор для улучшенного смешивания
          if (composer && isComposerReady) {
            try {
              composer.postMessage({
                type: 'mask',
                payload: { data: new Uint8Array(pha), width: w, height: h }
              });
            } catch (error) {
              console.warn('Не удалось отправить маску в композитор:', error);
              // Fallback: рендеринг напрямую
              renderMaskToCanvas(pha, w, h);
            }
          } else {
            // Fallback: рендеринг напрямую
            renderMaskToCanvas(pha, w, h);
          }

          // Обновление статистики с детализацией
          updateFrameStats(timeMs, postProcessTimeMs);
          
          // Разблокируем для следующего кадра
        isProcessing = false;
      }
    };

    // Настройка обработчиков композитора (если доступен)
    if (composer) {
      composer.onmessage = (e) => {
        const msg = e.data;
        
        if (msg.type === 'status') {
          console.log('Composer:', msg.payload);
          if (msg.payload.includes('ready')) {
            isComposerReady = true;
          }
        }
        
        if (msg.type === 'error') {
          console.error('Composer error:', msg.payload);
          stats.value.error = msg.payload;
        }
        
        if (msg.type === 'frame') {
          // Headless режим: рисуем готовый кадр
          if (msg.payload?.bitmap) {
            const ctx = outputCanvas.value.getContext('2d');
            ctx.clearRect(0, 0, outputCanvas.value.width, outputCanvas.value.height);
            ctx.drawImage(msg.payload.bitmap, 0, 0);
            msg.payload.bitmap.close();
          }
        }
      };
    }

      // Инициализация модели
      // URL модели - нужно скачать с GitHub
      const modelUrl = "/models/rvm_mobilenetv3_fp32.onnx";

      worker.postMessage({
        type: "init",
      modelUrl,
      downsample,
        threads,
        enablePostProcessing,
        blurRadius,
        edgeThreshold,
        morphKernelSize,
    });

    // Инициализация композитора (если доступен)
    if (composer) {
      try {
        const canvas = outputCanvas.value;
        const width = canvas.width || 640;
        const height = canvas.height || 360;
        
        // Создаем клонируемый объект конфигурации
        const backgroundConfig = {
          type: props.backgroundConfig?.type || 'blur',
          blurAmount: props.backgroundConfig?.blurAmount || 15,
          color: props.backgroundConfig?.color || '#2e2e2e',
          photo: props.backgroundConfig?.photo || null
        };
        
        composer.postMessage({
          type: 'headless-init',
          width,
          height,
          mode: backgroundConfig.type,
          background: backgroundConfig
        });
      } catch (error) {
        console.warn('Не удалось инициализировать композитор:', error);
        // Продолжаем без композитора
      }
    }

    isInitialized = true;
    console.log("✅ Оптимизированная RVM модель готова к работе!");
    } catch (error) {
      console.error("❌ Ошибка загрузки модели:", error);
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

  const renderMaskToCanvas = (pha, w, h) => {
    if (!outputCanvas.value || !sourceVideo.value) return;

    const ctx = outputCanvas.value.getContext("2d");
    const videoWidth = sourceVideo.value.videoWidth;
    const videoHeight = sourceVideo.value.videoHeight;

    if (!videoWidth || !videoHeight) return;

    // Масштабируем canvas под видео
    outputCanvas.value.width = videoWidth;
    outputCanvas.value.height = videoHeight;

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
  };

  const applyBackground = (ctx, maskCanvas, width, height) => {
    const bgType = props.backgroundConfig.type;

    // Сохраняем оригинальное видео
    const videoData = ctx.getImageData(0, 0, width, height);

    // Создаем фон
    if (bgType === "blur") {
      // Оптимизированный размытый фон с кэшированием
      renderCachedBlur(ctx, width, height);
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
    
    // Адаптивный пропуск кадров для оптимизации
    if (frameSkipCounter % adaptiveFrameSkip !== 0) {
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

    // Отправляем кадр воркеру с адаптивными параметрами
    const bitmap = offscreen.transferToImageBitmap();
    worker.postMessage({ 
      type: "run", 
      bitmap, 
      downsample: adaptiveDownsample 
    }, [bitmap]);

    // Также отправляем кадр в композитор (если готов)
    if (composer && isComposerReady) {
      try {
        const frameBitmap = await createImageBitmap(video, 0, 0, vw, vh);
        composer.postMessage({ type: 'frame', frame: frameBitmap }, [frameBitmap]);
      } catch (error) {
        console.warn('Не удалось отправить кадр в композитор:', error);
      }
    }
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

  const updateFrameStats = (processingTime, postProcessTime = 0) => {
    frameCount++;
    fpsFrameCount++;

    // Обновляем детализированную статистику
    stats.value.latency = processingTime;
    stats.value.postProcessTime = postProcessTime;
    stats.value.adaptiveDownsample = adaptiveDownsample;
    stats.value.adaptiveFrameSkip = adaptiveFrameSkip;

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
    // При 30fps на обработку кадра должно уходить ~33ms
    // При 60fps на обработку кадра должно уходить ~16ms
    const targetFrameTime = 1000 / (stats.value.fps || 30);
    const cpuUsageRatio = Math.min(1, processingTime / targetFrameTime);
    const estimatedCPU = Math.round(cpuUsageRatio * 100);
    
    // Сглаживание с более сильным коэффициентом
    const smoothingFactor = 0.15;
    stats.value.cpu = Math.round(
      estimatedCPU * smoothingFactor + (stats.value.cpu || 0) * (1 - smoothingFactor),
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
    if (composer) {
      try {
        composer.postMessage({ type: "stop" });
      } catch (error) {
        console.warn('Ошибка остановки композитора:', error);
      }
    }
    frameCount = 0;
    fpsHistory = [];
    stats.value = { cpu: 0, gpu: 0, fps: 0, avgFps: 0, latency: 0 };
  };

  // Функция переключения режимов
  const setTurboMode = (enabled) => {
    turboMode = enabled;
    if (turboMode) {
      console.log('⚡ Турбо-режим включен: максимальная производительность');
      adaptiveDownsample = 0.8;
      adaptiveFrameSkip = 2;
    } else {
      console.log('🎨 Режим качества включен: баланс качества и производительности');
      adaptiveDownsample = 0.5;
      adaptiveFrameSkip = 1;
    }
  };

  const setQualityMode = (enabled) => {
    setTurboMode(!enabled);
  };

  // Функция очистки кэша блюра
  const clearBlurCache = () => {
    blurCache = null;
    lastBlurTime = 0;
    lastBlurFrame = null;
    lastBlurConfig = null;
    motionDetected = false;
    staticFrameCount = 0;
    console.log('🧹 Кэш блюра очищен');
  };

  return {
    initialize,
    start,
    stop,
    processFrame,
    updateStats: updateFrameStats,
    setTurboMode,
    setQualityMode,
    clearBlurCache,
  };
}
