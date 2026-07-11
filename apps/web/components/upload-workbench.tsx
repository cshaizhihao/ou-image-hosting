"use client";

import { Badge, Button } from "@ou-image/ui";
import {
  AlertCircle,
  Check,
  ClipboardPaste,
  Copy,
  FileImage,
  HardDrive,
  ImagePlus,
  Link2,
  LoaderCircle,
  PlayCircle,
  Pause,
  Play,
  RefreshCw,
  UploadCloud,
  X
} from "lucide-react";
import {
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { workspaceHeaders } from "@/lib/api";
import { AppShell } from "./app-shell";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ACCEPTED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif"
]);
const ACCEPTED_EXTENSIONS = /\.(?:jpe?g|png|webp|gif|avif)$/i;

type UploadStatus =
  | "ready"
  | "queued"
  | "uploading"
  | "paused"
  | "success"
  | "error";

type UploadedImage = {
  id: string;
  name: string;
  size: number;
  width: number;
  height: number;
  format: string;
  sha256: string;
  thumbnailUrl: string;
  originalUrl: string;
  createdAt: string;
};

type UploadResponse = {
  image: UploadedImage;
  duplicate: boolean;
};

type UploadItem = {
  id: string;
  file: File | null;
  name: string;
  previewUrl: string;
  progress: number;
  status: UploadStatus;
  error?: string;
  result?: UploadResponse;
  sourceUrl?: string;
};

type UploadSummary = {
  count: number;
  bytes: number;
  quotaBytes: number;
};

type AlbumOption = { id: string; name: string };
type TagOption = { id: string; name: string; color: string };
type CopyFormat = "url" | "markdown" | "html" | "bbcode";

type ErrorResponse = {
  message?: string;
  error?: { message?: string };
};

function responseError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const candidate = payload as ErrorResponse;
  return candidate.error?.message ?? candidate.message ?? fallback;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fileLabelFromUrl(value: string) {
  try {
    const parsed = new URL(value);
    return decodeURIComponent(parsed.pathname.split("/").pop() || parsed.hostname);
  } catch {
    return "远程图片";
  }
}

function statusLabel(status: UploadStatus) {
  switch (status) {
    case "ready":
      return "等待确认";
    case "queued":
      return "等待上传";
    case "uploading":
      return "正在上传";
    case "paused":
      return "已暂停";
    case "success":
      return "上传完成";
    case "error":
      return "上传失败";
  }
}

