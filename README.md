<p align="center">
  <img src="./docs/assets/logo/ou-image-hosting-logo.jpg" width="180" alt="OU-Image Hosting Logo" />
</p>

<h1 align="center">OU-Image Hosting</h1>

<p align="center">
  欧记图床：一个从零构建、以视觉体验为核心的现代自托管图床与图片资产管理平台。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-ef8f8f" alt="Version 1.0.0" />
  <img src="https://img.shields.io/badge/progress-10%20%2F%2010-303030" alt="Round 10 of 10" />
  <img src="https://img.shields.io/badge/license-MIT-black" alt="MIT License" />
</p>

## 项目介绍

OU-Image Hosting 面向个人创作者、开发者和小型团队，目标不是只做一个返回外链的上传框，而是提供完整、清晰、耐看的图片工作台。

项目坚持三个原则：

1. **好看是产品能力**：排版、状态、主题与交互反馈从第一轮进入工程。
2. **上传必须高效**：拖拽、批量队列、重试和复制链接需要形成连续工作流。
3. **图片必须好管理**：搜索、标签、相册、批量操作、存储策略和审计记录必须清晰可靠。

## 当前版本

当前版本：**v1.0.0**

十轮开发已经全部完成：

- 提供安装、认证、上传、图库、图片编辑与版本、公开分享、相册、标签、收藏和回收站完整闭环
- 提供多工作区 RBAC、API Token、TOTP、会话、通知、审计、数据统计、系统状态和设置中心
- 新增 Docker Compose 双容器部署、只读根文件系统、健康检查、资源配额、非 root 运行和 CI 镜像流程
- 新增运行时流式 `/api/*` 同源代理，部署时可通过 `API_PROXY_TARGET` 切换内部 API 地址，无需重新构建 Web
- 备份恢复使用维护门、严格归档边界、原子目录切换与失败回滚；readiness 在恢复期间返回 503
- 生产启动校验随机密钥、HTTPS Origin 和重置令牌设置，并支持 SIGTERM/SIGINT 30 秒优雅关闭
- 接入用户提供的 Swei Ax Sans CJK SC Black 授权网页子集，仅用于品牌标题和关键数字，Logo 原图保持不变
- 完成键盘焦点、读屏、reduced-motion、浅色/深色与 375/768/1024/1440 响应式回归
- 40 个自动化测试通过，24 个业务页面与运行时 API 路由完成生产构建，生产依赖审计无已知漏洞
- 本地生产性能实测：API live p95 2.0 ms、ready p95 5.0 ms、Web 登录页 p95 6.6 ms

## 应用截图

### v1.0.0 最终界面

<p align="center">
  <img src="./docs/screenshots/v1.0.0-upload.png" width="49%" alt="OU-Image Hosting 最终上传工作台" />
  <img src="./docs/screenshots/v1.0.0-command-palette.png" width="49%" alt="OU-Image Hosting 命令面板" />
</p>

<p align="center">
  <img src="./docs/screenshots/v1.0.0-settings.png" width="66%" alt="OU-Image Hosting 最终设置中心" />
  <img src="./docs/screenshots/v1.0.0-upload-mobile-dark.png" width="280" alt="OU-Image Hosting 移动端深色上传工作台" />
</p>

### 团队、API Token、通知与审计

<p align="center">
  <img src="./docs/screenshots/v0.9.0-team.png" width="49%" alt="OU-Image Hosting 团队成员与角色管理" />
  <img src="./docs/screenshots/v0.9.0-token-created.png" width="49%" alt="OU-Image Hosting API Token Scope 与 IP 白名单" />
</p>

<p align="center">
  <img src="./docs/screenshots/v0.9.0-notifications.png" width="49%" alt="OU-Image Hosting 站内通知抽屉" />
  <img src="./docs/screenshots/v0.9.0-notification-settings.png" width="49%" alt="OU-Image Hosting 通知分类与免打扰设置" />
</p>

<p align="center">
  <img src="./docs/screenshots/v0.9.0-audit.png" width="66%" alt="OU-Image Hosting 审计日志筛选与 CSV 导出" />
  <img src="./docs/screenshots/v0.9.0-team-mobile-dark.png" width="280" alt="OU-Image Hosting 移动端深色团队管理" />
</p>

### 存储、分发与备份

<p align="center">
  <img src="./docs/screenshots/v0.8.0-storage-overview.png" width="49%" alt="OU-Image Hosting 存储提供商与容量控制台" />
  <img src="./docs/screenshots/v0.8.0-delivery-security.png" width="49%" alt="OU-Image Hosting 防盗链与签名链接设置" />
