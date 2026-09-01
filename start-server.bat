@echo off
cd /d "%~dp0"
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo Node.js is not installed or not in PATH.
  echo Please install Node.js LTS from https://nodejs.org/
  pause
  exit /b 1
)

if not exist package-lock.json (
  echo Installing dependencies...
  call npm install
)

call npm start
