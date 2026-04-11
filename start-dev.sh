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
CF_CONFIG_FILE="${CF_CONFIG_FILE:-$HOME/.cloudflared/config.yml}"
TUNNEL_NAME="${TUNNEL_NAME:-redink-tripai}"
TUNNEL_HOSTNAME="${TUNNEL_HOSTNAME:-platform.tripai.icu}"
PUBLIC_URL="${PUBLIC_URL:-https://platform.tripai.icu}"
TUNNEL_LOG_FILE="${TUNNEL_LOG_FILE:-/tmp/nextdevtpl-dev-cloudflared.log}"
NGROK_LOG_FILE="${NGROK_LOG_FILE:-/tmp/nextdevtpl-dev-ngrok.log}"

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

# 统一检查 HTTP 是否已可访问。
http_ready() {
  local url=$1
  [ -n "$url" ] || return 1
  command -v curl >/dev/null 2>&1 || return 0
  HTTP_CODE="$(curl -L -o /dev/null -s -w '%{http_code}' --max-time 10 "$url" || true)"
  [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "307" ] || [ "$HTTP_CODE" = "308" ]
}

# 只有固定域名已指向当前端口时，才启用 named tunnel。
named_tunnel_matches_port() {
  [ -n "$TUNNEL_NAME" ] || return 1
  [ -n "$TUNNEL_HOSTNAME" ] || return 1
  [ -f "$CF_CONFIG_FILE" ] || return 1
  TARGET_LINE="$(grep -A1 "hostname: ${TUNNEL_HOSTNAME}" "$CF_CONFIG_FILE" | tail -n1 | sed 's/^[[:space:]]*service:[[:space:]]*//')"
  [ -n "$TARGET_LINE" ] || return 1
  printf '%s' "$TARGET_LINE" | rg -q ":${PORT}(/)?$"
}

# 优先固定 Cloudflare，失败时退回 quick tunnel。
start_cloudflare_tunnel() {
  command -v cloudflared >/dev/null 2>&1 || return 1
  : > "$TUNNEL_LOG_FILE"
  if named_tunnel_matches_port; then
    nohup cloudflared --no-autoupdate tunnel --config "$CF_CONFIG_FILE" --protocol http2 run "$TUNNEL_NAME" > "$TUNNEL_LOG_FILE" 2>&1 &
    TUNNEL_PID=$!
    for _ in $(seq 1 20); do
      if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
        break
      fi
      if http_ready "$PUBLIC_URL"; then
        ACTIVE_TUNNEL_URL="$PUBLIC_URL"
        return 0
      fi
      sleep 1
    done
    kill "$TUNNEL_PID" 2>/dev/null || true
    wait "$TUNNEL_PID" 2>/dev/null || true
    TUNNEL_PID=""
  fi

  nohup cloudflared tunnel --protocol http2 --url "http://${CF_TUNNEL_HOST}:${PORT}" > "$TUNNEL_LOG_FILE" 2>&1 &
  TUNNEL_PID=$!
  for _ in $(seq 1 30); do
    if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
      return 1
    fi
    QUICK_URL="$(node -e "const fs=require('node:fs');const text=fs.existsSync('$TUNNEL_LOG_FILE')?fs.readFileSync('$TUNNEL_LOG_FILE','utf8'):'';const match=text.match(/https:\\/\\/[-a-z0-9.]+trycloudflare\\.com/);process.stdout.write(match?match[0]:'');")"
    if [ -n "$QUICK_URL" ] && http_ready "$QUICK_URL"; then
      ACTIVE_TUNNEL_URL="$QUICK_URL"
      return 0
    fi
    sleep 1
  done
  return 1
}

# Cloudflare 不可用时，若本机有 ngrok 就退回 ngrok。
start_ngrok_tunnel() {
  command -v ngrok >/dev/null 2>&1 || return 1
  : > "$NGROK_LOG_FILE"
  nohup ngrok http "http://${CF_TUNNEL_HOST}:${PORT}" --log=stdout > "$NGROK_LOG_FILE" 2>&1 &
  NGROK_PID=$!
  for _ in $(seq 1 30); do
    if ! kill -0 "$NGROK_PID" 2>/dev/null; then
      return 1
    fi
    NGROK_URL="$(curl -fsS http://127.0.0.1:4040/api/tunnels 2>/dev/null | node -e "let data='';process.stdin.on('data',d=>data+=d);process.stdin.on('end',()=>{try{const items=JSON.parse(data).tunnels||[];const item=items.find(v=>String(v.public_url||'').startsWith('https://'));process.stdout.write(item?item.public_url:'')}catch{process.stdout.write('')}}")"
    if [ -n "$NGROK_URL" ] && http_ready "$NGROK_URL"; then
      ACTIVE_TUNNEL_URL="$NGROK_URL"
      return 0
    fi
    sleep 1
  done
  return 1
}

# 统一启动公网入口。
start_tunnel() {
  if [ "$START_TUNNEL" != "1" ]; then
    return
  fi
  if start_cloudflare_tunnel; then
    printf '%s\n' "公网地址: $ACTIVE_TUNNEL_URL -> http://${CF_TUNNEL_HOST}:${PORT}"
    return
  fi
  printf '%s\n' "Cloudflare Tunnel 不可用，尝试 ngrok"
  if start_ngrok_tunnel; then
    printf '%s\n' "公网地址: $ACTIVE_TUNNEL_URL -> http://${CF_TUNNEL_HOST}:${PORT}"
    return
  fi
  printf '%s\n' "未能建立公网入口，保留局域网访问"
}

# 输出本地与局域网地址，后续直接复制即可。
print_local_access() {
  LAN_IP="$(python3 -c "import socket; s=socket.socket(socket.AF_INET, socket.SOCK_DGRAM); ip='';\ntry:\n s.connect(('8.8.8.8',80)); ip=s.getsockname()[0]\nexcept Exception:\n pass\nfinally:\n s.close()\nprint(ip)" 2>/dev/null | tr -d '\n')"
  printf '%s\n' "本地地址: http://127.0.0.1:${PORT}"
  if [ -n "$LAN_IP" ]; then
    printf '%s\n' "局域网地址: http://${LAN_IP}:${PORT}"
  fi
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

  if [ -n "${NGROK_PID:-}" ] && kill -0 "$NGROK_PID" 2>/dev/null; then
    kill "$NGROK_PID" 2>/dev/null || true
    wait "$NGROK_PID" 2>/dev/null || true
  fi
}

PACKAGE_MANAGER_CMD="$(pick_package_manager)"
install_dependencies
trap cleanup EXIT INT TERM

printf '%s\n' "调试服务启动中: http://127.0.0.1:${PORT}"
node node_modules/next/dist/bin/next dev --turbopack -H 0.0.0.0 -p "$PORT" &
DEV_PID=$!
wait_for_local_http
print_local_access
start_tunnel
wait "$DEV_PID"
