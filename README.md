<p align="center">
  <img src="./docs/assets/logo/ou-image-hosting-logo.jpg" width="180" alt="OU-Image Hosting Logo" />
</p>

<h1 align="center">OU-Image Hosting</h1>

<p align="center">
  欧记图床：一个从零构建、以视觉体验为核心的现代自托管图床与图片资产管理平台。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.3.0-ef8f8f" alt="Version 0.3.0" />
  <img src="https://img.shields.io/badge/progress-2%20%2F%2010-303030" alt="Round 2 of 10" />
  <img src="https://img.shields.io/badge/license-MIT-black" alt="MIT License" />
</p>

## 项目介绍

OU-Image Hosting 面向个人创作者、开发者和小型团队，目标不是只做一个返回外链的上传框，而是提供完整、清晰、耐看的图片工作台。

项目坚持三个原则：

1. **好看是产品能力**：排版、状态、主题与交互反馈从第一轮进入工程。
2. **上传必须高效**：拖拽、批量队列、重试和复制链接需要形成连续工作流。
3. **图片必须好管理**：搜索、标签、相册、批量操作、存储策略和审计记录必须清晰可靠。

## 当前版本

当前版本：**v0.3.0**

第 2 / 10 轮已经完成：

- 三步首次安装向导与运行环境检查
- 管理员账号、站点名称、注册开关和默认主题配置
- 登录、开放注册、退出与七天安全会话
- 找回密码、30 分钟一次性重置令牌和旧会话撤销
- `scrypt` 密码散列、登录失败锁定、接口限流和日志脱敏
- 首次使用引导与浅色、深色、跟随系统主题偏好
- 同源 API 代理、认证路由保护和真实用户菜单
- JSON 文件持久化单机模式，可在后续迁移到 PostgreSQL
- 8 个单元/集成测试与完整浏览器端认证流程验证

## 应用截图

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

## 认证与密码重置

- 会话凭证通过 `HttpOnly`、`SameSite=Lax` Cookie 保存。
- 生产环境默认给 Cookie 添加 `Secure`，应通过 HTTPS 对外提供服务。
- 开发环境如需在页面直接进入密码重置流程，可设置 `EXPOSE_DEVELOPMENT_RESET_TOKEN=true`。
- 生产环境不会返回明文重置令牌；后续轮次会接入邮件通知适配器。
- 找回密码接口始终返回相同文案，避免泄露邮箱是否已注册。

常用环境变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `API_PORT` | `4000` | Fastify 监听端口 |
| `PORT` | `3000` | Next.js 监听端口 |
| `APP_ORIGIN` | `http://localhost:3000` | 允许发起写请求的 Web 来源 |
| `API_PROXY_TARGET` | `http://127.0.0.1:4000` | Next.js 同源 API 代理目标 |
| `OU_DATA_DIR` | `./.data` | 单机持久化数据目录 |
| `COOKIE_SECURE` | 生产为 `true` | 显式控制会话 Cookie 的 Secure 属性 |
| `EXPOSE_DEVELOPMENT_RESET_TOKEN` | `false` | 仅开发环境显示本地重置入口 |

如果使用 `next start` 在纯 HTTP 内网测试，需显式设置 `COOKIE_SECURE=false`；正式部署应保留 Secure 并由 HTTPS 反向代理提供服务。

## 验证与构建

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

一次执行全部检查：

```bash
pnpm check
```

CPU 受限主机使用仓库提供的限速脚本：

```bash
scripts/run-low-cpu.sh pnpm check
```

该脚本将命令及其子进程限制在约 25% CPU。

## 技术架构

- Web：Next.js 15、React 19、TypeScript、Tailwind CSS 4
- UI：Radix UI primitives、Lucide Icons、自有 Design Token
- API：Fastify 5、Cookie、Rate Limit、Node.js Crypto
- Persistence：原子写入 JSON 单机仓库
- Testing：Vitest、Playwright
- Workspace：pnpm Monorepo

计划中的后续集成：

- PostgreSQL 与 Drizzle ORM
- Redis 与 BullMQ
- Sharp 图片处理
- Local、S3、Cloudflare R2 与 S3-compatible 存储
- Docker Compose 与反向代理部署

## 视觉方向

- Logo：用户提供的黑白猫原图，界面只按比例缩放，不重绘、不生成变体
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
| 3 | v0.4.0 | 上传引擎、队列与图片处理 |
| 4 | v0.5.0 | 图片库、筛选和批量操作 |
| 5 | v0.6.0 | 图片详情、编辑、分享与版本 |
| 6 | v0.7.0 | 相册、标签、收藏和回收站 |
| 7 | v0.8.0 | 存储、域名、防盗链与备份 |
| 8 | v0.9.0 | 团队、权限、API 与安全 |
| 9 | v1.0.0-rc.1 | 数据统计、系统状态与设置中心 |
| 10 | v1.0.0 | 质量收口、部署文档与正式发布 |

## 仓库规则

仅提交项目实现、正式设计资产、测试、部署和版本发布相关内容。会话草稿、私人参考资料、AI 提示词和临时分析文件不得入库。

每轮代码更新同时完成：

1. 功能、测试、构建与视觉检查。
2. `VERSION`、`CHANGELOG.md`、README 和截图更新。
3. 项目名称、私密内容与外部品牌痕迹审计。
4. Git Commit、版本 Tag 与 GitHub `main` 推送。

## License

[MIT](./LICENSE)
