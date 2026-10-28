@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Forma Development
where node >nul 2>&1
if errorlevel 1 goto missing
node scripts\windows-launcher.mjs dev
if errorlevel 1 goto failed
exit /b 0
:missing
echo Please install Node.js 22 or newer, then run this file again.
:failed
echo.
echo See the message above. Development startup stopped.
pause
exit /b 1
