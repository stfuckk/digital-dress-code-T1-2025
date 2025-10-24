import { env, InferenceSession, Tensor } from "onnxruntime-web";

// Оптимизированные настройки ONNX Runtime
env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.0/dist/";
env.wasm.simd = true;
env.wasm.proxy = false;
env.logLevel = "warning";

// Дополнительные оптимизации
env.wasm.numThreads = 1; // Будет установлено динамически
env.wasm.simd = true;
env.wasm.proxy = false;

let session = null;
let downsample = 0.25;
let r1 = null,
  r2 = null,
  r3 = null,
  r4 = null;

// Параметры постобработки (отключены для производительности)
let enablePostProcessing = false;
let blurRadius = 0;
let edgeThreshold = 0.1;
let morphKernelSize = 3;

function imageBitmapToTensor(bitmap) {
  const width = bitmap.width;
  const height = bitmap.height;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Cannot get 2d context");

  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;

  const tensorData = new Float32Array(1 * 3 * height * width);

  let rOffset = 0;
  let gOffset = height * width;
  let bOffset = 2 * height * width;

  for (let i = 0; i < height * width; i++) {
    const p = i * 4;
    tensorData[rOffset++] = pixels[p] / 255.0;
    tensorData[gOffset++] = pixels[p + 1] / 255.0;
    tensorData[bOffset++] = pixels[p + 2] / 255.0;
  }
  return new Tensor("float32", tensorData, [1, 3, height, width]);
}

// Функции постобработки маски
function applyGaussianBlur(data, width, height, radius) {
  const result = new Float32Array(data.length);
  const sigma = radius / 3;
  const kernelSize = Math.ceil(radius * 2) + 1;
  const kernel = new Float32Array(kernelSize);
  
  // Создаем ядро Гаусса
  let sum = 0;
  for (let i = 0; i < kernelSize; i++) {
    const x = i - Math.floor(kernelSize / 2);
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    sum += kernel[i];
  }
  
  // Нормализуем ядро
  for (let i = 0; i < kernelSize; i++) {
    kernel[i] /= sum;
  }
  
  // Применяем размытие по горизонтали
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 0;
      for (let k = 0; k < kernelSize; k++) {
        const nx = x + k - Math.floor(kernelSize / 2);
        if (nx >= 0 && nx < width) {
          value += data[y * width + nx] * kernel[k];
        }
      }
      result[y * width + x] = value;
    }
  }
  
  // Применяем размытие по вертикали
  const final = new Float32Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 0;
      for (let k = 0; k < kernelSize; k++) {
        const ny = y + k - Math.floor(kernelSize / 2);
        if (ny >= 0 && ny < height) {
          value += result[ny * width + x] * kernel[k];
        }
      }
      final[y * width + x] = value;
    }
  }
  
  return final;
}

function applyMorphology(data, width, height, kernelSize, operation = 'close') {
  const result = new Float32Array(data.length);
  const halfKernel = Math.floor(kernelSize / 2);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = data[y * width + x];
      
      if (operation === 'close') {
        // Морфологическое закрытие (расширение + эрозия)
        let maxVal = value;
        for (let ky = -halfKernel; ky <= halfKernel; ky++) {
          for (let kx = -halfKernel; kx <= halfKernel; kx++) {
            const nx = x + kx;
            const ny = y + ky;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              maxVal = Math.max(maxVal, data[ny * width + nx]);
            }
          }
        }
        value = maxVal;
      } else if (operation === 'open') {
        // Морфологическое открытие (эрозия + расширение)
        let minVal = value;
        for (let ky = -halfKernel; ky <= halfKernel; ky++) {
          for (let kx = -halfKernel; kx <= halfKernel; kx++) {
            const nx = x + kx;
            const ny = y + ky;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              minVal = Math.min(minVal, data[ny * width + nx]);
            }
          }
        }
        value = minVal;
      }
      
      result[y * width + x] = value;
    }
  }
  
  return result;
}

function enhanceMaskEdges(data, width, height, threshold) {
  const result = new Float32Array(data.length);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const value = data[idx];
      
      // Проверяем градиент на краях
      let isEdge = false;
      if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
        const gx = Math.abs(data[idx + 1] - data[idx - 1]);
        const gy = Math.abs(data[(y + 1) * width + x] - data[(y - 1) * width + x]);
        const gradient = Math.sqrt(gx * gx + gy * gy);
        isEdge = gradient > threshold;
      }
      
      // Усиливаем края
      if (isEdge) {
        result[idx] = Math.min(1.0, value * 1.2);
      } else {
        result[idx] = value;
      }
    }
  }
  
  return result;
}

