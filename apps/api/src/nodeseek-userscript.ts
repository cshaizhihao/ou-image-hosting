import { readFileSync } from "node:fs";

const browserScript = readFileSync(new URL("./nodeseek-client.user.js", import.meta.url), "utf8");

export function nodeSeekUserscript(origin: string) {
  const url = new URL(origin);
  const scriptUrl = `${url.origin}/api/integrations/nodeseek/install.user.js`;
  return [
    "// ==UserScript==",
    "// @name         OU 图床 · NodeSeek 上传",
    `// @namespace    ${url.origin}`,
    "// @version      1.1.1",
    "// @description  在 NodeSeek 粘贴、选图或 Shift＋右键上传图片，生成 Markdown。",
    "// @match        https://www.nodeseek.com/*",
    "// @match        https://nodeseek.com/*",
    `// @connect      ${url.hostname}`,
    "// @connect      nodeseek.com",
    "// @connect      *",
    "// @grant        GM_xmlhttpRequest",
    "// @grant        GM_registerMenuCommand",
    "// @grant        GM_getValue",
    "// @grant        GM_setValue",
    "// @grant        GM_setClipboard",
    "// @grant        unsafeWindow",
    `// @downloadURL  ${scriptUrl}`,
    `// @updateURL    ${scriptUrl}`,
    "// @sandbox      JavaScript",
    "// @run-at       document-idle",
    "// @noframes",
    "// ==/UserScript==",
    "",
    `(() => {\n${browserScript}\nrunNodeSeek(${JSON.stringify(url.origin)});\n})();`,
    ""
  ].join("\n");
}
