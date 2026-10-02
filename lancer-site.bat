@echo off
setlocal
call "%~dp0..\_tools\portguard.bat" 8090 "BAAM Games"
if errorlevel 1 exit /b 1
cd /d "%~dp0"
call npm run build
if errorlevel 1 (
  pause
  exit /b 1
)
start "" http://127.0.0.1:8090/
call npm run serve

