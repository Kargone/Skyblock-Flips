@echo off
setlocal
cd /d "%~dp0"

for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set BRANCH_DATE=%%I
set BRANCH_NAME=debug-json-%BRANCH_DATE%
echo Pushing debug data to branch: %BRANCH_NAME%

:: Use a throwaway index so the real index and working tree are never touched
set GIT_INDEX_FILE=%TEMP%\git-debug-index
git read-tree HEAD || goto :fail

git add -f data/trader-data.json ^
           data/trader-data.json.backup.json ^
           data/mayor-history.json ^
           data/mayor-price-history.json ^
           data/pastTradesLogs.json ^
           data/trade-outcomes.jsonl || goto :fail

:: NOTE: labeled-order-data.jsonl is deliberately NOT synced here - it grows too
:: large for a GitHub HTTPS push (408 / sideband disconnect; GitHub also hard-
:: rejects files >100MB). Transfer it out of band (Google Drive) like the
:: bazaar-trend-data file.

for /f %%T in ('git write-tree') do set TREE=%%T
for /f %%C in ('git commit-tree %TREE% -p HEAD -m "Exporting server JSON data for debugging (%BRANCH_DATE%)"') do set COMMIT=%%C
set GIT_INDEX_FILE=
del "%TEMP%\git-debug-index" 2>nul

if "%COMMIT%"=="" goto :fail
git push -f origin %COMMIT%:refs/heads/%BRANCH_NAME% || goto :fail

echo Done! Server data pushed to %BRANCH_NAME%.
pause
exit /b 0

:fail
set GIT_INDEX_FILE=
echo ERROR: something failed - nothing was changed locally.
pause
exit /b 1