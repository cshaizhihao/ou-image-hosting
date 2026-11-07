"use client";

import { Button, cn } from "@ou-image/ui";
import {
  ArrowLeft,
  ArrowRight,
  Clipboard,
  Download,
  EyeOff,
  ExternalLink,
  FileType2,
  Flame,
  ImageIcon,
  Images,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Moon,
  Shuffle,
  Sun,
  Trash2,
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
import { imageLink } from "@/lib/image-links";
import { paginationWindow } from "@/lib/pagination";
import {
  DEFAULT_SITE_BRANDING,
  bindSiteAppearance,
  hasStoredSiteBranding,
  readStoredSiteBranding,
  normalizeSiteBranding,
  storedThemePreference,
  useFallbackLogo,
  writeStoredSiteBranding,
  type AccentPreset,
  type SiteThemePreference
} from "@/lib/site-branding";

type PublicConfig = {
  setupComplete: boolean;
  site: {
    siteName: string;
    siteLogoUrl: string;
    publicUploadEnabled: boolean;
    publicUploadRequiresLogin: boolean;
    publicGalleryEnabled: boolean;
    publicGalleryShowUploader: boolean;
    publicGalleryShowFileName: boolean;
    publicGalleryShowUploadTime: boolean;
    publicUploadDefaultPublic: boolean;
    publicUploadHumanVerificationEnabled: boolean;
    publicUploadLivePhotoEnabled: boolean;
    theme: SiteThemePreference;
    accentPreset: AccentPreset;
  } | null;
};

type PublicImage = {
  id: string;
  name?: string;
  thumbnailUrl: string;
  originalUrl: string;
  liveVideoUrl?: string;
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

function makeFallbackConfig(branding = DEFAULT_SITE_BRANDING): PublicConfig {
  return {
    setupComplete: false,
    site: {
      siteName: branding.siteName,
      siteLogoUrl: branding.siteLogoUrl,
      publicUploadEnabled: true,
      publicUploadRequiresLogin: false,
      publicGalleryEnabled: true,
      publicGalleryShowUploader: false,
      publicGalleryShowFileName: true,
      publicGalleryShowUploadTime: true,
      publicUploadDefaultPublic: true,
      publicUploadHumanVerificationEnabled: false,
      publicUploadLivePhotoEnabled: false,
      theme: branding.theme,
      accentPreset: branding.accentPreset
    }
  };
}

const fallbackConfig: PublicConfig = makeFallbackConfig();

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

function isPublicUploadImageFile(file: File) {
  const name = file.name.toLowerCase();
  return (
    file.type.startsWith("image/") ||
    name.endsWith(".heic") ||
    name.endsWith(".heif")
  );
}

function isLivePhotoVideoFile(file: File) {
  const name = file.name.toLowerCase();
  return (
    file.type === "video/quicktime" ||
    file.type === "video/mp4" ||
    name.endsWith(".mov") ||
    name.endsWith(".mp4")
  );
}

function livePhotoBaseName(file: File) {
  return file.name
    .toLowerCase()
    .replace(/\.(jpe?g|heic|heif|mov|mp4)$/i, "")
    .replace(/[_\-. ]?(livephoto|live)$/i, "")
    .replace(/[_\-. ]+$/g, "");
}

function findLivePhotoVideoForImage(image: File, videos: File[]) {
  if (videos.length === 0) return null;
  const imageBase = livePhotoBaseName(image);
  return (
    videos.find((video) => livePhotoBaseName(video) === imageBase) ?? null
  );
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
  const uploadInProgress = useRef(false);
  const wheelLockRef = useRef(false);
  const personalRequestRef = useRef(0);
  const galleryRequestRef = useRef(0);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const [dark, setDark] = useState(false);
  const [config, setConfig] = useState(fallbackConfig);
  const [configReady, setConfigReady] = useState(false);
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
  const [personalPage, setPersonalPage] = useState(1);
  const [personalTotal, setPersonalTotal] = useState(0);
  const [personalTotalPages, setPersonalTotalPages] = useState(1);
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
  const personalPageSize = 12;
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
    uploadEnabled && site.publicUploadHumanVerificationEnabled && !session.authenticated
  );
  const previewImage =
    previewIndex === null ? null : galleryItems.at(previewIndex) ?? null;
  const selectedPersonalCount = selectedPersonalIds.size;
  const personalPageImages = personalImages;
  const personalPages = useMemo(
    () => paginationWindow(personalPage, personalTotalPages),
    [personalPage, personalTotalPages]
  );
  const originalUrl = result ? publicUrl(result.image.originalUrl) : "";
  const markdown = result
    ? imageLink(result.image.name, originalUrl, "markdown")
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
            imageLink(item.image.name, publicUrl(item.image.originalUrl), "markdown")
        )
        .join("\n"),
    [history]
  );

  useEffect(() => {
    const explicit = storedThemePreference(
      window.localStorage.getItem("ou-theme")
    );
    if (!configReady && !hasStoredSiteBranding()) {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.dataset.theme = prefersDark ? "dark" : "light";
      document.documentElement.dataset.accent = "neutral";
      setDark(prefersDark);
      return () => undefined;
    }
    return bindSiteAppearance(site, explicit, (theme) =>
      setDark(theme === "dark")
    );
  }, [configReady, site]);

  const refreshPublicGallery = useCallback(async (fresh = false) => {
    const requestId = ++galleryRequestRef.current;
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
      if (requestId !== galleryRequestRef.current) return;
      setGallery(payload.images);
      setGalleryPage(payload.page ?? galleryPage);
      setGalleryTotal(payload.total ?? payload.images.length);
      setGalleryTotalPages(payload.totalPages ?? 1);
      if (payload.preferences) setGalleryPreferences(payload.preferences);
    } catch (error) {
      if (requestId === galleryRequestRef.current) throw error;
    } finally {
      if (requestId === galleryRequestRef.current) setGalleryLoading(false);
    }
  }, [galleryFormat, galleryPage, galleryPageSize, gallerySort, site.publicGalleryEnabled]);

  const refreshPersonalImages = useCallback(async () => {
    if (!session.authenticated) return;
    const requestId = ++personalRequestRef.current;
    const payload = await apiJson<{ images: PersonalImage[]; total: number; totalPages: number; page: number }>(
      `/uploads?limit=${personalPageSize}&page=${personalPage}&sort=newest`
    );
    if (requestId !== personalRequestRef.current) return;
    setPersonalImages(payload.images);
    setPersonalTotal(payload.total);
    setPersonalTotalPages(payload.totalPages);
    setPersonalPage(payload.page);
    setSelectedPersonalIds((current) => {
      const validIds = new Set(payload.images.map((image) => image.id));
      return new Set([...current].filter((id) => validIds.has(id)));
    });
  }, [session.authenticated, personalPage]);

  useEffect(() => {
    if (session.authenticated) void refreshPersonalImages().catch(() => setError("上传历史加载失败，请刷新后重试。"));
    return () => { personalRequestRef.current += 1; };
  }, [session.authenticated, refreshPersonalImages]);

  useEffect(() => {
    let alive = true;
    const cached = readStoredSiteBranding();
    if (cached) setConfig(makeFallbackConfig(cached));

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
        if (payload.site) writeStoredSiteBranding(payload.site);
        setConfigReady(true);
        setSession(sessionPayload);
        setPublicVisible(
          payload.site?.publicUploadDefaultPublic ??
            fallbackConfig.site!.publicUploadDefaultPublic
        );
      } catch (requestError) {
        if (alive) {
          setConfigReady(true);
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
    return () => { galleryRequestRef.current += 1; };
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
    if (!requiresHumanChallenge) {
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
  }, [requiresHumanChallenge]);

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
    async (file: File, pairedVideo?: File | null) => {
      if (!uploadEnabled) return;
      if (requiresHumanChallenge && (!humanChallenge || !humanAnswer.trim())) {
        throw new ApiError("请先完成人机验证", 400, "HUMAN_CHALLENGE_REQUIRED");
      }
      setError("");
      setNotice("");
      const livePhotoVideoFile = site.publicUploadLivePhotoEnabled
        ? pairedVideo
        : undefined;
      const body = new FormData();
      body.append("file", file);
      if (livePhotoVideoFile) {
        body.append("livePhotoVideo", livePhotoVideoFile);
      }
      let payload: UploadResult;
      try {
        payload = await apiJson<UploadResult>(
          `/public/uploads?publicVisible=${publicVisible}`,
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
      site.publicUploadLivePhotoEnabled,
    ]
  );

  const uploadFiles = useCallback(
    async (files: File[] | FileList | undefined) => {
      if (!files || uploadInProgress.current || !uploadEnabled) return;
      const selectedFiles = Array.from(files);
      const imageFiles = selectedFiles.filter(isPublicUploadImageFile);
      const videos = selectedFiles.filter(isLivePhotoVideoFile);
      if (imageFiles.length === 0) {
        setError("没有发现可上传的图片文件。");
        return;
      }
      if (requiresHumanChallenge && imageFiles.length > 1) {
        setError("启用人机验证时请每次上传一张图片。");
        return;
      }
      if (videos.some((video) => video.size > 60 * 1024 * 1024)) {
        setError("Live Photo 动态片段不能超过 60 MB。");
        return;
      }

      uploadInProgress.current = true;
      setUploading(true);
      setUploadCount(imageFiles.length);
      setUploadIndex(0);
      setError("");
      setNotice("");
      try {
        let completed = 0;
        let duplicates = 0;
        const usedVideos = new Set<File>();
        for (const file of imageFiles) {
          setUploadIndex(completed + 1);
          const available = videos.filter((video) => !usedVideos.has(video));
          const pairedVideo = findLivePhotoVideoForImage(file, available)
            ?? (imageFiles.length === 1 && videos.length === 1 ? videos[0] : null);
          if (pairedVideo && site.publicUploadLivePhotoEnabled) usedVideos.add(pairedVideo);
          const payload = await uploadSingleFile(file, pairedVideo);
          completed += 1;
          if (payload?.duplicate) duplicates += 1;
        }
        const uploadMessage = imageFiles.length === 1
            ? duplicates
              ? "图片已存在，链接已为你取回。"
              : "上传完成，链接已生成。"
            : `已处理 ${completed} 张图片，其中 ${duplicates} 张为已存在图片。`;
        const unused = videos.length - usedVideos.size;
        setNotice(uploadMessage + (unused ? ` ${unused} 个动态片段未上传：${site.publicUploadLivePhotoEnabled ? "请选择同名的图片与视频一起上传。" : "管理员尚未开启 Live Photo。"}` : ""));
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
        uploadInProgress.current = false;
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
      site.publicUploadLivePhotoEnabled,
      uploadEnabled,
      uploadSingleFile
    ]
  );

  async function deleteSelectedPersonalImages() {
    const ids = Array.from(selectedPersonalIds);
    if (ids.length === 0 || visibilityBusy) return;
    if (!window.confirm(`确定删除选中的 ${ids.length} 张图片吗？删除后会进入回收站。`)) {
      return;
    }
    setVisibilityBusy(true);
    setError("");
    try {
      await apiJson("/uploads/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, action: "trash" })
      });
      setPersonalImages((current) =>
        current.filter((image) => !selectedPersonalIds.has(image.id))
      );
      setSelectedPersonalIds(new Set());
      setNotice("已将选中图片移入回收站。");
      await refreshPersonalImages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败，请稍后再试。");
    } finally {
      setVisibilityBusy(false);
    }
  }

  useEffect(() => {
    if (personalPage > personalTotalPages) setPersonalPage(personalTotalPages);
  }, [personalPage, personalTotalPages]);

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
      if (event.defaultPrevented || !uploadEnabled || uploading) return;
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
              alt=""
              height={46}
              onError={(event) => useFallbackLogo(event.currentTarget)}
              src={site.siteLogoUrl || fallbackConfig.site!.siteLogoUrl}
              width={46}
            />
          </span>
          <strong>{site.siteName}</strong>
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
                {personalImages.length > 0 && (
                  <a href="#my-uploads"><Images size={16} />我的上传</a>
                )}
                {session.backoffice?.allowed && (
                  <Link href="/overview"><LayoutDashboard size={16} />进入后台</Link>
                )}
                <button
                  onClick={() => {
                    window.dispatchEvent(new Event("ou:session-ended"));
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

      <section
        aria-labelledby="public-upload-title"
        className={cn("public-upload-card", dragging && "is-dragging")}
        id="public-upload-drop"
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => {
          event.preventDefault();
          if (uploadEnabled && !uploading) setDragging(true);
        }}
        onDrop={onDrop}
      >
        <input
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,.heic,.heif,video/quicktime,video/mp4,.mov,.mp4"
          hidden
          onChange={handleFileChange}
          multiple
          ref={inputRef}
          type="file"
        />
        <span className="public-upload-card__icon">
          <UploadCloud aria-hidden="true" size={28} />
        </span>
        <h1 id="public-upload-title">上传图片</h1>
        {uploadEnabled ? (
          <>
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
                uploading ||
                (requiresHumanChallenge && (!humanChallenge || !humanAnswer.trim()))
              }
              onClick={() => inputRef.current?.click()}
              type="button"
            >
              {uploading ? (
                <LoaderCircle aria-hidden="true" className="spin" size={16} />
              ) : (
                <ImageIcon aria-hidden="true" size={16} />
              )}
              {uploading
                ? (uploadCount > 1 ? `上传中 ${uploadIndex}/${uploadCount}` : "上传中…")
                : (dragging ? "松开上传" : "选择图片")}
            </Button>
            {site.publicGalleryEnabled && (
              <label className="public-upload-checkbox">
                <input
                  checked={publicVisible}
                  disabled={uploading}
                  onChange={(event) => setPublicVisible(event.target.checked)}
                  type="checkbox"
                />
                <span>公开展示</span>
              </label>
            )}
          </>
        ) : uploadLockedByLogin ? (
          <Button asChild>
            <Link href="/login">
              <LockKeyhole aria-hidden="true" size={16} />
              登录后上传
            </Link>
          </Button>
        ) : (
          <span className="public-upload-card__status" role="status">
            {configReady ? "上传已关闭" : "加载中…"}
          </span>
        )}
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
              <h2>我的上传历史</h2>
            </div>
            <div className="public-user-library__actions">
              <span>{selectedPersonalCount > 0 ? `已选择 ${selectedPersonalCount} 张` : `共 ${personalTotal} 张图片`}</span>
              <Button
                disabled={personalPageImages.length === 0 || visibilityBusy}
                onClick={() => {
                  const currentIds = personalPageImages.map((image) => image.id);
                  setSelectedPersonalIds((current) => {
                    const next = new Set(current);
                    const allSelected = currentIds.every((id) => next.has(id));
                    currentIds.forEach((id) => {
                      if (allSelected) next.delete(id);
                      else next.add(id);
                    });
                    return next;
                  });
                }}
                size="compact"
                variant="ghost"
              >
                本页全选
              </Button>
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
              <Button
                disabled={selectedPersonalCount === 0 || visibilityBusy}
                onClick={() => void deleteSelectedPersonalImages()}
                size="compact"
                variant="ghost"
              >
                <Trash2 size={15} />删除
              </Button>
            </div>
          </div>
          <div className="public-user-library__grid">
            {personalPageImages.map((image) => (
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
                  <small>{image.publicVisible ? "已公开" : "未公开"}</small>
                </span>
              </label>
            ))}
          </div>
          {personalTotalPages > 1 && (
            <div className="public-user-library__pagination" aria-label="我的上传历史分页">
              <button
                disabled={personalPage <= 1}
                onClick={() => setPersonalPage((page) => Math.max(1, page - 1))}
                type="button"
              >
                上一页
              </button>
              <div>
                {personalPages.map((page) => (
                  <button
                    aria-current={page === personalPage ? "page" : undefined}
                    key={page}
                    onClick={() => setPersonalPage(page)}
                    type="button"
                  >
                    {page}
                  </button>
                ))}
              </div>
              <button
                disabled={personalPage >= personalTotalPages}
                onClick={() =>
                  setPersonalPage((page) => Math.min(personalTotalPages, page + 1))
                }
                type="button"
              >
                下一页
              </button>
            </div>
          )}
        </section>
      )}

      {site.publicGalleryEnabled && (
        <section className="public-gallery" aria-label="公共图床展示">
          <div className="public-gallery__head public-gallery__head--toolbar">
            <div>
              <h2>公共图库</h2>
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
              {previewImage.liveVideoUrl ? (
                <video
                  className="public-gallery-preview__live"
                  controls
                  poster={previewImage.originalUrl}
                  src={previewImage.liveVideoUrl}
                />
              ) : (
                <img alt={previewImage.name || "公共图片"} src={previewImage.originalUrl} />
              )}
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
                  <Button onClick={() => void copy(imageLink(previewImage.name || "图片", publicUrl(previewImage.originalUrl), "markdown"), "Markdown 已复制。") } size="compact" variant="secondary"><Clipboard size={15} />Markdown</Button>
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