</p>

<p align="center">
  <img src="./docs/screenshots/v0.8.0-backups.png" width="66%" alt="OU-Image Hosting 完整备份与恢复" />
  <img src="./docs/screenshots/v0.8.0-storage-mobile-dark.png" width="280" alt="OU-Image Hosting 移动端深色存储控制台" />
</p>

### 相册、标签与图片整理

<p align="center">
  <img src="./docs/screenshots/v0.7.0-albums.png" width="49%" alt="OU-Image Hosting 相册与封面管理" />
  <img src="./docs/screenshots/v0.7.0-tags.png" width="49%" alt="OU-Image Hosting 标签与合并管理" />
</p>

<p align="center">
  <img src="./docs/screenshots/v0.7.0-image-organization.png" width="75%" alt="OU-Image Hosting 图片收藏相册标签整理" />
</p>

### 收藏与回收站

<p align="center">
  <img src="./docs/screenshots/v0.7.0-favorites.png" width="49%" alt="OU-Image Hosting 收藏页" />
  <img src="./docs/screenshots/v0.7.0-trash.png" width="49%" alt="OU-Image Hosting 回收站" />
</p>

<p align="center">
  <img src="./docs/screenshots/v0.7.0-favorites-mobile-dark.png" width="280" alt="OU-Image Hosting 移动端深色收藏页" />
</p>

### 图片详情、版本与分享

<p align="center">
  <img src="./docs/screenshots/v0.6.0-share-password.png" width="49%" alt="OU-Image Hosting 密码保护分享页" />
  <img src="./docs/screenshots/v0.6.0-share-view.png" width="49%" alt="OU-Image Hosting 公开分享查看页" />
</p>

### 图片库

<p align="center">
  <img src="./docs/screenshots/v0.5.0-library-grid.png" width="49%" alt="OU-Image Hosting 图片库网格视图" />
  <img src="./docs/screenshots/v0.5.0-library-list-selected.png" width="49%" alt="OU-Image Hosting 图片库列表选中态" />
</p>

<p align="center">
  <img src="./docs/screenshots/v0.5.0-library-mobile-dark.png" width="280" alt="OU-Image Hosting 移动端深色图片库" />
</p>

### 上传工作台

<p align="center">
  <img src="./docs/screenshots/v0.4.0-upload-desktop.png" width="49%" alt="OU-Image Hosting 桌面上传队列" />
  <img src="./docs/screenshots/v0.4.0-url-upload-dialog.png" width="49%" alt="OU-Image Hosting URL 上传对话框" />
</p>

<p align="center">
  <img src="./docs/screenshots/v0.4.0-upload-mobile-dark.png" width="280" alt="OU-Image Hosting 移动端深色上传队列" />
</p>

### 安装与初始化

<p align="center">
  <img src="./docs/screenshots/v0.3.0-install-light.png" width="49%" alt="OU-Image Hosting 环境检查" />
  <img src="./docs/screenshots/v0.3.0-install-config.png" width="49%" alt="OU-Image Hosting 站点配置" />
</p>

### 首次引导与工作区

<p align="center">
  <img src="./docs/screenshots/v0.3.0-onboarding-light.png" width="49%" alt="OU-Image Hosting 首次使用引导" />
  <img src="./docs/screenshots/v0.3.0-workspace-authenticated.png" width="49%" alt="OU-Image Hosting 已登录工作区" />
</p>

### 移动端深色模式

<p align="center">
  <img src="./docs/screenshots/v0.3.0-login-mobile-dark.png" width="280" alt="OU-Image Hosting 移动端深色登录页" />
</p>

## 快速开始

### Docker Compose（推荐）

生产部署使用 Web 与 API 双容器，只有 Web 端口绑定到宿主机回环地址：

```bash
git clone https://github.com/cshaizhihao/ou-image-hosting.git
cd ou-image-hosting
cp .env.production.example .env.production
openssl rand -hex 32
```

把生成的随机值写入 `.env.production` 的 `OU_SECRET_KEY`，并把 `APP_ORIGIN` 改为实际 HTTPS 域名，然后执行：

```bash
COMPOSE_PARALLEL_LIMIT=1 docker compose --env-file .env.production build
docker compose --env-file .env.production up -d
docker compose ps
curl --fail http://127.0.0.1:3000/api/health/ready
```

完整生产说明见 [部署](./docs/deployment.md)、[备份恢复](./docs/backup-restore.md)、[升级](./docs/upgrading.md) 与 [故障排查](./docs/troubleshooting.md)。

