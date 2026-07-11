"use client";

import { Button, cn } from "@ou-image/ui";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clipboard,
  Download,
  EyeOff,
  ExternalLink,
  FileType2,
  Flame,
  ImageIcon,
  Images,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Moon,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Sun,
  UploadCloud,
  UserRound,
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
import { paginationWindow } from "@/lib/pagination";
import {
  DEFAULT_SITE_BRANDING,
  bindSiteAppearance,
  normalizeSiteBranding,
  storedThemePreference,
  useFallbackLogo,
  type AccentPreset,
  type SiteThemePreference
} from "@/lib/site-branding";

type PublicConfig = {
  setupComplete: boolean;
  site: {
    siteName: string;
    siteDescription: string;
    siteLogoUrl: string;
    publicUploadEnabled: boolean;
    publicUploadRequiresLogin: boolean;
    publicGalleryEnabled: boolean;
    publicGalleryShowUploader: boolean;
    publicGalleryShowFileName: boolean;
    publicGalleryShowUploadTime: boolean;
    publicUploadDefaultPublic: boolean;
    publicUploadHumanVerificationEnabled: boolean;
    publicHeroTitle: string;
    publicHeroDescription: string;
    theme: SiteThemePreference;
    accentPreset: AccentPreset;
  } | null;
};

type PublicImage = {
  id: string;
  name?: string;
  thumbnailUrl: string;
  originalUrl: string;
  width: number;
  height: number;
  format?: string;
  shareViews?: number;
  uploaderName?: string;
  publicVisible?: boolean;
  createdAt?: string;
};

type PersonalImage = Omit<PublicImage, "name"> & {
  name: string;
  size: number;
  mime: string;
  format: string;
  updatedAt: string;
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
    siteName: DEFAULT_SITE_BRANDING.siteName,
    siteDescription: DEFAULT_SITE_BRANDING.siteDescription,
    siteLogoUrl: DEFAULT_SITE_BRANDING.siteLogoUrl,
    publicUploadEnabled: true,
    publicUploadRequiresLogin: false,
    publicGalleryEnabled: true,
    publicGalleryShowUploader: false,
    publicGalleryShowFileName: true,
    publicGalleryShowUploadTime: true,
    publicUploadDefaultPublic: true,
    publicUploadHumanVerificationEnabled: false,
    publicHeroTitle: DEFAULT_SITE_BRANDING.publicHeroTitle,
    publicHeroDescription: DEFAULT_SITE_BRANDING.publicHeroDescription,
    theme: DEFAULT_SITE_BRANDING.theme,
    accentPreset: DEFAULT_SITE_BRANDING.accentPreset
  }
};

type SessionStatus = {
  authenticated: boolean;
  user?: {
    displayName: string;
    email: string;
    role: "owner" | "member";
  };
  backoffice?: {
    allowed: boolean;
    role: "owner" | "admin" | "member";
  };
};

