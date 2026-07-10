<p align="center">
  <img src="./docs/assets/logo/ou-image-hosting-logo.jpg" width="180" alt="OU-Image Hosting Logo" />
</p>

<h1 align="center">OU-Image Hosting</h1>

<p align="center">
  欧记图床：一个从零构建、以视觉体验为核心的现代自托管图床与图片资产管理平台。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-ef8f8f" alt="Version 0.1.0" />
  <img src="https://img.shields.io/badge/status-planning-303030" alt="Planning" />
  <img src="https://img.shields.io/badge/license-MIT-black" alt="MIT License" />
</p>

## 项目介绍

OU-Image Hosting 不只是一个上传图片并返回链接的工具，而是一套面向个人创作者、开发者和小型团队的图片工作台。

项目坚持三个原则：

1. **好看是产品能力**：视觉、排版、动效和反馈不是最后补上的装饰。
2. **上传必须高效**：拖拽、粘贴、批量队列、失败重试和一键复制需要形成完整工作流。
3. **图片必须好管理**：搜索、标签、相册、批量操作、存储策略和审计记录必须清晰可靠。

## 当前版本

当前版本：**v0.1.0**

当前阶段已完成：

- 品牌命名与 Logo 资产入库
- 品牌视觉规范初稿
- 十轮开发路线图
- 完整开发主 Prompt
- GitHub 仓库、版本与更新流程约定

应用代码将在后续轮次从零实现。当前版本不包含可运行服务。

## 计划功能

- 文件选择、拖拽、剪贴板和 URL 上传
- 多文件上传队列、实时进度、暂停、取消与失败重试
- 图片缩略图、格式转换、压缩、水印和元数据读取
- 图片库、相册、标签、收藏、搜索和批量操作
- URL、Markdown、HTML、BBCode 一键复制
- 本地磁盘、S3、Cloudflare R2 和其他 S3 兼容存储
- 自定义域名、签名链接、访问控制与防盗链
- 用户、团队、角色、审计日志和 API Token
- 流量、存储、上传趋势和热门图片统计
- Docker Compose 一键部署与完整安装文档

## 视觉方向

- Logo：用户提供的黑白猫形象
- 品牌色：炭黑、暖白、鼻尖粉
- 风格：轻量编辑器感、内容优先、清晰克制、带少量俏皮细节
- 圆角：以 8px 为主，不使用过度胶囊化和卡片套卡片
- 动效：160–320ms，强调操作结果与空间关系
- 图标：统一使用 Lucide 线性图标
- 主题：浅色优先，同时完整支持深色模式

详细规则见 [品牌规范](./docs/brand-guidelines.md)。

## 应用截图

v0.1.0 为规划基线版本，尚未生成应用界面。第 2 轮完成应用壳层后，README 将加入桌面端、移动端、浅色和深色截图。

当前品牌资产：

<p align="center">
  <img src="./docs/assets/logo/ou-image-hosting-logo.jpg" width="320" alt="欧记图床品牌 Logo" />
</p>

## 使用方式

当前版本用于确认产品、品牌和实施路线：

1. 阅读 [完整开发主 Prompt](./docs/MASTER_PROMPT.md)。
2. 阅读 [十轮开发路线图](./docs/ROADMAP.md)。
3. 阅读 [品牌规范](./docs/brand-guidelines.md)。
4. 从第 1 轮开始按版本顺序开发，每轮结束更新 README、截图和 CHANGELOG。

## 安装方式

当前 v0.1.0 尚未提供应用安装包。

目标安装方式将在部署轮次实现：

```bash
git clone https://github.com/cshaizhihao/ou-image-hosting.git
cd ou-image-hosting
cp .env.example .env
docker compose up -d
```

开发环境目标命令：

```bash
pnpm install
pnpm dev
```

在对应功能完成前，README 不会将这些命令标记为可用。

## 技术架构

计划采用独立原创实现：

- Web：Next.js、React、TypeScript、Tailwind CSS
- UI：Radix primitives、Lucide Icons、自有设计令牌与组件库
- API：Fastify、TypeScript、OpenAPI
- Database：PostgreSQL、Drizzle ORM
- Queue：Redis、BullMQ
- Image：Sharp
- Storage：Local、S3、Cloudflare R2、S3-compatible
- Testing：Vitest、Playwright
- Deployment：Docker Compose

## 开发与同步规则

每轮更新必须同时完成：

1. 完成该轮代码和测试。
2. 更新 `VERSION`。
3. 更新 `CHANGELOG.md`。
4. 更新 README 的版本、功能、使用方式、安装方式和截图。
5. 检查项目中不存在其他项目的名称、代码痕迹或品牌资产。
6. 提交 Git Commit 并推送到 GitHub `main`。
7. 在轮次总结中提供版本号、Commit Hash、测试结果和截图路径。

## 路线图

完整计划见 [ROADMAP.md](./docs/ROADMAP.md)。

| 轮次 | 版本 | 目标 |
|---|---:|---|
| 1 | v0.1.0 | 品牌、仓库、架构和开发规范 |
| 2 | v0.2.0 | 设计系统、应用壳层和身份界面 |
| 3 | v0.3.0 | 上传引擎和队列体验 |
| 4 | v0.4.0 | 图片库、筛选和批量操作 |
| 5 | v0.5.0 | 图片详情、编辑与分享 |
| 6 | v0.6.0 | 多存储、域名和链接策略 |
| 7 | v0.7.0 | 用户、团队、权限和安全 |
| 8 | v0.8.0 | 数据统计、活动记录和可观测性 |
| 9 | v0.9.0 | 设置中心、部署与完整文档 |
| 10 | v1.0.0 | 性能、测试、安全审计和正式发布 |

## License

[MIT](./LICENSE)