### 环境要求

- Node.js 20 或更高版本
- pnpm 9.15.9
- Linux、macOS 或 Windows

### 安装

```bash
git clone https://github.com/cshaizhihao/ou-image-hosting.git
cd ou-image-hosting
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install
cp .env.example .env
```

### 启动开发环境

终端 1 启动 API：

```bash
pnpm dev:api
```

终端 2 启动 Web：

```bash
pnpm dev
```

访问 `http://localhost:3000`。第一次打开时会自动进入安装向导：

1. 检查 Node.js、数据目录和加密能力。
2. 创建站点与第一个管理员账号。
3. 选择主题、决定是否开放用户注册。
4. 完成首次使用引导并进入上传工作台。

本地数据默认保存在 `.data/ou-image.json`，文件权限为 `0600`。该目录已加入 `.gitignore`。

### 上传图片

进入上传工作台后可以：

1. 点击或拖入多张图片。
2. 在任意位置粘贴剪贴板中的图片。
3. 使用“图片地址”让服务端下载远程图片。
4. 在队列中暂停、继续、移除或重试单个任务。
5. 上传完成后复制可访问的原图地址。

原图保存在 `.data/storage/originals`，缩略图保存在 `.data/storage/thumbnails`。相同内容只保存一次。

### 管理图片库

进入“图片库”后可以：

1. 在网格和列表视图之间切换。
2. 按名称搜索，按格式筛选，并按时间、名称或大小排序。
3. 选择单张图片或当前页全部图片后批量移入回收站。
4. 直接打开原图；视图、筛选、排序和滚动位置会自动恢复。

### 编辑与分享

打开任意图片详情后可以：

1. 复制 URL、Markdown、HTML 或 BBCode。
2. 重命名、旋转、翻转或转换为 JPEG、PNG、WebP。
3. 从版本历史恢复任意版本，当前版本不会被删除。
4. 创建带密码和有效期的分享链接，并复制二维码。
5. 查看访问次数或随时撤销分享。

### 整理与回收

打开任意图片详情后可以直接加入收藏、选择多个相册和多个标签。独立管理页面还支持：

1. 创建相册、编辑名称与描述，并从相册图片中设置封面。
2. 创建带颜色的标签、修改标签信息，并把一个标签合并到另一个标签。
3. 在收藏页集中查看重要图片并一键移出收藏。
4. 在回收站批量恢复图片，或永久删除图片、全部版本和相关分享记录。
5. 删除相册或标签时只解除分类关系，不删除原始图片。

### 配置存储与分发

站点 Owner 可以在“存储”页面完成：

1. 查看本地文件数量、实际占用、文件系统容量和健康状态。
2. 配置并测试 Amazon S3、Cloudflare R2 或 S3-compatible 服务。
3. 将当前本地原图、缩略图和版本文件迁移到已验证的远端存储。
4. 设置自定义域名和包含 `{id}`、`{variant}` 或 `{path}` 的链接模板。
5. 开启 Referer 白名单、允许空 Referer 和带过期时间的签名 URL。
6. 创建、下载、恢复和删除完整 gzip 备份，并设置保留数量。

当前版本的实际图片写入与读取仍以本地存储为权威源；S3/R2 已支持安全配置、真实连接测试和本地到远端迁移，但不会显示虚假的“已切换活动存储”状态。

### 查看数据统计

具备 `analytics:read` 能力的工作区成员可以打开“数据统计”：

1. 在 7、30、90 天范围间切换，查看当前图片数、期间新增数、真实分享访问和原图版本占用。
2. “原图版本占用”统计去重后的原图版本物理文件，不包含 WebP 缩略图。
3. 趋势图只使用按日记录的新增图片和真实分享访问事件，不把历史累计访问伪装成每日曲线。
4. 当上传或分享访问只从某个版本开始完整记录时，页面会分别标明起始日期与未归因访问数。
5. 格式分布按当前有效图片数量计算，并同时展示当前版本原图大小；热门图片按所选范围内的真实分享访问排序。
6. 图表包含读屏可用的数据表摘要，空数据、加载失败和权限不足都有独立状态。

### 检查系统状态

“系统状态”、全站后台任务和失败任务重试仅站点 Owner 可访问：

