#!/usr/bin/env bash

set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_ROOT="$(mktemp -d)"
MOCK_BIN="$TEMP_ROOT/bin"
TARGET="$TEMP_ROOT/ou-image-hosting"
OUTPUT="$TEMP_ROOT/install.log"
DOCKER_LOG="$TEMP_ROOT/docker.log"

cleanup() {
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT

mkdir -p "$MOCK_BIN"

cat > "$MOCK_BIN/git" <<'EOF'
#!/usr/bin/env bash
set -e
if [[ "${1:-}" == "clone" ]]; then
  target="${@: -1}"
  mkdir -p "$target/.git"
  mkdir -p "$target/scripts"
  cp "$MOCK_SOURCE_ROOT/docker-compose.yml" "$target/docker-compose.yml"
  cp "$MOCK_SOURCE_ROOT/Caddyfile" "$target/Caddyfile"
  cp "$MOCK_SOURCE_ROOT/scripts/ouih" "$target/scripts/ouih"
  chmod +x "$target/scripts/ouih"
  exit 0
fi
if [[ "${1:-}" == "-C" ]]; then
  shift 2
  if [[ "${1:-}" == "remote" && "${2:-}" == "get-url" ]]; then
    printf '%s\n' "https://github.com/cshaizhihao/ou-image-hosting.git"
  fi
  exit 0
fi
exit 0
EOF

cat > "$MOCK_BIN/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$MOCK_DOCKER_LOG"
exit 0
EOF

cat > "$MOCK_BIN/curl" <<'EOF'
#!/usr/bin/env bash
headers_file=""
while (($# > 0)); do
  case "$1" in
    -D)
      headers_file="$2"
      shift 2
      ;;
    -w)
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
if [[ -n "$headers_file" ]]; then
  status="${MOCK_CF_STATUS:-200}"
  {
    printf 'HTTP/2 %s\r\n' "$status"
    if [[ "${MOCK_CF_HEADER:-yes}" == "yes" ]]; then
      printf 'server: cloudflare\r\n'
      printf 'cf-ray: test-ray-SIN\r\n'
    else
      printf 'server: origin\r\n'
    fi
    printf '\r\n'
  } > "$headers_file"
  printf '%s' "$status"
fi
exit 0
EOF

cat > "$MOCK_BIN/ss" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' 'State Recv-Q Send-Q Local Address:Port Peer Address:Port'
EOF

cat > "$MOCK_BIN/sleep" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

chmod +x "$MOCK_BIN/git" "$MOCK_BIN/docker" "$MOCK_BIN/curl" "$MOCK_BIN/ss" "$MOCK_BIN/sleep"
export PATH="$MOCK_BIN:$PATH"
export MOCK_SOURCE_ROOT="$ROOT"
export MOCK_DOCKER_LOG="$DOCKER_LOG"
export OUIH_BIN_DIR="$TEMP_ROOT/global-bin"
export OUIH_CONFIG_DIR="$TEMP_ROOT/global-config"

BOOTSTRAP_LOG="$TEMP_ROOT/bootstrap.log"
(
  source "$ROOT/install.sh"
  ASSUME_YES="true"
  AUTO_INSTALL_DEPS="true"
  git_installed="false"

  command_exists() {
    case "$1" in
      git) [[ "$git_installed" == "true" ]] ;;
      curl|openssl|install|apt-get) return 0 ;;
      *) return 1 ;;
    esac
  }

  run_as_root() {
    printf 'root %s\n' "$*" >> "$BOOTSTRAP_LOG"
    if [[ "$*" == *"apt-get install"* ]]; then
      git_installed="true"
    fi
  }

  bootstrap_base_dependencies
  [[ "$git_installed" == "true" ]]
) > "$TEMP_ROOT/bootstrap-base.out"
grep -F 'root apt-get update' "$BOOTSTRAP_LOG" >/dev/null
grep -F 'apt-get install -y git curl openssl coreutils ca-certificates' \
  "$BOOTSTRAP_LOG" >/dev/null

(
  source "$ROOT/install.sh"
  AUTO_INSTALL_DEPS="true"
  parse_arguments --no-install-deps
  [[ "$AUTO_INSTALL_DEPS" == "false" ]]
) > "$TEMP_ROOT/parse-no-install-deps.out"

if (
  source "$ROOT/install.sh"
  ASSUME_YES="true"
  parse_arguments --no-install-deps
  command_exists() {
    [[ "$1" != "git" ]]
  }
  bootstrap_base_dependencies
) > "$TEMP_ROOT/bootstrap-disabled.out" 2>&1; then
  printf '%s\n' "--no-install-deps 应在缺少依赖时拒绝继续" >&2
  exit 1
fi
grep -F '已禁用自动安装依赖' "$TEMP_ROOT/bootstrap-disabled.out" >/dev/null

PACMAN_LOG="$TEMP_ROOT/pacman.log"
(
  source "$ROOT/install.sh"
  command_exists() {
    [[ "$1" == "pacman" ]]
  }
  run_as_root() {
    printf '%s\n' "$*" >> "$PACMAN_LOG"
  }
  install_base_packages
) > "$TEMP_ROOT/bootstrap-pacman.out"
grep -F 'pacman -Syu --noconfirm --needed git curl openssl coreutils ca-certificates' \
  "$PACMAN_LOG" >/dev/null
