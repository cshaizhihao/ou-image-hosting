<p align="center">
  <img src="./docs/assets/logo/ou-image-hosting-logo.jpg" width="148" alt="OU-Image Hosting Logo" />
</p>

<h1 align="center">OU-Image Hosting</h1>

<p align="center">
  <strong>欧记图床</strong> · 好看的图片，也值得被好好管理。
</p>

<p align="center">
  一个重视视觉、效率与安全边界的现代自托管图床。
</p>

<p align="center">
  <a href="https://github.com/cshaizhihao/ou-image-hosting/releases">
    <img src="https://img.shields.io/github/v/release/cshaizhihao/ou-image-hosting?style=flat-square&color=ef8f8f" alt="Release" />
  </a>
  <a href="https://github.com/cshaizhihao/ou-image-hosting/actions/workflows/check.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/cshaizhihao/ou-image-hosting/check.yml?branch=main&style=flat-square&label=check" alt="Check" />
  </a>
  <a href="https://github.com/cshaizhihao/ou-image-hosting/actions/workflows/docker.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/cshaizhihao/ou-image-hosting/docker.yml?branch=main&style=flat-square&label=docker" alt="Docker" />
  </a>
  <img src="https://img.shields.io/badge/Next.js-15-111111?style=flat-square" alt="Next.js 15" />
  <img src="https://img.shields.io/badge/license-MIT-111111?style=flat-square" alt="MIT License" />
</p>

<p align="center">
  <a href="#一键安装">一键安装</a>
  ·
  <a href="#功能一览">功能一览</a>
  ·
  <a href="./docs/deployment.md">部署文档</a>
  ·
  <a href="./docs/backup-restore.md">备份恢复</a>
</p>

<br />

<p align="center">
  <img src="./docs/screenshots/ou-image-hosting-main.png" width="100%" alt="OU-Image Hosting 主界面" />
</p>

## 这是什么

OU-Image Hosting 不只是一个生成图片外链的上传框。

它把上传、整理、编辑、版本、分享、团队权限、数据统计、备份恢复与系统状态放进同一个清晰、克制、好看的工作台，适合个人创作者、开发者与小型团队部署在自己的服务器上。

## 为什么选择它

<table>
  <tr>
    <td width="50%">
      <strong>✦ 视觉不是装饰</strong><br />
      浅色、深色、桌面与移动端使用同一套设计语言。界面强调内容、状态和操作反馈，不堆叠廉价渐变与无意义卡片。
    </td>
    <td width="50%">
      <strong>⇧ 上传是一条完整工作流</strong><br />
      支持拖拽、批量选择、剪贴板、URL、队列、暂停、重试、去重、缩略图与上传完成后一键复制链接。
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong>⌘ 图片真正可管理</strong><br />
      网格与列表、搜索、格式筛选、相册、标签、收藏、回收站、批量操作和滚动位置恢复都围绕高频整理场景设计。
    </td>
    <td width="50%">
      <strong>↗ 分享保持可控</strong><br />
      提供 URL、Markdown、HTML、BBCode、二维码、访问统计、密码、有效期和随时撤销的公开分享。
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong>◎ 团队与安全边界明确</strong><br />
      多工作区、Owner/Admin/Editor/Viewer、API Token Scope、IP 白名单、TOTP、会话管理、通知和审计日志。
    </td>
    <td width="50%">
      <strong>◉ 部署后仍然好维护</strong><br />
      Docker 双容器、健康检查、系统状态、原子备份恢复、资源限制、优雅关闭和完整运维文档。
    </td>
  </tr>
</table>

## 一键安装

### 环境要求

- Linux 或 macOS
- Docker Engine 24+ / Docker Desktop
- Docker Compose v2
- Git、curl、OpenSSL

### 交互式安装

复制下面这一行到终端：

```bash
curl -fsSL https://raw.githubusercontent.com/cshaizhihao/ou-image-hosting/main/install.sh | bash
```

安装器使用品牌色和猫咪艺术字，并通过交互问答完成配置：

```text
       /\_/\
      ( o.o )      ██████╗ ██╗   ██╗
       > ^ <      ██╔═══██╗██║   ██║
                  ██║   ██║██║   ██║
                  ╚██████╔╝╚██████╔╝
                   ╚═════╝  ╚═════╝
              IMAGE HOSTING · 欧记图床
```

它会依次完成：

1. 检查 Git、curl、OpenSSL、Docker 与 Compose。
2. 询问安装目录、访问地址、监听端口和存储配额。
3. 克隆项目；重复执行时安全更新已有安装。
4. 生成权限为 `600` 的生产配置和 256-bit 随机密钥。
5. 升级时保留原加密密钥，并备份现有 `.env.production`。
6. 顺序构建 API 与 Web，避免两个镜像同时构建。
7. 启动容器并等待 readiness 健康检查通过。

安装完成后，打开安装器显示的地址，跟随页面向导创建站点和第一个管理员。

### 无人值守安装

使用默认配置安装到 `~/ou-image-hosting`：

```bash
curl -fsSL https://raw.githubusercontent.com/cshaizhihao/ou-image-hosting/main/install.sh \
  | bash -s -- --yes
```

