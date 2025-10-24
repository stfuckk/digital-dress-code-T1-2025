import { env, InferenceSession, Tensor } from "onnxruntime-web";

// Настройка WASM
env.wasm.wasmPaths =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.0/dist/";
env.wasm.simd = true;
env.wasm.proxy = false;
env.logLevel = "warning";

let session = null;
let downsample = 0.25;
let r1 = null,
  r2 = null,
  r3 = null,
  r4 = null;

function imageBitmapToTensor(bitmap, useFloat16 = false) {
  const width = bitmap.width;
  const height = bitmap.height;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Cannot get 2d context");

  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;

  // Используем Float32Array, так как Float16Array не поддерживается напрямую в JS
  // ONNX Runtime сам преобразует в float16 если нужно
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

  // Для FP16 модели ONNX Runtime автоматически конвертирует float32 в float16
  return new Tensor("float32", tensorData, [1, 3, height, width]);
}

self.onmessage = async (e) => {
  const msg = e.data;

  try {
    if (msg.type === "init") {
      const wantThreads =
        msg.threads ?? Math.min(4, self.navigator?.hardwareConcurrency || 2);
      env.wasm.numThreads = self.crossOriginIsolated ? wantThreads : 1;

      try {
        // Загружаем локальную модель
        const modelUrl = msg.modelUrl || "/models/rvm_resnet50_fp16.onnx";

        self.postMessage({
          type: "status",
          message: "Загрузка модели...",
        });

        const response = await fetch(modelUrl);
        if (!response.ok) {
          throw new Error(
            `Не удалось загрузить модель: HTTP ${response.status}`,
          );
        }

        const modelBuffer = await response.arrayBuffer();

        // Проверяем размер
        if (modelBuffer.byteLength < 10 * 1024 * 1024) {
          throw new Error(
            `Модель слишком мала (${modelBuffer.byteLength} bytes). Возможно, файл поврежден.`,
          );
        }

        self.postMessage({
          type: "status",
          message: "Инициализация модели...",
        });

        // Создаем сессию с правильными настройками для FP16
        session = await InferenceSession.create(modelBuffer, {
          executionProviders: ["wasm"],
          graphOptimizationLevel: "all",
          // Добавляем опции для работы с FP16
          enableCpuMemArena: true,
          enableMemPattern: true,
        });

        console.log("Модель успешно инициализирована");
      } catch (e2) {
        self.postMessage({
          type: "error",
          message: `Ошибка загрузки модели: ${e2.message || e2}`,
        });
        return;
      }

      downsample = msg.downsample ?? 0.25;
      r1 = r2 = r3 = r4 = null;

      self.postMessage({ type: "ready" });
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

      // Преобразуем изображение в тензор
      const srcTensor = imageBitmapToTensor(msg.bitmap, true);

      // Начальные состояния для RVM
      // Используем правильные размеры для начальных состояний
      const initStateSize = 1;
      const z = new Float32Array(initStateSize);
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

      // Сохраняем состояния для следующего кадра
      r1 = outputs.r1o;
      r2 = outputs.r2o;
      r3 = outputs.r3o;
      r4 = outputs.r4o;

      const pha = outputs.pha;
      const t1 = performance.now();

      self.postMessage(
        {
          type: "result",
          pha: pha.data,
          shape: pha.dims,
          timeMs: t1 - t0,
        },
        [pha.data.buffer],
      );

      msg.bitmap.close();
      return;
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      message: `Worker error: ${error.message || error}`,
    });
    console.error("Worker error:", error);
  }
};
