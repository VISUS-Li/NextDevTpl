#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_FILE="${CONFIG_FILE:-${SCRIPT_DIR}/release.env}"
OVERRIDE_REGISTRY_DOMAIN="${REGISTRY_DOMAIN-}"
OVERRIDE_REGISTRY_USER="${REGISTRY_USER-}"
OVERRIDE_NAMESPACE="${NAMESPACE-}"
OVERRIDE_IMAGE_NAME="${IMAGE_NAME-}"
OVERRIDE_CONTAINER_NAME="${CONTAINER_NAME-}"
OVERRIDE_APP_BIND_HOST="${APP_BIND_HOST-}"
OVERRIDE_APP_PORT="${APP_PORT-}"
OVERRIDE_SERVER_URL="${SERVER_URL-}"
OVERRIDE_REDINK_PUBLIC_URL="${REDINK_PUBLIC_URL-}"
OVERRIDE_DATABASE_URL="${DATABASE_URL-}"
OVERRIDE_DOCKER_NETWORK="${DOCKER_NETWORK-}"
OVERRIDE_LOCAL_STORAGE_VOLUME="${LOCAL_STORAGE_VOLUME-}"

if [ -f "${CONFIG_FILE}" ]; then
  # shellcheck disable=SC1090
  source "${CONFIG_FILE}"
fi

REGISTRY_DOMAIN="${OVERRIDE_REGISTRY_DOMAIN:-${REGISTRY_DOMAIN:-crpi-dwpdx29dne1d4tyy.cn-chengdu.personal.cr.aliyuncs.com}}"
REGISTRY_USER="${OVERRIDE_REGISTRY_USER:-${REGISTRY_USER:-}}"
REGISTRY_PASSWORD="${REGISTRY_PASSWORD:-}"
NAMESPACE="${OVERRIDE_NAMESPACE:-${NAMESPACE:-visus}}"
IMAGE_NAME="${OVERRIDE_IMAGE_NAME:-${IMAGE_NAME:-nextdevtpl}}"
CONTAINER_NAME="${OVERRIDE_CONTAINER_NAME:-${CONTAINER_NAME:-nextdevtpl-app}}"
APP_BIND_HOST="${OVERRIDE_APP_BIND_HOST:-${APP_BIND_HOST:-127.0.0.1}}"
APP_PORT="${OVERRIDE_APP_PORT:-${APP_PORT:-3000}}"
SERVER_URL="${OVERRIDE_SERVER_URL:-${SERVER_URL:-https://platform.tripai.icu}}"
REDINK_PUBLIC_URL="${OVERRIDE_REDINK_PUBLIC_URL:-${REDINK_PUBLIC_URL:-https://redink.tripai.icu}}"
DOCKER_NETWORK="${OVERRIDE_DOCKER_NETWORK:-${DOCKER_NETWORK:-}}"
LOCAL_STORAGE_VOLUME="${OVERRIDE_LOCAL_STORAGE_VOLUME:-${LOCAL_STORAGE_VOLUME:-nextdevtpl_storage}}"
DB_HOST="${DB_HOST:-host.docker.internal}"
DB_NAME="${DB_NAME:-nextdevtpl}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgre4250}"
DB_PORT="${DB_PORT:-5432}"
DATABASE_URL="${OVERRIDE_DATABASE_URL:-${DATABASE_URL:-postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}}}"
VERSION="${1:-latest}"
SKIP_LOGIN="${SKIP_LOGIN:-false}"
SKIP_PULL="${SKIP_PULL:-false}"
ENV_FILE="${ENV_FILE:-${REPO_ROOT}/.env.release}"

