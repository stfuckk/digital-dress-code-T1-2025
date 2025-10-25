// src/workers/comp.worker.js
// Оптимизированный композитор с улучшенным качеством смешивания

let outCanvas = null;
let outCtx = null;
let headless = false;
let headlessCanvas = null;
let W = 0, H = 0;

// Внутренние канвасы для оптимизации
let fgCanvas = null, fgCtx = null;
let maskCanvas = null, maskCtx = null;
let tempCanvas = null, tempCtx = null;

// Параметры композиции
let mode = 'blur';
let bgImage = null;
let bgColor = [0, 0, 0];
let blurPx = 15;

// Оптимизированные параметры смешивания
let enableEdgeSmoothing = true;
let enableColorMatting = true;
let edgeFeather = 2;
let spillSuppression = 0.1;

let latestFrame = null;
let latestMask = null;

function post(type, payload) { 
  self.postMessage({ type, payload }); 
}

// Оптимизированная функция смешивания с учетом цветового матирования
function applyColorMatting(frameData, maskData, width, height) {
  if (!enableColorMatting) return frameData;
  
  const result = new Uint8ClampedArray(frameData.length);
  
  for (let i = 0; i < width * height; i++) {
    const maskIdx = i;
    const frameIdx = i * 4;
    const resultIdx = i * 4;
    
    const alpha = maskData[maskIdx] / 255.0;
    
    // Простое подавление цветового разлива
    if (alpha < 0.8) {
      const spill = Math.max(0, 1 - alpha - spillSuppression);
      result[resultIdx] = Math.min(255, frameData[frameIdx] * (1 - spill * 0.3));
      result[resultIdx + 1] = Math.min(255, frameData[frameIdx + 1] * (1 - spill * 0.3));
      result[resultIdx + 2] = Math.min(255, frameData[frameIdx + 2] * (1 - spill * 0.3));
    } else {
      result[resultIdx] = frameData[frameIdx];
      result[resultIdx + 1] = frameData[frameIdx + 1];
      result[resultIdx + 2] = frameData[frameIdx + 2];
    }
    
    result[resultIdx + 3] = frameData[frameIdx + 3];
  }
  
  return result;
}

// Улучшенное сглаживание краев
function smoothEdges(maskData, width, height) {
  if (!enableEdgeSmoothing) return maskData;
  
  const result = new Uint8Array(maskData.length);
  const kernel = [
    [1, 2, 1],
    [2, 4, 2],
    [1, 2, 1]
  ];
  const kernelSum = 16;
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let sum = 0;
      
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = (y + ky) * width + (x + kx);
          sum += maskData[idx] * kernel[ky + 1][kx + 1];
        }
      }
      
      result[y * width + x] = Math.round(sum / kernelSum);
    }
  }
  
  // Копируем границы
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (y === 0 || y === height - 1 || x === 0 || x === width - 1) {
        result[y * width + x] = maskData[y * width + x];
      }
    }
  }
  
  return result;
}

self.onmessage = async (e) => {
  const { type } = e.data || {};
  try {
    if (type === 'attach-canvas') {
      outCanvas = e.data.canvas;
      W = outCanvas.width; H = outCanvas.height;
      outCtx = outCanvas.getContext('2d', { alpha: true, desynchronized: true });
      await initBuffersAndBackground(e.data);
      post('status', 'Optimized composer ready');
      return;
    }

    if (type === 'headless-init') {
      headless = true;
      W = e.data.width; H = e.data.height;
      headlessCanvas = new OffscreenCanvas(W, H);
      outCtx = headlessCanvas.getContext('2d', { alpha: true });
      await initBuffersAndBackground(e.data);
      post('status', 'Optimized composer ready (headless)');
      return;
    }

    if (type === 'frame') {
      if (latestFrame) latestFrame.close();
      latestFrame = e.data.frame;
      tryCompose();
      return;
    }

    if (type === 'mask') {
      latestMask = e.data.payload;
      tryCompose();
      return;
    }

    if (type === 'stop') {
      if (latestFrame) { latestFrame.close(); latestFrame = null; }
      latestMask = null;
      return;
    }
  } catch (err) {
    post('error', String(err));
  }
};