if grep -F 'pacman -Sy ' "$PACMAN_LOG" >/dev/null; then
  printf '%s\n' "pacman 不得执行不安全的部分升级" >&2
  exit 1
fi

DOCKER_BOOTSTRAP_LOG="$TEMP_ROOT/docker-bootstrap.log"
(
  source "$ROOT/install.sh"
  ASSUME_YES="true"
  AUTO_INSTALL_DEPS="true"
  docker_installed="true"
  compose_installed="false"
  docker_running="false"

  command_exists() {
    case "$1" in
      docker) [[ "$docker_installed" == "true" ]] ;;
      apt-get|systemctl) return 0 ;;
      service|sudo) return 1 ;;
      *) command -v "$1" >/dev/null 2>&1 ;;
    esac
  }

  curl() {
    local output=""
    printf 'curl %s\n' "$*" >> "$DOCKER_BOOTSTRAP_LOG"
    while (($# > 0)); do
      if [[ "$1" == "-o" ]]; then
        output="$2"
        shift 2
      else
        shift
      fi
    done
    printf '%s\n' '#!/bin/sh' > "$output"
  }

  run_as_root() {
    printf 'root %s\n' "$*" >> "$DOCKER_BOOTSTRAP_LOG"
    if [[ "${1:-}" == "sh" ]]; then
      docker_installed="true"
      compose_installed="true"
    elif [[ "$*" == "systemctl enable --now docker" ]]; then
      docker_running="true"
    fi
  }

  docker() {
    [[ "$docker_installed" == "true" ]] || return 127
    if [[ "${1:-}" == "compose" && "${2:-}" == "version" ]]; then
      [[ "$compose_installed" == "true" ]]
      return
    fi
    if [[ "${1:-}" == "info" ]]; then
      [[ "$docker_running" == "true" ]]
      return
    fi
    return 0
  }

  bootstrap_docker
  [[ "$docker_installed" == "true" &&
     "$compose_installed" == "true" &&
     "$docker_running" == "true" ]]
) > "$TEMP_ROOT/bootstrap-docker.out"
grep -F 'Docker 服务正在运行' "$TEMP_ROOT/bootstrap-docker.out" >/dev/null
grep -F "curl -fsSL --proto =https --tlsv1.2 https://get.docker.com -o " \
  "$DOCKER_BOOTSTRAP_LOG" >/dev/null
grep -F 'root systemctl enable --now docker' "$DOCKER_BOOTSTRAP_LOG" >/dev/null

NATIVE_DOCKER_LOG="$TEMP_ROOT/native-docker.log"
(
  source "$ROOT/install.sh"
  command_exists() {
    case "$1" in
      pacman) return 0 ;;
      systemctl|service) return 1 ;;
      *) return 1 ;;
    esac
  }
  run_as_root() {
    printf '%s\n' "$*" >> "$NATIVE_DOCKER_LOG"
  }
  install_docker_engine
) > "$TEMP_ROOT/native-docker.out"
grep -F 'pacman -Syu --noconfirm --needed docker docker-compose' \
  "$NATIVE_DOCKER_LOG" >/dev/null
if grep -F 'get.docker.com' "$NATIVE_DOCKER_LOG" >/dev/null; then
  printf '%s\n' "pacman 系统不得调用不受支持的 Docker 官方脚本" >&2
  exit 1
fi

NO_COLOR=1 "$ROOT/install.sh" \
  --yes \
  --dir "$TARGET" \
  --origin https://img.example.com \
  --bind 127.0.0.1 \
  --port 03080 \
  --quota-gb 020 \
  > "$OUTPUT"

ENV_FILE="$TARGET/.env.production"
test -f "$ENV_FILE"
test "$(stat -c '%a' "$ENV_FILE")" = "600"
grep -Fx 'APP_ORIGIN=https://img.example.com' "$ENV_FILE" >/dev/null
grep -Fx 'OU_PROXY_MODE=caddy' "$ENV_FILE" >/dev/null
grep -Fx 'OU_PUBLIC_HOST=img.example.com' "$ENV_FILE" >/dev/null
grep -Fx 'WEB_BIND_PORT=3080' "$ENV_FILE" >/dev/null
grep -Fx 'OU_STORAGE_QUOTA_BYTES=21474836480' "$ENV_FILE" >/dev/null
grep -F 'OU-Image Hosting 安装完成' "$OUTPUT" >/dev/null
test -x "$TEMP_ROOT/global-bin/ouih"
grep -Fx "INSTALL_DIR=$TARGET" "$TEMP_ROOT/global-config/install.conf" >/dev/null
grep -F -- '--profile https up -d' "$DOCKER_LOG" >/dev/null

