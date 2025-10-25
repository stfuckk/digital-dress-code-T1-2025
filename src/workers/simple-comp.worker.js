// src/workers/simple-comp.worker.js
// Упрощенный композитор без сложных операций

let isReady = false;

self.onmessage = async (e) => {
  const { type } = e.data || {};
  
  try {
    if (type === 'headless-init') {
      isReady = true;
      self.postMessage({ type: 'status', payload: 'Simple composer ready' });
      return;
    }
    
    if (type === 'frame') {
      // Просто пересылаем кадр обратно
      if (e.data.frame) {
        self.postMessage({ 
          type: 'frame', 
          payload: { bitmap: e.data.frame } 
        }, [e.data.frame]);
      }
      return;
    }
    
    if (type === 'mask') {
      // Просто подтверждаем получение маски
      self.postMessage({ type: 'status', payload: 'Mask received' });
      return;
    }
    
    if (type === 'stop') {
      isReady = false;
      self.postMessage({ type: 'status', payload: 'Stopped' });
      return;
    }
    
  } catch (err) {
    self.postMessage({ type: 'error', payload: String(err) });
  }
};
