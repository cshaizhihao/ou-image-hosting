#!/usr/bin/env bash

set -Eeuo pipefail

REPOSITORY_URL="https://github.com/cshaizhihao/ou-image-hosting.git"
DEFAULT_INSTALL_DIR="${HOME:-/opt}/ou-image-hosting"
DEFAULT_BIND_HOST="127.0.0.1"
DEFAULT_PORT="3000"
DEFAULT_QUOTA_GB="2"

INSTALL_DIR=""
APP_ORIGIN=""
BIND_HOST=""
WEB_PORT=""
QUOTA_GB=""
AUTO_START="true"
ASSUME_YES="false"
DRY_RUN="false"

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  RESET=$'\033[0m'
  BOLD=$'\033[1m'
  DIM=$'\033[2m'
  PINK=$'\033[38;5;210m'
  ROSE=$'\033[38;5;174m'
  WHITE=$'\033[38;5;255m'
  GRAY=$'\033[38;5;245m'
  GREEN=$'\033[38;5;114m'
  YELLOW=$'\033[38;5;221m'
  RED=$'\033[38;5;203m'
else
  RESET=""
  BOLD=""
  DIM=""
  PINK=""
  ROSE=""
  WHITE=""
  GRAY=""
  GREEN=""
  YELLOW=""
  RED=""
fi

INPUT_DEVICE="/dev/tty"
if [[ ! -r "$INPUT_DEVICE" ]]; then
  INPUT_DEVICE="/dev/stdin"
fi

print_banner() {
  printf '%s' "$PINK"
  cat <<'ART'

       /\_/\
      ( o.o )      ██████╗ ██╗   ██╗
       > ^ <      ██╔═══██╗██║   ██║
                  ██║   ██║██║   ██║
                  ██║   ██║██║   ██║
                  ╚██████╔╝╚██████╔╝
                   ╚═════╝  ╚═════╝
ART
  printf '%s\n' "${BOLD}${WHITE}              IMAGE HOSTING · 欧记图床${RESET}"
  printf '%s\n\n' "${DIM}${GRAY}          好看的图片，也值得被好好管理。${RESET}"
}

usage() {
  cat <<'EOF'
OU-Image Hosting 交互式安装程序

用法：
  bash install.sh [选项]

选项：
  --dir <目录>          安装目录，默认 ~/ou-image-hosting
  --origin <URL>        公开访问地址，例如 https://img.example.com
  --bind <IP>           宿主机绑定地址，默认 127.0.0.1
  --port <端口>         Web 端口，默认 3000
  --quota-gb <整数>     本地存储配额，默认 2 GB
  --no-start            构建完成后不自动启动
  --yes                 使用默认值，不进入交互问答
  --dry-run             只校验参数并显示安装计划
  -h, --help            显示帮助

一键交互安装：
  curl -fsSL https://raw.githubusercontent.com/cshaizhihao/ou-image-hosting/main/install.sh | bash

无人值守本机安装：
  curl -fsSL https://raw.githubusercontent.com/cshaizhihao/ou-image-hosting/main/install.sh \
    | bash -s -- --yes
EOF
}

info() {
  printf '%s\n' "${PINK}●${RESET} $*"
}

success() {
  printf '%s\n' "${GREEN}✓${RESET} $*"
}

warning() {
  printf '%s\n' "${YELLOW}!${RESET} $*"
}

fatal() {
  printf '%s\n' "${RED}✕ $*${RESET}" >&2
  exit 1
}

step() {
  printf '\n%s\n' "${BOLD}${ROSE}[$1/5] $2${RESET}"
}

on_error() {
  local line="$1"
  printf '\n%s\n' "${RED}安装在第 ${line} 行中断，请检查上方错误信息。${RESET}" >&2
}

trap 'on_error "$LINENO"' ERR
trap 'printf "\n%s\n" "${YELLOW}安装已取消，没有删除现有数据。${RESET}"; exit 130' INT TERM

ask() {
  local prompt="$1"
  local default_value="$2"
  local answer=""
  if [[ "$ASSUME_YES" == "true" ]]; then
    printf '%s' "$default_value"
    return
  fi
  printf '%s' "${WHITE}${prompt}${RESET} ${DIM}[${default_value}]${RESET}: " >&2
  IFS= read -r answer < "$INPUT_DEVICE" || true
  printf '%s' "${answer:-$default_value}"
}

