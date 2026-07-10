#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_SCRIPT="$ROOT_DIR/scripts/ouih"
TEST_ROOT="$(mktemp -d)"
MOCK_BIN="$TEST_ROOT/mock-bin"
MOCK_LOG="$TEST_ROOT/mock.log"

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  [[ "$haystack" == *"$needle"* ]] ||
    fail "输出缺少：$needle"
}

assert_log_contains() {
  local needle="$1"
  grep -F -- "$needle" "$MOCK_LOG" >/dev/null ||
    fail "mock 日志缺少：$needle"
}

reset_log() {
  : > "$MOCK_LOG"
}

make_install() {
  local directory="$1"
  mkdir -p "$directory/.git" "$directory/scripts"
  cp "$SOURCE_SCRIPT" "$directory/scripts/ouih"
  chmod +x "$directory/scripts/ouih"
  printf 'name: ou-image-hosting\nservices: {}\n' > "$directory/docker-compose.yml"
  cat > "$directory/.env.production" <<'EOF'
APP_ORIGIN=https://img.example.com
OU_SECRET_KEY=keep-this-production-secret-unchanged
OU_PROXY_MODE=cloudflare
EOF
}

mkdir -p "$MOCK_BIN"
cat > "$MOCK_BIN/docker" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'docker %s\n' "$*" >> "$MOCK_LOG"
if [[ "${1:-}" == "info" ]]; then
  exit "${MOCK_DOCKER_INFO_EXIT:-0}"
fi
exit 0
EOF

cat > "$MOCK_BIN/git" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'git %s\n' "$*" >> "$MOCK_LOG"
if [[ "$*" == *"status --porcelain"* ]]; then
  [[ "${MOCK_GIT_DIRTY:-0}" == "1" ]] && printf ' M local-change\n'
fi
if [[ "$*" == *"pull --ff-only origin main"* ]]; then
  if [[ "${MOCK_GIT_OVERWRITE_ENV:-0}" == "1" ]]; then
    printf 'APP_ORIGIN=https://overwritten.invalid\n' > "$2/.env.production"
  fi
  [[ "${MOCK_GIT_PULL_FAIL:-0}" == "1" ]] && exit 23
fi
exit 0
EOF
chmod +x "$MOCK_BIN/docker" "$MOCK_BIN/git"

export PATH="$MOCK_BIN:$PATH"
export MOCK_LOG
export NO_COLOR=1
export OUIH_DISABLE_SELF_UPDATE=true

install_one="$TEST_ROOT/install-one"
make_install "$install_one"

output="$(OUIH_INSTALL_DIR="$install_one" "$SOURCE_SCRIPT" dir)"
[[ "$output" == "$install_one" ]] || fail "dir 命令返回错误"

output="$(OUIH_INSTALL_DIR="$install_one" "$SOURCE_SCRIPT" url)"
[[ "$output" == "https://img.example.com" ]] || fail "url 命令返回错误"

output="$("$install_one/scripts/ouih" dir)"
[[ "$output" == "$install_one" ]] || fail "脚本自身目录发现失败"

external_script="$TEST_ROOT/bin/ouih"
mkdir -p "$(dirname "$external_script")"
cp "$SOURCE_SCRIPT" "$external_script"
chmod +x "$external_script"
config_file="$TEST_ROOT/install.conf"
printf 'INSTALL_DIR="%s"\n' "$install_one" > "$config_file"
output="$(OUIH_INSTALL_CONF="$config_file" "$external_script" dir)"
[[ "$output" == "$install_one" ]] || fail "install.conf 目录发现失败"

reset_log
env_before="$(cat "$install_one/.env.production")"
MOCK_GIT_OVERWRITE_ENV=1 OUIH_INSTALL_DIR="$install_one" \
  "$SOURCE_SCRIPT" update >/dev/null
env_after="$(cat "$install_one/.env.production")"
[[ "$env_before" == "$env_after" ]] || fail "update 未保留生产配置"
assert_log_contains "git -C $install_one status --porcelain"
assert_log_contains "git -C $install_one pull --ff-only origin main"
assert_log_contains "docker compose --env-file .env.production -f docker-compose.yml --profile https build api"
assert_log_contains "docker compose --env-file .env.production -f docker-compose.yml --profile https build web"
assert_log_contains "docker compose --env-file .env.production -f docker-compose.yml --profile https up -d"

