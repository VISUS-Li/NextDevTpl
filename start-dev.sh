#!/usr/bin/env bash
set -euo pipefail

# 加载 nvm，兼容非交互式会话
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

APP_DIR="${APP_DIR:-$(pwd)}"
PORT="${PORT:-3000}"
PACKAGE_MANAGER="${PACKAGE_MANAGER:-pnpm}"
NEXT_DEV_BUNDLER="${NEXT_DEV_BUNDLER:-webpack}"
SKIP_INSTALL="${SKIP_INSTALL:-0}"
START_TUNNEL="${START_TUNNEL:-1}"
DETACH="${DETACH:-0}"
KILL_EXISTING_PORT="${KILL_EXISTING_PORT:-1}"
CF_TUNNEL_HOST="${CF_TUNNEL_HOST:-127.0.0.1}"
CF_CONFIG_FILE="${CF_CONFIG_FILE:-$HOME/.cloudflared/config.yml}"
TUNNEL_NAME="${TUNNEL_NAME:-redink-tripai}"
TUNNEL_HOSTNAME="${TUNNEL_HOSTNAME:-platform.tripai.icu}"
PUBLIC_URL="${PUBLIC_URL:-https://platform.tripai.icu}"
APP_READY_PATH="${APP_READY_PATH:-/site.webmanifest}"
APP_READY_RETRIES="${APP_READY_RETRIES:-6}"
APP_READY_CURL_TIMEOUT="${APP_READY_CURL_TIMEOUT:-2}"
APP_LOG_FILE="${APP_LOG_FILE:-/tmp/nextdevtpl-dev.log}"
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

# 统一生成 Next dev bundler 参数，默认避开当前仓库在 Turbopack 下的冷启动卡顿。
pick_next_dev_bundler_arg() {
  case "$NEXT_DEV_BUNDLER" in
    webpack)
      printf '%s\n' "--webpack"
      ;;
    turbopack)
      printf '%s\n' "--turbopack"
      ;;
    *)
      printf '%s\n' "无效的 NEXT_DEV_BUNDLER: ${NEXT_DEV_BUNDLER}，可选 webpack 或 turbopack" >&2
      return 1
      ;;
  esac
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

# 启动前释放目标端口，避免旧的 dev 进程占用导致启动失败。
kill_existing_port_processes() {
  [ "$KILL_EXISTING_PORT" = "1" ] || return

  # 先用系统命令直接查监听进程，避免 set -e 和子命令细节影响启动流程。
  if [ "$(uname -s 2>/dev/null)" = "Linux" ] || [ "$(uname -s 2>/dev/null)" = "Darwin" ]; then
    LSOF_PIDS="$(lsof -ti tcp:${PORT} -sTCP:LISTEN 2>/dev/null | tr '\n' ' ' | xargs 2>/dev/null || true)"
    SS_PIDS="$(ss -ltnp 2>/dev/null | rg ":${PORT}\\b" | rg -o 'pid=[0-9]+' | sed 's/pid=//' | tr '\n' ' ' | xargs 2>/dev/null || true)"
    EXISTING_PIDS="$(printf '%s\n%s\n' "$LSOF_PIDS" "$SS_PIDS" | tr ' ' '\n' | awk 'NF&&!seen[$0]++{printf("%s ",$0)}' | sed 's/[[:space:]]*$//' || true)"
  else
    EXISTING_PIDS="$(
      PORT_TO_FREE="$PORT" node - <<'EOF'
const { execSync } = require("node:child_process");

const port = process.env.PORT_TO_FREE;

try {
  const output = execSync(
    `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -ExpandProperty OwningProcess"`,
    { stdio: ["ignore", "pipe", "ignore"] }
  )
    .toString()
    .trim();
  process.stdout.write(output.replace(/\s+/g, " ").trim());
} catch {}
EOF
    )" || true
  fi

  if [ -z "$EXISTING_PIDS" ]; then
    return 0
  fi

  printf '%s\n' "检测到端口 ${PORT} 已被占用，先停止旧进程: ${EXISTING_PIDS}"
  PORT_TO_FREE="$PORT" PIDS_TO_KILL="$EXISTING_PIDS" node - <<'EOF'
const { execSync } = require("node:child_process");

const platform = process.platform;
const pids = (process.env.PIDS_TO_KILL || "")
  .split(/\s+/)
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => Number(item))
  .filter((item) => Number.isInteger(item) && item > 0);
const pgids = new Set();

// Unix 下先结束进程组，避免只停掉 next-server 子进程而留下父进程继续占着 lock。
if (platform !== "win32") {
  for (const pid of pids) {
    try {
      const pgid = Number(
        execSync(`ps -o pgid= -p ${pid}`, {
          stdio: ["ignore", "pipe", "ignore"],
        })
          .toString()
          .trim()
      );
      if (Number.isInteger(pgid) && pgid > 1) {
        pgids.add(pgid);
      }
    } catch {}
  }
}

