@echo off
setlocal

set PORT=4000

echo Checking existing process on port %PORT%...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
	echo Stopping PID %%a on port %PORT%...
	taskkill /PID %%a /F >nul 2>&1
)

echo Starting Node App...
start "Dashboard" cmd /k npm start

echo Starting Background Bot...
start "Bot" cmd /k npm run bot

REM timeout /t 10

REM echo Starting LocalTunnel...
REM start cmd /k npx localtunnel --port 4000

endlocal
exit /b 0