指定公网域名、端口和空间配额：

```bash
curl -fsSL https://raw.githubusercontent.com/cshaizhihao/ou-image-hosting/main/install.sh \
  | bash -s -- \
      --yes \
      --origin https://img.example.com \
      --port 3080 \
      --quota-gb 20
```

查看全部参数：

```bash
curl -fsSL https://raw.githubusercontent.com/cshaizhihao/ou-image-hosting/main/install.sh \
  | bash -s -- --help
```

> 使用 HTTPS 域名时，仍需把 Nginx、Caddy 或其他反向代理转发到安装时选择的本机端口。

<details>
<summary><strong>手动使用 Docker Compose 安装</strong></summary>

```bash
git clone https://github.com/cshaizhihao/ou-image-hosting.git
cd ou-image-hosting

cp .env.production.example .env.production
openssl rand -hex 32
```

将随机值写入 `.env.production` 的 `OU_SECRET_KEY`，配置实际 `APP_ORIGIN`，然后：

```bash
COMPOSE_PARALLEL_LIMIT=1 docker compose --env-file .env.production build api
COMPOSE_PARALLEL_LIMIT=1 docker compose --env-file .env.production build web
docker compose --env-file .env.production up -d
curl --fail http://127.0.0.1:3000/api/health/ready
```

</details>

## 功能一览

### 图片工作流

- 本地选择、拖拽、剪贴板粘贴、URL 与批量上传
- 队列进度、暂停、继续、取消、失败重试与内容去重
- JPEG、PNG、WebP、GIF、AVIF 内容识别和尺寸限制
- EXIF 自动旋转、缩略图、格式转换、旋转与翻转
- 图片版本历史、恢复、重命名和原图访问

### 组织与分享

- 响应式网格/列表、搜索、格式筛选、排序和分页
- 相册、标签、收藏、回收站与批量管理
- URL、Markdown、HTML、BBCode 与二维码
- 密码保护、有效期、访问统计和分享撤销

### 团队与管理

- 多工作区与四级角色权限
- 精确 Scope 的 API Token、有效期与 IP/CIDR 白名单
- TOTP 双因素认证、恢复代码和活跃会话管理
- 通知偏好、免打扰、审计筛选与 CSV 导出
- 数据统计、系统状态、设置中心和后台任务

### 存储与运维

- 本地原图、缩略图、版本和物理空间统计
- S3、Cloudflare R2、S3-compatible 配置与迁移
- 自定义域名、链接模板、防盗链和签名 URL
- gzip 完整备份、严格校验、维护模式与原子恢复
- `/health/live`、`/health/ready` 与 Docker 健康检查

## 日常运维

默认安装目录为 `~/ou-image-hosting`。

```bash
cd ~/ou-image-hosting

# 查看状态
docker compose ps

# 实时日志
docker compose logs -f

# 停止 / 启动
docker compose stop
docker compose start

# readiness
curl --fail http://127.0.0.1:3000/api/health/ready
```

升级时重新执行一键安装命令即可。安装器会拒绝覆盖存在未提交修改的仓库，并在更新配置前创建备份。

> 不要执行 `docker compose down -v`，除非你明确要永久删除全部元数据、图片、版本、缩略图和卷内备份。

## 部署边界

- 当前元数据由单个 API 进程通过原子 JSON 文件管理，请只运行一个 API 副本。
- 当前图片读写的权威来源是 Docker 持久化卷中的本地存储。
- S3/R2 已支持安全配置、连接探测和迁移，但日常读写尚未切换到远端。
- PostgreSQL、Redis 与 CDN 变量用于状态探测，不代表业务已经启用这些组件。
- 正式公网部署应使用 HTTPS 反向代理，并把备份导出到服务器之外。

## 技术栈

| 层级 | 技术 |
|---|---|
| Web | Next.js 15、React 19、TypeScript、Tailwind CSS 4 |
| UI | Radix UI、Lucide、三层 Design Token、浅色/深色主题 |
| API | Fastify 5、Multipart、Cookie、Rate Limit、Node.js Crypto |
| Image | Sharp、版本原图、WebP 缩略图、SHA-256 去重 |
| Runtime | Docker Compose、非 root、只读根文件系统、健康检查 |
| Test | Vitest、Playwright、Axe |

## 文档

- [生产部署](./docs/deployment.md)
- [备份与恢复](./docs/backup-restore.md)
- [版本升级](./docs/upgrading.md)
- [故障排查](./docs/troubleshooting.md)
- [威胁模型](./docs/threat-model.md)
- [性能预算](./docs/performance.md)
- [品牌规范](./docs/brand-guidelines.md)

## 品牌

- Logo 使用用户提供的黑白猫原图，只按比例缩放，不重绘、不改色。
- 品牌色为炭黑、暖白与鼻尖粉。
- 标题使用 Swei Ax Sans CJK SC Black 授权网页子集，正文使用系统字体保证阅读体验。

## License

项目代码使用 [MIT License](./LICENSE)。

品牌展示字体子集使用 [SIL Open Font License 1.1](./apps/web/public/fonts/SIL-OFL-1.1.txt)。
