@echo off
REM Start the Q-Agent backend (FastAPI) and frontend (Vite) in separate windows.
setlocal
set ROOT=%~dp0..

echo ==^> Backend on http://127.0.0.1:8787
start "Q-Agent API" cmd /k "cd /d %ROOT%\api && uv run uvicorn app.main:app --host 127.0.0.1 --port 8787"

echo ==^> Frontend on http://localhost:5173
start "Q-Agent Web" cmd /k "cd /d %ROOT%\app && npm run dev"

echo Both services launching in separate windows.
