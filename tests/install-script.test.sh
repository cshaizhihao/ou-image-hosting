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
exit 0
EOF

cat > "$MOCK_BIN/ss" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' 'State Recv-Q Send-Q Local Address:Port Peer Address:Port'
EOF

chmod +x "$MOCK_BIN/git" "$MOCK_BIN/docker" "$MOCK_BIN/curl" "$MOCK_BIN/ss"
export PATH="$MOCK_BIN:$PATH"
export MOCK_SOURCE_ROOT="$ROOT"
export MOCK_DOCKER_LOG="$DOCKER_LOG"
export OUIH_BIN_DIR="$TEMP_ROOT/global-bin"
export OUIH_CONFIG_DIR="$TEMP_ROOT/global-config"

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
grep -Fx 'OU_STORAGE_QUOTA_BYTES=4294967296' "$ENV_FILE" >/dev/null
find "$TARGET" -maxdepth 1 -name '.env.production.backup-*' -type f | grep . >/dev/null
grep -F 'OU-Image Hosting 构建完成' "$OUTPUT" >/dev/null

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

printf '%s\n' "installer integration test passed"
