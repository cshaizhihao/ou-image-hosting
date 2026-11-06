import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { addAuditEvent } from "./access.js";
import { hashPassword, normalizeEmail, validatePassword } from "./security.js";
import { AppStore } from "./store.js";

export async function recoverAccount(store: AppStore, email: string, password: string, resetMfa = false) {
  const issues = validatePassword(password);
  if (password.length > 128) issues.push("密码不能超过 128 个字符");
  if (issues.length) throw new Error(issues[0]);
  const normalized = normalizeEmail(email);
  const passwordHash = await hashPassword(password);
  const timestamp = new Date().toISOString();
  await store.update((state) => {
    const user = state.users.find((candidate) => candidate.email === normalized);
    if (!user) throw new Error("未找到该账号，未修改数据");
    if (user.disabledAt) throw new Error("该账号已停用，请先由管理员恢复账号状态");
    user.passwordHash = passwordHash;
    user.passwordUpdatedAt = timestamp;
    user.updatedAt = timestamp;
    user.failedLoginCount = 0;
    delete user.lockedUntil;
    if (resetMfa) {
      delete user.totpSecretCiphertext;
      delete user.totpEnabledAt;
      delete user.lastTotpStep;
      delete user.recoveryCodeHashes;
    }
    state.sessions = state.sessions.filter((session) => session.userId !== user.id);
    state.passwordResets = state.passwordResets.filter((reset) => reset.userId !== user.id);
    state.loginChallenges = state.loginChallenges.filter((challenge) => challenge.userId !== user.id);
    state.apiTokens.forEach((token) => { if (token.userId === user.id && !token.revokedAt) token.revokedAt = timestamp; });
    addAuditEvent(state, { global: true, action: "account.offline-recovery", result: "success", resourceType: "user", resourceId: user.id, metadata: { resetMfa }, createdAt: timestamp });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const usage = "node dist/recover-account.js --offline --email EMAIL --password-stdin [--reset-mfa]";
  if (args.includes("--help")) { console.log(usage); return; }
  const emailIndex = args.indexOf("--email");
  const email = args[emailIndex + 1];
  const allowed = new Set(["--offline", "--email", "--password-stdin", "--reset-mfa"]);
  if (!args.includes("--offline") || !args.includes("--password-stdin") || emailIndex < 0 || !email || email.startsWith("--") || args.some((arg, index) => index !== emailIndex + 1 && !allowed.has(arg))) {
    throw new Error(`先停止本项目 API，再运行：${usage}`);
  }
  if (process.stdin.isTTY) throw new Error("请通过标准输入传入新密码，不要放在命令行参数中");
  const statePath = path.join(process.env.OU_DATA_DIR ?? path.resolve(".data"), "ou-image.json");
  await access(statePath);
  let password = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    password += chunk;
    if (password.length > 256) throw new Error("密码输入过长");
  }
  password = password.replace(/\r?\n$/, "");
  const store = new AppStore(statePath);
  await store.initialize();
  await recoverAccount(store, email, password, args.includes("--reset-mfa"));
  console.log("账号密码已更新，旧会话、API Token 和重置请求已撤销。现在可启动本项目 API 并重新登录。");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "恢复失败"); process.exitCode = 1; });
}
