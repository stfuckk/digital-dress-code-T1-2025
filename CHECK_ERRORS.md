# 🔍 Проверка ошибок

## Если видите пустой цветной фон:

### Шаг 1: Откройте Console в браузере

1. Нажмите **F12**
2. Вкладка **Console**
3. Посмотрите на ошибки (красным цветом)

### Шаг 2: Проверьте Elements

1. Вкладка **Elements** (или **Инспектор**)
2. Найдите `<div id="app">`
3. Посмотрите что внутри

**Если пусто:**
```html
<div id="app">
  <!-- пусто -->
</div>
```

Значит Vue не монтируется!

**Если есть содержимое:**
```html
<div id="app">
  <div class="app-container">
    <div class="full-interface">
      ...
    </div>
  </div>
</div>
```

Значит проблема в CSS!

---

## Типичные ошибки:

### 1. `Failed to resolve component`

```
[Vue warn]: Failed to resolve component: PresentationMode
```

**Причина:** Файл компонента не найден

**Решение:**
Проверьте что файлы существуют:
- `src/components/PresentationMode.vue`
- `src/components/FullInterface.vue`
- `src/components/VideoCanvas.vue`
- `src/components/UserInfo.vue`
- `src/components/StatsPanel.vue`

### 2. `Module not found`

```
Module not found: Can't resolve './components/FullInterface.vue'
```

**Причина:** Неправильный путь к файлу

**Решение:** Проверьте импорт в `App.vue`:
```javascript
import FullInterface from './components/FullInterface.vue'
```

### 3. `Cannot read properties of undefined`

```
Cannot read properties of undefined (reading 'value')
```

**Причина:** Ошибка в reactive переменных

**Решение:** Проверьте что все ref() правильно инициализированы

### 4. Нет ошибок, но пустой экран

**Причина:** CSS скрывает элементы или фон перекрывает

**Решение:**
1. В DevTools → Elements
2. Найдите `.app-container`
3. Посмотрите computed styles (справа)
4. Проверьте `display`, `visibility`, `opacity`

---

## Быстрая диагностика:

### Команды в Console (F12):

```javascript
// Проверить что Vue загружен
console.log(window.Vue)

// Проверить что приложение смонтировано
console.log(document.getElementById('app').innerHTML)

// Проверить ошибки
console.error('test')
```

---

## Если ничего не помогает:

### Создайте минимальный test.vue:

В `src/App.vue` замените всё на:

```vue
<template>
  <div style="padding: 50px; background: white; color: black;">
    <h1>Vue работает!</h1>
    <p>Если видите этот текст, значит Vue загружен корректно.</p>
    <button @click="count++">Клики: {{ count }}</button>
  </div>
</template>

<script setup>
import { ref } from 'vue'
const count = ref(0)
</script>
```

Если это работает - проблема в компонентах.  
Если не работает - проблема в самом Vue.

---

## Отправьте мне:

1. **Скриншот Console** (F12 → Console)
2. **Скриншот Elements** (F12 → Elements → div#app)
3. **Текст ошибок** (скопируйте из Console)

И я точно исправлю! 🔧

