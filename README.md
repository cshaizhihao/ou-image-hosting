<p align="center">
  <img src="./docs/assets/logo/ou-image-hosting-logo.jpg" width="144" alt="OU-Image Hosting Logo" />
</p>

<h1 align="center">OU-Image Hosting</h1>

<p align="center">
  <strong>欧记图床</strong> · 图片放好，页面也要好看 🐾
</p>

<p align="center">
  自托管图床 / 图片库 / 相册 / 公共上传 / R2 & S3 / 一键安装
</p>

<p align="center">
  <a href="https://github.com/cshaizhihao/ou-image-hosting/releases/latest">
    <img src="https://img.shields.io/badge/version-v1.0.0-ef8f8f?style=flat-square" alt="Current version v1.0.0" />
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
  <a href="#-快速开始">快速开始</a>
  ·
  <a href="#-预览">预览</a>
  ·
  <a href="#-能做什么">能做什么</a>
  ·
  <a href="#-日常维护">日常维护</a>
  ·
  <a href="./docs/deployment.md">部署文档</a>
</p>

## 🚀 快速开始

```bash
curl -fsSL https://raw.githubusercontent.com/cshaizhihao/ou-image-hosting/main/install.sh | bash
```

安装器会自动处理依赖、配置、反向代理和服务启动。完成后，打开提示里的访问地址，创建第一个管理员账号就能用。

Cloudflare 小黄云用户建议提前确认：DNS 已指向服务器 IP，SSL/TLS 为 **Full (strict)**，服务器放行 `80` / `443` 端口。安装时选择 Cloudflare 模式即可。

无人值守安装示例：

```bash
curl -fsSL https://raw.githubusercontent.com/cshaizhihao/ou-image-hosting/main/install.sh \
  | bash -s -- --yes --origin https://img.example.com --proxy cloudflare --port 3080
```

## 🖼️ 预览

<p align="center">
  <img src="./docs/screenshots/ou-image-hosting-main.png" width="100%" alt="OU-Image Hosting 主界面" />
</p>

## 🌷 这是什么

OU-Image Hosting / 欧记图床，是一个给个人创作者、开发者和小团队准备的自托管图床。

它不是网盘，也不是临时上传脚本。它更像一间自己的图片小屋：可以上传、整理、分享，也可以开放给别人使用；重要的是，后台和公共页都要顺眼、清楚、好维护。

## ✨ 能做什么

| 场景 | 内容 |
| --- | --- |
| 上传图片 | 拖拽、粘贴、URL、HEIC / HEIF、JPEG/HEIC + MOV Live Photo 动态片段、公共上传、登录后上传历史 |
| 分享外链 | 一键复制 URL、Markdown、HTML、BBCode |
| 整理图片 | 图片库、搜索、筛选、收藏、回收站、批量操作 |
| 管理相册 | 创建相册、设置封面、写描述、批量加入或移出图片 |
| 公共图床 | 访客上传、公开图库、站内浮窗预览、公开/隐藏切换、上传历史分页与批量删除 |
| 账号权限 | 管理员、子管理员、普通用户、访客边界分离 |
| 存储方式 | 本地存储、Amazon S3、Cloudflare R2、S3-compatible |
| 日常运维 | 更新、备份、恢复、回滚、诊断、日志查看 |

## 🧑‍🔧 日常维护

安装完成后，可以使用：

```bash
ouih
```

常用命令：

| 命令 | 用途 |
| --- | --- |
| `ouih status` | 查看服务状态 |
| `ouih logs` | 查看运行日志 |
| `ouih update` | 更新项目 |
| `ouih doctor` | 检查 Docker、端口、DNS、HTTPS、磁盘、内存和配置 |
| `ouih backup` | 创建备份 |
| `ouih restore` | 恢复备份 |
| `ouih rollback` | 回退最近一次成功更新 |
| `ouih url` | 查看访问地址 |
| `ouih dir` | 查看安装目录 |
| `ouih uninstall` | 卸载服务 |

网站打不开时，先跑：

```bash
ouih doctor
```

它会把常见问题先帮你过一遍。

## 🔒 安全边界

后台和公共上传默认分开。普通注册用户只能使用公共图床和查看自己的上传历史，游客上传不会混入管理员个人历史，也不会误进后台。

公共上传可以配置速率限制、每日额度、人机验证、IP 封禁和审计记录。后台不会展示用户密码，只提供重置入口。站点设置和站点外观已分开：常用上传开关更好找，品牌、主题色、公共页文案和三枚卖点卡片可折叠编辑；刷新时会用中性加载态避免默认文案和默认主题色闪烁。

## 📦 技术栈

- Next.js 15 / React 19 / Radix UI / CSS Modules
- Fastify / TypeScript / Sharp
- Docker Compose / Caddy
- Vitest / Playwright / GitHub Actions

## 📚 文档

- [部署文档](./docs/deployment.md)
- [备份与恢复](./docs/backup-restore.md)
- [安全模型](./docs/threat-model.md)
- [v1.0.0 发布说明](./docs/releases/v1.0.0.md)

## 🤍 License
MIT License。

如果它刚好让你的图片小屋舒服了一点，那就很好。
