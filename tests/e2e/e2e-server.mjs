import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const dataDirectory = path.join(root, ".data", `playwright-${process.pid}`);
const children = [];
let stopping = false;
let stopPromise;

await rm(dataDirectory, { force: true, recursive: true });
await mkdir(dataDirectory, { recursive: true });

function start(command, args, environment) {
  const lowCpu = process.env.OU_E2E_LOW_CPU === "1";
  const launchCommand = lowCpu
    ? path.join(root, "scripts", "run-low-cpu.sh")
    : command;
  const launchArgs = lowCpu ? [command, ...args] : args;
  const child = spawn(launchCommand, launchArgs, {
    cwd: root,
    detached: true,
    env: { ...process.env, ...environment },
    stdio: "ignore"
  });
  children.push(child);
  child.once("exit", (code, signal) => {
    if (!stopping) {
      console.error(
        `[e2e-server] ${command} exited unexpectedly (${signal ?? code})`
      );
      void stop(code ?? 1);
    }
  });
  return child;
}

async function waitFor(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The one-shot server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function stop(exitCode = 0) {
  if (stopPromise) return stopPromise;
  stopping = true;
  stopPromise = (async () => {
    const hardExit = setTimeout(() => process.exit(exitCode || 1), 5_000);
    try {
      await Promise.all(children.map((child) => terminateProcessGroup(child)));
      await rm(dataDirectory, { force: true, recursive: true });
    } finally {
      clearTimeout(hardExit);
      process.exit(exitCode);
    }
  })();
  return stopPromise;
}

async function terminateProcessGroup(child) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 750));
  try {
    process.kill(-child.pid, 0);
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

process.once("SIGINT", () => void stop(0));
process.once("SIGTERM", () => void stop(0));
process.once("SIGHUP", () => void stop(0));

start(
  "pnpm",
  ["--filter", "@ou-image/api", "exec", "tsx", "src/server.ts"],
  {
    API_PORT: "4100",
    APP_ORIGIN: "http://localhost:3100",
    COOKIE_SECURE: "false",
    EXPOSE_DEVELOPMENT_RESET_TOKEN: "true",
    NODE_ENV: "development",
    OU_DATA_DIR: dataDirectory,
    OU_SECRET_KEY: "playwright-only-secret-key-32-bytes"
  }
);

await waitFor("http://127.0.0.1:4100/health");

start(
  "pnpm",
  [
    "--filter",
    "@ou-image/web",
    "exec",
    "next",
    "dev",
    "-H",
    "127.0.0.1",
    "-p",
    "3100"
  ],
  {
    API_PROXY_TARGET: "http://127.0.0.1:4100",
    NODE_ENV: "development",
    PORT: "3100"
  }
);

await new Promise(() => {});
