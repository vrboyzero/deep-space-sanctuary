@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"
for %%I in ("%SCRIPT_DIR%..") do set "PARENT_DIR=%%~fI"
if not defined STAR_SANCTUARY_RUNTIME_MODE (
    if defined BELLDANDY_RUNTIME_MODE (
        set "STAR_SANCTUARY_RUNTIME_MODE=%BELLDANDY_RUNTIME_MODE%"
    ) else (
        set "STAR_SANCTUARY_RUNTIME_MODE=source"
    )
)
if not defined BELLDANDY_RUNTIME_MODE set "BELLDANDY_RUNTIME_MODE=%STAR_SANCTUARY_RUNTIME_MODE%"
if not defined STAR_SANCTUARY_RUNTIME_DIR (
    if defined BELLDANDY_RUNTIME_DIR (
        set "STAR_SANCTUARY_RUNTIME_DIR=%BELLDANDY_RUNTIME_DIR%"
    ) else (
        set "STAR_SANCTUARY_RUNTIME_DIR=%SCRIPT_DIR%"
    )
)
if not defined BELLDANDY_RUNTIME_DIR set "BELLDANDY_RUNTIME_DIR=%STAR_SANCTUARY_RUNTIME_DIR%"
if not defined STAR_SANCTUARY_ENV_DIR (
    if defined BELLDANDY_ENV_DIR (
        set "STAR_SANCTUARY_ENV_DIR=%BELLDANDY_ENV_DIR%"
    ) else if exist "%PARENT_DIR%\install-info.json" (
        set "STAR_SANCTUARY_ENV_DIR=%PARENT_DIR%"
    )
)
if not defined BELLDANDY_ENV_DIR if defined STAR_SANCTUARY_ENV_DIR set "BELLDANDY_ENV_DIR=%STAR_SANCTUARY_ENV_DIR%"

goto :after_helpers

:print_capability_hints
echo [HINT] Default startup does not require optional native features like node-pty, fastembed, protobufjs, or onnxruntime-node.
echo [HINT] A plain "pnpm approve-builds" reminder is not a blocker for the default install/start path.
echo [HINT] If the log mentions native bindings or postinstall failures, verify Node.js is v22.12+ and rerun install/build.
echo [HINT] If the log mentions registry, tarball, ECONNRESET, ETIMEDOUT, or proxy access, fix network/registry access and rerun.
goto :eof

:after_helpers

echo [Star Sanctuary Launcher] Initialization...

REM Check whether Node.js is installed.
node -v >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install Node.js v22 LTS from https://nodejs.org/
    echo [HINT] After installing Node.js, reopen the terminal so node/corepack are available on PATH, then rerun start.bat.
    pause
    exit /b 1
)

REM Check Node.js version compatibility using Node itself to avoid batch parsing issues.
node -e "const v=parseInt(process.version.slice(1));if(v<22){console.log('[ERROR] Node.js version too old: '+process.version);console.log('[ERROR] Star Sanctuary requires Node.js v22 or higher.');console.log('[ERROR] Please download v22 LTS from https://nodejs.org/');process.exit(1)}"
if %errorlevel% neq 0 (
    pause
    exit /b 1
)

REM Check pnpm.
call pnpm -v >nul 2>nul
if %errorlevel% neq 0 (
    echo [INFO] pnpm not found. Enabling via corepack...
    call corepack enable
    if %errorlevel% neq 0 (
        echo [ERROR] corepack enable failed.
        echo [HINT] Install a Node.js distribution that includes corepack, or repair the current Node.js installation, then rerun start.bat.
        pause
        exit /b 1
    )
    call corepack prepare pnpm@latest --activate
    if %errorlevel% neq 0 (
        echo [ERROR] corepack prepare pnpm@latest failed.
        echo [HINT] pnpm activation failed before install/build started.
        call :print_capability_hints
        pause
        exit /b 1
    )
)

REM A copied or stale node_modules directory may exist without usable workspace binaries.
set "NEED_INSTALL=0"
if not exist node_modules set "NEED_INSTALL=1"
if "%NEED_INSTALL%"=="0" (
    call corepack pnpm exec tsc -v >nul 2>nul
    if %errorlevel% neq 0 set "NEED_INSTALL=1"
)
if "%NEED_INSTALL%"=="0" (
    call corepack pnpm exec tsx --version >nul 2>nul
    if %errorlevel% neq 0 set "NEED_INSTALL=1"
)
if "%NEED_INSTALL%"=="1" (
    echo [INFO] Installing dependencies...
    call corepack pnpm install
    if %errorlevel% neq 0 (
        echo [ERROR] Dependency installation failed. Please check the error above.
        call :print_capability_hints
        pause
        exit /b 1
    )
)

REM Check whether workspace packages are already built.
if not exist "packages\belldandy-core\dist" goto :do_build
if not exist "packages\belldandy-agent\dist" goto :do_build
if not exist "packages\belldandy-channels\dist" goto :do_build
if not exist "packages\belldandy-skills\dist" goto :do_build
if not exist "packages\belldandy-memory\dist" goto :do_build
if not exist "packages\belldandy-protocol\dist" goto :do_build
goto :skip_build

:do_build
echo [INFO] Building project (compiling TypeScript...)
call corepack pnpm build
if %errorlevel% neq 0 (
    echo [ERROR] Build failed. Please check the error above.
    call :print_capability_hints
    pause
    exit /b 1
)
echo [INFO] Build complete.

:skip_build

REM Let the Gateway decide whether a temporary setup token is needed.
set "AUTO_OPEN_BROWSER=true"

REM NOTE: We do NOT pre-load .env.local here.
REM The Gateway reads .env / .env.local directly on startup with correct
REM quote-stripping, while explicit shell env vars still keep higher priority.

:main_loop
echo.
echo [Star Sanctuary Launcher] Starting Gateway...
echo [Star Sanctuary Launcher] WebChat: http://localhost:28889
echo.

call corepack pnpm bdd start

if %errorlevel% equ 100 (
    echo.
    echo [Star Sanctuary Launcher] Restarting...
    timeout /t 2 >nul
    goto main_loop
)

echo.
echo [Star Sanctuary Launcher] Gateway exited (code %errorlevel%).
pause
