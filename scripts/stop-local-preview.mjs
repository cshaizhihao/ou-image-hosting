import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  const state = JSON.parse(await readFile(path.join(root, ".data/local-preview/process.json"), "utf8"));
  if (state.root !== root || !Number.isSafeInteger(state.pid)) throw new Error("预览进程记录不符合当前项目。");
  const command = execFileSync("ps", ["-p", String(state.pid), "-o", "command="], { encoding: "utf8" });
  if (!command.includes("local-preview.mjs")) throw new Error("进程已变化，未停止其他程序。");
  process.kill(state.pid, "SIGTERM");
  console.log("已请求停止本项目的本地预览，图片与源码保留。");
} catch (error) {
  if (error.code === "ENOENT" || error.code === "ESRCH") console.log("当前没有记录到运行中的本地预览。");
  else { console.error(error.message); process.exitCode = 1; }
}
