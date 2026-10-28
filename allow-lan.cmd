@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Forma LAN Firewall
where node >nul 2>&1
if errorlevel 1 goto missing
node scripts\windows-launcher.mjs firewall
if errorlevel 1 goto failed
echo.
echo LAN firewall setup completed.
pause
exit /b 0
:missing
echo Please install Node.js 22 or newer, then run this file again.
:failed
echo.
echo Right-click this file and choose Run as administrator.
pause
exit /b 1
