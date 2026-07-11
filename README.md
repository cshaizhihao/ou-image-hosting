<p align="center">
  <img src="./docs/assets/logo/ou-image-hosting-logo.jpg" width="150" alt="OU-Image Hosting Logo" />
</p>

<h1 align="center">OU-Image Hosting</h1>

<p align="center">
  <strong>欧记图床</strong> · 把图片放进来，剩下的交给队列 🐾
</p>

<p align="center">
  一个好看、有温度、现代、适合长期自托管的图片资产管理工具。
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
  <a href="#-一键安装">一键安装</a>
  ·
  <a href="#-功能亮点">功能亮点</a>
  ·
  <a href="#-运维命令">运维命令</a>
  ·
  <a href="./docs/deployment.md">部署文档</a>
  ·
  <a href="./docs/backup-restore.md">备份恢复</a>
</p>

<br />

<p align="center">
  <img src="./docs/screenshots/ou-image-hosting-main.png" width="100%" alt="OU-Image Hosting 主界面" />
</p>

## ✨ 这是什么

OU-Image Hosting / 欧记图床，是一个面向个人创作者、开发者和小团队的自托管图床。

它不是一个冷冰冰的上传框，而是一个认真对待“图片管理体验”的小型图片资产工作台：上传、整理、相册、公共图床、分享、权限、统计、备份、恢复和服务器运维，都放在一个清晰、可爱但克制的界面里。

如果你想要一个自己掌控数据、界面顺眼、安装不折腾、后期也好维护的图床，它就是为这个场景做的。

## 🌷 设计气质

- 🐱 **可爱但不幼稚**：猫咪 Logo、柔和品牌色、温暖文案，但不堆装饰。
- 🧭 **清楚比炫技重要**：上传、整理、分享、设置都尽量少绕路。
- 🪄 **动效只服务反馈**：弹窗、菜单、预览和状态切换更丝滑，但不抢戏。
- 🖥️ **100% 缩放也好读**：后台字号、间距和桌面布局按真实使用场景调过。
- 🔒 **边界分明**：访客、注册用户、子管理员、站点所有者权限明确，不混在一起。

## 🚀 一键安装

> 推荐系统：Debian / Ubuntu / CentOS / Rocky Linux / AlmaLinux / Fedora / Arch / openSUSE / Alpine。
>
> 安装器会自动检测并补齐常见依赖，包括 Git、curl、OpenSSL、Docker Engine 和 Docker Compose v2。

```bash
curl -fsSL https://raw.githubusercontent.com/cshaizhihao/ou-image-hosting/main/install.sh | bash
```

安装器会用交互式向导完成这些事：

- 🧩 检测系统、包管理器和缺失依赖
- 🐳 安装或检查 Docker / Compose
- 🌐 选择本地访问、公网 HTTPS 域名或 Cloudflare 小黄云模式
- 🔐 生成生产密钥和 `.env.production`
- 🧱 顺序构建 API 与 Web，降低小机器 CPU 压力
- 🪪 安装全局管理命令 `ouih`
- ✅ 启动服务并检查访问地址、反向代理、HTTPS 和健康状态

安装完成后，打开安装器给出的地址，创建第一个管理员账号即可开始使用。

## ☁️ Cloudflare 小黄云部署

如果你希望用 Cloudflare 代理访问：

1. 在 Cloudflare DNS 中添加指向服务器公网 IP 的 `A` 记录。
2. 打开代理状态，也就是小黄云。
3. SSL/TLS 模式选择 **Full (strict)**。
4. 云厂商安全组与服务器防火墙放行 TCP `80` / `443`。
5. 运行一键安装，访问方式选择 **Cloudflare 小黄云**。

安装器会自动部署 Caddy 源站证书，并检查 Cloudflare 边缘访问结果，避免页面暴露内部 `:3000` 端口。

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

## 🖼️ 功能亮点

### 上传与公共图床

- 拖拽、选择文件、剪贴板粘贴和 URL 上传
- 上传前队列预览，单张图片可改名
- 上传后批量复制 URL、Markdown、HTML、BBCode
- 可直接加入相册、标签，并选择是否公开展示
- 公共上传首页支持访客直传或登录后上传
- 登录用户可在公共页查看自己的上传历史
- 公共图库支持最新、最热、随机、格式筛选
- 缩略图点击后站内浮窗预览，不跳出新页面
- 预览支持左右按钮、键盘方向键、鼠标滚轮和移动端滑动