ensure_env_file() {
  local env_dir existing_auth_secret existing_config_secret temp_file
  env_dir="$(dirname "${ENV_FILE}")"
  mkdir -p "${env_dir}"
  existing_auth_secret="$(grep -E '^BETTER_AUTH_SECRET=' "${ENV_FILE}" 2>/dev/null | head -n1 | cut -d= -f2- || true)"
  existing_config_secret="$(grep -E '^CONFIG_SECRET_KEY=' "${ENV_FILE}" 2>/dev/null | head -n1 | cut -d= -f2- || true)"
  if [ -z "${existing_auth_secret}" ]; then
    existing_auth_secret="$(openssl rand -hex 32)"
  fi
  if [ -z "${existing_config_secret}" ]; then
    existing_config_secret="$(openssl rand -hex 32)"
  fi
  temp_file="$(mktemp)"
  cat > "${temp_file}" <<EOF
NODE_ENV=production
DATABASE_URL=${DATABASE_URL}
BETTER_AUTH_SECRET=${existing_auth_secret}
CONFIG_SECRET_KEY=${existing_config_secret}
BETTER_AUTH_URL=${SERVER_URL}
NEXT_PUBLIC_APP_URL=${SERVER_URL}
REDINK_PUBLIC_URL=${REDINK_PUBLIC_URL}
STORAGE_PROVIDER=local
LOCAL_STORAGE_DIR=/app/.local-storage
EOF
  if [ -f "${ENV_FILE}" ]; then
    grep -Ev '^(NODE_ENV|DATABASE_URL|BETTER_AUTH_SECRET|CONFIG_SECRET_KEY|BETTER_AUTH_URL|NEXT_PUBLIC_APP_URL|REDINK_PUBLIC_URL|STORAGE_PROVIDER|LOCAL_STORAGE_DIR)=' "${ENV_FILE}" >> "${temp_file}" || true
  fi
  mv "${temp_file}" "${ENV_FILE}"
  echo "已同步部署环境文件: ${ENV_FILE}"
}

ensure_host_gateway() {
  local value="$1"
  if [ -n "${DOCKER_NETWORK}" ]; then
    return
  fi
  if [[ "${value}" == *host.docker.internal* ]]; then
    DOCKER_RUN_ARGS+=("--add-host" "host.docker.internal:host-gateway")
  fi
}

FULL_IMAGE="${REGISTRY_DOMAIN}/${NAMESPACE}/${IMAGE_NAME}:${VERSION}"

echo "准备部署镜像: ${FULL_IMAGE}"
echo "容器名称: ${CONTAINER_NAME}"
echo "站点地址: ${SERVER_URL}"
echo "端口映射: ${APP_BIND_HOST}:${APP_PORT}:3000"

cd "${REPO_ROOT}"
ensure_env_file

if [ "${SKIP_LOGIN}" != "true" ]; then
  if [ -z "${REGISTRY_USER}" ] || [ -z "${REGISTRY_PASSWORD}" ]; then
    echo "错误：当前启用了自动登录，但没有提供 REGISTRY_PASSWORD"
    exit 1
  fi
  echo "登录阿里云镜像仓库..."
  docker login --username="${REGISTRY_USER}" "${REGISTRY_DOMAIN}" --password "${REGISTRY_PASSWORD}"
else
  echo "已跳过镜像仓库登录，默认使用本机已保存的 Docker 凭证"
fi

if [ "${SKIP_PULL}" != "true" ]; then
  echo "拉取镜像..."
  docker pull "${FULL_IMAGE}"
else
  echo "已跳过镜像拉取"
fi

if docker ps -a --format '{{.Names}}' | grep -wq "${CONTAINER_NAME}"; then
  echo "停止旧容器..."
  docker stop "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  echo "删除旧容器..."
  docker rm "${CONTAINER_NAME}" >/dev/null 2>&1 || true
fi

DOCKER_RUN_ARGS=()
if [ -n "${DOCKER_NETWORK}" ]; then
  DOCKER_RUN_ARGS+=("--network" "${DOCKER_NETWORK}")
fi
ensure_host_gateway "${DATABASE_URL}"

echo "启动新容器..."
docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  "${DOCKER_RUN_ARGS[@]}" \
  --env-file "${ENV_FILE}" \
  -e "PORT=3000" \
  -p "${APP_BIND_HOST}:${APP_PORT}:3000" \
  -v "${LOCAL_STORAGE_VOLUME}:/app/.local-storage" \
  "${FULL_IMAGE}"

echo "当前容器状态："
docker ps --filter "name=${CONTAINER_NAME}"

echo "等待应用启动..."
READY_URL="http://${APP_BIND_HOST}:${APP_PORT}"
for _ in $(seq 1 60); do
  if curl -fsS -I "${READY_URL}" >/dev/null 2>&1; then
    echo "应用已就绪: ${READY_URL}"
    break
  fi
  sleep 2
done

if ! curl -fsS -I "${READY_URL}" >/dev/null 2>&1; then
  echo "错误：应用未在预期时间内启动成功: ${READY_URL}"
  echo "最近日志："
  docker logs --tail 100 "${CONTAINER_NAME}"
  exit 1
fi

echo "最近日志："
docker logs --tail 80 "${CONTAINER_NAME}"