1. 页面首次打开只读取最近一次已保存的检查结果，不会因为查看页面自动执行外部探测。
2. 点击“立即检查”后才会检查 JSON 元数据存储、本地文件系统、Sharp 图片处理和当前进程内任务队列。
3. PostgreSQL 与 Redis 当前不是元数据存储或任务队列的活动实现；即使填写连接变量，也只显示“已配置但当前未使用”。
4. CDN 只进行配置与端点可达性探测；探测通过不代表图片读取、写入或业务流量已经切换到 CDN。
5. “未配置”和“已配置但当前未使用”采用中性状态，不会被错误计入服务故障。
6. Owner 可以查看备份与存储迁移任务的完成、失败和进度状态，并在允许时重试失败任务。

### 配置站点与图片处理

打开“设置中心 → 站点与处理”可以查看当前生效配置：

1. 站点 Owner 可修改站点名称、站点描述与公开注册开关。
2. 所有工作区成员都可读取上传、处理、本地化和默认外观设置；只有工作区 Admin 或 Owner 可以保存。
3. 上传上限以 MB 编辑、以 bytes 提交，并单独显示受全局硬限制约束后的实际生效上限。
4. 可选择 JPEG、PNG、WebP、GIF、AVIF 允许格式，并设置处理质量和缩略图宽度。
5. 可设置 IANA 时区、简体中文或英文界面，以及浅色、深色或跟随系统的默认外观。
6. 个人资料、密码、TOTP、通知偏好和活跃会话继续保留在同一设置中心中。

### 团队协作与安全

登录后可通过“团队”“API Token”“审计日志”和“设置”完成：

1. 创建或切换工作区，邀请成员并分配 Owner、Admin、Editor、Viewer 角色。
2. 调整成员角色、移除成员，或由当前 Owner 安全转移工作区所有权。
3. 创建仅显示一次明文的 API Token，选择精确 Scope、有效期和 IP/CIDR 白名单。
4. 查看并撤销登录会话，启用 TOTP 双因素认证并妥善保存一次性恢复代码。
5. 配置安全、协作和系统通知偏好，以及跨午夜生效的免打扰时段。
6. 按成员、动作和时间筛选审计记录，由 Admin 或 Owner 导出 CSV。

API Token 固定绑定创建时的工作区，不能访问团队、安全设置或其他管理接口。Viewer 仅可读取；Editor 可管理图片内容；Admin 可管理成员、通知与审计；只有 Owner 能转移所有权和执行最高权限操作。

## 认证与密码重置

- 会话凭证通过 `HttpOnly`、`SameSite=Lax` Cookie 保存。
- 生产环境默认给 Cookie 添加 `Secure`，应通过 HTTPS 对外提供服务。
- 所有 Cookie 写请求校验 `Origin`；API Token 必须使用严格的 `Authorization: Bearer <token>`。
- 账号可启用 TOTP 双因素认证，恢复代码仅显示一次并采用原子消费。
- 安全设置页可查看当前登录会话、撤销其他设备，并管理通知偏好。
- 开发环境如需在页面直接进入密码重置流程，可设置 `EXPOSE_DEVELOPMENT_RESET_TOKEN=true`。
- 生产环境不会返回明文重置令牌。
- 找回密码接口始终返回相同文案，避免泄露邮箱是否已注册。

常用环境变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `API_PORT` | `4000` | Fastify 监听端口 |
| `PORT` | `3000` | Next.js 监听端口 |
| `APP_ORIGIN` | `http://localhost:3000` | 允许发起写请求的 Web 来源 |
| `API_PROXY_TARGET` | `http://127.0.0.1:4000` | Next.js 运行时流式同源 API 代理目标；修改后无需重建 Web |
| `OU_DATA_DIR` | `./.data` | 单机持久化数据目录 |
| `OU_STORAGE_QUOTA_BYTES` | `2147483648` | 本地图片存储配额，单位字节 |
| `OU_SECRET_KEY` | 无 | 加密 S3/R2 凭据并生成签名 URL；使用远端密钥或签名链接时必填 |
| `COOKIE_SECURE` | 生产为 `true` | 显式控制会话 Cookie 的 Secure 属性 |
| `EXPOSE_DEVELOPMENT_RESET_TOKEN` | `false` | 仅开发环境显示本地重置入口 |
| `TRUST_PROXY` | `false` | 是否信任明确配置的反向代理；启用时才读取转发 IP |
| `TRUST_PROXY_ADDRESSES` | 无 | 逗号分隔的可信代理 IPv4、IPv6 或 CIDR；`TRUST_PROXY=true` 时必填 |
| `DATABASE_URL` | 无 | PostgreSQL 探测配置；当前 JSON 元数据存储仍是活动实现 |
| `REDIS_URL` | 无 | Redis 探测配置；当前任务仍在单进程内执行 |
| `CDN_BASE_URL` | 无 | CDN 端点可达性探测；不代表图片流量已切换 |

