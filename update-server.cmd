@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Forma Server Update
where node >nul 2>&1
if errorlevel 1 goto missing
node scripts\windows-launcher.mjs update
if errorlevel 1 goto failed
exit /b 0
:missing
echo Please install Node.js 22 or newer, then run this file again.
:failed
echo.
echo Update stopped. Keep your data, .env and backups folders.
pause
exit /b 1
