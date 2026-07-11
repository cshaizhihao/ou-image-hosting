#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_SCRIPT="$ROOT_DIR/scripts/ouih"
TEST_ROOT="$(mktemp -d)"
MOCK_BIN="$TEST_ROOT/mock-bin"
SHIM_BIN="$TEST_ROOT/shim-bin"
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
  printf 'https://{$OU_PUBLIC_HOST} { reverse_proxy web:3000 }\n' > "$directory/Caddyfile"
  cat > "$directory/.env.production" <<'EOF'
APP_ORIGIN=https://img.example.com
OU_SECRET_KEY=keep-this-production-secret-unchanged
OU_PROXY_MODE=cloudflare
OU_PUBLIC_HOST=img.example.com
EOF
}

mkdir -p "$MOCK_BIN" "$SHIM_BIN"
for shim_command in awk bash cat chmod cp curl date dirname env find grep gzip head id install mktemp mkdir mv openssl printf realpath readlink rm sed sort tail tar; do
  shim_target="$(command -v "$shim_command" 2>/dev/null || true)"
  [[ -n "$shim_target" ]] || continue
  ln -s "$shim_target" "$SHIM_BIN/$shim_command"
done

cat > "$MOCK_BIN/docker" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'docker %s\n' "$*" >> "$MOCK_LOG"
if [[ "${1:-}" == "info" ]]; then
  exit "${MOCK_DOCKER_INFO_EXIT:-0}"
fi
if [[ "$*" == *"ps --status running --services"* ]]; then
  printf 'api\nweb\ncaddy\n'
fi
if [[ "$*" == *"tar -czf -"* ]]; then
  printf 'mock-volume-backup\n'
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
if [[ "$*" == *"rev-parse HEAD"* ]]; then
  printf '%s\n' "${MOCK_GIT_HEAD:-1111111111111111111111111111111111111111}"
fi
if [[ "$*" == *"cat-file -e"* ]]; then
  exit "${MOCK_GIT_CAT_FILE_EXIT:-0}"
fi
if [[ "$*" == *"reset --hard origin/main"* ]]; then
  if [[ "${MOCK_GIT_OVERWRITE_ENV:-0}" == "1" ]]; then
    printf 'APP_ORIGIN=https://overwritten.invalid\n' > "$2/.env.production"
  fi
  [[ "${MOCK_GIT_SYNC_FAIL:-0}" == "1" ]] && exit 23
fi
exit 0
EOF
chmod +x "$MOCK_BIN/docker" "$MOCK_BIN/git"

cat > "$MOCK_BIN/curl" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'curl %s\n' "$*" >> "$MOCK_LOG"
exit "${MOCK_CURL_EXIT:-0}"
EOF

cat > "$MOCK_BIN/getent" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'getent %s\n' "$*" >> "$MOCK_LOG"
[[ "${MOCK_DNS_FAIL:-0}" != "1" ]]
EOF

cat > "$MOCK_BIN/ss" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'LISTEN 0 4096 0.0.0.0:80 0.0.0.0:*\n'
printf 'LISTEN 0 4096 0.0.0.0:443 0.0.0.0:*\n'
printf 'LISTEN 0 4096 127.0.0.1:3000 0.0.0.0:*\n'
EOF
chmod +x "$MOCK_BIN/curl" "$MOCK_BIN/getent" "$MOCK_BIN/ss"

export PATH="$MOCK_BIN:$PATH"
export MOCK_BIN
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
assert_log_contains "git -C $install_one fetch --depth 1 origin main"
assert_log_contains "git -C $install_one checkout -B main origin/main"
assert_log_contains "git -C $install_one reset --hard origin/main"
assert_log_contains "docker compose --env-file .env.production -f docker-compose.yml --profile https build api"
assert_log_contains "docker compose --env-file .env.production -f docker-compose.yml --profile https build web"
assert_log_contains "docker compose --env-file .env.production -f docker-compose.yml --profile https up -d"

reset_log
if MOCK_GIT_DIRTY=1 OUIH_INSTALL_DIR="$install_one" \
  "$SOURCE_SCRIPT" update >"$TEST_ROOT/dirty.out" 2>&1; then
  fail "脏仓库应拒绝更新"
