@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Forma LAN Server
where node >nul 2>&1
if errorlevel 1 goto missing
node scripts\windows-launcher.mjs start
if errorlevel 1 goto failed
exit /b 0
:missing
echo Please install Node.js 22 or newer, then run this file again.
:failed
echo.
echo See the message above. The operation has stopped.
pause
exit /b 1