type GalleryPreferences = {
  showUploader: boolean;
  showFileName: boolean;
  showUploadTime: boolean;
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

function publicDate(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

export function PublicUploadLanding() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wheelLockRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const [dark, setDark] = useState(false);
  const [config, setConfig] = useState<PublicConfig>(fallbackConfig);
  const [session, setSession] = useState<SessionStatus>({ authenticated: false });
  const [gallery, setGallery] = useState<PublicImage[]>([]);
  const [galleryPreferences, setGalleryPreferences] = useState<GalleryPreferences>({
    showUploader: false,
    showFileName: true,
    showUploadTime: true
  });
  const [gallerySort, setGallerySort] = useState<"latest" | "hot" | "random">("latest");
  const [galleryFormat, setGalleryFormat] = useState("all");
  const [galleryPage, setGalleryPage] = useState(1);
  const [galleryPageSize, setGalleryPageSize] = useState(24);
  const [galleryTotal, setGalleryTotal] = useState(0);
  const [galleryTotalPages, setGalleryTotalPages] = useState(1);
  const [galleryLoading, setGalleryLoading] = useState(true);
  const [personalImages, setPersonalImages] = useState<PersonalImage[]>([]);
  const [selectedPersonalIds, setSelectedPersonalIds] = useState<Set<string>>(
    () => new Set()
  );
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [publicVisible, setPublicVisible] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [uploadIndex, setUploadIndex] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [history, setHistory] = useState<UploadQueueItem[]>([]);
  const [humanChallenge, setHumanChallenge] = useState<{
    token: string;
    question: string;
    expiresAt: string;
  } | null>(null);
  const [humanAnswer, setHumanAnswer] = useState("");
  const [humanChallengeLoading, setHumanChallengeLoading] = useState(false);

  const site = config.site ?? fallbackConfig.site!;
  const galleryItems = gallery;
  const galleryPages = useMemo(
    () => paginationWindow(galleryPage, galleryTotalPages),
    [galleryPage, galleryTotalPages]
  );
  const uploadEnabled = Boolean(
    config.setupComplete &&
      site.publicUploadEnabled &&
      (!site.publicUploadRequiresLogin || session.authenticated)
  );
  const uploadLockedByLogin = Boolean(
    config.setupComplete &&
      site.publicUploadEnabled &&
      site.publicUploadRequiresLogin &&
      !session.authenticated
  );
  const requiresHumanChallenge = Boolean(
    site.publicUploadHumanVerificationEnabled && !session.authenticated
  );
  const previewImage =
    previewIndex === null ? null : galleryItems.at(previewIndex) ?? null;
  const selectedPersonalCount = selectedPersonalIds.size;
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
    const explicit = storedThemePreference(
      window.localStorage.getItem("ou-theme")
    );
    return bindSiteAppearance(site, explicit, (theme) =>
      setDark(theme === "dark")
    );
  }, [site]);

  const refreshPublicGallery = useCallback(async (fresh = false) => {
    if (!site.publicGalleryEnabled) {
      setGallery([]);
      setGalleryTotal(0);
      setGalleryTotalPages(1);
      setGalleryLoading(false);
      return;
    }
    setGalleryLoading(true);
    try {
      const payload = await apiJson<{
        images: PublicImage[];
        preferences?: GalleryPreferences;
        page?: number;
        total?: number;
        totalPages?: number;
      }>(
        `/public/images?sort=${gallerySort}&format=${galleryFormat}&page=${galleryPage}&limit=${galleryPageSize}`,
        { cache: fresh ? "reload" : "default" }
      );
      setGallery(payload.images);
      setGalleryPage(payload.page ?? galleryPage);
      setGalleryTotal(payload.total ?? payload.images.length);
      setGalleryTotalPages(payload.totalPages ?? 1);
      if (payload.preferences) setGalleryPreferences(payload.preferences);
    } finally {
      setGalleryLoading(false);
    }
  }, [galleryFormat, galleryPage, galleryPageSize, gallerySort, site.publicGalleryEnabled]);

  const refreshPersonalImages = useCallback(async () => {
    if (!session.authenticated) return;
    const payload = await apiJson<{ images: PersonalImage[] }>(
      "/uploads?limit=18&sort=newest"
    );
    setPersonalImages(payload.images);
    setSelectedPersonalIds((current) => {
      const validIds = new Set(payload.images.map((image) => image.id));
      return new Set([...current].filter((id) => validIds.has(id)));
    });
  }, [session.authenticated]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [payload, sessionPayload] = await Promise.all([
          apiJson<PublicConfig>("/public/config"),
          apiJson<{
            user: NonNullable<SessionStatus["user"]>;
            backoffice?: SessionStatus["backoffice"];
          }>("/auth/session")
            .then((payload) => ({
              authenticated: true as const,
              user: payload.user,
              backoffice: payload.backoffice
            }))
            .catch(() => ({ authenticated: false }))
        ]);
        if (!alive) return;
        setConfig(
          payload.site
            ? {
                ...payload,
                site: {
                  ...payload.site,
                  ...normalizeSiteBranding(payload.site)
                }
              }
            : payload
        );
        setSession(sessionPayload);
        setPublicVisible(
          payload.site?.publicUploadDefaultPublic ??
            fallbackConfig.site!.publicUploadDefaultPublic
        );
        if (sessionPayload.authenticated) {
          const personal = await apiJson<{ images: PersonalImage[] }>(
            "/uploads?limit=18&sort=newest"
          );
          if (alive) setPersonalImages(personal.images);
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

  useEffect(() => {
    void refreshPublicGallery().catch((requestError) => {
      setError(
        requestError instanceof Error ? requestError.message : "公共图库加载失败"
      );
    });
  }, [refreshPublicGallery]);

  const togglePersonalSelection = (imageId: string) => {
    setSelectedPersonalIds((current) => {
      const next = new Set(current);
      if (next.has(imageId)) next.delete(imageId);
      else next.add(imageId);
      return next;
    });
  };

  const setSelectedPersonalVisibility = async (publicVisibleNext: boolean) => {
    if (selectedPersonalIds.size === 0 || visibilityBusy) return;
    setVisibilityBusy(true);
    setError("");
    setNotice("");
    try {
      const payload = await apiJson<{ updated: number; publicVisible: boolean }>(
        "/uploads/bulk",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ids: Array.from(selectedPersonalIds),
            action: "set-public-visibility",
            publicVisible: publicVisibleNext
          })
        }
      );
      setNotice(
        publicVisibleNext
          ? `已公开 ${payload.updated} 张图片。`
          : `已隐藏 ${payload.updated} 张图片。`
      );
      const selectedIds = new Set(selectedPersonalIds);
      setPersonalImages((current) =>
        current.map((image) =>
          selectedIds.has(image.id)
            ? { ...image, publicVisible: publicVisibleNext }
            : image
        )
      );
      setSelectedPersonalIds(new Set());
      if (publicVisibleNext) {
        await refreshPublicGallery(true);
      } else {
        setGallery((current) =>
          current.filter((image) => !selectedIds.has(image.id))
        );
        setGalleryTotal((current) =>
          Math.max(0, current - [...selectedIds].filter((id) =>
            gallery.some((image) => image.id === id)
          ).length)
        );
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "公开状态更新失败"
      );
    } finally {
      setVisibilityBusy(false);
    }
  };

  const closePreview = useCallback(() => setPreviewIndex(null), []);

  const movePreview = useCallback(
    (direction: -1 | 1) => {
      setPreviewIndex((current) => {
        if (current === null || galleryItems.length === 0) return current;
        return (current + direction + galleryItems.length) % galleryItems.length;
      });
    },
    [galleryItems.length]
  );

  useEffect(() => {
    if (previewIndex === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePreview();
      if (event.key === "ArrowLeft") movePreview(-1);
      if (event.key === "ArrowRight") movePreview(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePreview, movePreview, previewIndex]);

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

  const refreshHumanChallenge = useCallback(async () => {
    if (!requiresHumanChallenge || !uploadEnabled) {
      setHumanChallenge(null);
      setHumanAnswer("");
      return;
    }
    setHumanChallengeLoading(true);
    try {
      const challenge = await apiJson<{
        enabled: boolean;
        token?: string;
        question?: string;
        expiresAt?: string;
      }>("/public/upload-challenge");
      setHumanChallenge(
        challenge.enabled && challenge.token && challenge.question && challenge.expiresAt
          ? {
              token: challenge.token,
              question: challenge.question,
              expiresAt: challenge.expiresAt
            }
          : null
      );
      setHumanAnswer("");
    } catch (requestError) {
      setHumanChallenge(null);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "人机验证加载失败"
      );
    } finally {
      setHumanChallengeLoading(false);
    }
  }, [requiresHumanChallenge, uploadEnabled]);

  useEffect(() => {
    void refreshHumanChallenge();
  }, [refreshHumanChallenge]);

  const hidePreviewImage = async () => {
    if (!previewImage || !session.backoffice?.allowed) return;
    setVisibilityBusy(true);
    setError("");
    try {
      await apiJson(`/public/images/${encodeURIComponent(previewImage.id)}/hide`, {
        method: "POST"
      });
      closePreview();
      setNotice("图片已从公共图库隐藏，原上传者仍可在自己的历史记录中看到它。");
      setGallery((current) =>
        current.filter((image) => image.id !== previewImage.id)
      );
      setGalleryTotal((current) => Math.max(0, current - 1));
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "隐藏图片失败"
      );
    } finally {
      setVisibilityBusy(false);
    }
  };

  const uploadSingleFile = useCallback(
    async (file?: File) => {
      if (!file || uploading || !uploadEnabled) return;
      if (requiresHumanChallenge && (!humanChallenge || !humanAnswer.trim())) {
        throw new ApiError("请先完成人机验证", 400, "HUMAN_CHALLENGE_REQUIRED");
      }
      setError("");
      setNotice("");
      const body = new FormData();
      body.append("file", file);
      let payload: UploadResult;
      try {
        payload = await apiJson<UploadResult>(
          `/public/uploads?publicVisible=${publicVisible ? "true" : "false"}`,
          {
            method: "POST",
            body,
            headers: requiresHumanChallenge
              ? {
                  "x-ou-challenge-token": humanChallenge!.token,
                  "x-ou-challenge-answer": humanAnswer.trim()
                }
              : undefined
          }
        );
      } finally {
        if (requiresHumanChallenge) {
          await refreshHumanChallenge();
        }
      }
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
    [
      humanAnswer,
      humanChallenge,
      publicVisible,
      refreshHumanChallenge,
      requiresHumanChallenge,
      uploadEnabled,
      uploading
    ]
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
      if (requiresHumanChallenge && imageFiles.length > 1) {
        setError("启用人机验证时请每次上传一张图片。");
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
          await refreshPublicGallery(true);
        }
        if (session.authenticated) {
          await refreshPersonalImages();
        }
      } catch (requestError) {
        if (
          requestError instanceof ApiError &&
          requestError.code === "LOGIN_REQUIRED_FOR_PUBLIC_UPLOAD"
        ) {
          setError("管理员已开启登录后上传，请先登录再上传图片。");
          setSession({ authenticated: false });
          return;
        }
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
      requiresHumanChallenge,
      refreshPersonalImages,
      refreshPublicGallery,
      session.authenticated,
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
              onError={(event) => useFallbackLogo(event.currentTarget)}
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
          {session.authenticated && session.user ? (
            <details className="public-account-menu">
              <summary>
                <span>{session.user.displayName.slice(0, 2).toUpperCase()}</span>
                <strong>{session.user.displayName}</strong>
              </summary>
              <div>
                <header>
                  <strong>{session.user.displayName}</strong>
                  <small>{session.user.email}</small>
                </header>
                <a href="#my-uploads"><Images size={16} />我的上传</a>
                {session.backoffice?.allowed && (
                  <Link href="/overview"><LayoutDashboard size={16} />进入后台</Link>
                )}
                <button
                  onClick={() => {
                    void apiJson("/auth/logout", { method: "POST" }).finally(() => {
                      window.location.replace("/");
                    });
                  }}
                  type="button"
                >
                  <LogOut size={16} />退出登录
                </button>
              </div>
            </details>
          ) : (
            <Button asChild variant="secondary">
              <Link href="/login">
                <LockKeyhole aria-hidden="true" size={16} />
                登录
              </Link>
            </Button>
          )}
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
              {site.publicUploadRequiresLogin ? "支持登录后上传" : "访客可直接上传"}
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
            accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,.heic,.heif"
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
            {uploadEnabled
              ? "拖入图片，立即生成链接"
              : uploadLockedByLogin
                ? "登录后即可上传图片"
                : "公共上传暂未开放"}
          </h2>
          <p>
            {uploadEnabled
              ? "支持拖拽、批量选择和直接粘贴图片。JPG、PNG、WebP、GIF 与 AVIF，单张最大 20 MB。"
              : uploadLockedByLogin
                ? "当前站点允许访问公共图床，但管理员要求上传前先登录。"
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
          {requiresHumanChallenge && (
            <div className="public-upload-challenge">
              <label htmlFor="public-upload-challenge-answer">
                <span>简单验证</span>
                <strong>
                  {humanChallengeLoading
                    ? "正在出题..."
                    : humanChallenge?.question ?? "暂时无法获取题目"}
                </strong>
              </label>
              <input
                autoComplete="off"
                disabled={humanChallengeLoading || !humanChallenge}
                id="public-upload-challenge-answer"
                inputMode="numeric"
                maxLength={3}
                onChange={(event) =>
                  setHumanAnswer(event.target.value.replace(/\D/g, ""))
                }
                placeholder="答案"
                value={humanAnswer}
              />
              <button
                disabled={humanChallengeLoading}
                onClick={() => void refreshHumanChallenge()}
                type="button"
              >
                换一题
              </button>
            </div>
          )}
          <Button
            disabled={
              !uploadEnabled ||
              uploading ||
              (requiresHumanChallenge &&
                (!humanChallenge || !humanAnswer.trim()))
            }
            onClick={() => inputRef.current?.click()}
            type="button"
          >
            {uploadLockedByLogin ? (
              <LockKeyhole aria-hidden="true" size={16} />
            ) : (
              <UploadCloud aria-hidden="true" size={16} />
            )}
            {uploadLockedByLogin
              ? "请先登录"
              : uploading && uploadCount > 1
                ? `正在上传 ${uploadIndex}/${uploadCount}`
                : uploading
                  ? "正在上传..."
                  : "选择图片上传"}
          </Button>
          {uploadLockedByLogin && (
            <Button asChild size="compact" variant="secondary">
              <Link href="/login">
                <LockKeyhole aria-hidden="true" size={15} />
                登录后上传
              </Link>
            </Button>
          )}
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

      {session.authenticated && personalImages.length > 0 && (
        <section className="public-user-library" aria-label="我的上传历史" id="my-uploads">
          <div className="public-user-library__head">
            <div>
              <span>MY UPLOADS</span>
              <h2>我的上传历史</h2>
              <p>登录后上传的图片会留在这里，可多选后公开或从公共图床隐藏。</p>
            </div>
            <div className="public-user-library__actions">
              <span>{selectedPersonalCount > 0 ? `已选择 ${selectedPersonalCount} 张` : `${personalImages.length} 张最近上传`}</span>
              <Button
                disabled={selectedPersonalCount === 0 || visibilityBusy}
                onClick={() => void setSelectedPersonalVisibility(true)}
                size="compact"
                variant="secondary"
              >
                设为公开
              </Button>
              <Button
                disabled={selectedPersonalCount === 0 || visibilityBusy}
                onClick={() => void setSelectedPersonalVisibility(false)}
                size="compact"
                variant="ghost"
              >
                设为隐藏
              </Button>
            </div>
          </div>
          <div className="public-user-library__grid">
            {personalImages.map((image) => (
              <label
                className={cn(
                  "public-user-library__card",
                  selectedPersonalIds.has(image.id) && "is-selected"
                )}
                key={image.id}
              >
                <input
                  checked={selectedPersonalIds.has(image.id)}
                  onChange={() => togglePersonalSelection(image.id)}
                  type="checkbox"
                />
                <img
                  alt={image.name}
                  decoding="async"
                  height={image.height}
                  loading="lazy"
                  src={image.thumbnailUrl}
                  width={image.width}
                />
                <span>
                  <strong title={image.name}>{image.name}</strong>
                  <small>{image.publicVisible ? "正在公共图床展示" : "仅自己可见"}</small>
                </span>
              </label>
            ))}
          </div>
        </section>
      )}

      {site.publicGalleryEnabled && (
        <section className="public-gallery" aria-label="公共图床展示">
          <div className="public-gallery__head public-gallery__head--toolbar">
            <div>
              <span>PUBLIC GALLERY</span>
              <h2>公共图片展台</h2>
              <p>轻量缩略图浏览，点击后在当前页面查看。</p>
            </div>
            <div className="public-gallery__filters" aria-label="公共图库筛选">
              <div className="public-gallery__segments">
                {([
                  ["latest", "最新", Images],
                  ["hot", "最热", Flame],
                  ["random", "随机", Shuffle]
                ] as const).map(([value, label, Icon]) => (
                  <button
                    aria-pressed={gallerySort === value}
                    key={value}
                    onClick={() => {
                      setGallerySort(value);
                      setGalleryPage(1);
                    }}
                    type="button"
                  >
                    <Icon aria-hidden="true" size={15} />{label}
                  </button>
                ))}
              </div>
              <label>
                <FileType2 aria-hidden="true" size={16} />
                <span className="sr-only">筛选图片格式</span>
                <select
                  onChange={(event) => {
                    setGalleryFormat(event.target.value);
                    setGalleryPage(1);
                  }}
                  value={galleryFormat}
                >
                  <option value="all">全部格式</option>
                  <option value="jpeg">JPG</option>
                  <option value="png">PNG</option>
                  <option value="webp">WebP</option>
                  <option value="gif">GIF</option>
                  <option value="avif">AVIF</option>
                </select>
              </label>
              <label>
                <Images aria-hidden="true" size={16} />
                <span className="sr-only">每页图片数量</span>
                <select
                  aria-label="公共图库每页图片数量"
                  onChange={(event) => {
                    setGalleryPageSize(Number(event.target.value));
                    setGalleryPage(1);
                  }}
                  value={galleryPageSize}
                >
                  <option value={12}>12 张</option>
                  <option value={24}>24 张</option>
                  <option value={36}>36 张</option>
                </select>
              </label>
            </div>
          </div>
          {galleryLoading ? (
            <div className="public-gallery__grid" aria-label="正在加载公共图片">
              {Array.from({ length: 8 }, (_, index) => <span className="public-gallery__skeleton" key={index} />)}
            </div>
          ) : galleryItems.length === 0 ? (
            <div className="public-gallery__empty">
              <Images aria-hidden="true" size={30} />
              <strong>{galleryFormat === "all" ? "公共图库还没有图片" : "这个格式暂时没有公开图片"}</strong>
              <span>上传时选择公开展示，图片就会来到这里。</span>
            </div>
          ) : (
            <div className="public-gallery__grid">
              {galleryItems.map((image, index) => {
                const displayName = image.name || "公共图片";
                return (
                  <button
                    aria-label={`预览 ${displayName}`}
                    key={image.id}
                    onClick={() => setPreviewIndex(index)}
                    type="button"
                  >
                    <img
                      alt={displayName}
                      decoding="async"
                      height={image.height}
                      loading="lazy"
                      src={image.thumbnailUrl}
                      width={image.width}
                    />
                    {(galleryPreferences.showFileName || galleryPreferences.showUploader || galleryPreferences.showUploadTime) && (
                      <span>
                        {galleryPreferences.showFileName && <strong>{displayName}</strong>}
                        <small>
                          {[
                            galleryPreferences.showUploader ? image.uploaderName : "",
                            galleryPreferences.showUploadTime ? publicDate(image.createdAt) : ""
                          ].filter(Boolean).join(" · ")}
                        </small>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {!galleryLoading && galleryTotal > 0 && (
            <nav className="public-gallery__pagination" aria-label="公共图库分页">
              <button
                disabled={galleryPage <= 1}
                onClick={() =>
                  setGalleryPage((current) => Math.max(1, current - 1))
                }
                type="button"
              >
                <ArrowLeft aria-hidden="true" size={16} />上一页
              </button>
              <span>{galleryTotal} 张公开图片</span>
              <div aria-label="选择页码">
                {galleryPages.map((pageNumber) => (
                  <button
                    aria-current={pageNumber === galleryPage ? "page" : undefined}
                    key={pageNumber}
                    onClick={() => setGalleryPage(pageNumber)}
                    type="button"
                  >
                    {pageNumber}
                  </button>
                ))}
              </div>
              <button
                disabled={galleryPage >= galleryTotalPages}
                onClick={() =>
                  setGalleryPage((current) =>
                    Math.min(galleryTotalPages, current + 1)
                  )
                }
                type="button"
              >
                下一页<ArrowRight aria-hidden="true" size={16} />
              </button>
            </nav>
          )}
        </section>
      )}

      {previewImage && (
        <div
          aria-label="公共图床图片预览"
          aria-modal="true"
          className="public-gallery-preview"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePreview();
          }}
          onTouchEnd={(event) => {
            const start = touchStartRef.current;
            touchStartRef.current = null;
            const touch = event.changedTouches[0];
            if (!start || !touch) return;
            const deltaX = touch.clientX - start.x;
            const deltaY = touch.clientY - start.y;
            if (Math.abs(deltaX) < 42 || Math.abs(deltaX) < Math.abs(deltaY)) {
              return;
            }
            movePreview(deltaX > 0 ? -1 : 1);
          }}
          onTouchStart={(event) => {
            const touch = event.touches[0];
            if (!touch) return;
            touchStartRef.current = { x: touch.clientX, y: touch.clientY };
          }}
          onWheel={(event) => {
            if (Math.abs(event.deltaY) < 20 || wheelLockRef.current) return;
            wheelLockRef.current = true;
            movePreview(event.deltaY > 0 ? 1 : -1);
            window.setTimeout(() => {
              wheelLockRef.current = false;
            }, 260);
          }}
          role="dialog"
        >
          <section className="public-gallery-preview__panel">
            <button
              aria-label="关闭预览"
              className="public-gallery-preview__close"
              onClick={closePreview}
              type="button"
            >
              <X aria-hidden="true" size={18} />
            </button>
            <button
              aria-label="上一张图片"
              className="public-gallery-preview__nav is-left"
              onClick={() => movePreview(-1)}
              type="button"
            >
              <ArrowLeft aria-hidden="true" size={22} />
            </button>
            <figure>
              <img alt={previewImage.name || "公共图片"} src={previewImage.originalUrl} />
              <figcaption>
                <div>
                  <strong>{previewImage.name || "公共图片"}</strong>
                  <span>
                    {previewImage.width} × {previewImage.height}
                    {previewImage.format && ` · ${previewImage.format.toUpperCase()}`}
                    {galleryItems.length > 1 && ` · ${(previewIndex ?? 0) + 1}/${galleryItems.length}`}
                  </span>
                  {(previewImage.uploaderName || previewImage.createdAt) && (
                    <small>{[previewImage.uploaderName, publicDate(previewImage.createdAt)].filter(Boolean).join(" · ")}</small>
                  )}
                </div>
                <div className="public-gallery-preview__tools">
                  <Button onClick={() => void copy(publicUrl(previewImage.originalUrl), "图片链接已复制。") } size="compact" variant="secondary"><Clipboard size={15} />复制链接</Button>
                  <Button onClick={() => void copy(`![${previewImage.name || "图片"}](${publicUrl(previewImage.originalUrl)})`, "Markdown 已复制。") } size="compact" variant="secondary"><Clipboard size={15} />Markdown</Button>
                  <Button asChild size="compact" variant="ghost"><a download href={previewImage.originalUrl}><Download size={15} />下载</a></Button>
                  <Button asChild size="compact" variant="ghost"><a href={previewImage.originalUrl} rel="noreferrer" target="_blank"><ExternalLink size={15} />原图</a></Button>
                  {session.backoffice?.allowed && (
                    <Button disabled={visibilityBusy} onClick={() => void hidePreviewImage()} size="compact" variant="ghost"><EyeOff size={15} />隐藏</Button>
                  )}
                </div>
              </figcaption>
            </figure>
            <button
              aria-label="下一张图片"
              className="public-gallery-preview__nav is-right"
              onClick={() => movePreview(1)}
              type="button"
            >
              <ArrowRight aria-hidden="true" size={22} />
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
