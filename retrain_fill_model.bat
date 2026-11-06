@echo off
:: Retrain the fill model from the latest trade outcomes. Run on the LAPTOP after
:: pulling fresh data with pull_debug_data.bat. Review the printed table, then
:: commit optimizer\fill_model.json and push - the server picks it up on git pull
:: (fill_model.py hot-reloads on mtime change, no optimizer restart needed).
::
:: Do this ~weekly: the backtest showed fill rates drift over time, so a stale
:: model under-predicts. Retraining on fresh data keeps it calibrated.
setlocal
cd /d "%~dp0optimizer"

echo === cleaning trade outcomes ===
python clean_trade_outcomes.py || goto :fail
echo.
echo === refitting fill model ===
python fit_fill_model.py || goto :fail

echo.
echo === refitting exit-price drift ===
python fit_exit_drift.py || goto :fail

echo.
echo Done. Review the output above, then commit optimizer\fill_model.json and
echo optimizer\exit_drift.json and push.
pause
exit /b 0

:fail
echo ERROR: retrain failed - fill_model.json not updated.
pause
exit /b 1