fi
assert_contains "$(cat "$TEST_ROOT/dirty.out")" "未提交修改"
if grep -F "reset --hard origin/main" "$MOCK_LOG" >/dev/null; then
  fail "脏仓库不应执行同步"
fi

reset_log
if MOCK_GIT_OVERWRITE_ENV=1 MOCK_GIT_SYNC_FAIL=1 \
  OUIH_INSTALL_DIR="$install_one" \
  "$SOURCE_SCRIPT" update >"$TEST_ROOT/sync-fail.out" 2>&1; then
  fail "同步失败应返回非零"
fi
[[ "$(cat "$install_one/.env.production")" == "$env_before" ]] ||
  fail "同步失败后未恢复生产配置"
assert_contains "$(cat "$TEST_ROOT/sync-fail.out")" "生产配置已恢复"
assert_contains "$(cat "$TEST_ROOT/sync-fail.out")" "修复原因后可重试：ouih update"
assert_contains "$(cat "$TEST_ROOT/sync-fail.out")" "如更新已完成过且需要回退"
if grep -F "build api" "$MOCK_LOG" >/dev/null; then
  fail "同步失败后不应开始构建"
fi

reset_log
hidden_mock_bin="$TEST_ROOT/hidden-mock-bin"
mkdir -p "$hidden_mock_bin"
mv "$MOCK_BIN/git" "$hidden_mock_bin/git"
cat > "$MOCK_BIN/apt-get" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'apt-get %s\n' "$*" >> "$MOCK_LOG"
cp "$HIDDEN_MOCK_BIN/git" "$MOCK_BIN/git"
chmod +x "$MOCK_BIN/git"
exit 0
EOF
chmod +x "$MOCK_BIN/apt-get"
cat > "$MOCK_BIN/sudo" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'sudo %s\n' "$*" >> "$MOCK_LOG"
exec "$@"
EOF
chmod +x "$MOCK_BIN/sudo"
env_before="$(cat "$install_one/.env.production")"
PATH="$MOCK_BIN:$SHIM_BIN" HIDDEN_MOCK_BIN="$hidden_mock_bin" \
  MOCK_GIT_OVERWRITE_ENV=1 OUIH_INSTALL_DIR="$install_one" \
  "$SOURCE_SCRIPT" update >/dev/null
env_after="$(cat "$install_one/.env.production")"
[[ "$env_before" == "$env_after" ]] || fail "自动补 Git 更新未保留生产配置"
assert_log_contains "apt-get update"
assert_log_contains "apt-get install -y git curl openssl coreutils tar gzip ca-certificates"
assert_log_contains "git -C $install_one fetch --depth 1 origin main"
rm -f "$MOCK_BIN/apt-get"
rm -f "$MOCK_BIN/sudo"
rm -f "$MOCK_BIN/git"
mv "$hidden_mock_bin/git" "$MOCK_BIN/git"

reset_log
OUIH_INSTALL_DIR="$install_one" "$SOURCE_SCRIPT" status >/dev/null
OUIH_INSTALL_DIR="$install_one" "$SOURCE_SCRIPT" logs -f api >/dev/null
OUIH_INSTALL_DIR="$install_one" "$SOURCE_SCRIPT" start >/dev/null
OUIH_INSTALL_DIR="$install_one" "$SOURCE_SCRIPT" stop >/dev/null
assert_log_contains "docker compose --env-file .env.production -f docker-compose.yml --profile https ps"
assert_log_contains "docker compose --env-file .env.production -f docker-compose.yml --profile https logs -f api"
assert_log_contains "docker compose --env-file .env.production -f docker-compose.yml --profile https up -d"
assert_log_contains "docker compose --env-file .env.production -f docker-compose.yml --profile https stop"

