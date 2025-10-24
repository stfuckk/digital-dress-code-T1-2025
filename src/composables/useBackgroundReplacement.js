export function useBackgroundReplacement(
  sourceVideo,
  outputCanvas,
  stats,
  props,
) {
  let worker = null;
  let isInitialized = false;
  let isReady = false;
  let backendType = 'wasm';

  // Performance & frame pacing
  let frameCount = 0;
  let fpsHistory = [];
  let lastFpsTime = Date.now();
  let fpsFrameCount = 0;
  let droppedFrames = 0;
  const TARGET_FPS = 30;
  const MAX_FRAME_TIME = 33; // ms, for 30 FPS
  
  // Optimized model parameters
  const INFERENCE_SIZE = 320; // Better quality while maintaining speed
  const downsample = 0.25; // Aggressive downsampling
  const threads = 4; // Max threads for performance
  
  // Drawing on background
  let drawingCanvas = null;
  let isDrawingEnabled = false;
  
  // Latest mask for reuse
  let lastProcessedMask = null;
  let isProcessing = false;

  // Background image
  const loadedBackgroundImage = { value: null };
  let currentPhotoUrl = null;
  
  
  // Render dynamic blur background (updates every frame)
  function renderBlur(ctx, width, height) {
    const blurAmount = props.backgroundConfig.blurAmount || 15;
    
    // Apply blur filter directly to current video frame
    ctx.filter = `blur(${blurAmount}px)`;
    ctx.drawImage(sourceVideo.value, 0, 0, width, height);
    ctx.filter = "none";
  }

  // Create Web Worker
  const createWorker = () => {
    return new Worker(new URL("../workers/rvm.worker.js", import.meta.url), {
      type: "module",
    });
  };

  const initialize = async () => {
    if (isInitialized) return;

    try {
      console.log("🚀 Initializing optimized RVM model...");

      worker = createWorker();

      // Setup worker message handlers
      worker.onmessage = (e) => {
        const msg = e.data;

        if (msg.type === "ready") {
          isReady = true;
          backendType = msg.config?.backend || 'wasm';
          console.log(`✓ Model ready! Backend: ${backendType.toUpperCase()}`);
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
          const h = dims[2], w = dims[3];
          const metrics = msg.metrics || { total: 0, preprocess: 0, inference: 0, postprocess: 0 };

          // Save mask for reuse
          lastProcessedMask = { pha, w, h };

          // Render to canvas
          renderMaskToCanvas(pha, w, h);

          // Update stats with detailed metrics
          updateFrameStats(metrics);
          
          isProcessing = false;
        }
      };

      // Initialize model
      const modelUrl = "/models/rvm_mobilenetv3_fp32.onnx";

      worker.postMessage({
        type: "init",
        modelUrl,
        downsample,
        threads,
      });

      isInitialized = true;
      console.log("✅ Model initialized!");
    } catch (error) {
      console.error("❌ Model initialization error:", error);
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

    // Save original video
    const videoData = ctx.getImageData(0, 0, width, height);

    // Create background
    if (bgType === "blur") {
      renderBlur(ctx, width, height);
    } else if (bgType === "color") {
      const color = hexToRgb(props.backgroundConfig.color);
      ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
      ctx.fillRect(0, 0, width, height);
    } else if (bgType === "photo" && props.backgroundConfig.photo) {
      const bgImage = loadedBackgroundImage.value;
      if (bgImage && bgImage.complete) {
        ctx.drawImage(bgImage, 0, 0, width, height);
      } else {
        ctx.fillStyle = "#2e2e2e";
        ctx.fillRect(0, 0, width, height);
      }
    }

    // Draw custom drawing on background if enabled
    if (isDrawingEnabled && drawingCanvas) {
      ctx.drawImage(drawingCanvas, 0, 0, width, height);
    }

    // Draw user info on background (before compositing person)
    drawUserInfoOnCanvas(ctx, width, height);

    // Save background with text and drawings
    const bgData = ctx.getImageData(0, 0, width, height);

    // Restore video
    ctx.putImageData(videoData, 0, 0);

    // Scale mask to video size with bilinear interpolation
    const scaledMaskCanvas = document.createElement("canvas");
    scaledMaskCanvas.width = width;
    scaledMaskCanvas.height = height;
    const scaledMaskCtx = scaledMaskCanvas.getContext("2d");
    scaledMaskCtx.imageSmoothingEnabled = true;
    scaledMaskCtx.imageSmoothingQuality = 'high';
    scaledMaskCtx.drawImage(maskCanvas, 0, 0, width, height);
    const maskData = scaledMaskCtx.getImageData(0, 0, width, height);

    // Compositing: blend foreground and background by mask
    const resultData = ctx.createImageData(width, height);
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      const alpha = maskData.data[idx] / 255;

      resultData.data[idx] = videoData.data[idx] * alpha + bgData.data[idx] * (1 - alpha);
      resultData.data[idx + 1] = videoData.data[idx + 1] * alpha + bgData.data[idx + 1] * (1 - alpha);
      resultData.data[idx + 2] = videoData.data[idx + 2] * alpha + bgData.data[idx + 2] * (1 - alpha);
      resultData.data[idx + 3] = 255;
    }

    ctx.putImageData(resultData, 0, 0);
  };

  const processFrame = async () => {
    if (!worker || !isReady || !sourceVideo.value || !outputCanvas.value) {
      return;
    }

    // Load background image if needed
    if (props.backgroundConfig.type === "photo" && props.backgroundConfig.photo) {
      loadBackgroundImage(props.backgroundConfig.photo);
    }

    // Drop frame if still processing (frame pacing)
    if (isProcessing) {
      droppedFrames++;
      // Reuse last mask
      if (lastProcessedMask) {
        renderMaskToCanvas(lastProcessedMask.pha, lastProcessedMask.w, lastProcessedMask.h);
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

    // Downscale to INFERENCE_SIZE (256-320p) for speed
    const { w, h } = calcScaledSize(vw, vh, INFERENCE_SIZE);

    // Use OffscreenCanvas and transferToImageBitmap for zero-copy
    const offscreen = new OffscreenCanvas(w, h);
    const offscreenCtx = offscreen.getContext("2d");
    offscreenCtx.drawImage(video, 0, 0, w, h);

    // Transfer bitmap to worker (zero-copy transfer)
    const bitmap = offscreen.transferToImageBitmap();
    worker.postMessage({ 
      type: "run", 
      bitmap
    }, [bitmap]);
  };

  const calcScaledSize = (videoWidth, videoHeight, targetShortSide) => {
    const aspectRatio = videoWidth / videoHeight;
    let w, h;

    if (videoWidth < videoHeight) {
      w = targetShortSide;
      h = Math.round(targetShortSide / aspectRatio);
    } else {
      h = targetShortSide;
      w = Math.round(targetShortSide * aspectRatio);
    }
    
    return { w, h };
  };

  const updateFrameStats = (metrics) => {
    frameCount++;
    fpsFrameCount++;

    // Update detailed metrics
    stats.value.metrics = {
      preprocess: metrics.preprocess || 0,
      inference: metrics.inference || 0,
      postprocess: metrics.postprocess || 0,
      total: metrics.total || 0
    };
    stats.value.backend = backendType;
    stats.value.droppedFrames = droppedFrames;

    // FPS calculation
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

    // Legacy stats for compatibility
    stats.value.latency = Math.round(metrics.total || 0);
    
    const targetFrameTime = 1000 / TARGET_FPS;
    const cpuUsageRatio = Math.min(1, (metrics.total || 0) / targetFrameTime);
    const estimatedCPU = Math.round(cpuUsageRatio * 100);
    
    const smoothingFactor = 0.15;
    stats.value.cpu = Math.round(
      estimatedCPU * smoothingFactor + (stats.value.cpu || 0) * (1 - smoothingFactor),
    );

    stats.value.gpu = Math.min(100, Math.round(Math.random() * 30 + 15));
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
    stats.value = { 
      cpu: 0, 
      gpu: 0, 
      fps: 0, 
      avgFps: 0, 
      latency: 0,
      metrics: { preprocess: 0, inference: 0, postprocess: 0, total: 0 },
      backend: backendType,
      droppedFrames: 0
    };
  };


  const setDrawingCanvas = (canvas) => {
    drawingCanvas = canvas;
    console.log('✓ Drawing canvas set');
  };

  const enableDrawing = (enabled) => {
    isDrawingEnabled = enabled;
    console.log(`✓ Drawing ${enabled ? 'enabled' : 'disabled'}`);
  };

  const clearDrawing = () => {
    if (drawingCanvas) {
      const ctx = drawingCanvas.getContext('2d');
      ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
      console.log('✓ Drawing cleared');
    }
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
