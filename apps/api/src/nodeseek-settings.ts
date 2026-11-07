import { randomBytes } from "node:crypto";

export function nodeSeekSettings() {
  const nonce = randomBytes(18).toString("base64");
  return {
    csp: `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; frame-ancestors 'self' https://www.nodeseek.com https://nodeseek.com; form-action 'none'; base-uri 'none'`,
    html: `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OU 图床设置</title>
<style nonce="${nonce}">
  :root {
    color-scheme: light;
    font: 14px/1.5 system-ui, sans-serif;
    --surface: #f5faf8;
    --ink: #183e34;
    --muted: #45665a;
    --line: #bfd8cf;
    --accent: #236953;
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 10px 16px 18px; background: var(--surface); color: var(--ink); }
  h1 { font-size: 19px; margin: 0 0 4px; }
  p { margin: 0 0 14px; color: var(--muted); }
  label { display: block; margin: 0 0 6px; font-weight: 650; }
  input {
    width: 100%; padding: 8px 10px; border: 1px solid var(--line);
    border-radius: 8px; background: #fff; color: var(--ink); font: inherit;
  }
  input::placeholder { color: #567167; }
  button {
    border: 1px solid var(--line); border-radius: 8px; padding: 7px 11px;
    background: #fff; color: var(--ink); font: inherit; font-weight: 600; cursor: pointer;
  }
  button[type=submit] { background: var(--accent); color: #fff; border-color: var(--accent); }
  :is(input, button):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button:disabled { opacity: .5; cursor: default; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .status { min-height: 1.5em; margin: 8px 0; font-size: 13px; }
</style>
</head>
<body>
<h1>OU 图床 · 上传凭据</h1>
<p>请粘贴这台图床的管理员发给你的上传凭据。</p>
<form>
  <label for="credential">NodeSeek 专用凭据</label>
  <input id="credential" type="password" autocomplete="off" spellcheck="false" placeholder="粘贴 ouh_ 开头的凭据" required disabled>
  <p class="status" role="status">正在连接插件…</p>
  <div class="actions">
    <button type="submit" disabled>保存凭据</button>
    <button id="clear" type="button" disabled>清除凭据</button>
  </div>
</form>
<script nonce="${nonce}">
  const allowed = new Set([location.origin, "https://www.nodeseek.com", "https://nodeseek.com"]);
  const form = document.querySelector("form");
  const credential = document.querySelector("#credential");
  const status = document.querySelector(".status");
  const save = document.querySelector("button[type=submit]");
  const clear = document.querySelector("#clear");
  let port;
  window.addEventListener("message", (event) => {
    if (port || event.source !== parent || !allowed.has(event.origin) ||
        event.data?.type !== "ou-nodeseek-settings" || !event.ports[0]) return;
    port = event.ports[0];
    status.textContent = event.data.configured ? "已配置凭据，可粘贴新凭据替换。" : "尚未配置凭据。";
    credential.disabled = save.disabled = false;
    clear.disabled = !event.data.configured;
    port.postMessage({ type: "ready" });
    credential.focus();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!event.isTrusted || !port) return;
    const value = credential.value.trim();
    if (!/^ouh_[a-f0-9]{12}_[A-Za-z0-9_-]+$/.test(value)) {
      status.textContent = "凭据格式无效，请复制完整的 NodeSeek 专用凭据。";
      return;
    }
    credential.value = "";
    port.postMessage({ type: "save", value });
  });
  clear.addEventListener("click", (event) => { if (event.isTrusted) port?.postMessage({ type: "clear" }); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") port?.postMessage({ type: "close" }); });
</script>
</body>
</html>`
  };
}
