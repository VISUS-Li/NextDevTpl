#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_FILE="${CONFIG_FILE:-${SCRIPT_DIR}/release.env}"
OVERRIDE_REGISTRY_DOMAIN="${REGISTRY_DOMAIN-}"
OVERRIDE_REGISTRY_USER="${REGISTRY_USER-}"
OVERRIDE_NAMESPACE="${NAMESPACE-}"
OVERRIDE_IMAGE_NAME="${IMAGE_NAME-}"
OVERRIDE_SERVER_URL="${SERVER_URL-}"
OVERRIDE_REDINK_PUBLIC_URL="${REDINK_PUBLIC_URL-}"

if [ -f "${CONFIG_FILE}" ]; then
  # shellcheck disable=SC1090
  source "${CONFIG_FILE}"
fi

REGISTRY_DOMAIN="${OVERRIDE_REGISTRY_DOMAIN:-${REGISTRY_DOMAIN:-crpi-dwpdx29dne1d4tyy.cn-chengdu.personal.cr.aliyuncs.com}}"
REGISTRY_USER="${OVERRIDE_REGISTRY_USER:-${REGISTRY_USER:-}}"
REGISTRY_PASSWORD="${REGISTRY_PASSWORD:-}"
NAMESPACE="${OVERRIDE_NAMESPACE:-${NAMESPACE:-visus}}"
IMAGE_NAME="${OVERRIDE_IMAGE_NAME:-${IMAGE_NAME:-nextdevtpl}}"
SERVER_URL="${OVERRIDE_SERVER_URL:-${SERVER_URL:-https://platform.tripai.icu}}"
REDINK_PUBLIC_URL="${OVERRIDE_REDINK_PUBLIC_URL:-${REDINK_PUBLIC_URL:-https://redink.tripai.icu}}"
VERSION="${1:-latest}"
SKIP_LOGIN="${SKIP_LOGIN:-false}"
SKIP_PUSH="${SKIP_PUSH:-false}"

FULL_IMAGE="${REGISTRY_DOMAIN}/${NAMESPACE}/${IMAGE_NAME}:${VERSION}"

echo "准备构建镜像"
echo "镜像地址: ${FULL_IMAGE}"
echo "站点地址: ${SERVER_URL}"

cd "${REPO_ROOT}"

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

echo "开始构建镜像..."
docker build \
  --build-arg BETTER_AUTH_URL="${SERVER_URL}" \
  --build-arg NEXT_PUBLIC_APP_URL="${SERVER_URL}" \
  --build-arg REDINK_PUBLIC_URL="${REDINK_PUBLIC_URL}" \
  -t "${FULL_IMAGE}" \
  .

if [ "${SKIP_PUSH}" != "true" ]; then
  echo "开始推送镜像..."
  docker push "${FULL_IMAGE}"
else
  echo "已跳过镜像推送"
fi

echo "构建流程完成"
echo "镜像: ${FULL_IMAGE}"
