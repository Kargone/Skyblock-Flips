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
    backend/production/trader-data.json ^
    backend/production/trader-data.json.backup.json ^
    backend/production/mayor-history.json ^
    backend/Testing/pastTradesLogs.json || goto :fail

echo.
echo Files copied. Deleting remote branch...
git push origin --delete %BRANCH_NAME%

echo.
echo Done! All 4 files updated and temporary branch deleted.
pause
exit /b 0

:fail
echo ERROR: couldn't fetch or restore from %BRANCH_NAME% - remote branch left in place.
pause
exit /b 1