reset_log
if MOCK_GIT_DIRTY=1 OUIH_INSTALL_DIR="$install_one" \
  "$SOURCE_SCRIPT" update >"$TEST_ROOT/dirty.out" 2>&1; then
  fail "脏仓库应拒绝更新"
fi
assert_contains "$(cat "$TEST_ROOT/dirty.out")" "未提交修改"
if grep -F "pull --ff-only" "$MOCK_LOG" >/dev/null; then
  fail "脏仓库不应执行 pull"
fi

reset_log
if MOCK_GIT_OVERWRITE_ENV=1 MOCK_GIT_PULL_FAIL=1 \
  OUIH_INSTALL_DIR="$install_one" \
  "$SOURCE_SCRIPT" update >"$TEST_ROOT/pull-fail.out" 2>&1; then
  fail "pull 失败应返回非零"
fi
[[ "$(cat "$install_one/.env.production")" == "$env_before" ]] ||
  fail "pull 失败后未恢复生产配置"
assert_contains "$(cat "$TEST_ROOT/pull-fail.out")" "生产配置已恢复"
if grep -F "build api" "$MOCK_LOG" >/dev/null; then
  fail "pull 失败后不应开始构建"
fi

reset_log
OUIH_INSTALL_DIR="$install_one" "$SOURCE_SCRIPT" status >/dev/null
OUIH_INSTALL_DIR="$install_one" "$SOURCE_SCRIPT" logs -f api >/dev/null
OUIH_INSTALL_DIR="$install_one" "$SOURCE_SCRIPT" start >/dev/null
OUIH_INSTALL_DIR="$install_one" "$SOURCE_SCRIPT" stop >/dev/null
assert_log_contains "docker compose --env-file .env.production -f docker-compose.yml --profile https ps"
assert_log_contains "docker compose --env-file .env.production -f docker-compose.yml --profile https logs -f api"
assert_log_contains "docker compose --env-file .env.production -f docker-compose.yml --profile https up -d"
assert_log_contains "docker compose --env-file .env.production -f docker-compose.yml --profile https stop"

install_cancel="$TEST_ROOT/install-cancel"
make_install "$install_cancel"
reset_log
if printf 'y\nWRONG\n' |
  OUIH_INSTALL_DIR="$install_cancel" INPUT_DEVICE=/dev/stdin \
    "$SOURCE_SCRIPT" uninstall >"$TEST_ROOT/cancel.out" 2>&1; then
  fail "第二次确认错误时应取消卸载"
fi
[[ -d "$install_cancel" ]] || fail "确认失败不应删除安装目录"
if grep -F "down --remove-orphans" "$MOCK_LOG" >/dev/null; then
  fail "确认失败不应调用 docker compose down"
fi

install_keep="$TEST_ROOT/install-keep"
make_install "$install_keep"
reset_log
printf 'y\nUNINSTALL\n' |
  OUIH_INSTALL_DIR="$install_keep" INPUT_DEVICE=/dev/stdin \
    "$SOURCE_SCRIPT" uninstall >/dev/null
[[ -d "$install_keep" ]] || fail "默认卸载必须保留安装目录"
[[ -f "$install_keep/.env.production" ]] || fail "默认卸载必须保留生产配置"
assert_log_contains "down --remove-orphans"
if grep -F -- "--volumes" "$MOCK_LOG" >/dev/null; then
  fail "默认卸载不应删除数据卷"
fi

install_purge="$TEST_ROOT/install-purge"
make_install "$install_purge"
reset_log
printf 'y\nPURGE DATA\n' |
  OUIH_INSTALL_DIR="$install_purge" INPUT_DEVICE=/dev/stdin \
    "$SOURCE_SCRIPT" uninstall --purge-data >/dev/null
[[ ! -e "$install_purge" ]] || fail "purge 卸载未删除安装目录"
assert_log_contains "down --remove-orphans --volumes"

menu_install="$TEST_ROOT/install-menu"
make_install "$menu_install"
output="$(
  printf '7\n' |
    OUIH_INSTALL_DIR="$menu_install" INPUT_DEVICE=/dev/stdin \
      "$SOURCE_SCRIPT"
)"
assert_contains "$output" "$menu_install"

printf 'PASS: ouih mock integration tests\n'
