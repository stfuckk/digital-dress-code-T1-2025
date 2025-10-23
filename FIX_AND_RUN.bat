@echo off
chcp 65001 >nul
title Fix & Run - Vue App

echo.
echo ====================================================
echo    Исправление и запуск Vue приложения
echo ====================================================
echo.

echo [1/4] Проверка структуры папок...
if not exist "src\components" (
    echo ❌ Папка components не найдена, создаю...
    mkdir src\components
    echo ✅ Создана папка src\components
) else (
    echo ✅ Папка components существует
)

if not exist "src\composables" (
    echo ❌ Папка composables не найдена, создаю...
    mkdir src\composables
    echo ✅ Создана папка src\composables
) else (
    echo ✅ Папка composables существует
)

echo.
echo [2/4] Очистка старых зависимостей...
if exist "node_modules" (
    echo Удаляю node_modules...
    rmdir /s /q node_modules
)
if exist "package-lock.json" (
    del package-lock.json
)
echo ✅ Очистка завершена

echo.
echo [3/4] Установка зависимостей...
call npm install
if %errorlevel% neq 0 (
    echo ❌ Ошибка установки! Проверьте npm.
    pause
    exit /b 1
)
echo ✅ Зависимости установлены

echo.
echo [4/4] Запуск dev-сервера...
echo.
echo Откроется браузер на http://localhost:3000
echo.
echo Если видите пустой экран:
echo 1. Нажмите F12 (открыть DevTools)
echo 2. Перейдите на вкладку Console
echo 3. Скопируйте все ошибки (если есть красные)
echo.
echo ====================================================
echo.

call npm run dev

pause