如果使用 `next start` 在纯 HTTP 内网测试，需显式设置 `COOKIE_SECURE=false`；正式部署应保留 Secure 并由 HTTPS 反向代理提供服务。

反向代理部署时不要使用无限制的代理信任。示例：

```dotenv
TRUST_PROXY=true
TRUST_PROXY_ADDRESSES=127.0.0.1,10.0.0.0/24
```

## 验证与构建

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm audit --prod --audit-level=moderate
```

一次执行全部检查：

```bash
pnpm check
```

浏览器、无障碍与响应式回归：

```bash
OU_E2E_LOW_CPU=1 pnpm exec playwright test --workers=1
```

生产服务启动后运行顺序性能冒烟：

```bash
scripts/run-low-cpu.sh node scripts/performance-smoke.mjs
```

CPU 受限主机使用仓库提供的限速脚本：

```bash
scripts/run-low-cpu.sh pnpm check
```

该脚本将命令及其子进程限制在约 25% CPU。

## 技术架构

- Web：Next.js 15、React 19、TypeScript、Tailwind CSS 4
- UI：Radix UI primitives、Lucide Icons、自有 Design Token
- API：Fastify 5、Multipart、Cookie、Rate Limit、Node.js Crypto
- Image：Sharp 元数据、旋转/翻转、格式转换、版本原图与 WebP 缩略图
- Persistence：原子 JSON 元数据与本地原图/缩略图目录
- Operations：Docker Compose、生产健康检查、维护门、原子备份恢复、优雅关闭与 CI 镜像流程
- Proxy：Next.js Node Route Handler 运行时流式同源 API 代理
- Testing：Vitest、Playwright
- Workspace：pnpm Monorepo

计划中的后续集成：

- PostgreSQL 与 Drizzle ORM 的真实元数据读写切换
- Redis 与 BullMQ 的真实异步任务队列切换
- S3、Cloudflare R2 与 S3-compatible 存储的完整活动读写切换

## 视觉方向

- Logo：用户提供的黑白猫原图，界面只按比例缩放，不重绘、不生成变体
- 字体：Swei Ax Sans CJK SC Black 授权网页子集用于品牌标题，正文保留系统字体保证可读性
- 品牌色：炭黑、暖白、鼻尖粉
- 风格：轻量编辑器感、内容优先、清晰克制
- 圆角：以 8px 为主，避免过度胶囊化和卡片套卡片
- 动效：160–320ms，强调操作结果与空间关系
- 图标：统一使用 Lucide 线性图标
- 主题：浅色优先，完整支持深色模式

详细规则见 [品牌规范](./docs/brand-guidelines.md)。

## 十轮路线图

完整计划见 [ROADMAP.md](./docs/ROADMAP.md)。

| 轮次 | 版本 | 目标 |
|---|---:|---|
| 1 | v0.2.0 | 设计系统、应用壳层和工程基础（已完成） |
| 2 | v0.3.0 | 安装、认证与首次使用引导（已完成） |
| 3 | v0.4.0 | 上传引擎、队列与图片处理（已完成） |
| 4 | v0.5.0 | 图片库、筛选和批量操作（已完成） |
| 5 | v0.6.0 | 图片详情、编辑、分享与版本（已完成） |
| 6 | v0.7.0 | 相册、标签、收藏和回收站（已完成） |
| 7 | v0.8.0 | 存储、域名、防盗链与备份（已完成） |
| 8 | v0.9.0 | 团队、权限、API 与安全（已完成） |
| 9 | v1.0.0-rc.1 | 数据统计、系统状态与设置中心（已完成） |
| 10 | v1.0.0 | 质量收口、部署文档与正式发布（已完成） |

## 仓库规则

仅提交项目实现、正式设计资产、测试、部署和版本发布相关内容。会话记录、私人参考资料和临时分析文件不得入库。

每轮代码更新同时完成：

1. 功能、测试、构建与视觉检查。
2. `VERSION`、`CHANGELOG.md`、README 和截图更新。
3. 项目名称、私密内容与外部品牌痕迹审计。
4. Git Commit、版本 Tag 与 GitHub `main` 推送。

## License

[MIT](./LICENSE)

品牌展示字体子集遵循 [SIL Open Font License 1.1](./apps/web/public/fonts/SIL-OFL-1.1.txt)。
