#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${CONFIG_FILE:-${SCRIPT_DIR}/release.env}"
OVERRIDE_DOMAIN="${DOMAIN-}"
OVERRIDE_WWW_DOMAIN="${WWW_DOMAIN-}"
OVERRIDE_APP_BIND_HOST="${APP_BIND_HOST-}"
OVERRIDE_APP_UPSTREAM_HOST="${APP_UPSTREAM_HOST-}"
OVERRIDE_APP_PORT="${APP_PORT-}"

# Nginx 配置和部署脚本共用一份发布配置，避免域名和端口分散。
if [ -f "${CONFIG_FILE}" ]; then
  # shellcheck disable=SC1090
  source "${CONFIG_FILE}"
fi

DOMAIN="${OVERRIDE_DOMAIN:-${DOMAIN:-platform.tripai.icu}}"
WWW_DOMAIN="${OVERRIDE_WWW_DOMAIN:-${WWW_DOMAIN:-}}"
APP_BIND_HOST="${OVERRIDE_APP_BIND_HOST:-${APP_BIND_HOST:-127.0.0.1}}"
APP_UPSTREAM_HOST="${OVERRIDE_APP_UPSTREAM_HOST:-${APP_UPSTREAM_HOST:-127.0.0.1}}"
APP_PORT="${OVERRIDE_APP_PORT:-${APP_PORT:-3000}}"
TARGET_FILE="${1:-}"
SERVER_NAMES="${DOMAIN}"
if [ -n "${WWW_DOMAIN}" ]; then
  SERVER_NAMES="${SERVER_NAMES} ${WWW_DOMAIN}"
fi

read -r -d '' NGINX_CONFIG <<EOF || true
server {
    listen 80;
    listen [::]:80;
    server_name ${SERVER_NAMES};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://${DOMAIN}\$request_uri;
    }
}

EOF

if [ -n "${WWW_DOMAIN}" ]; then
  read -r -d '' WWW_REDIRECT <<EOF || true
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${WWW_DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_session_tickets off;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    return 301 https://${DOMAIN}\$request_uri;
}

EOF
  NGINX_CONFIG="${NGINX_CONFIG}
${WWW_REDIRECT}"
fi

read -r -d '' APP_SERVER <<EOF || true
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_session_tickets off;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    client_max_body_size 100m;

    location / {
        proxy_pass http://${APP_UPSTREAM_HOST}:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300;
        proxy_send_timeout 300;
    }
}
EOF

NGINX_CONFIG="${NGINX_CONFIG}
${APP_SERVER}"

if [ -n "${TARGET_FILE}" ]; then
  printf '%s\n' "${NGINX_CONFIG}" > "${TARGET_FILE}"
  echo "已生成 Nginx 配置: ${TARGET_FILE}"
else
  printf '%s\n' "${NGINX_CONFIG}"
fi
