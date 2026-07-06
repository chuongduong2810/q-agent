@echo off
REM Q-Agent one-click setup (Windows). Requires: uv, node 20+, Claude CLI.
setlocal
set ROOT=%~dp0..

where uv >nul 2>nul
if errorlevel 1 (
  echo ==^> uv not found: installing
  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex" || goto :err
  REM Make uv available in this session (installer adds it to %%USERPROFILE%%\.local\bin).
  set "PATH=%USERPROFILE%\.local\bin;%PATH%"
  where uv >nul 2>nul || (echo uv install failed; open a new shell or add %%USERPROFILE%%\.local\bin to PATH & goto :err)
)

echo ==^> Backend (api): uv sync
pushd "%ROOT%\api" && uv sync --extra dev || goto :err
popd

echo ==^> Frontend (app): npm install
pushd "%ROOT%\app" && call npm install || goto :err

echo ==^> Playwright browsers (chromium)
call npx playwright install chromium || goto :err
popd

if not exist "%ROOT%\api\.env" (
  copy "%ROOT%\api\.env.example" "%ROOT%\api\.env" >nul
  echo ==^> Created api\.env from example (edit QAGENT_SECRET_KEY before real use^)
)

echo.
echo Setup complete.
echo   - Configure providers + authenticate the Claude CLI (claude).
echo   - Optional demo data:  cd api ^&^& uv run python -m app.seed
echo   - Start everything:    scripts\start.bat
goto :eof

:err
echo Setup failed.
exit /b 1
