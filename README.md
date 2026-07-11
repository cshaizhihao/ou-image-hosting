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
  <a href="#-适合谁">适合谁</a>
  ·
  <a href="#-它能做什么">功能介绍</a>
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

它想解决的事情很简单：  
你有很多图片，想自己保存、自己管理、自己生成外链，也希望这个过程不要像在维护一台冷冰冰的服务器。

所以它把公共上传、图片库、相册、分享链接、权限、存储、备份、反向代理和日常运维都放进一个尽量清楚、顺眼、可长期使用的界面里。

它不是追求复杂的大型网盘，也不是只有一个上传框的小工具。  
它更像一间自己的图片小屋：轻量、漂亮、可控，打开时不会有压力。

## ✨ 为什么做它

很多图床要么太简陋，要么太重，要么安装之后还要反复查日志、改配置、找端口、配反代。

欧记图床希望把这些琐碎事情收起来：

- 上传图片时，知道图片去哪了。
- 分享图片时，能快速拿到想要的链接格式。
- 打开后台时，界面不要丑得让人想关掉。
- 给访客上传时，权限边界要清楚。
- 服务器出问题时，能有一个好用的诊断入口。
- 用 Cloudflare 小黄云时，不要把 `:3000` 这种内部端口暴露给别人。

说白了，它想做一个“自己用也舒服，给别人看也不寒酸”的图床。

## 🐾 适合谁

- 写博客、文档、教程，需要稳定图片外链的人。
- 做个人站、作品集、知识库，想把图片资源放在自己服务器上的人。
- 经常整理截图、素材、封面图，希望有相册和批量管理的人。
- 想开放一个公共上传入口，但又不希望访客碰到后台的人。
- 想用 Cloudflare、R2、S3，但不想每一步都靠猜配置的人。
- 喜欢界面好看一点、文案有温度一点的小工具的人。

如果你只是想找一个“能传图就行”的脚本，它可能有点认真。  
如果你希望图床像一个长期维护的小产品，它会比较合适。

## 🖼️ 它能做什么

### 上传图片

你可以在公共页面或后台上传图片，支持拖拽、选择文件、粘贴图片和 URL 上传。

上传完成后，可以直接复制常用链接格式：

- 原图 URL
- Markdown
- HTML
- BBCode

如果是登录用户，还能在公共页面看到自己的上传历史，之后再决定哪些图片公开展示、哪些隐藏起来。

### 管理图片

后台图片库适合长期整理图片资产。

你可以搜索、筛选、分页浏览，也可以批量选择图片进行整理：

- 公开或隐藏图片
- 加入一个或多个相册
- 收藏常用图片
- 移入回收站
- 创建分享链接

图片浏览场景保留瀑布流和缩略图体验，管理操作则尽量使用弹窗、卡片和清晰的反馈，不把页面越撑越长。

### 建立相册

相册不是一个普通列表，而是图片的主分类。

每个相册可以设置描述、封面和排序方式，也可以从图片库批量加入图片。  
如果封面图片被移出或删除，系统会自动处理，不会留下失效封面。

### 开放公共图床

你可以把站点首页作为公共上传页面。

管理员可以决定：

- 是否允许访客上传
- 是否必须登录后才能上传
- 上传后是否默认公开
- 公共图库是否展示缩略图
- 是否显示上传者、文件名和上传时间

公共图库里的图片点击后会在当前页面用浮窗打开，不会跳到新页面。  
预览支持鼠标滚轮、键盘方向键、左右按钮和移动端滑动。

### 管理账号与权限

欧记图床把不同身份分得很清楚：

- 站点所有者：拥有最高管理权限。
- 子管理员：只能由站点所有者在后台手动添加或授权。
- 普通注册用户：只能使用公共图床和查看自己的上传历史。
- 未登录访客：只在管理员允许时才能上传。

普通用户不会因为注册账号就进入后台。  
后台也不会展示任何用户密码，只提供安全的密码重置方式。

### 配置存储

默认可以直接使用本地存储，也可以切换到：

- Amazon S3
- Cloudflare R2
- S3-compatible 存储

后台提供配置向导和连接测试。  
如果配置失败，会尽量告诉你是密钥、权限、桶、区域还是网络问题，而不是只给一个看不懂的错误。

## 🚀 快速开始

推荐使用 Debian / Ubuntu / CentOS / Rocky Linux / AlmaLinux / Fedora / Arch / openSUSE / Alpine。

安装器会自动检测并补齐常见依赖，包括 Git、curl、OpenSSL、Docker Engine 和 Docker Compose v2。

```bash
curl -fsSL https://raw.githubusercontent.com/cshaizhihao/ou-image-hosting/main/install.sh | bash
```

安装过程会引导你完成：

- 选择访问方式
- 设置站点地址
- 配置端口
- 生成生产密钥
- 启动 Docker 服务
- 安装 `ouih` 管理命令
- 检查服务健康状态

安装完成后，打开安装器给出的地址，创建第一个管理员账号即可使用。

## ☁️ Cloudflare 小黄云

如果你使用 Cloudflare 代理访问，推荐这样配置：

1. 在 Cloudflare DNS 中添加指向服务器公网 IP 的 `A` 记录。
2. 打开代理状态，也就是小黄云。
3. SSL/TLS 模式选择 **Full (strict)**。
4. 云厂商安全组和服务器防火墙放行 TCP `80` / `443`。
5. 安装时访问方式选择 **Cloudflare 小黄云**。

安装器会自动处理 Caddy 反向代理和源站证书，并尽量避免对外暴露内部端口。

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

它会帮你检查大多数常见问题，比如端口占用、DNS 指向、HTTPS、Caddy、Docker 状态和配置文件。

## 🎨 外观与品牌

欧记图床默认是一套柔和、干净、带一点猫咪气质的界面。

你也可以在后台自定义：

- 站点名称
- 副标题
- Logo
- 登录页文案
- 公共首页文案
- 浅色 / 深色 / 跟随系统
- 主题色

主题色会被限制在设计系统里，避免一不小心把界面改得太奇怪。  
Logo 会保持原始比例，不会被拉伸、重绘或变形。

## 🔒 安全与边界

欧记图床默认尽量保持“个人使用不打扰，公开使用有防护”。

你可以为公共上传配置：

- 每 IP 上传频率
- 每日上传数量
- 每日上传流量
- 简单人机验证
- IP 封禁
- 公共上传审计

系统也会处理上传文件名、远程 URL 上传、会话、CSRF 和后台权限校验。  
这些东西平时不需要你一直盯着，但在开放公共上传时会很有用。

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
