@echo off
setlocal
cd /d "%~dp0"

:: Optional argument: pull_debug_data.bat 2026-10-20
if "%~1"=="" (
  for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set BRANCH_DATE=%%I
) else (
  set BRANCH_DATE=%~1
)
set BRANCH_NAME=debug-json-%BRANCH_DATE%
echo Fetching data from branch: %BRANCH_NAME%

git fetch --prune origin || goto :fail

:: Write files to disk only (does NOT stage them)
git restore --source=origin/%BRANCH_NAME% --worktree -- ^
    data/trader-data.json ^
    data/trader-data.json.backup.json ^
    data/mayor-history.json ^
    data/mayor-price-history.json ^
    data/pastTradesLogs.json ^
    data/trade-outcomes.jsonl || goto :fail

:: labeled-order-data is optional (the logger may not be producing output);
:: pull it if present, but do not fail the whole sync when it is absent.
git restore --source=origin/%BRANCH_NAME% --worktree -- ^
    data/labeled-order-data.jsonl ^
    data/labeled-order-data.checkpoint.json 2>nul

echo.
echo Files copied. Deleting remote branch...
git push origin --delete %BRANCH_NAME%

echo.
echo Done! Data files updated and temporary branch deleted.
pause
exit /b 0

:fail
echo ERROR: couldn't fetch or restore from %BRANCH_NAME% - remote branch left in place.
pause
exit /b 1