#!/usr/bin/env bash

set -Eeuo pipefail

REPOSITORY_URL="https://github.com/cshaizhihao/ou-image-hosting.git"
DEFAULT_INSTALL_DIR="${HOME:-/opt}/ou-image-hosting"
DEFAULT_BIND_HOST="127.0.0.1"
DEFAULT_PORT="3000"
DEFAULT_QUOTA_GB="2"
DEFAULT_PROXY_MODE="caddy"

INSTALL_DIR=""
APP_ORIGIN=""
BIND_HOST=""
WEB_PORT=""
QUOTA_GB=""
PROXY_MODE=""
PUBLIC_HOST=""
AUTO_START="true"
ASSUME_YES="false"
DRY_RUN="false"
OUIH_COMMAND_PATH=""
AUTO_INSTALL_DEPS="true"

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
  --proxy <模式>        caddy、cloudflare（小黄云）、external 或 none
  --no-install-deps     不自动安装缺少的系统依赖
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

run_as_root() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  elif command_exists sudo; then
    sudo "$@"
  else
    fatal "自动安装依赖需要管理员权限，请使用 root 或安装 sudo。"
  fi
}

detect_package_manager() {
  local manager
  for manager in apt-get dnf yum pacman zypper apk brew; do
    if command_exists "$manager"; then
      printf '%s' "$manager"
      return 0
    fi
  done
  return 1
}

install_base_packages() {
  local manager=""
  manager="$(detect_package_manager)" ||
    fatal "未识别到受支持的包管理器，请手动安装 Git、curl、OpenSSL 和 coreutils。"

  info "使用 ${manager} 自动安装基础依赖"
  case "$manager" in
    apt-get)
      run_as_root apt-get update
      run_as_root env DEBIAN_FRONTEND=noninteractive \
        apt-get install -y git curl openssl coreutils ca-certificates
      ;;
    dnf)
      run_as_root dnf install -y git curl openssl coreutils ca-certificates
      ;;
    yum)
      run_as_root yum install -y git curl openssl coreutils ca-certificates
      ;;
    pacman)
      run_as_root pacman -Syu --noconfirm --needed \
        git curl openssl coreutils ca-certificates
      ;;
    zypper)
      run_as_root zypper --non-interactive install -y \
        git curl openssl coreutils ca-certificates
      ;;
    apk)
      run_as_root apk add --no-cache git curl openssl coreutils ca-certificates
      ;;
    brew)
      brew install git curl openssl@3 coreutils ca-certificates
      ;;
  esac
}

bootstrap_base_dependencies() {
  local -a missing=()
  local command_name
  for command_name in git curl openssl install; do
    if ! command_exists "$command_name"; then
      missing+=("$command_name")
    fi
  done

  if ((${#missing[@]} > 0)); then
    warning "检测到缺少基础依赖：${missing[*]}"
    [[ "$AUTO_INSTALL_DEPS" == "true" ]] ||
      fatal "已禁用自动安装依赖，请手动安装后重试。"
    if [[ "$ASSUME_YES" != "true" ]] &&
       ! confirm "是否自动安装这些依赖？" "y"; then
      fatal "缺少必要依赖，安装无法继续。"
    fi
    install_base_packages
  fi

  require_command git "自动安装失败，请检查包管理器输出。"
  require_command curl "自动安装失败，请检查包管理器输出。"
  require_command openssl "自动安装失败，请检查包管理器输出。"
  require_command install "自动安装失败，请检查 coreutils。"
}

install_docker_engine() {
  [[ "$(uname -s)" == "Linux" ]] ||
    fatal "macOS 请安装并启动 Docker Desktop；自动安装 Docker Engine 仅支持 Linux。"

  local manager=""
  manager="$(detect_package_manager)" ||
    fatal "未识别到受支持的包管理器，请手动安装 Docker Engine 与 Compose v2。"

  case "$manager" in
    apt-get|dnf|yum)
      local installer=""
      installer="$(mktemp)"
      info "正在下载 Docker 官方安装程序"
      curl -fsSL --proto '=https' --tlsv1.2 \
        https://get.docker.com -o "$installer"
      if ! run_as_root sh "$installer"; then
        rm -f "$installer"
        fatal "Docker 官方安装程序执行失败。"
      fi
      rm -f "$installer"
      ;;
    pacman)
      info "使用 pacman 安装 Docker Engine 与 Compose v2"
      run_as_root pacman -Syu --noconfirm --needed docker docker-compose
      ;;
    zypper)
      info "使用 zypper 安装 Docker Engine 与 Compose v2"
      run_as_root zypper --non-interactive install -y docker docker-compose
      ;;
    apk)
      info "使用 apk 安装 Docker Engine 与 Compose v2"
      run_as_root apk add --no-cache docker docker-cli-compose
      ;;
    brew)
      fatal "macOS 请安装并启动 Docker Desktop；Homebrew 不提供完整 Docker Engine 服务。"
      ;;
  esac

  if command_exists systemctl; then
    run_as_root systemctl enable --now docker || true
  elif command_exists service; then
    run_as_root service docker start || true
  fi
}

