@echo off
chcp 65001 >nul
setlocal
set "ROOT=%~dp0"
pushd "%ROOT%" || exit /b 1

set "GGEMAIL_PORT=4173"
set "GGEMAIL_TOKEN=gg-email-local"
set "URL=http://127.0.0.1:%GGEMAIL_PORT%/?token=%GGEMAIL_TOKEN%"

if not exist "out\web\server.cjs" (
  echo Не найден out\web\server.cjs. Соберите проект: npm install ^&^& npm run web
  popd
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo Не найден Node.js 22+. Установите Node.js или используйте установщик GG Email.
  popd
  pause
  exit /b 1
)

netstat -ano | findstr ":%GGEMAIL_PORT%" | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 goto open

start "GG Email server" /min cmd /c "set GGEMAIL_PORT=%GGEMAIL_PORT%& set GGEMAIL_TOKEN=%GGEMAIL_TOKEN%& node out\web\server.cjs"
timeout /t 3 /nobreak >nul

:open
popd
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" (
  start "" "%EDGE%" --app="%URL%" --window-size=1400,900
) else (
  start "" "%URL%"
)
exit /b 0
