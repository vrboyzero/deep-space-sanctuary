#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"
PARENT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -z "${STAR_SANCTUARY_RUNTIME_MODE:-}" ]]; then
    export STAR_SANCTUARY_RUNTIME_MODE="${BELLDANDY_RUNTIME_MODE:-source}"
fi
if [[ -z "${BELLDANDY_RUNTIME_MODE:-}" ]]; then
    export BELLDANDY_RUNTIME_MODE="${STAR_SANCTUARY_RUNTIME_MODE}"
fi
if [[ -z "${STAR_SANCTUARY_RUNTIME_DIR:-}" ]]; then
    export STAR_SANCTUARY_RUNTIME_DIR="${BELLDANDY_RUNTIME_DIR:-${SCRIPT_DIR}}"
fi
if [[ -z "${BELLDANDY_RUNTIME_DIR:-}" ]]; then
    export BELLDANDY_RUNTIME_DIR="${STAR_SANCTUARY_RUNTIME_DIR}"
fi
if [[ -z "${STAR_SANCTUARY_ENV_DIR:-}" ]]; then
    if [[ -n "${BELLDANDY_ENV_DIR:-}" ]]; then
        export STAR_SANCTUARY_ENV_DIR="${BELLDANDY_ENV_DIR}"
    elif [[ -f "${PARENT_DIR}/install-info.json" ]]; then
        export STAR_SANCTUARY_ENV_DIR="${PARENT_DIR}"
    fi
fi
if [[ -z "${BELLDANDY_ENV_DIR:-}" && -n "${STAR_SANCTUARY_ENV_DIR:-}" ]]; then
    export BELLDANDY_ENV_DIR="${STAR_SANCTUARY_ENV_DIR}"
fi

print_capability_hints() {
    echo "[HINT] Default startup does not require optional native features like node-pty, fastembed, protobufjs, or onnxruntime-node."
    echo "[HINT] A plain \"pnpm approve-builds\" reminder is not a blocker for the default install/start path."
    echo "[HINT] If the log mentions better-sqlite3, native bindings, ABI, or postinstall failures, switch to Node.js v22.12+ LTS and rerun install/build."
    echo "[HINT] If the log mentions registry, tarball, ECONNRESET, ETIMEDOUT, or proxy access, fix network/registry access and rerun."
}

echo "[Star Sanctuary Launcher] Initialization..."

# Check Node
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js not found. Please install Node.js v22 LTS"
    echo "[HINT] After installing Node.js, reopen the terminal so node/corepack are available on PATH, then rerun ./start.sh."
    exit 1
fi

# 检查 Node.js 版本兼容性（使用 node 自身来检查，避免 shell 文本解析差异）
node -e 'const v=parseInt(process.version.slice(1),10);if(v<22){console.log("[ERROR] Node.js version too old: "+process.version);console.log("[ERROR] Star Sanctuary requires Node.js v22 or higher.");console.log("[ERROR] Please download v22 LTS from https://nodejs.org/");process.exit(1)}'

# Check PNPM
if ! command -v pnpm &> /dev/null; then
    echo "[INFO] pnpm not found. Enabling via corepack..."
    if ! corepack enable; then
        echo "[ERROR] corepack enable failed."
        echo "[HINT] Install a Node.js distribution that includes corepack, or repair the current Node.js installation, then rerun ./start.sh."
        exit 1
    fi
    if ! corepack prepare pnpm@latest --activate; then
        echo "[ERROR] corepack prepare pnpm@latest failed."
        echo "[HINT] pnpm activation failed before install/build started."
        print_capability_hints
        exit 1
    fi
fi

# A copied or stale node_modules directory may exist without usable workspace binaries.
NEED_INSTALL=0
[ ! -d "node_modules" ] && NEED_INSTALL=1

if [ "$NEED_INSTALL" -eq 0 ] && ! corepack pnpm exec tsc -v >/dev/null 2>&1; then
    NEED_INSTALL=1
fi

if [ "$NEED_INSTALL" -eq 0 ] && ! corepack pnpm exec tsx --version >/dev/null 2>&1; then
    NEED_INSTALL=1
fi

if [ "$NEED_INSTALL" -eq 1 ]; then
    echo "[INFO] Installing dependencies..."
    if ! corepack pnpm install; then
        echo "[ERROR] Dependency installation failed. Please check the error above."
        print_capability_hints
        exit 1
    fi
fi

# 检查所有 workspace 包是否已编译（任何一个 dist 缺失都需要构建）
NEED_BUILD=0
[ ! -d "packages/belldandy-core/dist" ] && NEED_BUILD=1
[ ! -d "packages/belldandy-agent/dist" ] && NEED_BUILD=1
[ ! -d "packages/belldandy-channels/dist" ] && NEED_BUILD=1
[ ! -d "packages/belldandy-skills/dist" ] && NEED_BUILD=1
[ ! -d "packages/belldandy-memory/dist" ] && NEED_BUILD=1
[ ! -d "packages/belldandy-protocol/dist" ] && NEED_BUILD=1

if [ "$NEED_BUILD" -eq 1 ]; then
    echo "[INFO] Building project (compiling TypeScript...)"
    if ! corepack pnpm build; then
        echo "[ERROR] Build failed. Please check the error above."
        print_capability_hints
        exit 1
    fi
    echo "[INFO] Build complete."
fi

# Let the Gateway decide whether a temporary setup token is needed.
export AUTO_OPEN_BROWSER="true"

# NOTE: We do NOT manually open the browser here.
# The Gateway handles AUTO_OPEN_BROWSER internally (same as start.bat).
# Opening it separately would cause two windows.

# NOTE: We do NOT pre-load .env.local here.
# The Gateway reads .env / .env.local directly on startup with correct
# quote-stripping, while explicit shell env vars still keep higher priority.

while true; do
    echo ""
    echo "[Star Sanctuary Launcher] Starting Gateway..."
    echo "[Star Sanctuary Launcher] WebChat: http://localhost:28889"
    echo ""

    set +e
    corepack pnpm bdd start
    EXIT_CODE=$?
    set -e

    if [ $EXIT_CODE -eq 100 ]; then
        echo ""
        echo "[Star Sanctuary Launcher] Restarting..."
        sleep 2
    else
        echo ""
        echo "[Star Sanctuary Launcher] Gateway exited (code $EXIT_CODE)."
        break
    fi
done
