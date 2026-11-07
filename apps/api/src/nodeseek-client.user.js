function runNodeSeek(apiOrigin) {
    const maximumBytes = 20 * 1024 * 1024;
    const tokenKey = "ou-nodeseek-upload-token";
    let menu;
    let toast;
    let toastTimer;
    function notify(message) {
        if (!toast) {
            toast = document.createElement("div");
            toast.setAttribute("role", "status");
            toast.style.cssText = "position:fixed;right:16px;bottom:16px;max-width:calc(100vw - 32px);z-index:2147483647;background:#202633;color:white;padding:12px 16px;border-radius:10px;font:14px system-ui;pointer-events:none";
            document.body.append(toast);
        }
        toast.textContent = message;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toast?.remove(); toast = undefined; }, 4800);
    }
    GM_registerMenuCommand("设置 OU 图床上传凭据", () => {
        const value = window.prompt("粘贴图床后台生成的 NodeSeek 上传凭据。留空可清除。");
        if (value === null)
            return;
        const token = value.trim();
        if (token && !/^ouh_[a-f0-9]{12}_[A-Za-z0-9_-]+$/.test(token)) {
            notify("凭据格式无效");
            return;
        }
        GM_setValue(tokenKey, token);
        notify(token ? "OU 图床凭据已保存" : "OU 图床凭据已清除");
    });
    function token() {
        const value = GM_getValue(tokenKey, "");
        if (!value)
            notify("请在脚本菜单设置 OU 图床上传凭据");
        return value;
    }
    function upload(value, credential) {
        const headers = { Authorization: `Bearer ${credential}` };
        let data;
        if (typeof value === "string") {
            headers["Content-Type"] = "application/json";
            data = JSON.stringify({ url: value });
        }
        else {
            if (value.size > maximumBytes)
                throw new Error("图片不能超过 20 MB");
            data = new FormData();
            data.append("file", value);
        }
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: `${apiOrigin}/api/integrations/nodeseek/uploads`,
                headers, data, anonymous: true, timeout: 90_000,
                onload(result) {
                    try {
                        const body = JSON.parse(result.responseText);
                        if (result.status >= 300 || result.status < 200 || typeof body.url !== "string") {
                            throw new Error(body.error?.message || `上传失败（HTTP ${result.status}）`);
                        }
                        const url = new URL(body.url, apiOrigin);
                        if (url.protocol !== "https:" && url.protocol !== "http:")
                            throw new Error("图床返回的链接无效");
                        const href = url.href.replace(/\(/g, "%28").replace(/\)/g, "%29");
                        resolve(`![图片](${href})`);
                    }
                    catch (error) {
                        reject(error);
                    }
                },
                onerror: () => reject(new Error("无法连接 OU 图床")),
                ontimeout: () => reject(new Error("上传超时"))
            });
        });
    }
    function editorFor(target) {
        if (!(target instanceof Element))
            return;
        const mirrorElement = target.closest(".CodeMirror");
        if (mirrorElement) {
            const element = mirrorElement;
            let mirror = (element.wrappedJSObject ?? element).CodeMirror;
            if (!mirror && typeof unsafeWindow !== "undefined") {
                const index = [...document.querySelectorAll(".CodeMirror")].indexOf(element);
                const pageElement = unsafeWindow.document.querySelectorAll(".CodeMirror").item(index);
                mirror = pageElement?.CodeMirror;
            }
            if (!mirror || typeof mirror.replaceRange !== "function")
                return;
            return {
                element,
                value: () => mirror.getValue(),
                selected: () => mirror.getSelection(),
                insert: (text) => mirror.replaceSelection(text),
                replace: (start, end, text) => mirror.replaceRange(text, mirror.posFromIndex(start), mirror.posFromIndex(end))
            };
        }
        if (!(target instanceof HTMLTextAreaElement) || target.readOnly || target.disabled ||
            !target.closest(".md-editor, #editor, #code-mirror-editor"))
            return;
        const replace = (start, end, text) => {
            target.setRangeText(text, start, end, "preserve");
            target.dispatchEvent(new Event("input", { bubbles: true }));
        };
        return {
            element: target,
            value: () => target.value,
            selected: () => target.value.slice(target.selectionStart, target.selectionEnd),
            insert: (text) => replace(target.selectionStart, target.selectionEnd, text),
            replace
        };
    }
    document.addEventListener("paste", async (event) => {
        if (!event.isTrusted || event.defaultPrevented)
            return;
        const editor = editorFor(event.target);
        const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
        if (!editor || !files.length)
            return;
        const credential = token();
        if (!credential)
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const marker = `<!-- OU 上传中 ${crypto.randomUUID()} -->`;
        const selection = editor.selected();
        editor.insert(marker);
        notify(`正在上传 ${files.length} 张图片`);
        const links = [];
        let failure = "";
        for (const file of files) {
            try {
                links.push(await upload(file, credential));
            }
            catch (error) {
                failure = error instanceof Error ? error.message : "上传失败";
            }
        }
        const position = editor.element.isConnected ? editor.value().indexOf(marker) : -1;
        if (position >= 0) {
            editor.replace(position, position + marker.length, links.length ? links.join("\n") : selection);
        }
        else if (links.length) {
            GM_setClipboard(links.join("\n"));
            notify("图片已上传，Markdown 已复制");
            return;
        }
        notify(failure ? `已上传 ${links.length}/${files.length} 张 · ${failure}` : `已插入 ${links.length} 张图片`);
    }, true);
    function closeMenu() {
        menu?.remove();
        menu = undefined;
    }
    document.addEventListener("pointerdown", (event) => {
        if (event.target !== menu)
            closeMenu();
    }, true);
    document.addEventListener("keydown", (event) => { if (event.key === "Escape")
        closeMenu(); });
    document.addEventListener("contextmenu", (event) => {
        closeMenu();
        if (!event.isTrusted || event.shiftKey || !(event.target instanceof HTMLImageElement))
            return;
        const source = event.target.currentSrc || event.target.src;
        let url;
        try {
            url = new URL(source, location.href);
        }
        catch {
            return;
        }
        if (!["https:", "http:", "data:", "blob:"].includes(url.protocol))
            return;
        event.preventDefault();
        menu = document.createElement("button");
        menu.type = "button";
        menu.textContent = "上传到 OU 图床并复制 Markdown";
        menu.style.cssText = "position:fixed;z-index:2147483647;background:#202633;color:white;border:0;border-radius:8px;padding:10px 12px;font:14px system-ui;cursor:pointer;max-width:calc(100vw - 16px)";
        document.body.append(menu);
        menu.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - menu.offsetWidth - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - menu.offsetHeight - 8))}px`;
        menu.focus();
        menu.addEventListener("click", async (click) => {
            if (!click.isTrusted)
                return;
            closeMenu();
            const credential = token();
            if (!credential)
                return;
            notify("正在上传图片");
            try {
                let value = url.href;
                if (url.origin === location.origin || url.protocol === "data:" || url.protocol === "blob:") {
                    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
                    if (!response.ok)
                        throw new Error("无法读取原图片");
                    const blob = await response.blob();
                    value = new File([blob], url.pathname.split("/").at(-1)?.slice(0, 100) || "nodeseek-image", { type: blob.type });
                }
                GM_setClipboard(await upload(value, credential));
                notify("图片已上传，Markdown 已复制");
            }
            catch (error) {
                notify(error instanceof Error ? error.message : "上传失败");
            }
        });
    }, true);
}