for (const pgid of pgids) {
  try {
    process.kill(-pgid, "SIGTERM");
  } catch {}
}

for (const pid of pids) {
  try {
    if (platform === "win32") {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {}
}
EOF

  # 给 Next 的父子进程一点时间退出，并在必要时补一次强制结束。
  for _ in $(seq 1 10); do
    REMAINING_PIDS="$(lsof -ti tcp:${PORT} -sTCP:LISTEN 2>/dev/null | tr '\n' ' ' | xargs 2>/dev/null || true)"
    [ -z "$REMAINING_PIDS" ] && return 0
    sleep 1
  done

  printf '%s\n' "端口 ${PORT} 仍未释放，改为强制停止: ${EXISTING_PIDS}"
  PIDS_TO_KILL="$EXISTING_PIDS" node - <<'EOF'
const { execSync } = require("node:child_process");

const platform = process.platform;
const pids = (process.env.PIDS_TO_KILL || "")
  .split(/\s+/)
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => Number(item))
  .filter((item) => Number.isInteger(item) && item > 0);
const pgids = new Set();

if (platform !== "win32") {
  for (const pid of pids) {
    try {
      const pgid = Number(
        execSync(`ps -o pgid= -p ${pid}`, {
          stdio: ["ignore", "pipe", "ignore"],
        })
          .toString()
          .trim()
      );
      if (Number.isInteger(pgid) && pgid > 1) {
        pgids.add(pgid);
      }
    } catch {}
  }
}

for (const pgid of pgids) {
  try {
    process.kill(-pgid, "SIGKILL");
  } catch {}
}

for (const pid of pids) {
  try {
    if (platform === "win32") {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {}
}
EOF

  sleep 1
}

# 统一检查 HTTP 是否已可访问。
http_ready() {
  local url=$1
  [ -n "$url" ] || return 1
  command -v curl >/dev/null 2>&1 || return 0
  HTTP_CODE="$(curl -L -o /dev/null -s -w '%{http_code}' --max-time "$APP_READY_CURL_TIMEOUT" "${url%/}${APP_READY_PATH}" || true)"
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
  LAN_IP="$(node -e "const os=require('node:os');const items=Object.values(os.networkInterfaces()).flat().filter(Boolean);const item=items.find((entry)=>entry.family==='IPv4'&&!entry.internal);process.stdout.write(item?.address||'')" 2>/dev/null | tr -d '\n')"
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

  for _ in $(seq 1 "$APP_READY_RETRIES"); do
    HTTP_CODE="$(curl -L -o /dev/null -s -w '%{http_code}' --max-time "$APP_READY_CURL_TIMEOUT" "http://127.0.0.1:${PORT}${APP_READY_PATH}" || true)"
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "307" ] || [ "$HTTP_CODE" = "308" ]; then
      return 0
    fi
    sleep 1
  done

  printf '%s\n' "等待本地服务超时: http://127.0.0.1:${PORT}${APP_READY_PATH}"
  printf '%s\n' "可继续查看应用日志判断是否卡在 Next 编译或接口初始化"
  return 1
}

# 前台模式退出时同时关闭子进程
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
NEXT_DEV_BUNDLER_ARG="$(pick_next_dev_bundler_arg)"
install_dependencies
kill_existing_port_processes

if [ "$DETACH" != "1" ]; then
  trap cleanup EXIT INT TERM
fi

printf '%s\n' "调试服务启动中: http://127.0.0.1:${PORT}"
printf '%s\n' "开发 bundler: ${NEXT_DEV_BUNDLER}"
if [ "$DETACH" = "1" ]; then
  : > "$APP_LOG_FILE"
  setsid node node_modules/next/dist/bin/next dev "$NEXT_DEV_BUNDLER_ARG" -H 0.0.0.0 -p "$PORT" </dev/null > "$APP_LOG_FILE" 2>&1 &
  DEV_PID=$!
else
  node node_modules/next/dist/bin/next dev "$NEXT_DEV_BUNDLER_ARG" -H 0.0.0.0 -p "$PORT" &
  DEV_PID=$!
fi

print_local_access
if wait_for_local_http; then
  start_tunnel
else
  printf '%s\n' "跳过公网隧道，待本地服务可响应后再启动"
fi

if [ "$DETACH" = "1" ]; then
  printf '%s\n' "调试服务已转入后台: PID=${DEV_PID}"
  printf '%s\n' "应用日志: ${APP_LOG_FILE}"
  if [ -n "${TUNNEL_PID:-}" ]; then
    printf '%s\n' "隧道日志: ${TUNNEL_LOG_FILE}"
  fi
  if [ -n "${NGROK_PID:-}" ]; then
    printf '%s\n' "隧道日志: ${NGROK_LOG_FILE}"
  fi
  exit 0
fi

wait "$DEV_PID"
