import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { seedPreview } from "./seed-local-preview.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = path.join(root, ".data/local-preview");
const stateFile = path.join(data, "process.json");
const children = [];
let stopping = false;

async function assertFree(port) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error(`本机端口 ${port} 已被占用，未修改或停止占用它的程序。`)));
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
  }
  await rm(stateFile, { force: true });
  const deadline = setTimeout(() => process.exit(code), 5000);
  deadline.unref();
  await Promise.all(children.map((child) => child.exitCode !== null ? Promise.resolve() : new Promise((resolve) => child.once("exit", resolve))));
  process.exit(code);
}
function start(args, environment) {
  const pnpm = process.env.npm_execpath;
  if (!pnpm) throw new Error("请使用 pnpm preview:local 启动预览。");
  const child = spawn(process.execPath, [pnpm, ...args], {
    cwd: root, detached: true, stdio: "inherit",
    env: { ...process.env, ...environment, NEXT_TELEMETRY_DISABLED: "1" }
  });
  children.push(child);
  child.once("exit", (code) => { if (!stopping) void stop(code || 1); });
}
async function ready(url) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("预览服务启动超时，请查看本机终端日志。");
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
try {
  await assertFree(3280); await assertFree(4280);
  await mkdir(data, { recursive: true });
  const keyFile = path.join(data, ".preview-key");
  let secret;
  try { secret = await readFile(keyFile, "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; secret = randomBytes(32).toString("hex"); await writeFile(keyFile, secret, { mode: 0o600 }); }
  await writeFile(stateFile, JSON.stringify({ pid: process.pid, root, startedAt: new Date().toISOString(), url: "http://127.0.0.1:3280" }), { mode: 0o600 });
  start(["--filter", "@ou-image/api", "exec", "tsx", "watch", "src/server.ts"], {
    NODE_ENV: "development", API_HOST: "127.0.0.1", API_PORT: "4280", APP_ORIGIN: "http://127.0.0.1:3280",
    OU_DATA_DIR: data, OU_SECRET_KEY: secret, COOKIE_SECURE: "false", EXPOSE_DEVELOPMENT_RESET_TOKEN: "true", TRUST_PROXY: "false"
  });
  await ready("http://127.0.0.1:4280/health");
  start(["--filter", "@ou-image/web", "exec", "next", "dev", "-H", "127.0.0.1", "-p", "3280"], {
    NODE_ENV: "development", OU_LOCAL_PREVIEW: "1", API_PROXY_TARGET: "http://127.0.0.1:4280", APP_ORIGIN: "http://127.0.0.1:3280"
  });
  await ready("http://127.0.0.1:3280/api/health");
  await seedPreview();
  console.log("\n本机预览：http://127.0.0.1:3280/library\n账号：preview@ou.local\n密码：OuPreview!2026Local\n按 Ctrl+C 或运行 pnpm preview:stop 停止。预览数据保留在 .data/local-preview/。\n");
} catch (error) { console.error(error.message); await stop(1); }
