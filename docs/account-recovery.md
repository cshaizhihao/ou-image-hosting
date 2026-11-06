# 账号恢复

当前版本未接入邮件服务。找回密码页面会引导用户联系站点管理员，不会声称已发送邮件；生产环境不返回重置令牌。

有服务器权限的站点所有者可离线重置账号。先进入本项目部署目录，使用部署时相同的 Compose 文件、环境文件和项目名执行以下命令。只停止本项目的 `api`，不要停止整个 Docker 服务或其他项目。

```bash
docker compose stop api
read -rsp '新密码：' recovery_password
printf '\n'
printf '%s' "$recovery_password" | docker compose run --rm -T --no-deps api node dist/recover-account.js --offline --email admin@example.com --password-stdin
unset recovery_password
docker compose up -d api
```

将邮箱替换成目标账号。新密码需要 12–128 个字符，包含大小写字母、数字和特殊字符。密码通过标准输入传递，不应写到命令行参数或提交到仓库。必须在 API 停止期间修改 JSON 数据，避免覆盖正在进行的写入。

恢复会撤销该账号的旧会话、API Token、登录挑战和密码重置请求，保留图片、工作区和双因素认证。确实丢失双因素认证及恢复码时，可在上述命令末尾加 `--reset-mfa`；完成后重新绑定。停用账号不会被此工具重新启用。

开发者可用 `pnpm --filter @ou-image/api exec tsx src/recover-account.ts` 运行同一工具，参数相同。不要在本机预览运行期间对其数据使用此工具。