reset_log
output="$(OUIH_INSTALL_DIR="$install_one" "$SOURCE_SCRIPT" backup)"
assert_contains "$output" "数据卷备份已创建"
backup_file="$(find "${install_one}.backups" -maxdepth 1 -type f -name '*-manual-*.tar.gz' | head -n 1)"
[[ -s "$backup_file" ]] || fail "backup 未生成非空归档"
assert_log_contains "docker compose --env-file .env.production -f docker-compose.yml --profile https stop"
assert_log_contains "run --rm --no-deps -T --user 0:0"
assert_log_contains "tar -czf -"
assert_log_contains "docker compose --env-file .env.production -f docker-compose.yml --profile https up -d"

restore_source="$TEST_ROOT/restore-source"
restore_archive="$TEST_ROOT/valid-restore.tar.gz"
mkdir -p "$restore_source/data"
cat > "$restore_source/.ouih-backup-manifest" <<'EOF'
format=ouih-volume-backup-v1
product=OU-Image Hosting
created_at=20260101T000000Z
reason=test
version=1.12.0
revision=test-revision
EOF
printf '{"schemaVersion":8}\n' > "$restore_source/data/ou-image.json"
tar -czf "$restore_archive" \
  -C "$restore_source" .ouih-backup-manifest \
  -C "$restore_source/data" .
reset_log
env_before="$(cat "$install_one/.env.production")"
printf 'y\nRESTORE\n' |
  OUIH_INSTALL_DIR="$install_one" INPUT_DEVICE=/dev/stdin \
    "$SOURCE_SCRIPT" restore "$restore_archive" > "$TEST_ROOT/restore.out"
assert_contains "$(cat "$TEST_ROOT/restore.out")" "恢复完成"
[[ "$(cat "$install_one/.env.production")" == "$env_before" ]] ||
  fail "restore 未保留生产配置"
assert_log_contains "tar -xzf - -C /restore-staging --no-same-owner --no-same-permissions"
assert_log_contains "cp -a /restore-staging/. /data/"

invalid_archive="$TEST_ROOT/invalid-restore.tar.gz"
tar -czf "$invalid_archive" -C "$restore_source/data" ou-image.json
reset_log
if OUIH_INSTALL_DIR="$install_one" "$SOURCE_SCRIPT" restore "$invalid_archive" \
  > "$TEST_ROOT/invalid-restore.out" 2>&1; then
  fail "缺少备份标识的归档应拒绝恢复"
fi
assert_contains "$(cat "$TEST_ROOT/invalid-restore.out")" "备份内容检查失败"
if grep -F "tar -xzf -" "$MOCK_LOG" >/dev/null; then
  fail "无效归档不应进入数据卷恢复"
fi

reset_log
if OUIH_MAX_BACKUP_ARCHIVE_BYTES=1 OUIH_INSTALL_DIR="$install_one" \
  "$SOURCE_SCRIPT" restore "$restore_archive" > "$TEST_ROOT/archive-limit.out" 2>&1; then
  fail "超过压缩文件预算的归档应拒绝恢复"
fi
assert_contains "$(cat "$TEST_ROOT/archive-limit.out")" "压缩文件超过安全上限"

if OUIH_MAX_BACKUP_ENTRIES=1 OUIH_INSTALL_DIR="$install_one" \
  "$SOURCE_SCRIPT" restore "$restore_archive" > "$TEST_ROOT/entry-limit.out" 2>&1; then
  fail "超过条目预算的归档应拒绝恢复"
fi
assert_contains "$(cat "$TEST_ROOT/entry-limit.out")" "超过条目数/解压字节预算"

if OUIH_MAX_BACKUP_UNCOMPRESSED_BYTES=1 OUIH_INSTALL_DIR="$install_one" \
  "$SOURCE_SCRIPT" restore "$restore_archive" > "$TEST_ROOT/bytes-limit.out" 2>&1; then
  fail "超过解压字节预算的归档应拒绝恢复"
fi
assert_contains "$(cat "$TEST_ROOT/bytes-limit.out")" "超过条目数/解压字节预算"

ln -s ou-image.json "$restore_source/data/linked-state"
symlink_archive="$TEST_ROOT/symlink-restore.tar.gz"
tar -czf "$symlink_archive" \
  -C "$restore_source" .ouih-backup-manifest \
  -C "$restore_source/data" .
