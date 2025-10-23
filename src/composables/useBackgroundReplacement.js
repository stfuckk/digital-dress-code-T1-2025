import * as tf from "@tensorflow/tfjs";
import * as bodyPix from "@tensorflow-models/body-pix";

export function useBackgroundReplacement(
  sourceVideo,
  outputCanvas,
  stats,
  props,
) {
  let model = null;
  let isInitialized = false;
  let frameCount = 0;
  let fpsHistory = [];
  let lastFpsTime = Date.now();
  let fpsFrameCount = 0;

  // Конфигурация модели
  const modelConfig = {
    architecture: "MobileNetV1",
    outputStride: 16,
    multiplier: 0.75,
    quantBytes: 2,
  };

  const segmentationConfig = {
    flipHorizontal: false,
    internalResolution: "medium",
    segmentationThreshold: 0.7,
    maxDetections: 1,
    scoreThreshold: 0.2,
    nmsRadius: 20,
  };

  const initialize = async () => {
    if (isInitialized) return;

    try {
      console.log("Загрузка BodyPix модели...");

      // Настройка TensorFlow.js для использования WebGL
      await tf.setBackend("webgl");
      await tf.ready();

      model = await bodyPix.load(modelConfig);
      isInitialized = true;

      console.log("Модель загружена успешно!");
    } catch (error) {
      console.error("Ошибка загрузки модели:", error);
      throw error;
    }
  };

  const processFrame = async () => {
    if (!model || !sourceVideo.value || !outputCanvas.value) return;

    const startTime = performance.now();

    try {
      const ctx = outputCanvas.value.getContext("2d");
      const width = outputCanvas.value.width;
      const height = outputCanvas.value.height;

      // Получаем сегментацию
      const segmentation = await model.segmentPerson(
        sourceVideo.value,
        segmentationConfig,
      );

      // Применяем фон если включен
      if (props.backgroundEnabled) {
        await drawFrameWithBackground(ctx, segmentation, width, height);
      } else {
        // Просто рисуем оригинал
        ctx.drawImage(sourceVideo.value, 0, 0, width, height);
      }

      // Обновляем статистику
      const processingTime = performance.now() - startTime;
      updateFrameStats(processingTime);
    } catch (error) {
      console.error("Ошибка обработки кадра:", error);
    }
  };

  const drawFrameWithBackground = async (ctx, segmentation, width, height) => {
    const { data } = segmentation;

    // Рисуем оригинальное видео
    ctx.drawImage(sourceVideo.value, 0, 0, width, height);
    const videoData = ctx.getImageData(0, 0, width, height);

    // Создаём фон
    let backgroundData;
    const bgType = props.backgroundConfig.type;

    if (bgType === "blur") {
      // Размытый фон
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = width;
      tempCanvas.height = height;
      const tempCtx = tempCanvas.getContext("2d");

      tempCtx.filter = `blur(${props.backgroundConfig.blurAmount}px)`;
      tempCtx.drawImage(sourceVideo.value, 0, 0, width, height);
      tempCtx.filter = "none";

      backgroundData = tempCtx.getImageData(0, 0, width, height);
    } else if (bgType === "color") {
      // Однотонный цвет
      const color = hexToRgb(props.backgroundConfig.color);
      backgroundData = ctx.createImageData(width, height);

      for (let i = 0; i < backgroundData.data.length; i += 4) {
        backgroundData.data[i] = color.r;
        backgroundData.data[i + 1] = color.g;
        backgroundData.data[i + 2] = color.b;
        backgroundData.data[i + 3] = 255;
      }
    } else {
      // Без фона - возвращаем оригинал
      return;
    }

    // Композитинг: человек + фон
    const mask = data;
    for (let i = 0; i < mask.length; i++) {
      const pixelIndex = i * 4;
      if (mask[i] === 0) {
        // Фон
        videoData.data[pixelIndex] = backgroundData.data[pixelIndex];
        videoData.data[pixelIndex + 1] = backgroundData.data[pixelIndex + 1];
        videoData.data[pixelIndex + 2] = backgroundData.data[pixelIndex + 2];
      }
    }

    ctx.putImageData(videoData, 0, 0);
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

    // CPU (оценка на основе времени обработки)
    const estimatedCPU = Math.min(
      100,
      Math.round((processingTime / 33.33) * 100),
    );
    stats.value.cpu = Math.round(estimatedCPU * 0.7 + stats.value.cpu * 0.3); // Сглаживание

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
    frameCount = 0;
    fpsHistory = [];
    stats.value = { cpu: 0, gpu: 0, fps: 0, avgFps: 0 };
  };

  return {
    initialize,
    start,
    stop,
    processFrame,
    updateStats: updateFrameStats,
  };
}