bootstrap_docker() {
  local needs_install="false"
  if ! command_exists docker; then
    warning "未检测到 Docker Engine"
    needs_install="true"
  elif ! docker compose version >/dev/null 2>&1; then
    warning "未检测到 Docker Compose v2 插件"
    needs_install="true"
  fi

  if [[ "$needs_install" == "true" ]]; then
    [[ "$AUTO_INSTALL_DEPS" == "true" ]] ||
      fatal "已禁用自动安装依赖，请手动安装 Docker Engine 与 Compose v2。"
    if [[ "$ASSUME_YES" != "true" ]] &&
       ! confirm "是否使用 Docker 官方脚本自动安装或修复 Docker？" "y"; then
      fatal "缺少 Docker Engine 或 Compose v2，安装无法继续。"
    fi
    install_docker_engine
  fi

  require_command docker "Docker 自动安装失败。"
  docker compose version >/dev/null 2>&1 ||
    fatal "Docker Compose v2 自动安装失败。"
  success "Docker Compose v2 已就绪"

  if ! docker info >/dev/null 2>&1; then
    if command_exists systemctl; then
      run_as_root systemctl enable --now docker || true
    elif command_exists service; then
      run_as_root service docker start || true
    fi
  fi

  if docker info >/dev/null 2>&1; then
    success "Docker 服务正在运行"
  elif [[ "${EUID:-$(id -u)}" -ne 0 ]] &&
       command_exists sudo &&
       sudo docker info >/dev/null 2>&1; then
    fatal "Docker 已安装，但当前用户尚无权限。请执行 sudo usermod -aG docker \"$USER\"，重新登录后再运行安装器。"
  else
    fatal "Docker 已安装但服务未正常运行，请检查 systemctl status docker。"
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

read_env_value() {
  local file="$1"
  local key="$2"
  sed -n "s/^${key}=//p" "$file" | head -n 1
}

load_existing_configuration() {
  local env_file="$INSTALL_DIR/.env.production"
  [[ -f "$env_file" ]] || return 0

  local origin_was_explicit="$APP_ORIGIN"
  local value=""

  if [[ -z "$APP_ORIGIN" ]]; then
    APP_ORIGIN="$(read_env_value "$env_file" APP_ORIGIN)"
  fi
  if [[ -z "$PROXY_MODE" && -z "$origin_was_explicit" ]]; then
    PROXY_MODE="$(read_env_value "$env_file" OU_PROXY_MODE)"
  fi
  if [[ -z "$BIND_HOST" ]]; then
    BIND_HOST="$(read_env_value "$env_file" WEB_BIND_HOST)"
  fi
  if [[ -z "$WEB_PORT" ]]; then
    WEB_PORT="$(read_env_value "$env_file" WEB_BIND_PORT)"
  fi
  if [[ -z "$QUOTA_GB" ]]; then
    value="$(read_env_value "$env_file" OU_STORAGE_QUOTA_BYTES)"
    if [[ "$value" =~ ^[0-9]+$ ]] && ((value >= 1073741824)); then
      QUOTA_GB=$((value / 1024 / 1024 / 1024))
    fi
  fi

  success "检测到现有生产配置，未显式指定的设置将保持不变"
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
    PUBLIC_HOST="${APP_ORIGIN#https://}"
    PROXY_MODE="${PROXY_MODE:-$DEFAULT_PROXY_MODE}"
    if [[ ("$PROXY_MODE" == "caddy" || "$PROXY_MODE" == "cloudflare") &&
          "$PUBLIC_HOST" == *:* ]]; then
      fatal "自动 HTTPS 使用标准 443 端口，公开地址不要附加端口。"
    fi
  elif [[ "$APP_ORIGIN" =~ ^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?$ ]]; then
    COOKIE_SECURE="false"
    PUBLIC_HOST=""
    PROXY_MODE="${PROXY_MODE:-none}"
  else
    fatal "公开地址必须是 HTTPS 域名，或 localhost/127.0.0.1 本地 HTTP 地址。"
  fi

  case "$PROXY_MODE" in
    caddy|cloudflare)
      [[ "$COOKIE_SECURE" == "true" ]] ||
        fatal "Caddy 自动 HTTPS 模式必须使用 HTTPS 域名。"
      BIND_HOST="127.0.0.1"
      ;;
    external)
      [[ "$COOKIE_SECURE" == "true" ]] ||
        fatal "外部反向代理模式必须使用 HTTPS 域名。"
      ;;
    none)
      [[ "$COOKIE_SECURE" == "false" ]] ||
        fatal "HTTPS 域名不能关闭反向代理，请选择 caddy 或 external。"
      ;;
    *)
      fatal "反向代理模式只能是 caddy、cloudflare、external 或 none。"
      ;;
  esac

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
      --proxy)
        [[ $# -ge 2 ]] || fatal "--proxy 缺少参数"
        PROXY_MODE="$2"
        shift 2
        ;;
      --no-install-deps)
        AUTO_INSTALL_DEPS="false"
        shift
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
  normalize_install_dir
  load_existing_configuration
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

  if [[ "$APP_ORIGIN" == https://* && -z "$PROXY_MODE" && "$ASSUME_YES" != "true" ]]; then
    printf '\n%s\n' "${BOLD}${WHITE}选择 HTTPS 接入方式${RESET}" >&2
    printf '%s\n' "${PINK}1)${RESET} 域名直连服务器：自动部署 Caddy（灰云 / 普通 DNS）" >&2
    printf '%s\n' "${PINK}2)${RESET} Cloudflare 小黄云：Caddy 自动源站证书 + Full (strict)" >&2
    printf '%s\n' "${PINK}3)${RESET} 使用服务器已有的 Nginx / Caddy / 面板反向代理" >&2
    local proxy_choice
    proxy_choice="$(ask "请选择" "1")"
    case "$proxy_choice" in
      1) PROXY_MODE="caddy" ;;
      2) PROXY_MODE="cloudflare" ;;
      3) PROXY_MODE="external" ;;
      *) fatal "HTTPS 接入方式只能选择 1、2 或 3。" ;;
    esac
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
  case "$PROXY_MODE" in
    caddy) printf '  %-14s %s\n' "HTTPS 入口" "Caddy 自动证书 + 80/443 反向代理" ;;
    cloudflare) printf '  %-14s %s\n' "HTTPS 入口" "Cloudflare 小黄云 + Caddy 源站证书" ;;
    external) printf '  %-14s %s\n' "HTTPS 入口" "使用现有外部反向代理" ;;
    none) printf '  %-14s %s\n' "HTTPS 入口" "不启用（仅本机 HTTP）" ;;
  esac
  printf '  %-14s %s GB\n' "存储配额" "$QUOTA_GB"
  printf '  %-14s %s\n' "完成后启动" "$AUTO_START"
  printf '  %-14s %s\n' "自动安装依赖" "$AUTO_INSTALL_DEPS"
  printf '%s\n\n' "${DIM}──────────────────────────────────────────────────${RESET}"
}