if OUIH_INSTALL_DIR="$install_one" "$SOURCE_SCRIPT" restore "$symlink_archive" \
  > "$TEST_ROOT/symlink-restore.out" 2>&1; then
  fail "包含 symlink 的归档应拒绝恢复"
fi
assert_contains "$(cat "$TEST_ROOT/symlink-restore.out")" "含链接/设备/FIFO等特殊条目"
rm -f "$restore_source/data/linked-state"

mkfifo "$restore_source/data/special-pipe"
special_archive="$TEST_ROOT/special-restore.tar.gz"
tar -czf "$special_archive" \
  -C "$restore_source" .ouih-backup-manifest \
  -C "$restore_source/data" .
if OUIH_INSTALL_DIR="$install_one" "$SOURCE_SCRIPT" restore "$special_archive" \
  > "$TEST_ROOT/special-restore.out" 2>&1; then
  fail "包含 FIFO 的归档应拒绝恢复"
fi
assert_contains "$(cat "$TEST_ROOT/special-restore.out")" "含链接/设备/FIFO等特殊条目"
rm -f "$restore_source/data/special-pipe"

reset_log
printf 'y\n' |
  OUIH_INSTALL_DIR="$install_one" INPUT_DEVICE=/dev/stdin \
    "$SOURCE_SCRIPT" rollback > "$TEST_ROOT/rollback.out"
assert_contains "$(cat "$TEST_ROOT/rollback.out")" "已回退到 1111111111111111111111111111111111111111"
assert_log_contains "git -C $install_one cat-file -e 1111111111111111111111111111111111111111^{commit}"
assert_log_contains "git -C $install_one reset --hard 1111111111111111111111111111111111111111"
assert_log_contains "docker compose --env-file .env.production -f docker-compose.yml --profile https build api"
assert_log_contains "docker compose --env-file .env.production -f docker-compose.yml --profile https build web"
if OUIH_INSTALL_DIR="$install_one" "$SOURCE_SCRIPT" rollback \
  > "$TEST_ROOT/rollback-again.out" 2>&1; then
  fail "最近更新回退记录消费后不应重复回退"
fi
assert_contains "$(cat "$TEST_ROOT/rollback-again.out")" "没有可回退"

reset_log
output="$(OUIH_INSTALL_DIR="$install_one" "$SOURCE_SCRIPT" doctor)"
assert_contains "$output" "系统诊断"
assert_contains "$output" "生产配置可读取"
assert_contains "$output" "Docker Compose v2 可用"
assert_contains "$output" "Caddy 容器正在运行"
assert_contains "$output" "Caddy 配置校验通过"
assert_contains "$output" "DNS 可以解析：img.example.com"
assert_contains "$output" "公网地址可以访问：https://img.example.com"
assert_contains "$output" "备份目录可写"
assert_contains "$output" "最近数据卷备份"
assert_contains "$output" "诊断摘要"
assert_contains "$output" "0 项失败"
assert_log_contains "curl --silent --show-error --fail --location --connect-timeout 3 --max-time 8 --output /dev/null https://img.example.com"

reset_log
if MOCK_CURL_EXIT=22 OUIH_INSTALL_DIR="$install_one" \
  "$SOURCE_SCRIPT" doctor >"$TEST_ROOT/doctor-fail.out" 2>&1; then
  fail "公网探测失败时 doctor 应返回非零"
fi
assert_contains "$(cat "$TEST_ROOT/doctor-fail.out")" "公网地址访问失败"
assert_contains "$(cat "$TEST_ROOT/doctor-fail.out")" "项失败"

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
  printf '7\nx0\n' |
    OUIH_INSTALL_DIR="$menu_install" INPUT_DEVICE=/dev/stdin \
      "$SOURCE_SCRIPT" 2>&1
)"
assert_contains "$output" "$menu_install"
assert_contains "$output" "按任意键返回上级菜单"
menu_count="$(grep -c '1) 查看状态' <<< "$output")"
[[ "$menu_count" -eq 2 ]] || fail "菜单操作完成后应返回上级菜单"

printf 'PASS: ouih mock integration tests\n'
