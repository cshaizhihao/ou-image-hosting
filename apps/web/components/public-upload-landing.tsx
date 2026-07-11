"use client";

import { Button, cn } from "@ou-image/ui";
import {
  Check,
  Clipboard,
  ExternalLink,
  ImageIcon,
  Images,
  LockKeyhole,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  UploadCloud,
  X
} from "lucide-react";
import Link from "next/link";
import {
  type ChangeEvent,
  type DragEvent,
  type ClipboardEvent as ReactClipboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { ApiError } from "@/lib/api";

type PublicConfig = {
  setupComplete: boolean;
  site: {
    siteName: string;
    siteDescription: string;
    siteLogoUrl: string;
    publicUploadEnabled: boolean;
    publicGalleryEnabled: boolean;
    publicUploadDefaultPublic: boolean;
    publicHeroTitle: string;
    publicHeroDescription: string;
  } | null;
};

type PublicImage = {
  id: string;
  name: string;
  thumbnailUrl: string;
  originalUrl: string;
  width: number;
  height: number;
  createdAt: string;
};

type UploadResult = {
  image: {
    id: string;
    name: string;
    originalUrl: string;
    thumbnailUrl: string;
  };
  duplicate: boolean;
};

type UploadQueueItem = UploadResult & {
  uploadedAt: string;
};

const fallbackConfig: PublicConfig = {
  setupComplete: false,
  site: {
    siteName: "OU-Image Hosting",
    siteDescription: "欧记图床",
    siteLogoUrl: "/brand/ou-image-hosting-logo.jpg",
    publicUploadEnabled: true,
    publicGalleryEnabled: true,
    publicUploadDefaultPublic: true,
    publicHeroTitle: "把图片放进来，剩下的交给队列。",
    publicHeroDescription:
      "拖拽、选择或粘贴图片，即可生成可分享链接。公开展示可以在后台关闭，上传时也能自己决定是否出现在公共图床里。"
  }
};

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin"
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    throw new ApiError(
      payload.error?.message ?? "请求失败，请稍后再试",
      response.status,
      payload.error?.code ?? "REQUEST_FAILED"
    );
  }
  return (await response.json()) as T;
}

function publicUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path.startsWith("/") ? path : `/${path}`}`;
}

export function PublicUploadLanding() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dark, setDark] = useState(false);
  const [config, setConfig] = useState<PublicConfig>(fallbackConfig);
  const [gallery, setGallery] = useState<PublicImage[]>([]);
  const [publicVisible, setPublicVisible] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [uploadIndex, setUploadIndex] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [history, setHistory] = useState<UploadQueueItem[]>([]);

  const site = config.site ?? fallbackConfig.site!;
  const uploadEnabled = Boolean(config.setupComplete && site.publicUploadEnabled);
  const originalUrl = result ? publicUrl(result.image.originalUrl) : "";
  const markdown = result
    ? `![${result.image.name}](${originalUrl})`
    : "";
  const historyLinks = useMemo(
    () =>
      history
        .map((item) => publicUrl(item.image.originalUrl))
        .join("\n"),
    [history]
  );
  const historyMarkdown = useMemo(
    () =>
      history
        .map(
          (item) =>
            `![${item.image.name}](${publicUrl(item.image.originalUrl)})`
        )
        .join("\n"),
    [history]
  );

  useEffect(() => {
    const saved = window.localStorage.getItem("ou-theme");
    const nextDark =
      saved === "dark" ||
      (saved !== "light" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    setDark(nextDark);
    document.documentElement.dataset.theme = nextDark ? "dark" : "light";
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const payload = await apiJson<PublicConfig>("/public/config");
        if (!alive) return;
        setConfig(payload);
        setPublicVisible(
          payload.site?.publicUploadDefaultPublic ??
            fallbackConfig.site!.publicUploadDefaultPublic
        );
        if (payload.site?.publicGalleryEnabled) {
          const images = await apiJson<{ images: PublicImage[] }>("/public/images");
          if (alive) setGallery(images.images);
        }
      } catch (requestError) {
        if (alive) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "公共上传配置读取失败"
          );
        }
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    window.localStorage.setItem("ou-theme", next ? "dark" : "light");
    document.documentElement.dataset.theme = next ? "dark" : "light";
  };

  const copy = async (value: string, message: string) => {
    await navigator.clipboard.writeText(value);
    setNotice(message);
  };

  const uploadSingleFile = useCallback(
    async (file?: File) => {
      if (!file || uploading || !uploadEnabled) return;
      setError("");
      setNotice("");
      const body = new FormData();
      body.append("file", file);
      const payload = await apiJson<UploadResult>(
        `/public/uploads?publicVisible=${publicVisible ? "true" : "false"}`,
        {
          method: "POST",
          body
        }
      );
      setResult(payload);
      setHistory((current) => [
        {
          ...payload,
          uploadedAt: new Date().toISOString()
        },
        ...current
      ].slice(0, 8));
      return payload;
    },
    [publicVisible, uploadEnabled, uploading]
  );

  const uploadFiles = useCallback(
    async (files: File[] | FileList | undefined) => {
      if (!files || uploading || !uploadEnabled) return;
      const imageFiles = Array.from(files).filter((file) =>
        file.type.startsWith("image/")
      );
      if (imageFiles.length === 0) {
        setError("没有发现可上传的图片文件。");
        return;
      }

      setUploading(true);
      setUploadCount(imageFiles.length);
      setUploadIndex(0);
      setError("");
      setNotice("");
      try {
        let completed = 0;
        let duplicates = 0;
        for (const file of imageFiles) {
          setUploadIndex(completed + 1);
          const payload = await uploadSingleFile(file);
          completed += 1;
          if (payload?.duplicate) duplicates += 1;
        }
        setNotice(
          imageFiles.length === 1
            ? duplicates
              ? "图片已存在，链接已为你取回。"
              : "上传完成，链接已生成。"
            : `已处理 ${completed} 张图片，其中 ${duplicates} 张为已存在图片。`
        );
        if (publicVisible && site.publicGalleryEnabled) {
          const images = await apiJson<{ images: PublicImage[] }>("/public/images");
          setGallery(images.images);
        }
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "上传失败，请稍后再试"
        );
      } finally {
        setUploading(false);
        setUploadCount(0);
        setUploadIndex(0);
      }
    },
    [
      publicVisible,
      site.publicGalleryEnabled,
      uploadEnabled,
      uploading,
      uploadSingleFile
    ]
  );

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    void uploadFiles(event.target.files ?? undefined);
    event.currentTarget.value = "";
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    void uploadFiles(event.dataTransfer.files);
  };

  const handlePaste = useCallback(
    (event: ClipboardEvent) => {
      if (!uploadEnabled || uploading) return;
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
        file.type.startsWith("image/")
      );
      if (files.length === 0) return;
      event.preventDefault();
      void uploadFiles(files);
    },
    [uploadEnabled, uploading, uploadFiles]
  );

  useEffect(() => {
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  const onPasteCapture = (event: ReactClipboardEvent<HTMLElement>) => {
    if (!uploadEnabled || uploading) return;
    const files = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/")
    );
    if (files.length === 0) return;
    event.preventDefault();
    void uploadFiles(files);
  };

  const galleryItems = useMemo(() => gallery.slice(0, 12), [gallery]);

  return (
    <main
      className="public-upload-page"
      id="main-content"
      onPasteCapture={onPasteCapture}
    >
      <a className="skip-link" href="#public-upload-drop">
        跳到公共上传区域
      </a>

      <header className="public-upload-topbar">
        <Link className="public-upload-brand" href="/">
          <span>
            <img
              alt={`${site.siteName} Logo`}
              height={46}
              src={site.siteLogoUrl || fallbackConfig.site!.siteLogoUrl}
              width={46}
            />
          </span>
          <strong>{site.siteName}</strong>
          <small>{site.siteDescription || "欧记图床"}</small>
        </Link>

        <div>
          <button
            aria-label={dark ? "切换浅色模式" : "切换深色模式"}
            className="public-upload-icon"
            onClick={toggleTheme}
            type="button"
          >
            {dark ? <Sun aria-hidden="true" size={18} /> : <Moon aria-hidden="true" size={18} />}
          </button>
          <Button asChild variant="secondary">
            <Link href="/login">
              <LockKeyhole aria-hidden="true" size={16} />
              登录
            </Link>
          </Button>
        </div>
      </header>

      <section className="public-upload-hero">
        <div className="public-upload-copy">
          <span className="public-upload-eyebrow">PUBLIC IMAGE DESK</span>
          <h1>{site.publicHeroTitle}</h1>
          <p>{site.publicHeroDescription}</p>
          <div className="public-upload-benefits">
            <span>
              <ImageIcon size={17} />
              缩略图展示，节省流量
            </span>
            <span>
              <ShieldCheck size={17} />
              文件类型与大小校验
            </span>
            <span>
              <Check size={17} />
              登录入口保持干净
            </span>
          </div>
        </div>

        <section
          aria-labelledby="public-upload-title"
          className={cn(
            "public-upload-card",
            dragging && "is-dragging",
            !uploadEnabled && "is-disabled"
          )}
          id="public-upload-drop"
          onDragLeave={() => setDragging(false)}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDrop={onDrop}
        >
          <input
            accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
            hidden
            onChange={handleFileChange}
            multiple
            ref={inputRef}
            type="file"
          />
          <span className="public-upload-card__icon">
            <UploadCloud aria-hidden="true" size={30} />
          </span>
          <span className="public-upload-card__badge">
            <Sparkles aria-hidden="true" size={14} />
            公共上传入口
          </span>
          <h2 id="public-upload-title">
            {uploadEnabled ? "拖入图片，立即生成链接" : "公共上传暂未开放"}
          </h2>
          <p>
            {uploadEnabled
              ? "支持拖拽、批量选择和直接粘贴图片。JPG、PNG、WebP、GIF 与 AVIF，单张最大 20 MB。"
              : "管理员可以在后台「设置中心 → 站点与处理」中开启公共上传。"}
          </p>
          <label className="public-upload-checkbox">
            <input
              checked={publicVisible}
              disabled={!site.publicGalleryEnabled}
              onChange={(event) => setPublicVisible(event.target.checked)}
              type="checkbox"
            />
            <span>
              {site.publicGalleryEnabled
                ? "公开展示到公共图床，可取消勾选。"
                : "公共展示已关闭，本次上传不会进入图库。"}
            </span>
          </label>
          <Button
            disabled={!uploadEnabled || uploading}
            onClick={() => inputRef.current?.click()}
            type="button"
          >
            <UploadCloud aria-hidden="true" size={16} />
            {uploading && uploadCount > 1
              ? `正在上传 ${uploadIndex}/${uploadCount}`
              : uploading
                ? "正在上传..."
                : "选择图片上传"}
          </Button>
          <small className="public-upload-card__hint">
            也可以按 Ctrl/⌘ + V 粘贴剪贴板里的图片。
          </small>
        </section>
      </section>

      {(notice || error) && (
        <div className={cn("public-upload-toast", error && "is-error")}>
          <span>{error || notice}</span>
          <button aria-label="关闭提示" onClick={() => { setNotice(""); setError(""); }} type="button">
            <X size={14} />
          </button>
        </div>
      )}

      {result && (
        <section className="public-upload-result" aria-label="上传结果">
          <img alt={result.image.name} src={result.image.thumbnailUrl} />
          <div>
            <span>{result.duplicate ? "已找到同图" : "上传完成"}</span>
            <h2>{result.image.name}</h2>
            <code>{originalUrl}</code>
            <div>
              <Button onClick={() => void copy(originalUrl, "原图链接已复制。")} size="compact" variant="secondary">
                <Clipboard size={15} />
                复制链接
              </Button>
              <Button onClick={() => void copy(markdown, "Markdown 已复制。")} size="compact" variant="secondary">
                <Clipboard size={15} />
                复制 Markdown
              </Button>
              <Button asChild size="compact" variant="ghost">
                <a href={originalUrl} rel="noreferrer" target="_blank">
                  <ExternalLink size={15} />
                  打开图片
                </a>
              </Button>
            </div>
          </div>
        </section>
      )}

      {history.length > 1 && (
        <section className="public-upload-history" aria-label="最近上传结果">
          <div className="public-upload-history__head">
            <span>
              <Images aria-hidden="true" size={17} />
              最近上传
            </span>
            <div>
              <Button
                onClick={() => void copy(historyLinks, "最近上传链接已复制。")}
                size="compact"
                variant="secondary"
              >
                <Clipboard size={15} />
                复制全部链接
              </Button>
              <Button
                onClick={() => void copy(historyMarkdown, "最近上传 Markdown 已复制。")}
                size="compact"
                variant="secondary"
              >
                <Clipboard size={15} />
                复制 Markdown
              </Button>
            </div>
          </div>
          <div className="public-upload-history__list">
            {history.map((item) => {
              const itemUrl = publicUrl(item.image.originalUrl);
              return (
                <article key={`${item.image.id}-${item.uploadedAt}`}>
                  <img alt="" src={item.image.thumbnailUrl} />
                  <div>
                    <strong>{item.image.name}</strong>
                    <small>{item.duplicate ? "已存在图片" : "新上传图片"}</small>
                  </div>
                  <Button
                    onClick={() => void copy(itemUrl, "图片链接已复制。")}
                    size="compact"
                    variant="ghost"
                  >
                    <Clipboard size={15} />
                    复制
                  </Button>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {site.publicGalleryEnabled && galleryItems.length > 0 && (
        <section className="public-gallery" aria-label="公共图床展示">
          <div className="public-gallery__head">
            <span>PUBLIC GALLERY</span>
            <h2>最近公开的图片</h2>
          </div>
          <div className="public-gallery__grid">
            {galleryItems.map((image) => (
              <a href={image.originalUrl} key={image.id} rel="noreferrer" target="_blank">
                <img alt={image.name} loading="lazy" src={image.thumbnailUrl} />
                <span>{image.name}</span>
              </a>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
