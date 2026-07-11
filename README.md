<p align="center">
  <img src="./docs/assets/logo/ou-image-hosting-logo.jpg" width="150" alt="OU-Image Hosting Logo" />
</p>

<h1 align="center">OU-Image Hosting</h1>

<p align="center">
  <strong>欧记图床</strong> · 一间放图片的小屋，也可以很好看 🐾
</p>

<p align="center">
  现代、温柔、好维护的自托管图床与图片资产管理工具。
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
  <a href="#-为什么用它">为什么用它</a>
  ·
  <a href="#-功能一览">功能一览</a>
  ·
  <a href="#-日常维护">日常维护</a>
  ·
  <a href="./docs/deployment.md">部署文档</a>
</p>

<br />

<p align="center">
  <img src="./docs/screenshots/ou-image-hosting-main.png" width="100%" alt="OU-Image Hosting 主界面" />
</p>

## 🌷 这是什么

OU-Image Hosting / 欧记图床，是一个适合个人创作者、开发者和小团队使用的自托管图床。

它把上传、图片库、相册、公共图床、分享链接、权限、存储和日常运维放在一起，目标很简单：图片自己管，界面要顺眼，部署别太折腾。

如果你希望图床像一个可以长期使用的小产品，而不是临时拼起来的上传脚本，它会比较合适。

## 🚀 快速开始

推荐使用 Debian / Ubuntu / CentOS / Rocky Linux / AlmaLinux / Fedora / Arch / openSUSE / Alpine。

安装器会自动检测并补齐常见依赖，包括 Git、curl、OpenSSL、Docker Engine 和 Docker Compose v2。

```bash
curl -fsSL https://raw.githubusercontent.com/cshaizhihao/ou-image-hosting/main/install.sh | bash
```

安装完成后，打开安装器给出的地址，创建第一个管理员账号即可使用。

如果你使用 Cloudflare 小黄云，安装前建议先确认：DNS 已指向服务器 IP，SSL/TLS 模式为 **Full (strict)**，并且服务器已放行 `80` / `443` 端口。安装时选择 Cloudflare 模式即可，安装器会处理 Caddy 反向代理和源站证书。

## ✨ 为什么用它

很多图床都能上传图片，但真正长期用起来，麻烦往往不在“上传”本身，而在后面的整理、分享、权限、访问地址、备份和运维。

欧记图床更在意这些细节：

- 打开后台时，界面清楚、舒服，不像临时管理页。
- 上传之后，能快速复制 URL、Markdown、HTML、BBCode。
- 图片多了以后，可以用相册、搜索、筛选和批量操作慢慢整理。
- 开放访客上传时，普通用户不会误进后台。
- 用 Cloudflare 访问时，不会把内部端口暴露在页面里。
- 网站打不开时，可以先用 `ouih doctor` 查一遍常见问题。

它不是一个大而全的网盘，也不是只会生成外链的小脚本。它更像一间自己的图片小屋：轻量、漂亮、可控。

## 🐾 适合谁

- 写博客、文档、教程，需要稳定图片外链的人。
- 做个人站、作品集、知识库，想把图片放在自己服务器上的人。
- 经常整理截图、素材、封面图，希望有相册和批量管理的人。
- 想开放公共上传入口，但不希望访客碰到后台的人。
- 想用 Cloudflare、R2、S3，但不想每一步都靠猜配置的人。

## 🖼️ 功能一览

### 上传与分享

支持公共页面和后台上传，可拖拽、选择文件、粘贴图片或通过 URL 上传。上传完成后，可以直接复制原图 URL、Markdown、HTML 或 BBCode。

登录用户可以在公共页面看到自己的上传历史，并选择哪些图片公开展示、哪些隐藏起来。

### 图片库与相册

后台图片库支持搜索、筛选、分页浏览和批量整理。你可以批量公开/隐藏、加入相册、收藏、移入回收站或创建分享链接。

相册可以设置描述、封面和排序方式，也可以从图片库批量加入图片。封面图片失效时，系统会自动处理，不留下坏封面。

### 公共图床

站点首页可以作为公共上传页面。管理员可以决定是否允许访客上传、是否必须登录、上传后是否默认公开，以及公共图库是否展示缩略图。

公共图库点击图片后会在当前页面用浮窗打开，不跳新页面；支持鼠标滚轮、键盘方向键、左右按钮和移动端滑动。

### 账号与权限

权限边界按真实使用场景拆开：

- 站点所有者拥有最高管理权限。
- 子管理员只能由站点所有者在后台手动添加或授权。
- 普通注册用户只能使用公共图床和查看自己的上传历史。
- 未登录访客只在管理员允许时才能上传。

后台不会展示用户密码，只提供安全的密码重置方式。

### 存储与品牌

默认可直接使用本地存储，也可以配置 Amazon S3、Cloudflare R2 或 S3-compatible 存储。后台提供配置向导和连接测试，尽量把密钥、权限、桶、区域、网络问题说清楚。

站点名称、副标题、Logo、登录页文案、公共首页文案、浅色/深色模式和主题色都可以在后台调整。Logo 会保持原始比例，不会被拉伸、重绘或变形。

## 🧰 无人值守安装

使用默认配置：

```bash
curl -fsSL https://raw.githubusercontent.com/cshaizhihao/ou-image-hosting/main/install.sh \
  | bash -s -- --yes
```

指定域名、端口和空间配额：

```bash
curl -fsSL https://raw.githubusercontent.com/cshaizhihao/ou-image-hosting/main/install.sh \
  | bash -s -- \
      --yes \
      --origin https://img.example.com \
      --proxy cloudflare \
      --port 3080 \
      --quota-gb 20
```

查看全部参数：

```bash
curl -fsSL https://raw.githubusercontent.com/cshaizhihao/ou-image-hosting/main/install.sh \
  | bash -s -- --help
```

## 🧑‍🔧 日常维护

安装完成后，可以使用：

```bash
ouih
```

常用命令：

```bash
ouih status      # 查看服务状态
ouih logs        # 查看运行日志
ouih update      # 更新项目
ouih doctor      # 检查 Docker、端口、DNS、HTTPS、磁盘、内存和配置
ouih backup      # 创建备份
ouih restore     # 恢复备份
ouih rollback    # 回退最近一次成功更新
ouih url         # 查看访问地址
ouih dir         # 查看安装目录
ouih uninstall   # 卸载服务
```

如果网站打不开，建议先运行：

```bash
ouih doctor
```

它会帮你检查端口占用、DNS 指向、HTTPS、Caddy、Docker 状态和配置文件等常见问题。

## 🔒 安全与边界

欧记图床默认尽量保持“个人使用不打扰，公开使用有防护”。

公共上传可以配置每 IP 上传频率、每日上传数量、每日上传流量、简单人机验证、IP 封禁和上传审计。系统也会处理上传文件名、远程 URL 上传、会话、CSRF 和后台权限校验。

## 📦 技术栈

- Frontend：Next.js 15、React 19、Radix UI、CSS Modules
- Backend：Fastify、TypeScript、Sharp
- Storage：Local filesystem、Amazon S3、Cloudflare R2、S3-compatible
- Runtime：Docker Compose、Caddy
- Quality：Vitest、Playwright、GitHub Actions

## 📚 文档

- [部署文档](./docs/deployment.md)
- [备份与恢复](./docs/backup-restore.md)
- [安全模型](./docs/threat-model.md)
- [v1.0.0 发布说明](./docs/releases/v1.0.0.md)

## 🤍 License

MIT License。

如果它刚好帮你把图片收拾得更舒服一点，那就很好。
