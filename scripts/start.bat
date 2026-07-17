@echo off
REM Start the Q-Agent backend (FastAPI) and frontend (Vite) in separate windows.
setlocal
set ROOT=%~dp0..

call :ensure_dev_db
if errorlevel 1 exit /b 1

echo ==^> Backend on http://127.0.0.1:8787
start "Q-Agent API" cmd /k "cd /d %ROOT%\api && uv run uvicorn app.main:app --host 127.0.0.1 --port 8787"

echo ==^> Frontend on http://localhost:5173
start "Q-Agent Web" cmd /k "cd /d %ROOT%\app && npm run dev"

echo Both services launching in separate windows.
exit /b 0

REM If api\.env points at the docker-compose Postgres (127.0.0.1:5456), make
REM sure the `db` service is up before the backend starts — uvicorn has no DB
REM connection retry, so Alembic's boot-time migration fails immediately
REM otherwise. This only starts the plain postgres:16-alpine `db` service,
REM never rebuilds the `api`/`web` images.
:ensure_dev_db
findstr /C:"127.0.0.1:5456" "%ROOT%\api\.env" >nul 2>&1
if errorlevel 1 exit /b 0

echo ==^> Ensuring docker-compose Postgres (db) is up
pushd "%ROOT%"
docker compose up -d db >nul
for /f "delims=" %%i in ('docker compose ps -q db') do set DB_CID=%%i
popd

:wait_db
echo ==^> Waiting for Postgres...
docker exec %DB_CID% pg_isready -U qagent -d qagent >nul 2>&1
if errorlevel 1 (
  timeout /t 1 /nobreak >nul
  goto wait_db
)
exit /b 0