confirm() {
  local prompt="$1"
  local default_answer="${2:-y}"
  local hint="[Y/n]"
  local answer=""
  if [[ "$default_answer" == "n" ]]; then
    hint="[y/N]"
  fi
  if [[ "$ASSUME_YES" == "true" ]]; then
    [[ "$default_answer" == "y" ]]
    return
  fi
  printf '%s' "${WHITE}${prompt}${RESET} ${DIM}${hint}${RESET}: " >&2
  IFS= read -r answer < "$INPUT_DEVICE" || true
  answer="${answer:-$default_answer}"
  [[ "$answer" =~ ^[Yy]$ ]]
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

require_command() {
  local command_name="$1"
  local install_hint="$2"
  if command_exists "$command_name"; then
    success "$command_name 已就绪"
  else
    fatal "缺少 ${command_name}。${install_hint}"
  fi
}

normalize_install_dir() {
  if [[ "$INSTALL_DIR" == "~/"* ]]; then
    INSTALL_DIR="${HOME}/${INSTALL_DIR#~/}"
  elif [[ "$INSTALL_DIR" == "~" ]]; then
    INSTALL_DIR="$HOME"
  fi
  [[ "$INSTALL_DIR" == /* ]] ||
    fatal "安装目录必须是绝对路径，或使用 ~/ 开头。"
}

validate_settings() {
  normalize_install_dir

  [[ "$WEB_PORT" =~ ^[0-9]+$ ]] ||
    fatal "端口必须是数字。"
  WEB_PORT=$((10#$WEB_PORT))
  (( WEB_PORT >= 1 && WEB_PORT <= 65535 )) ||
    fatal "端口必须位于 1–65535。"

  [[ "$BIND_HOST" == "127.0.0.1" || "$BIND_HOST" == "0.0.0.0" ]] ||
    fatal "绑定地址目前只支持 127.0.0.1 或 0.0.0.0。"

  [[ "$QUOTA_GB" =~ ^[0-9]+$ ]] ||
    fatal "存储配额必须是整数 GB。"
  QUOTA_GB=$((10#$QUOTA_GB))
  (( QUOTA_GB >= 1 && QUOTA_GB <= 1024 )) ||
    fatal "存储配额必须位于 1–1024 GB。"

  APP_ORIGIN="${APP_ORIGIN%/}"
  if [[ "$APP_ORIGIN" =~ ^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?$ ]]; then
    COOKIE_SECURE="true"
  elif [[ "$APP_ORIGIN" =~ ^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?$ ]]; then
    COOKIE_SECURE="false"
  else
    fatal "公开地址必须是 HTTPS 域名，或 localhost/127.0.0.1 本地 HTTP 地址。"
  fi

  QUOTA_BYTES=$((QUOTA_GB * 1024 * 1024 * 1024))
}

parse_arguments() {
  while (($# > 0)); do
    case "$1" in
      --dir)
        [[ $# -ge 2 ]] || fatal "--dir 缺少参数"
        INSTALL_DIR="$2"
        shift 2
        ;;
      --origin)
        [[ $# -ge 2 ]] || fatal "--origin 缺少参数"
        APP_ORIGIN="$2"
        shift 2
        ;;
      --bind)
        [[ $# -ge 2 ]] || fatal "--bind 缺少参数"
        BIND_HOST="$2"
        shift 2
        ;;
      --port)
        [[ $# -ge 2 ]] || fatal "--port 缺少参数"
        WEB_PORT="$2"
        shift 2
        ;;
      --quota-gb)
        [[ $# -ge 2 ]] || fatal "--quota-gb 缺少参数"
        QUOTA_GB="$2"
        shift 2
        ;;
      --no-start)
        AUTO_START="false"
        shift
        ;;
      --yes)
        ASSUME_YES="true"
        shift
        ;;
      --dry-run)
        DRY_RUN="true"
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        fatal "未知参数：$1。使用 --help 查看帮助。"
        ;;
    esac
  done
}

collect_settings() {
  if [[ "$ASSUME_YES" != "true" && ! -r "/dev/tty" ]]; then
    fatal "当前环境没有交互终端，请使用 --yes 或直接运行已下载的 install.sh。"
  fi

  INSTALL_DIR="${INSTALL_DIR:-$(ask "安装到哪个目录？" "$DEFAULT_INSTALL_DIR")}"
  WEB_PORT="${WEB_PORT:-$(ask "Web 使用哪个端口？" "$DEFAULT_PORT")}"
  BIND_HOST="${BIND_HOST:-$(ask "绑定到哪个地址？" "$DEFAULT_BIND_HOST")}"
  QUOTA_GB="${QUOTA_GB:-$(ask "本地图片空间上限（GB）？" "$DEFAULT_QUOTA_GB")}"

  if [[ -z "$APP_ORIGIN" ]]; then
    if [[ "$ASSUME_YES" == "true" ]]; then
      APP_ORIGIN="http://localhost:${WEB_PORT}"
    else
      printf '\n%s\n' "${BOLD}${WHITE}选择访问方式${RESET}" >&2
      printf '%s\n' "${PINK}1)${RESET} 本机使用（http://localhost:${WEB_PORT}）" >&2
      printf '%s\n' "${PINK}2)${RESET} 公网 HTTPS 域名（推荐正式部署）" >&2
      local mode
      mode="$(ask "请选择" "1")"
      case "$mode" in
        1)
          APP_ORIGIN="http://localhost:${WEB_PORT}"
          ;;
        2)
          APP_ORIGIN="$(ask "请输入完整 HTTPS 地址" "https://img.example.com")"
          ;;
        *)
          fatal "访问方式只能选择 1 或 2。"
          ;;
      esac
    fi
  fi

  if [[ "$AUTO_START" == "true" && "$ASSUME_YES" != "true" ]]; then
    if ! confirm "构建完成后立即启动服务？" "y"; then
      AUTO_START="false"
    fi
  fi

  validate_settings
}

show_plan() {
  printf '\n%s\n' "${BOLD}${WHITE}安装计划${RESET}"
  printf '%s\n' "${DIM}──────────────────────────────────────────────────${RESET}"
  printf '  %-14s %s\n' "安装目录" "$INSTALL_DIR"
  printf '  %-14s %s\n' "公开地址" "$APP_ORIGIN"
  printf '  %-14s %s:%s\n' "监听地址" "$BIND_HOST" "$WEB_PORT"
  printf '  %-14s %s GB\n' "存储配额" "$QUOTA_GB"
  printf '  %-14s %s\n' "完成后启动" "$AUTO_START"
  printf '%s\n\n' "${DIM}──────────────────────────────────────────────────${RESET}"
}

check_environment() {
  step 1 "检查运行环境"
  require_command git "请先安装 Git。"
  require_command curl "请先安装 curl。"
  require_command openssl "请先安装 OpenSSL。"
  require_command docker "请先安装 Docker Engine 或 Docker Desktop。"

  if docker compose version >/dev/null 2>&1; then
    success "Docker Compose v2 已就绪"
  else
    fatal "未检测到 Docker Compose v2（docker compose）。"
  fi

  if docker info >/dev/null 2>&1; then
    success "Docker 服务正在运行"
  else
    fatal "无法连接 Docker 服务，请启动 Docker 或检查当前用户权限。"
  fi
}

prepare_source() {
  step 2 "准备项目文件"

  if [[ -d "$INSTALL_DIR/.git" ]]; then
    local remote_url
    remote_url="$(git -C "$INSTALL_DIR" remote get-url origin 2>/dev/null || true)"
    [[ "$remote_url" == "$REPOSITORY_URL" ||
       "$remote_url" == "git@github.com:cshaizhihao/ou-image-hosting.git" ]] ||
      fatal "安装目录中的 Git 仓库不是 OU-Image Hosting。"
    [[ -z "$(git -C "$INSTALL_DIR" status --porcelain)" ]] ||
      fatal "安装目录存在未提交修改，请先处理后再升级。"

    info "检测到已有安装，正在安全更新"
    git -C "$INSTALL_DIR" fetch --depth 1 origin main
    git -C "$INSTALL_DIR" checkout main
    git -C "$INSTALL_DIR" pull --ff-only origin main
    success "项目已更新到最新 main"
  else
    if [[ -d "$INSTALL_DIR" && -n "$(find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
      fatal "安装目录非空且不是项目仓库，请选择其他目录。"
    fi
    mkdir -p "$(dirname "$INSTALL_DIR")"
    info "正在获取 OU-Image Hosting"
    git clone --depth 1 --branch main "$REPOSITORY_URL" "$INSTALL_DIR"
    success "项目文件已准备完成"
  fi
}

write_configuration() {
  step 3 "生成安全配置"

  local env_file="$INSTALL_DIR/.env.production"
  local existing_secret=""
  local secret=""

  if [[ -f "$env_file" ]]; then
    existing_secret="$(sed -n 's/^OU_SECRET_KEY=//p' "$env_file" | head -n 1)"
    cp "$env_file" "${env_file}.backup-$(date +%Y%m%d%H%M%S)"
    chmod 600 "${env_file}.backup-"*
    warning "已备份现有生产配置"
  fi

  if [[ ${#existing_secret} -ge 32 ]]; then
    secret="$existing_secret"
    success "保留现有加密密钥"
  else
    secret="$(openssl rand -hex 32)"
    success "已生成新的 256-bit 随机密钥"
  fi

  umask 077
  cat > "$env_file" <<EOF
NODE_ENV=production
APP_ORIGIN=${APP_ORIGIN}
WEB_BIND_HOST=${BIND_HOST}
WEB_BIND_PORT=${WEB_PORT}
PORT=3000
API_PORT=4000
API_PROXY_TARGET=http://api:4000
OU_DATA_DIR=/data
OU_STORAGE_QUOTA_BYTES=${QUOTA_BYTES}
OU_SECRET_KEY=${secret}
COOKIE_SECURE=${COOKIE_SECURE}
EXPOSE_DEVELOPMENT_RESET_TOKEN=false
TRUST_PROXY=true
TRUST_PROXY_ADDRESSES=172.30.10.2/32
DATABASE_URL=
REDIS_URL=
CDN_BASE_URL=
OU_IMAGE_TAG=local
EOF
  chmod 600 "$env_file"
  success "生产配置已写入 .env.production（权限 600）"
}

build_application() {
  step 4 "构建应用镜像"
  cd "$INSTALL_DIR"
  docker compose --env-file .env.production config --quiet
  success "Compose 配置校验通过"

  info "正在顺序构建 API，避免并行占满主机"
  COMPOSE_PARALLEL_LIMIT=1 docker compose --env-file .env.production build api
  success "API 镜像构建完成"

  info "正在顺序构建 Web"
  COMPOSE_PARALLEL_LIMIT=1 docker compose --env-file .env.production build web
  success "Web 镜像构建完成"
}

start_application() {
  step 5 "启动并检查服务"
  cd "$INSTALL_DIR"

  if [[ "$AUTO_START" != "true" ]]; then
    warning "已按你的选择跳过启动"
    printf '%s\n' "稍后运行：cd \"$INSTALL_DIR\" && docker compose --env-file .env.production up -d"
    return
  fi

  docker compose --env-file .env.production up -d
  info "等待服务通过 readiness 检查"

  local health_url="http://127.0.0.1:${WEB_PORT}/api/health/ready"
  local ready="false"
  for _ in $(seq 1 60); do
    if curl -fsS "$health_url" >/dev/null 2>&1; then
      ready="true"
      break
    fi
    sleep 2
  done

  if [[ "$ready" != "true" ]]; then
    docker compose --env-file .env.production ps
    warning "服务尚未通过健康检查，请查看日志："
    printf '%s\n' "cd \"$INSTALL_DIR\" && docker compose --env-file .env.production logs --tail=200"
    exit 1
  fi

  success "Web 与 API 已通过健康检查"
}

finish() {
  local title="OU-Image Hosting 安装完成"
  if [[ "$AUTO_START" != "true" ]]; then
    title="OU-Image Hosting 构建完成"
  fi
  printf '\n%s\n' "${GREEN}${BOLD}╭────────────────────────────────────────────────╮${RESET}"
  printf '%s\n' "${GREEN}${BOLD}│          ${title}             │${RESET}"
  printf '%s\n' "${GREEN}${BOLD}╰────────────────────────────────────────────────╯${RESET}"
  if [[ "$AUTO_START" == "true" ]]; then
    printf '\n  %s %s\n' "${GRAY}访问地址${RESET}" "${PINK}${APP_ORIGIN}${RESET}"
  else
    printf '\n  %s %s\n' "${GRAY}启动命令${RESET}" "cd \"$INSTALL_DIR\" && docker compose --env-file .env.production up -d"
  fi
  printf '  %s %s\n' "${GRAY}安装目录${RESET}" "$INSTALL_DIR"
  printf '  %s %s\n' "${GRAY}查看状态${RESET}" "cd \"$INSTALL_DIR\" && docker compose ps"
  printf '  %s %s\n' "${GRAY}查看日志${RESET}" "cd \"$INSTALL_DIR\" && docker compose logs -f"
  printf '  %s %s\n\n' "${GRAY}停止服务${RESET}" "cd \"$INSTALL_DIR\" && docker compose stop"
  if [[ "$APP_ORIGIN" == https://* ]]; then
    warning "请确认 HTTPS 反向代理已转发到 127.0.0.1:${WEB_PORT}。"
  fi
  if [[ "$AUTO_START" == "true" ]]; then
    printf '%s\n' "${DIM}${GRAY}首次打开页面后，跟随图形向导创建站点管理员。${RESET}"
  fi
}

main() {
  parse_arguments "$@"
  print_banner
  collect_settings
  show_plan

  if [[ "$DRY_RUN" == "true" ]]; then
    success "Dry run 完成，没有修改系统。"
    exit 0
  fi

  if [[ "$ASSUME_YES" != "true" ]] && ! confirm "确认开始安装？" "y"; then
    warning "已取消安装，没有修改系统。"
    exit 0
  fi

  check_environment
  prepare_source
  write_configuration
  build_application
  start_application
  finish
}

main "$@"
