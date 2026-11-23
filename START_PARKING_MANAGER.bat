@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Parking Manager v17

echo ==============================================
echo           PARKING MANAGER v17 · iPhone Ready
echo ==============================================
echo.
if not exist node_modules\vite\bin\vite.js (
  echo Устанавливаю зависимости проекта...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo Не удалось установить зависимости. Проверь Node.js и подключение к интернету.
    pause
    exit /b 1
  )
)
echo.
echo Запускаю Parking Manager.
echo Адрес на компьютере: http://localhost:5180/
echo Для iPhone открой HTTPS-адрес опубликованной версии.
echo Локальный адрес по Wi-Fi может быть доступен в браузере, но GPS на iPhone требует HTTPS.
echo Не закрывай это окно, пока пользуешься приложением.
echo Чтобы установить на iPhone: опубликуй приложение на HTTPS, открой ссылку в Safari,
echo нажми Поделиться -> На экран Домой -> Добавить.

echo Для ручного запуска: npm.cmd install, затем npm.cmd run dev.
echo.
call npm.cmd run dev
if errorlevel 1 (
  echo.
  echo Сервер не запустился. Если порт 5180 занят, останови старый Vite через Ctrl+C.
  pause
  exit /b 1
)
pause