check_environment() {
  step 1 "检查运行环境"
  bootstrap_base_dependencies
  bootstrap_docker

  if [[ "$PROXY_MODE" == "caddy" || "$PROXY_MODE" == "cloudflare" ]]; then
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -Eq '^ou-image-hosting-caddy-[0-9]+$'; then
      success "检测到现有 OU-Image Hosting Caddy，将原地升级"
    elif command_exists ss; then
      local occupied_ports=""
      if ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq '(^|:|\])80$'; then
        occupied_ports="${occupied_ports} 80"
      fi
      if ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq '(^|:|\])443$'; then
        occupied_ports="${occupied_ports} 443"
      fi
      [[ -z "$occupied_ports" ]] ||
        fatal "自动 HTTPS 需要宿主机 80/443 端口，但以下端口已被占用：${occupied_ports}。请停止占用服务，或使用 --proxy external。"
      success "宿主机 80/443 端口可用于自动 HTTPS"
    else
      warning "系统没有 ss，无法预检 80/443 端口；Compose 启动时会继续校验。"
    fi
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

    info "检测到已有安装，正在对齐远端 main"
    git -C "$INSTALL_DIR" fetch --depth 1 origin main
    git -C "$INSTALL_DIR" checkout -B main origin/main
    git -C "$INSTALL_DIR" reset --hard origin/main
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

update_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local temp_file=""
  temp_file="$(mktemp)"
  awk -v target="${key}=" -v replacement="${key}=${value}" '
    BEGIN { replaced = 0 }
    index($0, target) == 1 {
      if (!replaced) {
        print replacement
        replaced = 1
      }
      next
    }
    { print }
    END {
      if (!replaced) {
        print replacement
      }
    }
  ' "$file" > "$temp_file"
  chmod 600 "$temp_file"
  mv "$temp_file" "$file"
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
  if [[ -f "$env_file" ]]; then
    update_env_value "$env_file" APP_ORIGIN "$APP_ORIGIN"
    update_env_value "$env_file" WEB_BIND_HOST "$BIND_HOST"
    update_env_value "$env_file" WEB_BIND_PORT "$WEB_PORT"
    update_env_value "$env_file" OU_STORAGE_QUOTA_BYTES "$QUOTA_BYTES"
    update_env_value "$env_file" OU_SECRET_KEY "$secret"
    update_env_value "$env_file" COOKIE_SECURE "$COOKIE_SECURE"
    update_env_value "$env_file" OU_PROXY_MODE "$PROXY_MODE"
    update_env_value "$env_file" OU_PUBLIC_HOST "$PUBLIC_HOST"
    update_env_value "$env_file" EXPOSE_DEVELOPMENT_RESET_TOKEN "false"
  else
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
OU_PROXY_MODE=${PROXY_MODE}
OU_PUBLIC_HOST=${PUBLIC_HOST}
EXPOSE_DEVELOPMENT_RESET_TOKEN=false
TRUST_PROXY=true
TRUST_PROXY_ADDRESSES=172.30.10.2/32
DATABASE_URL=
REDIS_URL=
CDN_BASE_URL=
OU_IMAGE_TAG=local
EOF
  fi
  chmod 600 "$env_file"
  success "生产配置已写入 .env.production（权限 600）"
}

