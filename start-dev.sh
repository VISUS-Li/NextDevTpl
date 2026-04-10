#!/usr/bin/env bash
set -euo pipefail

# 加载 nvm，兼容非交互式会话
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

APP_DIR="${APP_DIR:-$(pwd)}"
PORT="${PORT:-3000}"
PACKAGE_MANAGER="${PACKAGE_MANAGER:-pnpm}"
SKIP_INSTALL="${SKIP_INSTALL:-0}"
START_TUNNEL="${START_TUNNEL:-1}"
CF_TUNNEL_HOST="${CF_TUNNEL_HOST:-127.0.0.1}"
TUNNEL_LOG_FILE="${TUNNEL_LOG_FILE:-/tmp/nextdevtpl-dev-cloudflared.log}"

cd "$APP_DIR"

# 统一选择包管理器，避免分支重复
pick_package_manager() {
  if [ "$PACKAGE_MANAGER" = "pnpm" ] && command -v pnpm >/dev/null 2>&1; then
    printf '%s\n' "pnpm"
    return
  fi

  if [ "$PACKAGE_MANAGER" = "yarn" ] && command -v yarn >/dev/null 2>&1; then
    printf '%s\n' "yarn"
    return
  fi

  if command -v pnpm >/dev/null 2>&1; then
    printf '%s\n' "pnpm"
    return
  fi

  if command -v yarn >/dev/null 2>&1; then
    printf '%s\n' "yarn"
    return
  fi

  printf '%s\n' "npm"
}

# 按锁文件安装依赖，兼容现有仓库习惯
install_dependencies() {
  if [ "$SKIP_INSTALL" = "1" ]; then
    return
  fi

  if [ -f pnpm-lock.yaml ] && command -v pnpm >/dev/null 2>&1; then
    pnpm install --frozen-lockfile
    return
  fi

  if [ -f yarn.lock ] && command -v yarn >/dev/null 2>&1; then
    yarn install --frozen-lockfile
    return
  fi

  if [ -f package-lock.json ]; then
    npm ci
    return
  fi

  npm install
}

# 启动 Cloudflare Tunnel，并尝试打印外网地址
start_tunnel() {
  if [ "$START_TUNNEL" != "1" ]; then
    return
  fi

  if ! command -v cloudflared >/dev/null 2>&1; then
    printf '%s\n' "未找到 cloudflared，已跳过隧道"
    return
  fi

  nohup cloudflared tunnel --protocol http2 --url "http://${CF_TUNNEL_HOST}:${PORT}" > "$TUNNEL_LOG_FILE" 2>&1 &
  TUNNEL_PID=$!

  for _ in $(seq 1 30); do
    if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
      printf '%s\n' "cloudflared 启动失败，请检查 $TUNNEL_LOG_FILE"
      return
    fi

    TUNNEL_URL=$(node -e "const fs = require('node:fs'); const path = '$TUNNEL_LOG_FILE'; const text = fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : ''; const match = text.match(/https:\\/\\/[-a-z0-9.]+trycloudflare\\.com/); process.stdout.write(match ? match[0] : '');")
    if [ -n "$TUNNEL_URL" ]; then
      if ! command -v curl >/dev/null 2>&1; then
        printf '%s\n' "Cloudflare Tunnel: $TUNNEL_URL -> http://${CF_TUNNEL_HOST}:${PORT}"
        return
      fi

      HTTP_CODE="$(curl -L -o /dev/null -s -w '%{http_code}' --max-time 10 "$TUNNEL_URL" || true)"
      if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "307" ] || [ "$HTTP_CODE" = "308" ]; then
        printf '%s\n' "Cloudflare Tunnel: $TUNNEL_URL -> http://${CF_TUNNEL_HOST}:${PORT}"
        return
      fi
    fi

    sleep 1
  done

  printf '%s\n' "Cloudflare Tunnel 已启动，但外网地址暂未验证通过，日志: $TUNNEL_LOG_FILE"
}

# 等待本地服务可访问，再继续后续步骤
wait_for_local_http() {
  if ! command -v curl >/dev/null 2>&1; then
    return
  fi

  for _ in $(seq 1 60); do
    HTTP_CODE="$(curl -L -o /dev/null -s -w '%{http_code}' --max-time 5 "http://127.0.0.1:${PORT}" || true)"
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "307" ] || [ "$HTTP_CODE" = "308" ]; then
      return
    fi
    sleep 1
  done
}

# 退出时同时关闭子进程
cleanup() {
  if [ -n "${DEV_PID:-}" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    kill "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi

  if [ -n "${TUNNEL_PID:-}" ] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    kill "$TUNNEL_PID" 2>/dev/null || true
    wait "$TUNNEL_PID" 2>/dev/null || true
  fi
}

PACKAGE_MANAGER_CMD="$(pick_package_manager)"
install_dependencies
trap cleanup EXIT INT TERM

printf '%s\n' "调试服务启动中: http://127.0.0.1:${PORT}"
node node_modules/next/dist/bin/next dev --turbopack -H 0.0.0.0 -p "$PORT" &
DEV_PID=$!
wait_for_local_http
start_tunnel
wait "$DEV_PID"
