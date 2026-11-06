# 在已有服务的 VPS 上隔离部署

当服务器已使用 80/443 时，可沿用主部署的 API、Web、数据卷和健康检查，叠加 `compose.tunnel.yml`，由独立 Cloudflare Tunnel 提供 HTTPS 入口。不要重载现有反向代理或启动 Caddy 的 `https` profile。

## 准备独立资源

使用新的部署目录和明确的 Compose 项目名，例如 `ouih-img-zze-cc`。先核对端口、Docker 子网、项目名和目录未被使用；默认后端子网为 `172.30.10.0/29`。不要覆盖现有目录、容器、配置、数据卷或网络。

根据 `.env.production.example` 创建权限为 `600` 的 `.env.production`，设置：

```dotenv
APP_ORIGIN=https://img.example.com
OU_PUBLIC_HOST=img.example.com
OU_PROXY_MODE=tunnel
WEB_BIND_HOST=127.0.0.1
WEB_BIND_PORT=20380
OU_API_IMAGE=ghcr.io/OWNER/ou-image-hosting-api@sha256:API_DIGEST
OU_WEB_IMAGE=ghcr.io/OWNER/ou-image-hosting-web@sha256:WEB_DIGEST
COOKIE_SECURE=true
EXPOSE_DEVELOPMENT_RESET_TOKEN=false
```

另行生成 `OU_SECRET_KEY`，保留部署时的原值。镜像应来自已通过 CI 的发布版本，并记录实际 digest。私有 GHCR 镜像只在拉取时使用临时 Docker 登录配置，不修改已有的 Docker 凭据配置。

## 启动与接入

1. 在 Cloudflare 新建仅用于本项目的 remotely managed tunnel。为目标主机名设置 ingress，服务地址为 `http://web:3000`，最后添加 `http_status:404` 兜底规则。
2. 将该隧道的运行令牌写入权限为 `600` 的 `.env.tunnel`：`TUNNEL_TOKEN=...`。不要把 Cloudflare 账户 API 令牌复制到 VPS。
3. 拉取镜像并启动独立项目：

```bash
docker compose -p ouih-img-zze-cc --env-file .env.production -f docker-compose.yml -f compose.tunnel.yml config --quiet
docker compose -p ouih-img-zze-cc --env-file .env.production -f docker-compose.yml -f compose.tunnel.yml pull api web cloudflared
docker compose -p ouih-img-zze-cc --env-file .env.production -f docker-compose.yml -f compose.tunnel.yml up -d --no-build --wait
```

4. 通过 VPS 本机的 `127.0.0.1:20380/api/setup` 完成初始化，再发布 DNS。初始化请求的 Origin 应与 `APP_ORIGIN` 一致；账号密码通过权限受限的 JSON 文件或标准输入传递，勿写入命令行参数。
5. 确认目标域名没有需要保留的旧记录，再创建 CNAME 到 `TUNNEL_ID.cfargotunnel.com`，设置 `proxied: true`（小黄云）。不修改其他域名解析。
6. 验证公网 HTTPS、登录、上传、原图、缩略图、分享与隧道状态，并对照部署前的容器 ID、运行时间和监听端口，确认已有服务未被重启或改变。

此模式不需要为本项目开放入站端口，也不需要更改现有服务。隧道需要访问 Cloudflare 的出站网络；若出站连接被限制，应先确认部署条件，不调整其他服务的防火墙配置。

## 更新、恢复与回退

所有命令都必须保留同一项目名、环境文件和两个 Compose 文件。更新前创建本项目数据卷快照，再替换两个镜像 digest 并执行 `up -d --no-build --wait`。回退到旧镜像时同时核对状态模式和对应快照。

账号恢复参照[恢复指南](./account-recovery.md)，在每条 Compose 命令中同样加入本节的项目名和文件参数。只操作本项目的 API，不停止 Docker daemon 或其他项目。

官方接口与运行方式参考 [Cloudflare Tunnel 文档](https://developers.cloudflare.com/tunnel/get-started/)。
