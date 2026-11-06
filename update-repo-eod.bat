@echo off
setlocal EnableDelayedExpansion
title VoxelRealms - End of Day GitHub Sync

cd /d "F:\Created Apps\voxel-game"

echo ========================================================
echo   VoxelRealms: Fantasy Edition - EoD Repository Update
echo   Remote: https://github.com/its-just-lucasg/Voxel-Realms.git
echo ========================================================
echo.

:: Ensure git repository is initialized and remote is set
if not exist ".git" (
    echo Initializing Git repository...
    git init -b main
    git remote add origin https://github.com/its-just-lucasg/Voxel-Realms.git
)

:: Ensure local git identity is configured so commits never fail
git config user.name >nul 2>&1
if %errorlevel% neq 0 git config user.name "its-just-lucasg"
git config user.email >nul 2>&1
if %errorlevel% neq 0 git config user.email "its-just-lucasg@users.noreply.github.com"

:: Generate clean timestamp via PowerShell
for /f "delims=" %%i in ('powershell -NoProfile -Command "Get-Date -Format \"yyyy-MM-dd HH:mm\""') do set "TIMESTAMP=%%i"

:: Allow custom commit message passed as argument, otherwise use EoD timestamp
if "%~1"=="" (
    set "COMMIT_MSG=EoD Update (%TIMESTAMP%)"
) else (
    set "COMMIT_MSG=%* (%TIMESTAMP%)"
)

echo [1/3] Staging all changes...
git add -A

:: Check if there are staged changes to commit
git diff --cached --quiet
if %errorlevel% equ 0 (
    echo No new local file changes to commit.
) else (
    echo [2/3] Committing changes: "!COMMIT_MSG!"
    git commit -m "!COMMIT_MSG!"
)

echo [3/3] Pushing to GitHub (origin/main)...
git push -u origin main

if %errorlevel% equ 0 (
    echo.
    echo [SUCCESS] Voxel-Realms repository is up to date!
) else (
    echo.
    echo [WARNING] Push encountered an issue. Pulling latest changes and retrying...
    git pull origin main --rebase
    git push -u origin main
)

echo.
pause