install_management_command() {
  local source_path="$INSTALL_DIR/scripts/ouih"
  local bin_dir=""
  local config_dir=""
  local command_path=""
  local config_path=""
  local use_sudo="false"
  local config_temp=""

  [[ -x "$source_path" ]] ||
    fatal "项目缺少 scripts/ouih，无法安装管理命令。"

  if [[ -n "${OUIH_BIN_DIR:-}" || -n "${OUIH_CONFIG_DIR:-}" ]]; then
    bin_dir="${OUIH_BIN_DIR:-${HOME}/.local/bin}"
    config_dir="${OUIH_CONFIG_DIR:-${HOME}/.config/ou-image-hosting}"
  elif [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    bin_dir="/usr/local/bin"
    config_dir="/etc/ou-image-hosting"
  elif [[ "$ASSUME_YES" != "true" ]] &&
       command_exists sudo &&
       confirm "把 ouih 安装为系统全局命令？（需要 sudo）" "y"; then
    bin_dir="/usr/local/bin"
    config_dir="/etc/ou-image-hosting"
    use_sudo="true"
  else
    bin_dir="${HOME}/.local/bin"
    config_dir="${XDG_CONFIG_HOME:-${HOME}/.config}/ou-image-hosting"
  fi

  command_path="${bin_dir}/ouih"
  config_path="${config_dir}/install.conf"
  config_temp="$(mktemp)"
  printf 'INSTALL_DIR=%s\n' "$INSTALL_DIR" > "$config_temp"

  if [[ "$use_sudo" == "true" ]]; then
    sudo install -d -m 0755 "$bin_dir" "$config_dir"
    sudo install -m 0755 "$source_path" "$command_path"
    sudo install -m 0644 "$config_temp" "$config_path"
  else
    install -d -m 0755 "$bin_dir" "$config_dir"
    install -m 0755 "$source_path" "$command_path"
    install -m 0644 "$config_temp" "$config_path"
  fi
  rm -f "$config_temp"

  OUIH_COMMAND_PATH="$command_path"
  success "管理命令已安装：${command_path}"
  if [[ ":${PATH}:" != *":${bin_dir}:"* ]]; then
    warning "${bin_dir} 不在 PATH；当前会话可运行：export PATH=\"${bin_dir}:\$PATH\""
  fi
}

compose_command() {
  local -a command=(docker compose --env-file .env.production)
  if [[ "$PROXY_MODE" == "caddy" || "$PROXY_MODE" == "cloudflare" ]]; then
    command+=(--profile https)
  fi
  "${command[@]}" "$@"
}

build_application() {
  step 4 "构建应用镜像"
  cd "$INSTALL_DIR"
  compose_command config --quiet
  success "Compose 配置校验通过"

  info "正在顺序构建 API，避免并行占满主机"
  COMPOSE_PARALLEL_LIMIT=1 compose_command build api
  success "API 镜像构建完成"

  info "正在顺序构建 Web"
  COMPOSE_PARALLEL_LIMIT=1 compose_command build web
  success "Web 镜像构建完成"
}

validate_public_redirect_target() {
  local redirect_url="$1"
  [[ -n "$redirect_url" ]] || return 0

  local expected_authority="${APP_ORIGIN#*://}"
  local redirect_authority="${redirect_url#*://}"
  if [[ "$redirect_authority" == "$redirect_url" ]]; then
    fatal "HTTPS 入口返回了无法识别的跳转地址：${redirect_url}"
  fi
  redirect_authority="${redirect_authority%%/*}"

  [[ "$redirect_authority" == "$expected_authority" ]] ||
    fatal "HTTPS 入口错误跳转到 ${redirect_url}。公开地址应保持为 ${APP_ORIGIN}，不得暴露内部 Web 端口 ${WEB_PORT}。"
}

start_application() {
  step 5 "启动并检查服务"
  cd "$INSTALL_DIR"

  if [[ "$AUTO_START" != "true" ]]; then
    warning "已按你的选择跳过启动"
    printf '%s\n' "稍后运行：${OUIH_COMMAND_PATH:-ouih} start"
    return
  fi

  compose_command up -d
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
    compose_command ps
    warning "服务尚未通过健康检查，请查看日志："
    printf '%s\n' "cd \"$INSTALL_DIR\" && docker compose --env-file .env.production logs --tail=200"
    exit 1
  fi

  success "Web 与 API 已通过健康检查"

  if [[ "$PROXY_MODE" == "caddy" || "$PROXY_MODE" == "cloudflare" ]]; then
    info "等待 Caddy 申请证书并验证 HTTPS 入口"
    local https_ready="false"
    for _ in $(seq 1 30); do
      if curl --resolve "${PUBLIC_HOST}:443:127.0.0.1" \
        --connect-timeout 3 \
        --max-time 8 \
        -fsS "${APP_ORIGIN}/api/health/ready" >/dev/null 2>&1; then
        https_ready="true"
        break
      fi
      sleep 2
    done

    if [[ "$https_ready" != "true" ]]; then
      compose_command logs --tail=80 caddy || true
      fatal "自动 HTTPS 尚未就绪。请确认域名 A/AAAA 记录指向本机公网 IP，云防火墙和系统防火墙已放行 TCP 80/443；随后运行 ouih logs caddy 查看证书日志。"
    fi

    local public_redirect_url=""
    public_redirect_url="$(
      curl --resolve "${PUBLIC_HOST}:443:127.0.0.1" \
        --connect-timeout 3 \
        --max-time 8 \
        -sS \
        -o /dev/null \
        -w '%{redirect_url}' \
        "${APP_ORIGIN}/" 2>/dev/null || true
    )"
    validate_public_redirect_target "$public_redirect_url"
    success "Caddy 证书与 HTTPS 反向代理已通过检查"

    if [[ "$PROXY_MODE" == "cloudflare" ]]; then
      info "验证 Cloudflare 小黄云边缘入口"
      local cloudflare_ready="false"
      local response_headers_file=""
      local response_status=""
      response_headers_file="$(mktemp)"
      for _ in $(seq 1 30); do
        : > "$response_headers_file"
        response_status="$(
          curl \
            --connect-timeout 3 \
            --max-time 8 \
            -sS \
            -D "$response_headers_file" \
            -o /dev/null \
            -w '%{http_code}' \
            "${APP_ORIGIN}/api/health/ready" 2>/dev/null || true
        )"
        if [[ "$response_status" =~ ^2[0-9]{2}$ ]] &&
           grep -Eqi '^(cf-ray|server:[[:space:]]*cloudflare)' "$response_headers_file"; then
          cloudflare_ready="true"
          break
        fi
        sleep 2
      done
      rm -f "$response_headers_file"
      [[ "$cloudflare_ready" == "true" ]] ||
        fatal "Cloudflare 边缘入口尚未就绪。请确认 DNS 已开启小黄云、SSL/TLS 为 Full (strict)；首次签发期间关闭 Always Use HTTPS/重定向规则，并关闭会阻断 /api/health/ready 的 Access 或 WAF 规则。"
      success "Cloudflare 小黄云与 Full (strict) HTTPS 链路已通过检查"
    fi
  fi
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
    printf '\n  %s %s\n' "${GRAY}启动命令${RESET}" "${OUIH_COMMAND_PATH:-ouih} start"
  fi
  printf '  %s %s\n' "${GRAY}安装目录${RESET}" "$INSTALL_DIR"
  printf '  %s %s\n' "${GRAY}查看状态${RESET}" "${OUIH_COMMAND_PATH:-ouih} status"
  printf '  %s %s\n' "${GRAY}查看日志${RESET}" "${OUIH_COMMAND_PATH:-ouih} logs -f"
  printf '  %s %s\n' "${GRAY}停止服务${RESET}" "${OUIH_COMMAND_PATH:-ouih} stop"
  printf '  %s %s\n\n' "${GRAY}管理命令${RESET}" "${OUIH_COMMAND_PATH:-ouih}"
  if [[ "$PROXY_MODE" == "caddy" ]]; then
    success "HTTPS 证书由 Caddy 自动申请并续期"
  elif [[ "$PROXY_MODE" == "cloudflare" ]]; then
    success "Cloudflare 小黄云已启用，Caddy 自动维护受信源站证书"
  elif [[ "$PROXY_MODE" == "external" ]]; then
    warning "请将现有 HTTPS 反向代理转发到 127.0.0.1:${WEB_PORT}。"
  fi
  if [[ "$AUTO_START" == "true" ]]; then
    printf '%s\n' "${DIM}${GRAY}首次打开页面后，跟随图形向导创建站点管理员。${RESET}"
  fi
}

main() {
  trap 'on_error "$LINENO"' ERR
  trap 'printf "\n%s\n" "${YELLOW}安装已取消，没有删除现有数据。${RESET}"; exit 130' INT TERM
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
  install_management_command
  build_application
  start_application
  finish
}

if [[ -z "${BASH_SOURCE[0]-}" || "${BASH_SOURCE[0]-}" == "$0" ]]; then
  main "$@"
fi