function postProcessMask(phaData, width, height) {
  if (!enablePostProcessing) return phaData;
  
  let processed = new Float32Array(phaData);
  
  // 1. Морфологическое закрытие для заполнения дыр
  processed = applyMorphology(processed, width, height, morphKernelSize, 'close');
  
  // 2. Усиление краев
  processed = enhanceMaskEdges(processed, width, height, edgeThreshold);
  
  // 3. Легкое размытие для сглаживания
  if (blurRadius > 0) {
    processed = applyGaussianBlur(processed, width, height, blurRadius);
  }
  
  return processed;
}

self.onmessage = async (e) => {
  const msg = e.data;

  try {
    if (msg.type === "init") {
      // Оптимизированное количество потоков
      const wantThreads = msg.threads ?? Math.min(2, self.navigator?.hardwareConcurrency || 1);
      env.wasm.numThreads = self.crossOriginIsolated ? wantThreads : 1;

      try {
        // Загрузка модели
        const resp = await fetch(msg.modelUrl, { credentials: "same-origin" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
        const buf = await resp.arrayBuffer();
        if (buf.byteLength < 100 * 1024) {
          const head = new TextDecoder().decode(
            new Uint8Array(buf).slice(0, 200),
          );
          throw new Error(
            `Файл слишком мал (${buf.byteLength} B). Похоже не ONNX: ${head}`,
          );
        }

        // Оптимизированные настройки сессии
        session = await InferenceSession.create(buf, {
          executionProviders: ["wasm"],
          graphOptimizationLevel: "all",
          enableCpuMemArena: true,
          enableMemPattern: true,
          enableProfiling: false,
          logSeverityLevel: 2, // warning
        });
      } catch (e2) {
        self.postMessage({
          type: "error",
          message: `Не удалось загрузить модель ${msg.modelUrl}: ${e2.message || e2}`,
        });
        return;
      }

      // Оптимизированные параметры для производительности
      downsample = msg.downsample ?? 0.7; // Увеличиваем для FPS
      enablePostProcessing = msg.enablePostProcessing ?? false; // Отключаем по умолчанию
      blurRadius = msg.blurRadius ?? 0;
      edgeThreshold = msg.edgeThreshold ?? 0.1;
      morphKernelSize = msg.morphKernelSize ?? 3;
      
      r1 = r2 = r3 = r4 = null;

      self.postMessage({ 
        type: "ready",
        config: {
          downsample,
          enablePostProcessing,
          blurRadius,
          edgeThreshold,
          morphKernelSize
        }
      });
      return;
    }

    if (msg.type === "reset") {
      r1 = r2 = r3 = r4 = null;
      self.postMessage({ type: "reset-ok" });
      return;
    }

    if (msg.type === "run") {
      if (!session) {
        self.postMessage({ type: "error", message: "Session not initialized" });
        return;
      }

      const t0 = performance.now();

      const srcTensor = imageBitmapToTensor(msg.bitmap);

      // Начальные состояния для RVM
      const z = new Float32Array(1);
      const zShape = [1, 1, 1, 1];

      const feeds = {
        src: srcTensor,
        downsample_ratio: new Tensor(
          "float32",
          new Float32Array([downsample]),
          [1],
        ),
        r1i: r1 ?? new Tensor("float32", z, zShape),
        r2i: r2 ?? new Tensor("float32", z, zShape),
        r3i: r3 ?? new Tensor("float32", z, zShape),
        r4i: r4 ?? new Tensor("float32", z, zShape),
      };

      const outputs = await session.run(feeds);
      r1 = outputs.r1o;
      r2 = outputs.r2o;
      r3 = outputs.r3o;
      r4 = outputs.r4o;

      const pha = outputs.pha;
      const t1 = performance.now();

      // Применяем постобработку маски
      const processedPha = postProcessMask(pha.data, pha.dims[3], pha.dims[2]);
      const t2 = performance.now();

      self.postMessage(
        { 
          type: "result", 
          pha: processedPha, 
          shape: pha.dims, 
          timeMs: t1 - t0,
          postProcessTimeMs: t2 - t1,
          totalTimeMs: t2 - t0
        },
        [processedPha.buffer],
      );

      msg.bitmap.close();
      return;
    }
  } catch (error) {
    self.postMessage({ type: "error", message: `Worker error: ${error}` });
    console.error("Worker error:", error);
  }
};