FIRST_SECRET="$(sed -n 's/^OU_SECRET_KEY=//p' "$ENV_FILE")"
test "${#FIRST_SECRET}" -eq 64
sed -i 's|^DATABASE_URL=.*|DATABASE_URL=postgres://preserve-me|' "$ENV_FILE"
printf '%s\n' 'CUSTOM_DEPLOYMENT_FLAG=keep-me' >> "$ENV_FILE"

NO_COLOR=1 "$ROOT/install.sh" \
  --yes \
  --dir "$TARGET" \
  --origin http://localhost:3000 \
  --quota-gb 4 \
  --no-start \
  >> "$OUTPUT"

SECOND_SECRET="$(sed -n 's/^OU_SECRET_KEY=//p' "$ENV_FILE")"
test "$FIRST_SECRET" = "$SECOND_SECRET"
grep -Fx 'COOKIE_SECURE=false' "$ENV_FILE" >/dev/null
grep -Fx 'WEB_BIND_PORT=3080' "$ENV_FILE" >/dev/null
grep -Fx 'OU_STORAGE_QUOTA_BYTES=4294967296' "$ENV_FILE" >/dev/null
grep -Fx 'DATABASE_URL=postgres://preserve-me' "$ENV_FILE" >/dev/null
grep -Fx 'CUSTOM_DEPLOYMENT_FLAG=keep-me' "$ENV_FILE" >/dev/null
find "$TARGET" -maxdepth 1 -name '.env.production.backup-*' -type f | grep . >/dev/null
grep -F 'OU-Image Hosting 构建完成' "$OUTPUT" >/dev/null
grep -F "$TEMP_ROOT/global-bin/ouih start" "$OUTPUT" >/dev/null

NO_COLOR=1 "$ROOT/install.sh" \
  --yes \
  --dir "$TARGET" \
  --no-start \
  >> "$OUTPUT"

grep -Fx 'APP_ORIGIN=http://localhost:3000' "$ENV_FILE" >/dev/null
grep -Fx 'OU_PROXY_MODE=none' "$ENV_FILE" >/dev/null
grep -Fx 'WEB_BIND_PORT=3080' "$ENV_FILE" >/dev/null
grep -Fx 'OU_STORAGE_QUOTA_BYTES=4294967296' "$ENV_FILE" >/dev/null
grep -Fx 'DATABASE_URL=postgres://preserve-me' "$ENV_FILE" >/dev/null
grep -Fx 'CUSTOM_DEPLOYMENT_FLAG=keep-me' "$ENV_FILE" >/dev/null

NO_COLOR=1 "$ROOT/install.sh" \
  --yes \
  --dry-run \
  --dir "$TEMP_ROOT/dry-run" \
  > /dev/null

NO_COLOR=1 "$ROOT/install.sh" \
  --yes \
  --dry-run \
  --dir "$TEMP_ROOT/cloudflare-dry-run" \
  --origin https://cf.example.com \
  --proxy cloudflare \
  | grep -F 'Cloudflare 小黄云 + Caddy 源站证书' >/dev/null

NO_COLOR=1 "$ROOT/install.sh" \
  --yes \
  --dir "$TEMP_ROOT/cloudflare-no-start" \
  --origin https://cf-no-start.example.com \
  --proxy cloudflare \
  --no-start \
  > "$TEMP_ROOT/cloudflare-no-start.log"
grep -F "$TEMP_ROOT/global-bin/ouih start" \
  "$TEMP_ROOT/cloudflare-no-start.log" >/dev/null
grep -Fx 'OU_PROXY_MODE=cloudflare' \
  "$TEMP_ROOT/cloudflare-no-start/.env.production" >/dev/null

CF_TARGET="$TEMP_ROOT/cloudflare-success"
MOCK_CF_STATUS=200 NO_COLOR=1 "$ROOT/install.sh" \
  --yes \
  --dir "$CF_TARGET" \
  --origin https://cf-success.example.com \
  --proxy cloudflare \
  > "$TEMP_ROOT/cloudflare-success.log"
grep -F 'Cloudflare 小黄云与 Full (strict) HTTPS 链路已通过检查' \
  "$TEMP_ROOT/cloudflare-success.log" >/dev/null

assert_cloudflare_rejected() {
  local status="$1"
  local header_mode="$2"
  local case_name="$3"
  local target="$TEMP_ROOT/cloudflare-${case_name}"
  local log_file="$TEMP_ROOT/cloudflare-${case_name}.log"
  if MOCK_CF_STATUS="$status" MOCK_CF_HEADER="$header_mode" NO_COLOR=1 \
    "$ROOT/install.sh" \
      --yes \
      --dir "$target" \
      --origin "https://${case_name}.example.com" \
      --proxy cloudflare \
      > "$log_file" 2>&1; then
    printf 'Cloudflare 异常响应不应被判定为成功：%s\n' "$case_name" >&2
    exit 1
  fi
  grep -F 'Cloudflare 边缘入口尚未就绪' "$log_file" >/dev/null
}

assert_cloudflare_rejected 403 yes "status-403"
assert_cloudflare_rejected 525 yes "status-525"
assert_cloudflare_rejected 526 yes "status-526"
assert_cloudflare_rejected 200 no "missing-cf-header"

printf '%s\n' "installer integration test passed"
