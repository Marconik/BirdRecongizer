@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS from https://nodejs.org/ then try again.
  if not defined CI pause
  exit /b 1
)
node scripts/install.mjs
set "WILDSCENE_EXIT=%ERRORLEVEL%"
if not defined CI pause
exit /b %WILDSCENE_EXIT%
