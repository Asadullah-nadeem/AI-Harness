@echo off
setlocal enabledelayedexpansion

:: Check if node is installed
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [-] Node.js is not installed or not in PATH. Please install Node.js first.
    exit /b 1
)

:: Install packages if node_modules doesn't exist
if not exist "node_modules\" (
    echo [+] Installing packages...
    call npm install
)

:: Build the project if not built
if not exist "dist\" (
    echo [+] Compiling TypeScript...
    call npm run build
)

:: Run CLI
echo [+] Starting AI Harness...
node dist/cli.js %*
