function runNodeSeek(apiOrigin) {
    const maximumBytes = 20 * 1024 * 1024;
    const tokenKey = "ou-nodeseek-upload-token";
    const tokenFormat = /^ouh_[a-f0-9]{12}_[A-Za-z0-9_-]+$/;
    const firefox = /Firefox\//.test(navigator.userAgent);
    const editorSelector = ".md-editor, #editor, #code-mirror-editor";
    const mountedEditors = new WeakMap();
    let menu;
    let settings;
    let toast;
    let toastTimer;

    function notify(message) {
        if (!toast) {
            toast = document.createElement("div");
            toast.setAttribute("role", "status");
            toast.style.cssText = "position:fixed;right:16px;bottom:16px;max-width:calc(100vw - 32px);z-index:2147483647;background:#f0faf5;color:#183e34;border:1px solid #bed8ce;box-shadow:0 4px 20px #15352b26;padding:12px 16px;border-radius:10px;font:14px system-ui;pointer-events:none";
            document.body.append(toast);
        }
        toast.textContent = message;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toast?.remove(); toast = undefined; }, 4800);
    }

    function button(label) {
        const control = document.createElement("button");
        control.type = "button";
        control.textContent = label;
        control.style.cssText = `
            color-scheme:light;background:#f5faf8;color:#20493e;border:1px solid #bfd8cf;
            border-radius:8px;padding:5px 10px;min-height:32px;outline-offset:2px;
            cursor:pointer;font:600 13px/1.4 system-ui,sans-serif;
        `;
        return control;
    }

    function openSettings() {
        if (settings) return;
        const host = document.createElement("div");
        const root = host.attachShadow({ mode: "closed" });
        const dialog = document.createElement("dialog");
        dialog.setAttribute("aria-label", "OU 图床设置");
        dialog.style.cssText = `
            color-scheme:light;width:min(420px,calc(100vw - 24px));max-width:none;padding:0;
            border:1px solid #bfd8cf;border-radius:14px;background:#f5faf8;
            color:#183e34;box-shadow:0 16px 48px #102f2a40;
        `;
        const actions = document.createElement("div");
        actions.style.cssText = "display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;padding:12px 16px 0";
        const feedback = document.createElement("p");
        feedback.setAttribute("role", "status");
        feedback.style.cssText = "margin:0;padding:10px 16px;color:#45665a;font:13px/1.4 system-ui";
        feedback.hidden = true;
        const showFeedback = (message) => {
            feedback.textContent = message;
            feedback.hidden = false;
        };
        const importClipboard = button("从剪贴板导入");
        const dismiss = button("×");
        dismiss.setAttribute("aria-label", "关闭设置面板");
        dismiss.style.cssText += "width:32px;padding:0;font-size:20px";
        importClipboard.addEventListener("click", async (event) => {
            if (!event.isTrusted) return;
            let value;
            try {
                value = (await navigator.clipboard.readText()).trim();
            } catch {
                showFeedback("读取剪贴板失败，可在凭据表单里粘贴，或允许读取后重试。");
                return;
            }
            if (!dialog.open) return;
            if (!tokenFormat.test(value)) {
                showFeedback("剪贴板里没有完整的 NodeSeek 上传凭据。");
                return;
            }
            saveCredential(value);
        });
        dismiss.addEventListener("click", (event) => { if (event.isTrusted) dialog.close(); });
        const frame = document.createElement("iframe");
        frame.title = "OU 图床上传凭据";
        frame.style.cssText = "display:block;width:100%;height:min(260px,55vh);border:0";
        const channel = new MessageChannel();
        const frameTimer = setTimeout(() => {
            frame.style.display = "none";
            showFeedback("凭据表单未能加载。请先复制凭据，再点击「从剪贴板导入」。");
        }, 5000);
        frame.addEventListener("load", () => {
            frame.contentWindow.postMessage({
                type: "ou-nodeseek-settings",
                configured: Boolean(GM_getValue(tokenKey, ""))
            }, apiOrigin, [channel.port2]);
        }, { once: true });
        function saveCredential(value) {
            GM_setValue(tokenKey, value);
            dialog.close();
            notify("OU 图床凭据已保存");
        }
        channel.port1.onmessage = ({ data }) => {
            if (data?.type === "ready") {
                clearTimeout(frameTimer);
                feedback.hidden = true;
                frame.style.display = "block";
                return;
            }
            if (data?.type === "save" && typeof data.value === "string" && tokenFormat.test(data.value)) {
                saveCredential(data.value);
                return;
            } else if (data?.type === "clear") {
                GM_setValue(tokenKey, "");
                notify("OU 图床凭据已清除");
            } else if (data?.type !== "close") {
                return;
            }
            dialog.close();
        };
        dialog.addEventListener("close", () => {
            clearTimeout(frameTimer);
            channel.port1.close();
            host.remove();
            settings = undefined;
        });
        frame.src = `${apiOrigin}/api/integrations/nodeseek/settings.html`;
        actions.append(importClipboard, dismiss);
        dialog.append(actions, feedback, frame);
        root.append(dialog);
        document.body.append(host);
        settings = dialog;
        dialog.showModal();
    }

    GM_registerMenuCommand("设置 OU 图床上传凭据", openSettings);

    function token() {
        const value = GM_getValue(tokenKey, "");
        if (!value) openSettings();
        return value;
    }

    function imageTooLarge() {
        const error = new Error("图片不能超过 20 MB");
        error.code = "FILE_TOO_LARGE";
        return error;
    }

    function upload(value, credential) {
        const headers = { Authorization: `Bearer ${credential}` };
        let data;
        if (typeof value === "string") {
            headers["Content-Type"] = "application/json";
            data = JSON.stringify({ url: value });
        } else {
            if (value.size > maximumBytes) throw imageTooLarge();
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
                            const error = new Error(body.error?.message || `上传失败（HTTP ${result.status}）`);
                            error.code = body.error?.code;
                            throw error;
                        }
                        const url = new URL(body.url, apiOrigin);
                        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("图床返回的链接无效");
                        const href = url.href.replace(/\(/g, "%28").replace(/\)/g, "%29");
                        resolve(`![图片](${href})`);
                    } catch (error) {
                        reject(error);
                    }
                },
                onerror: () => reject(new Error("无法连接 OU 图床")),
                ontimeout: () => reject(new Error("上传超时"))
            });
        });
    }

    function editorFor(target) {
        if (!(target instanceof Element)) return;
        const mirrorElement = target.closest(".CodeMirror");
        if (mirrorElement) {
            let mirror = (mirrorElement.wrappedJSObject ?? mirrorElement).CodeMirror;
            if (!mirror && typeof unsafeWindow !== "undefined") {
                const index = [...document.querySelectorAll(".CodeMirror")].indexOf(mirrorElement);
                mirror = unsafeWindow.document.querySelectorAll(".CodeMirror").item(index)?.CodeMirror;
            }
            if (!mirror || typeof mirror.replaceRange !== "function" || mirror.getOption?.("readOnly")) return;
            return {
                element: mirrorElement,
                value: () => mirror.getValue(),
                selected: () => mirror.getSelection(),
                insert: (text) => mirror.replaceSelection(text),
                replace: (start, end, text) => mirror.replaceRange(text, mirror.posFromIndex(start), mirror.posFromIndex(end))
            };
        }
        if (!(target instanceof HTMLTextAreaElement) || target.readOnly || target.disabled || !target.closest(editorSelector)) return;
        const replace = (start, end, text, mode = "preserve") => {
            target.setRangeText(text, start, end, mode);
            target.dispatchEvent(new Event("input", { bubbles: true }));
        };
        return {
            element: target,
            value: () => target.value,
            selected: () => target.value.slice(target.selectionStart, target.selectionEnd),
            insert: (text) => replace(target.selectionStart, target.selectionEnd, text, "end"),
            replace
        };
    }

    async function uploadIntoEditor(editor, files, credential) {
        const marker = `<!-- OU 上传中 ${crypto.randomUUID()} -->`;
        const selection = editor.selected();
        editor.insert(marker);
        notify(`正在上传 ${files.length} 张图片`);
        const links = [];
        let failure = "";
        for (const file of files) {
            try {
                links.push(await upload(file, credential));
            } catch (error) {
                failure = error instanceof Error ? error.message : "上传失败";
            }
        }
        const position = editor.element.isConnected ? editor.value().indexOf(marker) : -1;
        if (position >= 0) {
            editor.replace(position, position + marker.length, links.length ? links.join("\n") : selection);
        } else if (links.length) {
            GM_setClipboard(links.join("\n"));
            notify("图片已上传，Markdown 已复制");
            return;
        }
        notify(failure ? `已上传 ${links.length}/${files.length} 张 · ${failure}` : `已插入 ${links.length} 张图片`);
    }

    document.addEventListener("paste", (event) => {
        if (!event.isTrusted || event.defaultPrevented) return;
        const editor = editorFor(event.target);
        const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
        if (!editor || !files.length) return;
        const credential = token();
        if (!credential) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void uploadIntoEditor(editor, files, credential);
    }, true);

    function editorElement(root) {
        return root.querySelector(".CodeMirror") ?? root.querySelector("textarea");
    }

    function mountEditor(root) {
        if (mountedEditors.get(root)?.isConnected || !editorElement(root)) return;
        const row = document.createElement("div");
        row.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:5px 8px;border-bottom:1px solid color-mix(in srgb,currentColor 18%,transparent);font:13px system-ui";
        const pick = button("选图上传");
        pick.style.cssText += "background:#dff4eb;border-color:#add2c4;color:#174b3d";
        const configure = button("凭据设置");
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*,.heic,.heif";
        input.multiple = true;
        input.hidden = true;
        let activeEditor;
        pick.addEventListener("click", (event) => {
            if (!event.isTrusted || !token()) return;
            activeEditor = editorFor(editorElement(root));
            if (!activeEditor) {
                notify("请切回编辑器的内容页再上传图片");
                return;
            }
            input.click();
        });
        input.addEventListener("change", (event) => {
            if (!event.isTrusted) return;
            const files = Array.from(input.files ?? []);
            input.value = "";
            if (!activeEditor || !files.length) return;
            const credential = token();
            if (credential) void uploadIntoEditor(activeEditor, files, credential);
        });
        configure.addEventListener("click", (event) => { if (event.isTrusted) openSettings(); });
        row.append(pick, configure, input);
        const toolbar = root.querySelector(".mde-toolbar");
        if (toolbar) toolbar.after(row);
        else root.prepend(row);
        mountedEditors.set(root, row);
    }

    let scanQueued = false;
    function scanEditors() {
        scanQueued = false;
        for (const root of document.querySelectorAll(editorSelector)) {
            if (!root.parentElement?.closest(editorSelector)) mountEditor(root);
        }
    }

    scanEditors();
    new MutationObserver(() => {
        if (!scanQueued) {
            scanQueued = true;
            requestAnimationFrame(scanEditors);
        }
    }).observe(document.body, { childList: true, subtree: true });

    function closeMenu() {
        menu?.remove();
        menu = undefined;
    }

    function downloadAcrossOrigins(url) {
        return new Promise((resolve, reject) => {
            const fail = () => {
                clearTimeout(timer);
                reject(new Error("浏览器无法读取这张站外图片"));
            };
            let request;
            const timer = setTimeout(() => {
                request?.abort();
                fail();
            }, 15_000);
            try {
                request = GM_xmlhttpRequest({
                    method: "GET",
                    url: url.href,
                    responseType: "blob",
                    anonymous: true,
                    redirect: "error",
                    timeout: 15_000,
                    onprogress(event) {
                        if (event.loaded > maximumBytes) {
                            clearTimeout(timer);
                            request?.abort();
                            reject(imageTooLarge());
                        }
                    },
                    onload(response) {
                        clearTimeout(timer);
                        if (response.status < 200 || response.status >= 300 ||
                            (response.finalUrl && response.finalUrl !== url.href) || !(response.response instanceof Blob)) {
                            fail();
                            return;
                        }
                        if (response.response.size > maximumBytes) reject(imageTooLarge());
                        else resolve(response.response);
                    },
                    onerror: fail,
                    ontimeout: fail
                });
            } catch { fail(); }
        });
    }

    async function downloadInPage(url) {
        const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok || !response.body) throw new Error("无法读取原图片");
        if (Number(response.headers.get("content-length")) > maximumBytes) {
            await response.body.cancel();
            throw imageTooLarge();
        }
        const reader = response.body.getReader();
        const chunks = [];
        let bytes = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > maximumBytes) {
                await reader.cancel();
                throw imageTooLarge();
            }
            chunks.push(value);
        }
        return new Blob(chunks, { type: response.headers.get("content-type") ?? "" });
    }

    async function uploadForumImage(url, image, credential) {
        let blob;
        try {
            blob = await downloadInPage(url);
        } catch (error) {
            if (error?.code === "FILE_TOO_LARGE" || !["https:", "http:"].includes(url.protocol)) throw error;
            // Only request the exact, already rendered image selected by the user.
            if (url.origin !== location.origin && image.complete && image.naturalWidth > 0) {
                try {
                    blob = await downloadAcrossOrigins(url);
                } catch (downloadError) {
                    if (downloadError?.code === "FILE_TOO_LARGE") throw downloadError;
                }
            }
        }
        if (blob) {
            const name = url.pathname.split("/").at(-1)?.slice(0, 100) || "nodeseek-image";
            return upload(new File([blob], name, { type: blob.type }), credential);
        }
        try {
            return await upload(url.href, credential);
        } catch (error) {
            if (error?.code === "BLOCKED_URL" || error?.code === "REMOTE_FETCH_FAILED") {
                throw new Error("无法自动读取这张图片。请先保存图片，再用编辑器里的「选图上传」。");
            }
            throw error;
        }
    }

    document.addEventListener("pointerdown", (event) => {
        if (event.target !== menu) closeMenu();
    }, true);
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu(); });

    document.addEventListener("contextmenu", (event) => {
        closeMenu();
        if (!event.isTrusted || !(event.shiftKey || (firefox && event.altKey)) || !(event.target instanceof HTMLImageElement)) return;
        const image = event.target;
        let url;
        try {
            url = new URL(image.currentSrc || image.src, location.href);
        } catch {
            return;
        }
        if (!["https:", "http:", "data:", "blob:"].includes(url.protocol) || url.username || url.password) return;
        event.preventDefault();
        menu = button("上传到图床并复制Markdown");
        menu.style.cssText += `
            position:fixed;z-index:2147483647;background:#edf9f3;outline:2px solid #5ca88e;
            padding:9px 12px;box-shadow:0 4px 16px #15352b33;max-width:calc(100vw - 16px);
        `;
        document.body.append(menu);
        menu.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - menu.offsetWidth - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - menu.offsetHeight - 8))}px`;
        menu.focus();
        menu.addEventListener("click", async (click) => {
            if (!click.isTrusted) return;
            closeMenu();
            const credential = token();
            if (!credential) return;
            notify("正在上传图片");
            try {
                GM_setClipboard(await uploadForumImage(url, image, credential));
                notify("图片已上传，Markdown 已复制");
            } catch (error) {
                notify(error instanceof Error ? error.message : "上传失败");
            }
        });
    }, true);
}