async function initBuffersAndBackground(cfg) {
  // Инициализация оптимизированных канвасов
  fgCanvas = new OffscreenCanvas(W, H);
  fgCtx = fgCanvas.getContext('2d', { alpha: true });
  maskCanvas = new OffscreenCanvas(W, H);
  maskCtx = maskCanvas.getContext('2d', { alpha: true });
  tempCanvas = new OffscreenCanvas(W, H);
  tempCtx = tempCanvas.getContext('2d', { alpha: true });

  mode = cfg.mode || 'blur';
  const background = cfg.background;

  bgImage = null;
  if (typeof background === 'string') {
    bgImage = await loadImage(background);
  } else if (background && typeof background === 'object') {
    if ('r' in background) {
      bgColor = [background.r/255, background.g/255, background.b/255];
    }
    if ('blur' in background) {
      blurPx = +background.blur || 15;
    }
  }
}

function tryCompose() {
  if (!outCtx || !latestFrame || !latestMask) return;

  const W = outCanvas.width, H = outCanvas.height;

  // 1) Рисуем фон с оптимизацией
  outCtx.save();
  outCtx.clearRect(0, 0, W, H);
  
  if (mode === 'image' && bgImage) {
    // Оптимизированное масштабирование фона
    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = 'high';
    outCtx.drawImage(bgImage, 0, 0, W, H);
  } else if (mode === 'color') {
    outCtx.fillStyle = rgbStr(bgColor);
    outCtx.fillRect(0, 0, W, H);
  } else {
    // Оптимизированное размытие
    outCtx.filter = `blur(${blurPx}px)`;
    outCtx.drawImage(latestFrame, 0, 0, W, H);
    outCtx.filter = 'none';
  }
  outCtx.restore();

  // 2) Подготавливаем foreground с улучшенным качеством
  fgCtx.clearRect(0, 0, W, H);
  fgCtx.drawImage(latestFrame, 0, 0, W, H);

  // 3) Обрабатываем маску с улучшениями
  const mw = latestMask.width, mh = latestMask.height;
  const imgData = new ImageData(W, H);
  
  // Масштабируем маску с улучшенной интерполяцией
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sy = Math.min(mh - 1, Math.floor(y * mh / H));
      const sx = Math.min(mw - 1, Math.floor(x * mw / W));
      const srcIdx = sy * mw + sx;
      const dstIdx = (y * W + x) * 4;
      const a = latestMask.data[srcIdx];
      
      imgData.data[dstIdx + 0] = 255;
      imgData.data[dstIdx + 1] = 255;
      imgData.data[dstIdx + 2] = 255;
      imgData.data[dstIdx + 3] = a;
    }
  }
  
  // Применяем сглаживание краев к маске
  const smoothedMask = smoothEdges(new Uint8Array(imgData.data.filter((_, i) => i % 4 === 3)), W, H);
  for (let i = 0; i < W * H; i++) {
    imgData.data[i * 4 + 3] = smoothedMask[i];
  }
  
  maskCtx.putImageData(imgData, 0, 0);

  // 4) Применяем цветовое матирование
  if (enableColorMatting) {
    const fgImageData = fgCtx.getImageData(0, 0, W, H);
    const mattedData = applyColorMatting(fgImageData.data, smoothedMask, W, H);
    const mattedImageData = new ImageData(mattedData, W, H);
    fgCtx.putImageData(mattedImageData, 0, 0);
  }

  // 5) Применяем маску с улучшенным смешиванием
  fgCtx.save();
  fgCtx.globalCompositeOperation = 'destination-in';
  fgCtx.drawImage(maskCanvas, 0, 0);
  fgCtx.restore();

  // 6) Финальное наложение с антиалиасингом
  outCtx.save();
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = 'high';
  outCtx.drawImage(fgCanvas, 0, 0, W, H);
  outCtx.restore();

  // Headless режим
  if (headless) {
    const bmp = headlessCanvas.transferToImageBitmap();
    post('frame', { bitmap: bmp }, [bmp]);
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}

function rgbStr([r,g,b]) { 
  return `rgb(${Math.round(r*255)}, ${Math.round(g*255)}, ${Math.round(b*255)})`; 
}
