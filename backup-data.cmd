@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Forma Data Backup
where node >nul 2>&1
if errorlevel 1 goto missing
node scripts\windows-launcher.mjs backup
if errorlevel 1 goto failed
echo.
echo Backup operation completed. Files are in the backups folder.
pause
exit /b 0
:missing
echo Please install Node.js 22 or newer, then run this file again.
:failed
echo.
echo Backup failed. See the message above.
pause
exit /b 1
