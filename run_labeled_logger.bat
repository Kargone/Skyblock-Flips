@echo off
:: Keeps optimizer/labeled_data_logger.py running - it collects the whole-catalog
:: price/volume training data for the exit-price model. It only reads the local
:: HTTP API (localhost:8000), so the Node server (server/http-server.js) must be
:: up. Auto-restarts if the logger exits for any reason - it died silently on
:: 2026-09-19 and never came back; this makes that self-healing. Launch at boot
:: via Task Scheduler (Action: this .bat) so a reboot can't leave it dead.
setlocal
cd /d "%~dp0optimizer"

:loop
echo [%date% %time%] starting labeled_data_logger...
python labeled_data_logger.py
echo [%date% %time%] logger exited (code %errorlevel%); restarting in 30s...
timeout /t 30 /nobreak >nul
goto loop