### 图片管理

- 图片库支持搜索、格式筛选、分页、网格/列表切换
- 多选后可批量公开、隐藏、收藏、加入多个相册、移入回收站
- 图片卡片显示公开状态、相册数量和收藏状态
- 相册可创建、排序、描述、封面自定义、批量补图和批量移出
- 回收站支持恢复和永久删除
- 分享链接支持复制、撤销、访问统计、密码和有效期

### 账号与权限

- 唯一站点所有者负责最高权限
- 普通注册用户只能使用公共图床和自己的上传历史
- 子管理员只能由站点所有者在后台手动授权
- 后台可查看注册账号、停用账号、授权/撤销子管理员
- 可生成一次性密码重置链接，但不会显示或读取用户密码
- API Token 支持作用域、有效期和 IP/CIDR 白名单
- 支持 TOTP 双因素认证、恢复代码和活跃会话管理

### 品牌与外观

- 后台可自定义站点名称、副标题、Logo
- 可自定义登录页文案、公共首页标题和描述
- 支持浅色、深色、跟随系统
- 支持受控主题色，避免把界面改得太怪
- Logo 保持原始比例，不拉伸、不重绘、不 AI 化

### 存储与运维

- 本地存储开箱即用
- Amazon S3 / Cloudflare R2 / S3-compatible 配置向导
- 连接测试能区分权限、密钥、桶、区域和网络问题
- 支持本地到 S3 / R2 的迁移进度展示
- 自动备份、手动备份、恢复前预检和原子恢复
- Docker Compose 三服务：API、Web、Caddy
- `/health/live`、`/health/ready` 与容器健康检查

## 🛡️ 安全与防滥用

- 公共上传可设置匿名/登录用户的每 IP 分钟限制、每日张数和每日流量
- 可开启短时效算术验证，默认关闭，不打扰个人使用
- 支持 IP 封禁和公共上传审计
- 上传文件名会清理控制字符、零宽字符、双向文本字符和异常空白
- 远程 URL 上传会阻断私网、保留地址、IPv4-mapped IPv6 与 DNS rebinding 风险
- Cookie 会话、CSRF Origin 检查、权限门禁和审计记录均在服务端执行

## 🧑‍🔧 运维命令

安装后可直接使用：

```bash
ouih
```

常用命令：

```bash
ouih status      # 查看容器与服务状态
ouih logs        # 查看日志
ouih start       # 启动服务
ouih stop        # 停止服务
ouih update      # 更新到最新版本
ouih doctor      # 诊断 Docker、端口、DNS、HTTPS、Caddy、磁盘、内存和配置
ouih backup      # 创建本机数据卷备份
ouih restore     # 恢复备份
ouih rollback    # 回退最近一次成功更新
ouih url         # 显示访问地址
ouih dir         # 显示安装目录
ouih uninstall   # 卸载服务
```

每个菜单动作执行后会停留在结果页，按任意键返回上级菜单，方便排查问题。

## 📦 技术栈

- **Frontend**：Next.js 15、React 19、Radix UI、CSS Modules
- **Backend**：Fastify、TypeScript、Sharp
- **Storage**：Local filesystem、Amazon S3、Cloudflare R2、S3-compatible
- **Runtime**：Docker Compose、Caddy
- **Quality**：Vitest、Playwright、GitHub Actions

## 📚 文档

- [部署文档](./docs/deployment.md)
- [备份与恢复](./docs/backup-restore.md)
- [安全模型](./docs/threat-model.md)
- [v1.0.0 发布说明](./docs/releases/v1.0.0.md)

## 🗺️ 适合谁

- 想把图片放在自己服务器上的个人用户
- 需要稳定图片外链的博客、文档、论坛、知识库维护者
- 希望给小团队统一管理素材和相册的创作者
- 不想每次维护图床都翻命令行日志的人

## 🤍 License

MIT License。

希望它像一只靠谱的小猫一样，安静、漂亮、会帮你把图片看好。
