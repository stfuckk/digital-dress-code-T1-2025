# 🎥 Цифровой дресс-код - Vue.js версия

> **Production-ready приложение на Vue 3 + Vite + TensorFlow.js**

[![Made with Vue](https://img.shields.io/badge/Made%20with-Vue.js-42b883)](https://vuejs.org/)
[![TensorFlow.js](https://img.shields.io/badge/TensorFlow.js-ML-orange)](https://www.tensorflow.org/js)
[![Vite](https://img.shields.io/badge/Built%20with-Vite-646CFF)](https://vitejs.dev/)

---

## 🚀 Быстрый старт

### Установка зависимостей

```bash
cd vue-app
npm install
```

### Запуск dev-сервера

```bash
npm run dev
```

Откроется на **http://localhost:3000**

### Сборка для production

```bash
npm run build
```

Статические файлы будут в папке `dist/`

### Просмотр production сборки

```bash
npm run preview
```

---

## 📂 Структура проекта

```
vue-app/
├── src/
│   ├── components/
│   │   ├── VideoCanvas.vue          # Главный компонент с видео
│   │   ├── UserInfo.vue             # Информация о пользователе
│   │   ├── StatsPanel.vue           # Панель статистики
│   │   ├── PresentationMode.vue     # Режим презентации
│   │   └── FullInterface.vue        # Полный интерфейс
│   ├── composables/
│   │   └── useBackgroundReplacement.js  # ML логика
│   ├── App.vue                      # Корневой компонент
│   ├── main.js                      # Entry point
│   └── style.css                    # Глобальные стили
├── index.html
├── vite.config.js                   # Конфиг Vite
├── package.json
└── README.md
```

---

## 🎯 Возможности

### ✨ Два режима работы

#### 1. Режим презентации (Minimal UI)
- Автозапуск камеры после разрешения
- Минималистичный интерфейс
- Чекбокс для включения фона
- URL: `?presentation=true`

#### 2. Полный интерфейс
- Все настройки
- Пресеты
- Полный контроль

### 📊 Отображение информации

**Без рамок! С контрастным текстом!**
- **ФИО** (крупно, белым с тенью)
- **Должность** (золотым цветом)
- **Компания** (серым цветом)

Используется `text-shadow` для контраста на любом фоне!

### 📈 Мониторинг производительности

- **CPU %** - загрузка процессора
- **GPU %** - загрузка видеокарты
- **FPS** - текущий
- **AVG FPS** - средний за 10 секунд

С цветовой индикацией (зелёный/жёлтый/красный)!

### 🎨 Типы фонов

1. **Размытие** - регулируемое (0-50px)
2. **Однотонный цвет** - любой цвет
3. **Без фона** - оригинал

### ⚡ Готовые пресеты

- 💼 **Работа** - размытие 25px
- 🎤 **Интервью** - тёмный фон
- 🎮 **Стриминг** - яркий фон
- 📊 **Презентация** - умеренное размытие

---

## 🎬 Режим презентации

### Автозапуск

Откройте с параметром:
```
http://localhost:3000/?presentation=true
```

Или добавьте кнопку в приложении:
```vue
<button @click="$router.push({ query: { presentation: 'true' } })">
  Презентация
</button>
```

### Минимальный UI

- Только необходимые поля (ФИО, должность, компания)
- Чекбокс включения фона
- Одна кнопка запуска
- Кнопка выхода (крестик в углу)

---

## 🛠️ Разработка

### Компонентная архитектура

**VideoCanvas.vue** - главный компонент
- Захват видео (WebRTC)
- ML обработка (TensorFlow.js + BodyPix)
- Рендеринг результата

**UserInfo.vue** - информация о пользователе
- Без фона!
- Контрастный текст с тенями
- Адаптивные размеры

**StatsPanel.vue** - статистика
- Полупрозрачный фон
- Цветовая индикация
- Real-time обновление

**useBackgroundReplacement.js** - composable
- Инициализация модели
- Обработка кадров
- Замена фона
- Статистика

### Добавление нового пресета

В `FullInterface.vue`:

```javascript
const presets = [
  // ...existing
  { 
    id: 'custom', 
    name: 'Мой пресет', 
    icon: '🌟', 
    config: { type: 'color', color: '#hexcolor' } 
  }
]
```

### Изменение стилей текста

В `UserInfo.vue`:

```css
.name {
  font-size: 2rem;
  text-shadow: /* ваши тени */;
}
```

---

## 📦 Production сборка

### Сборка

```bash
npm run build
```

Результат в `dist/`:
```
dist/
├── index.html
├── assets/
│   ├── index-[hash].js      # Код приложения
│   ├── vendor-[hash].js     # Vue
│   └── ml-[hash].js         # TensorFlow.js + BodyPix
```

### Оптимизации

- ✅ **Code splitting** - разделение на чанки
- ✅ **Tree shaking** - удаление неиспользуемого кода
- ✅ **Minification** - минификация (Terser)
- ✅ **Asset optimization** - оптимизация ресурсов

### Размеры bundle

- **Vendor**: ~150 KB (gzip)
- **ML**: ~800 KB (gzip)  
- **App**: ~50 KB (gzip)
- **Total**: ~1 MB (gzip)

### Деплой

**Static hosting:**
```bash
npm run build
# Загрузите dist/ на хостинг
```

**Netlify / Vercel:**
```bash
# Build command
npm run build

# Publish directory
dist
```

---

## 🔧 Кастомизация

### Изменение конфига модели

В `useBackgroundReplacement.js`:

```javascript
const modelConfig = {
  architecture: 'MobileNetV1',  // или 'ResNet50'
  outputStride: 16,              // 8, 16, 32
  multiplier: 0.75,              // 0.5, 0.75, 1.0
  quantBytes: 2                  // 1, 2, 4
}
```

### Настройка сегментации

```javascript
const segmentationConfig = {
  internalResolution: 'medium',   // 'low', 'medium', 'high'
  segmentationThreshold: 0.7,     // 0.0 - 1.0
  maxDetections: 1                // количество людей
}
```

### Цвета темы

В `src/style.css`:

```css
:root {
  --primary: #667eea;
  --secondary: #764ba2;
  /* ... */
}
```

---

## 🐛 Troubleshooting

### Низкий FPS

**Решения:**
1. Уменьшите разрешение камеры в `VideoCanvas.vue`
2. Измените `internalResolution` на `'low'`
3. Увеличьте `outputStride` до 32
4. Используйте `multiplier: 0.5`

### Модель не загружается

**Проверьте:**
1. Подключение к интернету (при первом запуске)
2. Консоль браузера (F12) для ошибок
3. Поддержку WebGL в браузере

### Текст плохо виден

**Увеличьте контраст в `UserInfo.vue`:**
```css
text-shadow: 
  -3px -3px 6px #000,
  3px -3px 6px #000,
  -3px 3px 6px #000,
  3px 3px 6px #000,
  0 0 20px rgba(0, 0, 0, 1);
```

---

## 🎓 Технологии

- **Vue 3** - Composition API
- **Vite** - Build tool
- **TensorFlow.js** - ML в браузере
- **BodyPix** - Сегментация человека
- **WebRTC** - Захват видео
- **Canvas API** - Рендеринг

---

## 🤝 Git Workflow

См. [GIT_INSTRUCTIONS.md](../GIT_INSTRUCTIONS.md)

---

## 📄 Лицензия

MIT License

---

## 👥 Команда

- **Козлов Денис** — Backend, DevOps, ML
- **Аношин Антон** — Backend, ML  
- **Кутырин Максим** — Frontend

**Хакатон:** Т1 Новосибирск  
**Команда:** Войтивайти

---

## 🎉 Готово к хакатону!

Просто запустите:
```bash
npm install
npm run dev
```

И начинайте разработку! 🚀

---

*Made with ❤️ for Hackathon*

