"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Button, cn } from "@ou-image/ui";
import {
  Album,
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  Edit3,
  FolderOpen,
  FolderPlus,
  ImageIcon,
  ImagePlus,
  Images,
  LoaderCircle,
  Plus,
  Search,
  Settings2,
  Trash2,
  X
} from "lucide-react";
import Link from "next/link";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";
import { apiRequest } from "@/lib/api";
import { AppShell } from "./app-shell";
import styles from "./albums-console.module.css";

type AlbumItem = {
  id: string;
  name: string;
  description: string;
  coverImageId?: string;
  coverThumbnailUrl?: string;
  coverMode?: "auto" | "custom" | "none";
  imageCount: number;
  createdAt: string;
  updatedAt: string;
};

type DialogMode = "create" | "edit";
type AlbumSort = "newest" | "oldest" | "name";
type ManageView = "overview" | "cover" | "add";

type LibraryImage = {
  id: string;
  name: string;
  format: "jpeg" | "png" | "webp" | "gif" | "avif" | "heic" | "heif";
  width: number;
  height: number;
  thumbnailUrl: string;
  albumIds: string[];
  createdAt: string;
};

type ImageListResponse = {
  images: LibraryImage[];
  total: number;
  page: number;
  totalPages: number;
};

function AlbumDialog({ children, className, onClose }: {
  children: ReactNode;
  className?: string;
  onClose: () => void;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogBackdrop}>
          <Dialog.Content
            className={cn(styles.dialog, className)}
            onOpenAutoFocus={() => { returnFocus.current = document.activeElement as HTMLElement; }}
            onCloseAutoFocus={(event) => {
              if (returnFocus.current?.isConnected) {
                event.preventDefault();
                returnFocus.current.focus();
              }
            }}
          >
            {children}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function requestMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function AlbumsConsole() {
  const [albums, setAlbums] = useState<AlbumItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>("create");
  const [editingAlbum, setEditingAlbum] = useState<AlbumItem | null>(null);
  const [deleteAlbum, setDeleteAlbum] = useState<AlbumItem | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<AlbumSort>("newest");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [managingAlbumId, setManagingAlbumId] = useState("");
  const [manageView, setManageView] = useState<ManageView>("overview");
  const [albumImages, setAlbumImages] = useState<LibraryImage[]>([]);
  const [libraryImages, setLibraryImages] = useState<LibraryImage[]>([]);
  const [imageQuery, setImageQuery] = useState("");
  const [imagePage, setImagePage] = useState(1);
  const [imageTotalPages, setImageTotalPages] = useState(1);
  const [imageTotal, setImageTotal] = useState(0);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [coverPage, setCoverPage] = useState(1);
  const [coverTotalPages, setCoverTotalPages] = useState(1);
  const [manageRevision, setManageRevision] = useState(0);
  const manageTabsId = useId();
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [manageLoading, setManageLoading] = useState(false);
  const [manageBusy, setManageBusy] = useState("");
  const [manageNotice, setManageNotice] = useState("");
  const [manageError, setManageError] = useState("");

  const loadAlbums = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await apiRequest<{ albums: AlbumItem[] }>("/albums");
      setAlbums(payload.albums);
    } catch (requestError) {
      setError(requestMessage(requestError, "相册加载失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAlbums();
  }, [loadAlbums]);

  const totalImages = useMemo(
    () => albums.reduce((total, album) => total + album.imageCount, 0),
    [albums]
  );

  const filteredAlbums = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return albums
      .filter(
        (album) =>
          !keyword ||
          album.name.toLocaleLowerCase().includes(keyword) ||
          album.description.toLocaleLowerCase().includes(keyword)
      )
      .sort((left, right) => {
        if (sort === "oldest") return left.createdAt.localeCompare(right.createdAt);
        if (sort === "name") return left.name.localeCompare(right.name, "zh-CN");
        return right.updatedAt.localeCompare(left.updatedAt);
      });
  }, [albums, query, sort]);

  const managedAlbum = albums.find((album) => album.id === managingAlbumId);

  const addableImages = useMemo(() => {
    if (!managedAlbum) return [];
    return libraryImages.filter(
      (image) => !image.albumIds.includes(managedAlbum.id)
    );
  }, [libraryImages, managedAlbum]);

  const allAddableSelected =
    addableImages.length > 0 &&
    addableImages.every((image) => selectedImages.has(image.id));

  useEffect(() => {
    if (!managingAlbumId) return;
    const controller = new AbortController();
    setManageLoading(true);
    setManageError("");
    const params = new URLSearchParams({ albumId: managingAlbumId, page: String(coverPage), limit: "24" });
    void apiRequest<ImageListResponse>(`/uploads?${params}`, { signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted) return;
        setAlbumImages(payload.images);
        setCoverTotalPages(payload.totalPages);
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) setManageError(requestMessage(requestError, "相册图片加载失败"));
      })
      .finally(() => { if (!controller.signal.aborted) setManageLoading(false); });
    return () => controller.abort();
  }, [managingAlbumId, coverPage, manageRevision]);

  useEffect(() => {
    if (!managingAlbumId || manageView !== "add") return;
    const controller = new AbortController();
    setLibraryLoading(true);
    setManageError("");
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ excludeAlbumId: managingAlbumId, q: imageQuery.trim(), page: String(imagePage), limit: "24" });
      void apiRequest<ImageListResponse>(`/uploads?${params}`, { signal: controller.signal })
        .then((payload) => {
          if (controller.signal.aborted) return;
          setLibraryImages(payload.images);
          setImageTotalPages(payload.totalPages);
          setImageTotal(payload.total);
          setImagePage(payload.page);
        })
        .catch((requestError: unknown) => {
          if (!controller.signal.aborted) setManageError(requestMessage(requestError, "图片库加载失败"));
        })
        .finally(() => { if (!controller.signal.aborted) setLibraryLoading(false); });
    }, 240);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [managingAlbumId, manageView, imageQuery, imagePage]);

  const openManageDialog = (album: AlbumItem, view: ManageView = "overview") => {
    setManagingAlbumId(album.id);
    setManageView(view);
    setImageQuery("");
    setImagePage(1);
    setCoverPage(1);
    setSelectedImages(new Set());
    setManageNotice("");
    setManageError("");
    setAlbumImages([]);
    setLibraryImages([]);
  };

  const updateManagedAlbum = (album: AlbumItem) => {
    setAlbums((current) =>
      current.map((item) => (item.id === album.id ? album : item))
    );
  };

  const updateCoverMode = async (
    mode: "auto" | "none",
    successMessage: string
  ) => {
    if (!managedAlbum || manageBusy) return;
    setManageBusy(`cover-${mode}`);
    setManageError("");
    setManageNotice("");
    try {
      const payload = await apiRequest<{ album: AlbumItem }>(
        `/albums/${managedAlbum.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ coverMode: mode })
        }
      );
      updateManagedAlbum(payload.album);
      setManageNotice(successMessage);
    } catch (requestError) {
      setManageError(requestMessage(requestError, "封面设置失败"));
    } finally {
      setManageBusy("");
    }
  };

  const setCustomCover = async (imageId: string) => {
    if (!managedAlbum || manageBusy) return;
    setManageBusy(`cover-${imageId}`);
    setManageError("");
    setManageNotice("");
    try {
      const payload = await apiRequest<{ album: AlbumItem }>(
        `/albums/${managedAlbum.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ coverImageId: imageId })
        }
      );
      updateManagedAlbum(payload.album);
      setManageNotice("已使用选中的图片作为相册封面。");
    } catch (requestError) {
      setManageError(requestMessage(requestError, "封面设置失败"));
    } finally {
      setManageBusy("");
    }
  };

  const toggleImageSelection = (imageId: string) => {
    setSelectedImages((current) => {
      const next = new Set(current);
      if (next.has(imageId)) next.delete(imageId);
      else next.add(imageId);
      return next;
    });
  };

  const addImagesToAlbum = async () => {
    if (!managedAlbum || selectedImages.size === 0 || manageBusy) return;
    setManageBusy("add-images");
    setManageError("");
    setManageNotice("");
    try {
      const payload = await apiRequest<{ updated: number }>("/uploads/bulk", {
        method: "POST",
        body: JSON.stringify({
          ids: Array.from(selectedImages),
          action: "add-to-albums",
          albumIds: [managedAlbum.id]
        })
      });
      const addedIds = new Set(selectedImages);
      const added = libraryImages.filter((image) => addedIds.has(image.id));
      setAlbumImages((current) => [...added, ...current]);
      setLibraryImages((current) =>
        current.map((image) =>
          addedIds.has(image.id)
            ? { ...image, albumIds: [...image.albumIds, managedAlbum.id] }
            : image
        )
      );
      const addedCount = payload.updated ?? selectedImages.size;
      setAlbums((current) =>
        current.map((album) =>
          album.id === managedAlbum.id
            ? {
                ...album,
                imageCount: album.imageCount + addedCount,
                updatedAt: new Date().toISOString()
              }
            : album
        )
      );
      try {
        const albumSnapshot = await apiRequest<{ albums: AlbumItem[] }>("/albums");
        setAlbums(albumSnapshot.albums);
      } catch {
        // The images were added successfully; the optimistic summary remains usable.
      }
      setManageNotice(`已将 ${addedCount} 张图片加入相册。`);
      setCoverPage(1);
      setManageRevision((revision) => revision + 1);
      setSelectedImages(new Set());
      setManageView("overview");
    } catch (requestError) {
      setManageError(requestMessage(requestError, "加入相册失败"));
    } finally {
      setManageBusy("");
    }
  };

  const openCreateDialog = () => {
    setDialogMode("create");
    setEditingAlbum(null);
    setName("");
    setDescription("");
    setError("");
    setDialogOpen(true);
  };

  const openEditDialog = (album: AlbumItem) => {
    setManagingAlbumId("");
    setDialogMode("edit");
    setEditingAlbum(album);
    setName(album.name);
    setDescription(album.description);
    setError("");
    setDialogOpen(true);
  };

  const saveAlbum = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) return;
    setSaving(true);
    setNotice("");
    setError("");
    try {
      if (dialogMode === "edit" && editingAlbum) {
        const payload = await apiRequest<{ album: AlbumItem }>(
          `/albums/${editingAlbum.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              name: nextName,
              description: description.trim()
            })
          }
        );
        setAlbums((current) =>
          current.map((album) =>
            album.id === payload.album.id ? payload.album : album
          )
        );
        setNotice(`相册「${payload.album.name}」已更新。`);
      } else {
        const payload = await apiRequest<{ album: AlbumItem }>("/albums", {
          method: "POST",
          body: JSON.stringify({
            name: nextName,
            description: description.trim()
          })
        });
        setAlbums((current) => [payload.album, ...current]);
        setNotice(`相册「${payload.album.name}」已创建。`);
      }
      setName("");
      setDescription("");
      setEditingAlbum(null);
      setDialogOpen(false);
    } catch (requestError) {
      setError(
        requestMessage(
          requestError,
          dialogMode === "edit" ? "相册更新失败" : "相册创建失败"
        )
      );
    } finally {
      setSaving(false);
    }
  };

  const removeAlbum = async () => {
    if (!deleteAlbum) return;
    setDeleting(true);
    setNotice("");
    setError("");
    try {
      await apiRequest(`/albums/${deleteAlbum.id}`, { method: "DELETE" });
      setAlbums((current) =>
        current.filter((album) => album.id !== deleteAlbum.id)
      );
      setNotice(`相册「${deleteAlbum.name}」已删除，图片仍保留在图片库。`);
      setDeleteAlbum(null);
    } catch (requestError) {
      setError(requestMessage(requestError, "相册删除失败"));
    } finally {
      setDeleting(false);
    }
  };

  const dialogTitle = dialogMode === "edit" ? "编辑相册" : "新建相册";
  const dialogSubtitle =
    dialogMode === "edit" ? "调整名称和描述" : "建立一个清晰的新分类";
  const managedCoverMode = managedAlbum?.coverMode ??
    (managedAlbum?.coverImageId ? "custom" : "auto");

  return (
    <AppShell activeKey="albums">
      <main className={`workspace-page ${styles.page}`}>
        <header className={styles.header}>
          <div className={styles.headerCopy}>
            <span>ALBUMS</span>
            <h1>相册</h1>
            <p>
              把图片按照项目、主题和用途分成不同卡片；图片会继续留在图片库里，
              也可以同时出现在多个相册中。
            </p>
          </div>
          <Button onClick={openCreateDialog}>
            <Plus aria-hidden="true" size={17} />
            新建相册
          </Button>
        </header>

        <section className={styles.toolbar} aria-label="相册摘要与操作">
          <div className={styles.summary}>
            <span>
              <Album aria-hidden="true" size={16} />
              {albums.length} 个相册
            </span>
            <span>
              <ImageIcon aria-hidden="true" size={16} />
              {totalImages} 张归档图片
            </span>
          </div>
          <label className={styles.search}>
            <Search aria-hidden="true" size={16} />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索相册名称或描述"
              type="search"
              value={query}
            />
          </label>
          <label className={styles.sortControl}>
            <span>排序</span>
            <select
              aria-label="相册排序方式"
              onChange={(event) => setSort(event.target.value as AlbumSort)}
              value={sort}
            >
              <option value="newest">最近更新</option>
              <option value="oldest">最早创建</option>
              <option value="name">按名称</option>
            </select>
          </label>
          <Button asChild variant="secondary">
            <Link href="/library">
              去图片库归档
              <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </Button>
        </section>

        {notice && (
          <p className={styles.notice} role="status">
            <Check aria-hidden="true" size={16} />
            {notice}
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {loading ? (
          <section className={styles.loading} aria-live="polite" role="status">
            <LoaderCircle className={styles.spin} aria-hidden="true" size={24} />
            正在整理相册卡片
          </section>
        ) : albums.length === 0 ? (
          <section className={styles.empty}>
            <span className={styles.emptyIcon}>
              <FolderPlus aria-hidden="true" size={34} />
            </span>
            <h2>还没有相册</h2>
            <p>新建一个相册，把同一批图片放在一起。比如产品截图、头像素材、博客配图。</p>
            <Button onClick={openCreateDialog}>
              <Plus aria-hidden="true" size={17} />
              新建相册
            </Button>
          </section>
        ) : filteredAlbums.length === 0 ? (
          <section className={styles.empty}>
            <span className={styles.emptyIcon}>
              <Search aria-hidden="true" size={34} />
            </span>
            <h2>没有匹配的相册</h2>
            <p>换一个关键词，或者新建一个更适合当前素材的分类。</p>
            <Button onClick={() => setQuery("")} variant="secondary">
              清空搜索
            </Button>
          </section>
        ) : (
          <section className={styles.grid} aria-label="相册列表">
            {filteredAlbums.map((album) => (
              <article className={styles.card} key={album.id}>
                <Link
                  aria-label={`打开相册 ${album.name}`}
                  className={styles.cover}
                  href={`/albums/${album.id}`}
                >
                  {album.coverThumbnailUrl ? (
                    <img alt="" src={album.coverThumbnailUrl} />
                  ) : (
                    <Album aria-hidden="true" size={42} />
                  )}
                </Link>
                <div className={styles.cardBody}>
                  <div className={styles.cardTitleRow}>
                    <h2>{album.name}</h2>
                    <span>{album.imageCount}</span>
                  </div>
                  <p>{album.description || "这个相册还没有描述，打开后可以继续整理图片。"}</p>
                  <span className={styles.cardMeta}>
                    <span>
                      <strong>{album.imageCount}</strong> 张图片
                    </span>
                    <time dateTime={album.updatedAt}>
                      {formatDate(album.updatedAt)}
                    </time>
                  </span>
                  <div className={styles.cardActions}>
                    <button
                      className={styles.iconButton}
                      onClick={() => openManageDialog(album)}
                      type="button"
                    >
                      <Settings2 aria-hidden="true" size={15} />
                      管理
                    </button>
                    <Button asChild size="compact" variant="secondary">
                      <Link href={`/albums/${album.id}`}>
                        <FolderOpen aria-hidden="true" size={15} />
                        打开
                      </Link>
                    </Button>
                    {album.imageCount === 0 && (
                      <button
                        className={styles.iconButton}
                        onClick={() => openManageDialog(album, "add")}
                        type="button"
                      >
                        <ImagePlus aria-hidden="true" size={15} />
                        添加图片
                      </button>
                    )}
                    <button
                      className={styles.iconButton}
                      onClick={() => openEditDialog(album)}
                      type="button"
                    >
                      <Edit3 aria-hidden="true" size={15} />
                      编辑
                    </button>
                    <button
                      className={cn(styles.iconButton, styles.dangerButton)}
                      onClick={() => setDeleteAlbum(album)}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={15} />
                      删除
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}
      </main>

      {managedAlbum && (
        <AlbumDialog className={styles.manageDialog} onClose={() => setManagingAlbumId("")}>
            <div className={styles.dialogHead}>
              <div className={styles.dialogTitle}>
                <span>
                  <Album aria-hidden="true" size={18} />
                </span>
                <div>
                  <Dialog.Title asChild><strong>{managedAlbum.name}</strong></Dialog.Title>
                  <Dialog.Description asChild><small>相册详情与内容管理</small></Dialog.Description>
                </div>
              </div>
              <button
                aria-label="关闭相册管理窗口"
                className={styles.close}
                onClick={() => setManagingAlbumId("")}
                type="button"
              >
                <X aria-hidden="true" size={17} />
              </button>
            </div>

            <div className={styles.manageTabs} role="tablist" aria-label="相册管理" onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              if (index < 0) return;
              event.preventDefault();
              const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
              buttons[next]?.focus();
              buttons[next]?.click();
            }}>
              <button
                id={`${manageTabsId}-overview`}
                aria-controls={`${manageTabsId}-panel`}
                tabIndex={manageView === "overview" ? 0 : -1}
                aria-selected={manageView === "overview"}
                onClick={() => setManageView("overview")}
                role="tab"
                type="button"
              >
                <Images aria-hidden="true" size={16} />
                详情
              </button>
              <button
                id={`${manageTabsId}-cover`}
                aria-controls={`${manageTabsId}-panel`}
                tabIndex={manageView === "cover" ? 0 : -1}
                aria-selected={manageView === "cover"}
                onClick={() => setManageView("cover")}
                role="tab"
                type="button"
              >
                <ImageIcon aria-hidden="true" size={16} />
                封面
              </button>
              <button
                id={`${manageTabsId}-add`}
                aria-controls={`${manageTabsId}-panel`}
                tabIndex={manageView === "add" ? 0 : -1}
                aria-selected={manageView === "add"}
                onClick={() => setManageView("add")}
                role="tab"
                type="button"
              >
                <ImagePlus aria-hidden="true" size={16} />
                添加图片
              </button>
            </div>

            <div className={styles.manageBody} id={`${manageTabsId}-panel`} role="tabpanel" aria-labelledby={`${manageTabsId}-${manageView}`} aria-busy={manageLoading || libraryLoading}>
              {manageNotice && (
                <p className={cn(styles.notice, styles.manageFeedback)} role="status">
                  <Check aria-hidden="true" size={16} />
                  {manageNotice}
                </p>
              )}
              {manageError && (
                <p className={cn(styles.error, styles.manageFeedback)} role="alert">
                  {manageError}
                </p>
              )}
              {manageLoading ? (
                <div className={styles.manageLoading} role="status">
                  <LoaderCircle className={styles.spin} aria-hidden="true" size={22} />
                  正在读取相册内容
                </div>
              ) : manageView === "overview" ? (
                <div className={styles.overviewPanel}>
                  <div className={styles.albumIdentity}>
                    <div className={styles.manageCover}>
                      {managedAlbum.coverThumbnailUrl ? (
                        <img alt="" src={managedAlbum.coverThumbnailUrl} />
                      ) : (
                        <Album aria-hidden="true" size={38} />
                      )}
                    </div>
                    <div>
                      <span className={styles.coverModeLabel}>
                        {managedCoverMode === "auto"
                          ? "自动封面"
                          : managedCoverMode === "custom"
                            ? "自定义封面"
                            : "无封面"}
                      </span>
                      <h2>{managedAlbum.name}</h2>
                      <p>
                        {managedAlbum.description ||
                          "暂时没有描述，可以在相册卡片上点击“编辑”补充用途。"}
                      </p>
                    </div>
                  </div>
                  <dl className={styles.albumFacts}>
                    <div>
                      <dt><Images aria-hidden="true" size={16} /> 图片</dt>
                      <dd>{managedAlbum.imageCount} 张</dd>
                    </div>
                    <div>
                      <dt><CalendarDays aria-hidden="true" size={16} /> 创建</dt>
                      <dd>{formatDate(managedAlbum.createdAt)}</dd>
                    </div>
                    <div>
                      <dt><Clock3 aria-hidden="true" size={16} /> 更新</dt>
                      <dd>{formatDate(managedAlbum.updatedAt)}</dd>
                    </div>
                  </dl>

                  {managedAlbum.imageCount === 0 ? (
                    <div className={styles.albumEmptyGuide}>
                      <span><ImagePlus aria-hidden="true" size={24} /></span>
                      <div>
                        <strong>这个相册正在等第一张图片</strong>
                        <p>从图片库选择已有图片，加入后仍会保留在原图片库中。</p>
                      </div>
                      <Button onClick={() => setManageView("add")} size="compact">
                        添加图片
                      </Button>
                    </div>
                  ) : (
                    <div className={styles.previewStrip}>
                      <div className={styles.sectionHeading}>
                        <div>
                          <strong>最近图片</strong>
                          <small>快速确认相册内容</small>
                        </div>
                        <Button onClick={() => setManageView("add")} size="compact" variant="secondary">
                          <Plus aria-hidden="true" size={15} />
                          添加更多
                        </Button>
                      </div>
                      <div className={styles.previewImages}>
                        {albumImages.slice(0, 5).map((image) => (
                          <img alt={image.name} key={image.id} src={image.thumbnailUrl} />
                        ))}
                      </div>
                    </div>
                  )}

                  <div className={styles.manageFooter}>
                    <Button asChild variant="secondary">
                      <Link href={`/albums/${managedAlbum.id}`}>
                        <FolderOpen aria-hidden="true" size={16} />
                        打开完整相册
                      </Link>
                    </Button>
                    <Button onClick={() => openEditDialog(managedAlbum)} variant="ghost">
                      <Edit3 aria-hidden="true" size={16} />
                      编辑资料
                    </Button>
                  </div>
                </div>
              ) : manageView === "cover" ? (
                <div className={styles.coverPanel}>
                  <div className={styles.sectionHeading}>
                    <div>
                      <strong>封面显示方式</strong>
                      <small>自动跟随内容，或固定一张你喜欢的图片</small>
                    </div>
                  </div>
                  <div className={styles.coverModes}>
                    <button
                      aria-pressed={managedCoverMode === "auto"}
                      disabled={Boolean(manageBusy)}
                      onClick={() => void updateCoverMode("auto", "已改为自动使用第一张图片作为封面。")}
                      type="button"
                    >
                      <span><Images aria-hidden="true" size={18} /></span>
                      <strong>自动第一张</strong>
                      <small>相册内容变化时自动保持可用封面</small>
                      {managedCoverMode === "auto" && <Check aria-hidden="true" size={16} />}
                    </button>
                    <button
                      aria-pressed={managedCoverMode === "none"}
                      disabled={Boolean(manageBusy)}
                      onClick={() => void updateCoverMode("none", "已清空相册封面。")}
                      type="button"
                    >
                      <span><X aria-hidden="true" size={18} /></span>
                      <strong>不显示封面</strong>
                      <small>使用相册的简洁占位图形</small>
                      {managedCoverMode === "none" && <Check aria-hidden="true" size={16} />}
                    </button>
                  </div>

                  <div className={styles.sectionHeading}>
                    <div>
                      <strong>从相册中选择</strong>
                      <small>点击图片即可固定为自定义封面</small>
                    </div>
                  </div>
                  {albumImages.length === 0 ? (
                    <div className={styles.compactEmpty}>
                      <ImageIcon aria-hidden="true" size={24} />
                      <strong>添加图片后才能选择自定义封面</strong>
                      <Button onClick={() => setManageView("add")} size="compact" variant="secondary">
                        去添加图片
                      </Button>
                    </div>
                  ) : (
                    <div className={styles.imagePickerGrid}>
                      {albumImages.map((image) => {
                        const selected = managedAlbum.coverImageId === image.id && managedCoverMode === "custom";
                        return (
                          <button
                            aria-label={`使用 ${image.name} 作为封面`}
                            aria-pressed={selected}
                            className={styles.imageChoice}
                            disabled={Boolean(manageBusy)}
                            key={image.id}
                            onClick={() => void setCustomCover(image.id)}
                            type="button"
                          >
                            <img alt="" src={image.thumbnailUrl} />
                            <span>{image.name}</span>
                            {selected && <Check aria-hidden="true" size={16} />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {coverTotalPages > 1 && <nav className={styles.pagination} aria-label="封面选图分页">
                    <span>第 {coverPage} / {coverTotalPages} 页</span>
                    <Button size="compact" variant="secondary" disabled={coverPage <= 1} onClick={() => setCoverPage((page) => page - 1)}>上一页</Button>
                    <Button size="compact" variant="secondary" disabled={coverPage >= coverTotalPages} onClick={() => setCoverPage((page) => page + 1)}>下一页</Button>
                  </nav>}
                </div>
              ) : (
                <div className={styles.addPanel}>
                  <div className={styles.sectionHeading}>
                    <div>
                      <strong>从图片库添加</strong>
                      <small>可多选，先加入本页选择，再切换分页。图片仍保留在图片库中</small>
                    </div>
                    <div className={styles.selectionTools}>
                      {!libraryLoading && addableImages.length > 0 && (
                        <button
                          onClick={() =>
                            setSelectedImages((current) => {
                              const next = new Set(current);
                              addableImages.forEach((image) => {
                                if (allAddableSelected) next.delete(image.id);
                                else next.add(image.id);
                              });
                              return next;
                            })
                          }
                          type="button"
                        >
                          {allAddableSelected
                            ? "取消全选"
                            : "全选本页"}
                        </button>
                      )}
                      <span className={styles.selectionCount}>
                        已选 {selectedImages.size} 张
                      </span>
                    </div>
                  </div>
                  <label className={styles.dialogSearch}>
                    <Search aria-hidden="true" size={16} />
                    <input
                      onChange={(event) => { setImageQuery(event.target.value); setImagePage(1); setSelectedImages(new Set()); }}
                      placeholder="搜索整个图片库"
                      type="search"
                      value={imageQuery}
                    />
                  </label>
                  {libraryLoading ? (
                    <div className={styles.manageLoading} role="status"><LoaderCircle aria-hidden="true" className={styles.spin} size={22} />正在搜索图片</div>
                  ) : addableImages.length === 0 ? (
                    <div className={styles.compactEmpty}>
                      <Check aria-hidden="true" size={24} />
                      <strong>
                        {imageQuery ? "没有匹配的可添加图片" : "图片库中的图片都已在这个相册中"}
                      </strong>
                      <Button asChild size="compact" variant="secondary">
                        <Link href="/library">前往图片库</Link>
                      </Button>
                    </div>
                  ) : (
                    <div className={styles.imagePickerGrid}>
                      {addableImages.map((image) => {
                        const selected = selectedImages.has(image.id);
                        return (
                          <button
                            aria-label={`${selected ? "取消选择" : "选择"} ${image.name}`}
                            aria-pressed={selected}
                            className={styles.imageChoice}
                            key={image.id}
                            onClick={() => toggleImageSelection(image.id)}
                            type="button"
                          >
                            <img alt="" src={image.thumbnailUrl} />
                            <span>{image.name}</span>
                            <small>{image.format.toUpperCase()} · {image.width} × {image.height}</small>
                            {selected && <Check aria-hidden="true" size={16} />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <nav className={styles.pagination} aria-label="选图分页">
                    <span>共 {imageTotal} 张可添加图片 · 第 {imagePage} / {imageTotalPages} 页</span>
                    <Button size="compact" variant="secondary" disabled={libraryLoading || imagePage <= 1} onClick={() => { setImagePage((page) => page - 1); setSelectedImages(new Set()); }}>上一页</Button>
                    <Button size="compact" variant="secondary" disabled={libraryLoading || imagePage >= imageTotalPages} onClick={() => { setImagePage((page) => page + 1); setSelectedImages(new Set()); }}>下一页</Button>
                  </nav>
                  <div className={styles.stickyActions}>
                    <Button onClick={() => setManageView("overview")} variant="ghost">
                      返回详情
                    </Button>
                    <Button
                      disabled={libraryLoading || selectedImages.size === 0 || Boolean(manageBusy)}
                      onClick={() => void addImagesToAlbum()}
                    >
                      {manageBusy === "add-images" ? (
                        <LoaderCircle className={styles.spin} aria-hidden="true" size={16} />
                      ) : (
                        <ImagePlus aria-hidden="true" size={16} />
                      )}
                      {selectedImages.size > 0
                        ? `加入 ${selectedImages.size} 张图片`
                        : "选择图片后加入"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
        </AlbumDialog>
      )}

      {dialogOpen && (
        <AlbumDialog onClose={() => setDialogOpen(false)}>
            <div className={styles.dialogHead}>
              <div className={styles.dialogTitle}>
                <span>
                  <FolderPlus aria-hidden="true" size={18} />
                </span>
                <div>
                  <Dialog.Title asChild><strong>{dialogTitle}</strong></Dialog.Title>
                  <Dialog.Description asChild><small>{dialogSubtitle}</small></Dialog.Description>
                </div>
              </div>
              <button
                aria-label="关闭相册窗口"
                className={styles.close}
                onClick={() => setDialogOpen(false)}
                type="button"
              >
                <X aria-hidden="true" size={17} />
              </button>
            </div>

            <form className={styles.form} onSubmit={saveAlbum}>
              <label className={styles.field}>
                名称
                <input
                  autoFocus
                  maxLength={60}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如：产品截图"
                  value={name}
                />
              </label>
              <label className={styles.field}>
                描述
                <textarea
                  maxLength={240}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="说明这个相册用于什么"
                  value={description}
                />
              </label>
              <div className={styles.dialogActions}>
                <Button
                  disabled={saving}
                  onClick={() => setDialogOpen(false)}
                  type="button"
                  variant="ghost"
                >
                  取消
                </Button>
                <Button disabled={!name.trim() || saving} type="submit">
                  {saving ? (
                    <LoaderCircle className={styles.spin} aria-hidden="true" size={16} />
                  ) : (
                    <FolderPlus aria-hidden="true" size={16} />
                  )}
                  {dialogMode === "edit" ? "保存修改" : "创建"}
                </Button>
              </div>
            </form>
        </AlbumDialog>
      )}

      {deleteAlbum && (
        <AlbumDialog className={styles.confirmDialog} onClose={() => setDeleteAlbum(null)}>
            <div className={styles.confirmIcon}>
              <Trash2 aria-hidden="true" size={22} />
            </div>
            <Dialog.Title asChild><h2>删除相册「{deleteAlbum.name}」？</h2></Dialog.Title>
            <Dialog.Description asChild><p>
              这只会移除相册分类和图片归属关系，原图片仍会保留在图片库和其他相册里。
            </p></Dialog.Description>
            <div className={styles.dialogActions}>
              <Button
                disabled={deleting}
                onClick={() => setDeleteAlbum(null)}
                variant="ghost"
              >
                取消
              </Button>
              <Button
                disabled={deleting}
                onClick={() => void removeAlbum()}
                variant="danger"
              >
                {deleting ? (
                  <LoaderCircle className={styles.spin} aria-hidden="true" size={16} />
                ) : (
                  <Trash2 aria-hidden="true" size={16} />
                )}
                确认删除
              </Button>
            </div>
        </AlbumDialog>
      )}
    </AppShell>
  );
}