export function UploadWorkbench() {
  const inputRef = useRef<HTMLInputElement>(null);
  const queueRef = useRef<UploadItem[]>([]);
  const activeRequestRef = useRef<XMLHttpRequest | null>(null);
  const activeItemIdRef = useRef<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [summary, setSummary] = useState<UploadSummary>({
    count: 0,
    bytes: 0,
    quotaBytes: 0
  });
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [albums, setAlbums] = useState<AlbumOption[]>([]);
  const [tags, setTags] = useState<TagOption[]>([]);
  const [selectedAlbumIds, setSelectedAlbumIds] = useState<string[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [publishAfterUpload, setPublishAfterUpload] = useState(false);
  const [copyFormat, setCopyFormat] = useState<CopyFormat>("url");

  useEffect(() => {
    queueRef.current = items;
  }, [items]);

  const refreshSummary = useCallback(async () => {
    try {
      const response = await fetch("/api/uploads/summary", {
        credentials: "include",
        cache: "no-store",
        headers: workspaceHeaders()
      });
      if (!response.ok) throw new Error("无法读取存储摘要");
      const payload = (await response.json()) as UploadSummary;
      setSummary(payload);
    } catch {
      setNotice("暂时无法读取存储用量，上传功能仍可继续使用。");
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const appendFiles = useCallback(
    (files: File[] | FileList, successMessage?: string) => {
      const candidates = Array.from(files);
      const accepted: UploadItem[] = [];
      const rejected: string[] = [];

      candidates.forEach((file) => {
        if (
          !ACCEPTED_TYPES.has(file.type) &&
          !(file.type === "" && ACCEPTED_EXTENSIONS.test(file.name))
        ) {
          rejected.push(`${file.name}：不支持的图片格式`);
          return;
        }
        if (file.size > MAX_FILE_SIZE) {
          rejected.push(`${file.name}：超过 20 MB`);
          return;
        }

        accepted.push({
          id: crypto.randomUUID(),
          file,
          name: file.name,
          previewUrl: URL.createObjectURL(file),
          progress: 0,
          status: "ready"
        });
      });

      if (accepted.length > 0) {
        setItems((current) => [...current, ...accepted]);
        setNotice(
          successMessage ??
            `已加入 ${accepted.length} 张图片，请确认文件名和完成后设置。`
        );
      }
      if (rejected.length > 0) {
        setNotice(rejected.slice(0, 2).join("；"));
      }
    },
    []
  );

  useEffect(() => {
    void refreshSummary();
  }, [refreshSummary]);

  useEffect(() => {
    Promise.all([
      fetch("/api/albums", {
        credentials: "include",
        cache: "no-store",
        headers: workspaceHeaders()
      }).then(async (response) =>
        response.ok
          ? ((await response.json()) as { albums: AlbumOption[] }).albums
          : []
      ),
      fetch("/api/tags", {
        credentials: "include",
        cache: "no-store",
        headers: workspaceHeaders()
      }).then(async (response) =>
        response.ok
          ? ((await response.json()) as { tags: TagOption[] }).tags
          : []
      )
    ])
      .then(([albumItems, tagItems]) => {
        setAlbums(albumItems);
        setTags(tagItems);
      })
      .catch(() => {
        setAlbums([]);
        setTags([]);
      });
  }, []);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));

      if (files.length > 0) {
        event.preventDefault();
        appendFiles(files, "已从剪贴板加入上传队列");
      }
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [appendFiles]);

  useEffect(() => {
    return () => {
      activeRequestRef.current?.abort();
      queueRef.current.forEach((item) => {
        if (item.previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
    };
  }, []);

  useEffect(() => {
    if (!urlDialogOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setUrlDialogOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [urlDialogOpen]);

  const updateItem = useCallback(
    (id: string, updater: (item: UploadItem) => UploadItem) => {
      setItems((current) =>
        current.map((item) => (item.id === id ? updater(item) : item))
      );
    },
    []
  );

  const completeRequest = useCallback(
    (id: string) => {
      if (activeItemIdRef.current === id) {
        activeRequestRef.current = null;
        activeItemIdRef.current = null;
      }
    },
    []
  );

  const applyPostUploadSettings = useCallback(
    async (imageId: string) => {
      if (selectedAlbumIds.length > 0 || selectedTagIds.length > 0) {
        const response = await fetch(
          `/api/uploads/${encodeURIComponent(imageId)}/organization`,
          {
            method: "PATCH",
            credentials: "include",
            headers: workspaceHeaders({ "content-type": "application/json" }),
            body: JSON.stringify({
              albumIds: selectedAlbumIds,
              tagIds: selectedTagIds
            })
          }
        );
        if (!response.ok) {
          throw new Error("图片已上传，但相册或标签设置没有保存");
        }
      }
      if (publishAfterUpload) {
        const response = await fetch("/api/uploads/bulk", {
          method: "POST",
          credentials: "include",
          headers: workspaceHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({
            ids: [imageId],
            action: "set-public-visibility",
            publicVisible: true
          })
        });
        if (!response.ok) {
          throw new Error("图片已上传，但公开展示状态没有保存");
        }
      }
    },
    [publishAfterUpload, selectedAlbumIds, selectedTagIds]
  );

  const uploadFile = useCallback(
    (item: UploadItem) => {
      if (!item.file || activeRequestRef.current) return;

      const request = new XMLHttpRequest();
      const formData = new FormData();
      formData.append("file", item.file, item.name.trim() || item.file.name);
      activeRequestRef.current = request;
      activeItemIdRef.current = item.id;

      updateItem(item.id, (current) => ({
        ...current,
        status: "uploading",
        error: undefined
      }));

      request.open("POST", "/api/uploads");
      request.withCredentials = true;
      request.responseType = "json";
      workspaceHeaders().forEach((value, key) => {
        request.setRequestHeader(key, value);
      });

      request.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable) return;
        updateItem(item.id, (current) => ({
          ...current,
          progress: Math.min(99, Math.round((event.loaded / event.total) * 100))
        }));
      });

      request.addEventListener("load", async () => {
        completeRequest(item.id);
        const payload = request.response as
          | UploadResponse
          | ErrorResponse
          | null;

        if (
          request.status >= 200 &&
          request.status < 300 &&
          payload &&
          "image" in payload
        ) {
          try {
            await applyPostUploadSettings(payload.image.id);
          } catch (postUploadError) {
            setNotice(
              postUploadError instanceof Error
                ? postUploadError.message
                : "图片已上传，但完成后设置没有全部保存"
            );
          }
          updateItem(item.id, (current) => ({
            ...current,
            status: "success",
            progress: 100,
            result: payload,
            error: undefined
          }));
          setNotice(
            payload.duplicate
              ? `${item.name} 已存在，已返回原有图片。`
              : `${item.name} 上传完成。`
          );
          void refreshSummary();
          return;
        }

        updateItem(item.id, (current) => ({
          ...current,
          status: "error",
          error:
            responseError(payload, `服务器返回错误（${request.status}）`)
        }));
      });

      request.addEventListener("error", () => {
        completeRequest(item.id);
        updateItem(item.id, (current) => ({
          ...current,
          status: "error",
          error: "网络连接中断，请稍后重试。"
        }));
      });

      request.addEventListener("abort", () => {
        completeRequest(item.id);
        updateItem(item.id, (current) => ({
          ...current,
          status: "paused"
        }));
      });

      request.send(formData);
    },
    [applyPostUploadSettings, completeRequest, refreshSummary, updateItem]
  );

  useEffect(() => {
    if (activeRequestRef.current) return;
    const next = items.find((item) => item.status === "queued" && item.file);
    if (next) uploadFile(next);
  }, [items, uploadFile]);

  const pauseUpload = (id: string) => {
    if (activeItemIdRef.current === id) {
      activeRequestRef.current?.abort();
      return;
    }
    updateItem(id, (item) => ({ ...item, status: "paused" }));
  };

  const resumeUpload = (id: string) => {
    updateItem(id, (item) => ({
      ...item,
      status: "queued",
      progress: 0,
      error: undefined
    }));
  };

  const startReadyUploads = () => {
    setItems((current) =>
      current.map((item) =>
        item.status === "ready"
          ? { ...item, status: "queued", progress: 0, error: undefined }
          : item
      )
    );
    setNotice("上传已经开始，队列会按顺序处理图片。");
  };

  const renameReadyItem = (id: string, name: string) => {
    updateItem(id, (item) =>
      item.status === "ready" ? { ...item, name: name.slice(0, 160) } : item
    );
  };

  const removeItem = (id: string) => {
    const target = queueRef.current.find((item) => item.id === id);
    if (!target || target.status === "uploading") return;
    if (target.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(target.previewUrl);
    }
    setItems((current) => current.filter((item) => item.id !== id));
  };

  const clearFinished = () => {
    const removable = queueRef.current.filter(
      (item) => item.status === "success" || item.status === "error"
    );
    removable.forEach((item) => {
      if (item.previewUrl.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
    });
    setItems((current) =>
      current.filter(
        (item) => item.status !== "success" && item.status !== "error"
      )
    );
  };

  const copyOriginalUrl = async (item: UploadItem) => {
    if (!item.result) return;
    try {
      const absoluteUrl = new URL(
        item.result.image.originalUrl,
        window.location.origin
      ).toString();
      await navigator.clipboard.writeText(absoluteUrl);
      setNotice(`${item.name} 的原图链接已复制。`);
    } catch {
      setNotice("浏览器未授予剪贴板权限，请从图片详情中复制链接。");
    }
  };

  const copySuccessful = async () => {
    const successful = items.filter(
      (item): item is UploadItem & { result: UploadResponse } =>
        item.status === "success" && Boolean(item.result)
    );
    if (successful.length === 0) return;
    const content = successful
      .map((item) => {
        const url = new URL(
          item.result.image.originalUrl,
          window.location.origin
        ).toString();
        const name = item.result.image.name || item.name;
        if (copyFormat === "markdown") return `![${name}](${url})`;
        if (copyFormat === "html") return `<img src="${url}" alt="${name}" />`;
        if (copyFormat === "bbcode") return `[img]${url}[/img]`;
        return url;
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(content);
      setNotice(`已复制 ${successful.length} 张图片的 ${copyFormat.toUpperCase()} 内容。`);
    } catch {
      setNotice("浏览器未授予剪贴板权限，请稍后重试。");
    }
  };

  const runRemoteUpload = useCallback(
    async (id: string, url: string) => {
      updateItem(id, (item) => ({
        ...item,
        status: "uploading",
        progress: 12,
        error: undefined
      }));

      try {
        const response = await fetch("/api/uploads/from-url", {
          method: "POST",
          credentials: "include",
          headers: workspaceHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({ url })
        });
        const payload = (await response.json()) as
          | UploadResponse
          | ErrorResponse;

        if (!response.ok || !("image" in payload)) {
          throw new Error(responseError(payload, "远程图片上传失败"));
        }

        await applyPostUploadSettings(payload.image.id);

        updateItem(id, (item) => ({
          ...item,
          status: "success",
          progress: 100,
          result: payload,
          previewUrl: payload.image.thumbnailUrl || item.previewUrl
        }));
        setNotice(
          payload.duplicate
            ? "这张远程图片已存在，已返回原有图片。"
            : "远程图片上传完成。"
        );
        void refreshSummary();
      } catch (error) {
        updateItem(id, (item) => ({
          ...item,
          status: "error",
          error: error instanceof Error ? error.message : "远程图片上传失败"
        }));
      }
    },
    [applyPostUploadSettings, refreshSummary, updateItem]
  );

  const submitRemoteUrl = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setUrlError("");

    let parsed: URL;
    try {
      parsed = new URL(remoteUrl.trim());
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    } catch {
      setUrlError("请输入以 http:// 或 https:// 开头的有效图片地址。");
      return;
    }

    const id = crypto.randomUUID();
    const url = parsed.toString();
    setItems((current) => [
      ...current,
      {
        id,
        file: null,
        name: fileLabelFromUrl(url),
        previewUrl: "",
        progress: 12,
        status: "uploading",
        sourceUrl: url
      }
    ]);
    setUrlDialogOpen(false);
    setRemoteUrl("");
    void runRemoteUpload(id, url);
  };

  const totalProgress = useMemo(() => {
    if (items.length === 0) return 0;
    return Math.round(
      items.reduce((total, item) => total + item.progress, 0) / items.length
    );
  }, [items]);

  const successfulCount = items.filter((item) => item.status === "success").length;
  const activeCount = items.filter((item) =>
    ["ready", "queued", "uploading", "paused"].includes(item.status)
  ).length;
  const readyCount = items.filter((item) => item.status === "ready").length;
  const quotaPercent =
    summary.quotaBytes > 0
      ? Math.min(100, Math.round((summary.bytes / summary.quotaBytes) * 100))
      : 0;

  return (
    <AppShell activeKey="upload">
      <main className="workspace-page upload-console">
        <header className="upload-hero">
          <div>
            <Badge tone="info">智能上传工作台</Badge>
            <h1>把图片放进来，剩下的交给队列。</h1>
            <p>
              拖拽、选择、粘贴或输入图片地址。支持 JPG、PNG、WebP、GIF 与
              AVIF，单张最大 20 MB。
            </p>
          </div>
          <div className="upload-hero__stat" aria-label="图片总数">
            <strong>{summaryLoading ? "—" : summary.count}</strong>
            <span>已存图片</span>
          </div>
        </header>

        <section className="upload-overview" aria-label="上传入口与存储摘要">
          <input
            accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
            aria-label="选择本地图片"
            className="sr-only"
            multiple
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              if (event.target.files) appendFiles(event.target.files);
              event.target.value = "";
            }}
            ref={inputRef}
            tabIndex={-1}
            type="file"
          />
          <div
            className={`upload-drop${dragging ? " is-dragging" : ""}`}
            onClick={() => inputRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              if (event.currentTarget.contains(event.relatedTarget as Node)) return;
              setDragging(false);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event: DragEvent<HTMLDivElement>) => {
              event.preventDefault();
              setDragging(false);
              appendFiles(event.dataTransfer.files);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                inputRef.current?.click();
              }
            }}
            role="button"
            tabIndex={0}
          >
            <span className="upload-drop__mark">
              <UploadCloud aria-hidden="true" size={32} strokeWidth={1.65} />
            </span>
            <div>
              <h2>{dragging ? "松开即可加入队列" : "拖入图片，立即开始上传"}</h2>
              <p>也可以点击此区域选择多张图片</p>
            </div>
            <span className="upload-drop__action">
              <ImagePlus aria-hidden="true" size={17} />
              选择图片
            </span>
          </div>

          <aside className="upload-utility">
            <div className="upload-storage">
              <div className="upload-storage__heading">
                <span>
                  <HardDrive aria-hidden="true" size={18} />
                  存储空间
                </span>
                <strong>{summaryLoading ? "读取中" : `${quotaPercent}%`}</strong>
              </div>
              <div
                aria-label={`已使用 ${quotaPercent}%`}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={quotaPercent}
                className="upload-storage__track"
                role="progressbar"
              >
                <span style={{ transform: `scaleX(${quotaPercent / 100})` }} />
              </div>
              <p>
                <strong>{formatBytes(summary.bytes)}</strong>
                <span>
                  / {summary.quotaBytes > 0 ? formatBytes(summary.quotaBytes) : "未限额"}
                </span>
              </p>
            </div>

            <div className="upload-methods">
              <button
                onClick={() => inputRef.current?.click()}
                type="button"
              >
                <ImagePlus aria-hidden="true" size={19} />
                <span>
                  <strong>本地文件</strong>
                  <small>批量选择图片</small>
                </span>
              </button>
              <button onClick={() => setUrlDialogOpen(true)} type="button">
                <Link2 aria-hidden="true" size={19} />
                <span>
                  <strong>图片地址</strong>
                  <small>从 URL 获取</small>
                </span>
              </button>
              <div className="upload-methods__paste">
                <ClipboardPaste aria-hidden="true" size={19} />
                <span>
                  <strong>剪贴板粘贴</strong>
                  <small>全局按 Ctrl / ⌘ + V</small>
                </span>
              </div>
            </div>
          </aside>
        </section>

        <p aria-live="polite" className="upload-notice" role="status">
          {notice}
        </p>

        <section className="upload-after-panel" aria-label="上传完成后设置">
          <div className="upload-after-panel__heading">
            <div>
              <span>AFTER UPLOAD</span>
              <h2>完成后自动整理</h2>
              <p>这些设置会应用到本次队列中随后上传成功的图片。</p>
            </div>
            <label className="upload-after-panel__public">
              <input
                checked={publishAfterUpload}
                onChange={(event) => setPublishAfterUpload(event.target.checked)}
                type="checkbox"
              />
              <span><strong>公开展示</strong><small>上传完成后进入公共图库</small></span>
            </label>
          </div>
          <div className="upload-after-panel__groups">
            <div>
              <strong>加入相册</strong>
              <div className="upload-after-panel__chips">
                {albums.length === 0 ? <span>暂无相册</span> : albums.map((album) => (
                  <button
                    aria-pressed={selectedAlbumIds.includes(album.id)}
                    key={album.id}
                    onClick={() => setSelectedAlbumIds((current) => current.includes(album.id) ? current.filter((id) => id !== album.id) : [...current, album.id])}
                    type="button"
                  >{album.name}</button>
                ))}
              </div>
            </div>
            <div>
              <strong>添加标签</strong>
              <div className="upload-after-panel__chips">
                {tags.length === 0 ? <span>暂无标签</span> : tags.map((tag) => (
                  <button
                    aria-pressed={selectedTagIds.includes(tag.id)}
                    key={tag.id}
                    onClick={() => setSelectedTagIds((current) => current.includes(tag.id) ? current.filter((id) => id !== tag.id) : [...current, tag.id])}
                    style={{ "--tag-color": tag.color } as CSSProperties}
                    type="button"
                  >{tag.name}</button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="upload-queue" aria-labelledby="upload-queue-title">
          <div className="upload-queue__head">
            <div>
              <span className="upload-queue__eyebrow">UPLOAD QUEUE</span>
              <h2 id="upload-queue-title">上传队列</h2>
              <p>
                {items.length === 0
                  ? "队列为空"
                  : `${activeCount} 项处理中 · ${successfulCount} 项已完成`}
              </p>
            </div>
            <div className="upload-queue__summary">
              <span>{totalProgress}%</span>
              {readyCount > 0 && (
                <Button onClick={startReadyUploads} size="compact">
                  <PlayCircle aria-hidden="true" size={16} />
                  开始上传 {readyCount} 张
                </Button>
              )}
              {successfulCount > 0 && (
                <div className="upload-copy-results">
                  <select aria-label="批量复制格式" onChange={(event) => setCopyFormat(event.target.value as CopyFormat)} value={copyFormat}>
                    <option value="url">URL</option>
                    <option value="markdown">Markdown</option>
                    <option value="html">HTML</option>
                    <option value="bbcode">BBCode</option>
                  </select>
                  <Button onClick={() => void copySuccessful()} size="compact" variant="secondary"><Copy size={15} />复制完成项</Button>
                </div>
              )}
              {items.some(
                (item) => item.status === "success" || item.status === "error"
              ) && (
                <Button onClick={clearFinished} size="compact" variant="ghost">
                  清理已结束
                </Button>
              )}
            </div>
          </div>

          {items.length > 0 && (
            <div
              aria-label={`总上传进度 ${totalProgress}%`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={totalProgress}
              className="upload-total-progress"
              role="progressbar"
            >
              <span style={{ transform: `scaleX(${totalProgress / 100})` }} />
            </div>
          )}

          {items.length === 0 ? (
            <div className="upload-queue__empty">
              <FileImage aria-hidden="true" size={26} />
              <strong>等待第一张图片</strong>
              <span>文件加入后会自动上传，并在这里显示实时进度。</span>
            </div>
          ) : (
            <ol className="upload-list">
              {items.map((item) => {
                const displayUrl =
                  item.result?.image.thumbnailUrl || item.previewUrl;
                return (
                  <li className={`upload-row is-${item.status}`} key={item.id}>
                    <div className="upload-row__thumb">
                      {displayUrl ? (
                        <img alt="" src={displayUrl} />
                      ) : (
                        <FileImage aria-hidden="true" size={22} />
                      )}
                    </div>
                    <div className="upload-row__body">
                      <div className="upload-row__title">
                        {item.status === "ready" ? (
                          <input
                            aria-label="上传前修改文件名"
                            maxLength={160}
                            onChange={(event) => renameReadyItem(item.id, event.target.value)}
                            spellCheck={false}
                            value={item.name}
                          />
                        ) : (
                          <strong title={item.name}>{item.name}</strong>
                        )}
                        {item.result?.duplicate && (
                          <span className="upload-duplicate">重复文件</span>
                        )}
                      </div>
                      <div className="upload-row__meta">
                        <span className="upload-status">
                          {item.status === "uploading" && (
                            <LoaderCircle
                              aria-hidden="true"
                              className="is-spinning"
                              size={13}
                            />
                          )}
                          {item.status === "success" && (
                            <Check aria-hidden="true" size={13} />
                          )}
                          {item.status === "error" && (
                            <AlertCircle aria-hidden="true" size={13} />
                          )}
                          {statusLabel(item.status)}
                        </span>
                        <span>
                          {item.file
                            ? formatBytes(item.file.size)
                            : item.result
                              ? formatBytes(item.result.image.size)
                              : "远程图片"}
                        </span>
                        {item.result && (
                          <span>
                            {item.result.image.width} × {item.result.image.height}
                          </span>
                        )}
                      </div>
                      {item.error ? (
                        <p className="upload-row__error">{item.error}</p>
                      ) : (
                        <div
                          aria-label={`${item.name} 上传进度 ${item.progress}%`}
                          aria-valuemax={100}
                          aria-valuemin={0}
                          aria-valuenow={item.progress}
                          className="upload-row__progress"
                          role="progressbar"
                        >
                          <span
                            style={{ transform: `scaleX(${item.progress / 100})` }}
                          />
                        </div>
                      )}
                    </div>
                    <div className="upload-row__percent" aria-hidden="true">
                      {item.progress}%
                    </div>
                    <div className="upload-row__actions">
                      {item.status === "uploading" && item.file && (
                        <button
                          aria-label={`暂停 ${item.name}`}
                          onClick={() => pauseUpload(item.id)}
                          title="暂停上传"
                          type="button"
                        >
                          <Pause aria-hidden="true" size={16} />
                        </button>
                      )}
                      {item.status === "paused" && (
                        <button
                          aria-label={`继续上传 ${item.name}`}
                          onClick={() => resumeUpload(item.id)}
                          title="继续上传"
                          type="button"
                        >
                          <Play aria-hidden="true" size={16} />
                        </button>
                      )}
                      {item.status === "error" &&
                        (item.file || item.sourceUrl) && (
                        <button
                          aria-label={`重试 ${item.name}`}
                          onClick={() => {
                            if (item.file) {
                              resumeUpload(item.id);
                            } else if (item.sourceUrl) {
                              void runRemoteUpload(item.id, item.sourceUrl);
                            }
                          }}
                          title="重试"
                          type="button"
                        >
                          <RefreshCw aria-hidden="true" size={16} />
                        </button>
                        )}
                      {item.status === "success" && (
                        <button
                          aria-label={`复制 ${item.name} 的原图链接`}
                          onClick={() => void copyOriginalUrl(item)}
                          title="复制原图链接"
                          type="button"
                        >
                          <Copy aria-hidden="true" size={16} />
                        </button>
                      )}
                      {item.status !== "uploading" && (
                        <button
                          aria-label={`移除 ${item.name}`}
                          onClick={() => removeItem(item.id)}
                          title="从队列移除"
                          type="button"
                        >
                          <X aria-hidden="true" size={16} />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </main>

      {urlDialogOpen && (
        <div
          className="upload-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setUrlDialogOpen(false);
          }}
        >
          <section
            aria-labelledby="url-upload-title"
            aria-modal="true"
            className="upload-dialog"
            role="dialog"
          >
            <button
              aria-label="关闭图片地址对话框"
              className="upload-dialog__close"
              onClick={() => setUrlDialogOpen(false)}
              type="button"
            >
              <X aria-hidden="true" size={18} />
            </button>
            <span className="upload-dialog__icon">
              <Link2 aria-hidden="true" size={22} />
            </span>
            <h2 id="url-upload-title">从图片地址上传</h2>
            <p>服务器会下载并验证图片，成功后加入当前图库。</p>
            <form onSubmit={submitRemoteUrl}>
              <label htmlFor="remote-image-url">图片 URL</label>
              <input
                autoFocus
                id="remote-image-url"
                onChange={(event) => {
                  setRemoteUrl(event.target.value);
                  setUrlError("");
                }}
                placeholder="https://example.com/photo.webp"
                spellCheck={false}
                type="url"
                value={remoteUrl}
              />
              {urlError && (
                <span className="upload-dialog__error" role="alert">
                  {urlError}
                </span>
              )}
              <div className="upload-dialog__actions">
                <Button
                  onClick={() => setUrlDialogOpen(false)}
                  type="button"
                  variant="ghost"
                >
                  取消
                </Button>
                <Button disabled={!remoteUrl.trim()} type="submit">
                  <UploadCloud aria-hidden="true" size={17} />
                  开始上传
                </Button>
              </div>
            </form>
          </section>
        </div>
      )}
    </AppShell>
  );
}
