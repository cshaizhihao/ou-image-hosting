"use client";

import { Button, cn } from "@ou-image/ui";
import {
  Album,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  FileImage,
  Grid2X2,
  Heart,
  ImagePlus,
  List,
  LoaderCircle,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  X
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { workspaceHeaders } from "@/lib/api";
import { paginationWindow } from "@/lib/pagination";
import { AppShell } from "./app-shell";

type LibraryImage = {
  id: string;
  name: string;
  size: number;
  mime: string;
  format: "jpeg" | "png" | "webp" | "gif" | "avif" | "heic" | "heif";
  width: number;
  height: number;
  sha256: string;
  thumbnailUrl: string;
  originalUrl: string;
  favorite: boolean;
  publicVisible: boolean;
  albumIds: string[];
  tagIds: string[];
  createdAt: string;
};

type LibraryResponse = {
  images: LibraryImage[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type AlbumOption = {
  id: string;
  name: string;
  description: string;
  imageCount: number;
};

type ViewMode = "grid" | "list";
type SortMode = "newest" | "oldest" | "name" | "size";
type FormatFilter = "all" | LibraryImage["format"];

const preferencesKey = "ou-library-preferences";
const scrollKey = "ou-library-scroll";
const pageSizeOptions = [12, 24, 48] as const;

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function responseMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const candidate = payload as {
    message?: string;
    error?: { message?: string };
  };
  return candidate.error?.message ?? candidate.message ?? fallback;
}

export function ImageLibrary() {
  const restoredRef = useRef(false);
  const [view, setView] = useState<ViewMode>("grid");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [format, setFormat] = useState<FormatFilter>("all");
  const [sort, setSort] = useState<SortMode>("newest");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [data, setData] = useState<LibraryResponse>({
    images: [],
    page: 1,
    limit: 24,
    total: 0,
    totalPages: 1
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [albumPickerOpen, setAlbumPickerOpen] = useState(false);
  const [albums, setAlbums] = useState<AlbumOption[]>([]);
  const [albumSelection, setAlbumSelection] = useState<Set<string>>(new Set());
  const [albumQuery, setAlbumQuery] = useState("");
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const [assigningAlbums, setAssigningAlbums] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<
    "public" | "private" | "favorite" | "unfavorite" | "trash" | null
  >(null);
  const [deleting, setDeleting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(preferencesKey) ?? "{}"
      ) as Partial<{
        view: ViewMode;
        format: FormatFilter;
        sort: SortMode;
        pageSize: number;
      }>;
      if (saved.view === "grid" || saved.view === "list") setView(saved.view);
      if (
        ["all", "jpeg", "png", "webp", "gif", "avif"].includes(
          saved.format ?? ""
        )
      ) {
        setFormat(saved.format!);
      }
      if (["newest", "oldest", "name", "size"].includes(saved.sort ?? "")) {
        setSort(saved.sort!);
      }
      if (pageSizeOptions.includes(saved.pageSize as 12 | 24 | 48)) {
        setPageSize(saved.pageSize!);
      }
    } catch {
      window.localStorage.removeItem(preferencesKey);
    }
    restoredRef.current = true;
  }, []);

  useEffect(() => {
    if (!restoredRef.current) return;
    window.localStorage.setItem(
      preferencesKey,
      JSON.stringify({ view, format, sort, pageSize })
    );
  }, [view, format, sort, pageSize]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const saveScroll = () =>
      window.sessionStorage.setItem(scrollKey, String(window.scrollY));
    window.addEventListener("pagehide", saveScroll);
    return () => {
      saveScroll();
      window.removeEventListener("pagehide", saveScroll);
    };
  }, []);

  const loadImages = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({
        q: debouncedQuery,
        format,
        page: String(page),
        limit: String(pageSize),
        sort
      });
      try {
        const response = await fetch(`/api/uploads?${params}`, {
          credentials: "same-origin",
          cache: "no-store",
          headers: workspaceHeaders(),
          signal
        });
        const payload = (await response.json()) as LibraryResponse;
        if (!response.ok) {
          throw new Error(responseMessage(payload, "图片库加载失败"));
        }
        setData(payload);
        setSelected(new Set());
        if (!signal?.aborted) {
          window.requestAnimationFrame(() => {
            const saved = Number(
              window.sessionStorage.getItem(scrollKey) ?? "0"
            );
            if (saved > 0) {
              window.scrollTo({ top: saved });
              window.sessionStorage.removeItem(scrollKey);
            }
          });
        }
      } catch (requestError) {
        if ((requestError as Error).name !== "AbortError") {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "图片库加载失败"
          );
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [debouncedQuery, format, page, pageSize, sort]
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadImages(controller.signal);
    return () => controller.abort();
  }, [loadImages, reloadKey]);

  const allSelected =
    data.images.length > 0 &&
    data.images.every((image) => selected.has(image.id));

  const toggleSelection = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePage = () => {
    setSelected(
      allSelected ? new Set() : new Set(data.images.map((image) => image.id))
    );
  };

  const loadAlbums = useCallback(async () => {
    setAlbumsLoading(true);
    try {
      const response = await fetch("/api/albums", {
        credentials: "same-origin",
        cache: "no-store",
        headers: workspaceHeaders()
      });
      const payload = (await response.json()) as { albums?: AlbumOption[] };
      if (!response.ok) {
        throw new Error(responseMessage(payload, "相册列表加载失败"));
      }
      setAlbums(payload.albums ?? []);
    } catch (requestError) {
      setNotice(
        requestError instanceof Error ? requestError.message : "相册列表加载失败"
      );
    } finally {
      setAlbumsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!albumPickerOpen) return;
    void loadAlbums();
  }, [albumPickerOpen, loadAlbums]);

  useEffect(() => {
    if (!albumPickerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAlbumPickerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [albumPickerOpen]);

  const openAlbumPicker = () => {
    if (selected.size === 0) return;
    setAlbumSelection(new Set());
    setAlbumQuery("");
    setAlbumPickerOpen(true);
  };

  const toggleAlbumSelection = (albumId: string) => {
    setAlbumSelection((current) => {
      const next = new Set(current);
      if (next.has(albumId)) next.delete(albumId);
      else next.add(albumId);
      return next;
    });
  };

  const filteredAlbums = useMemo(() => {
    const keyword = albumQuery.trim().toLocaleLowerCase();
    if (!keyword) return albums;
    return albums.filter(
      (album) =>
        album.name.toLocaleLowerCase().includes(keyword) ||
        album.description.toLocaleLowerCase().includes(keyword)
    );
  }, [albumQuery, albums]);

  const addSelectedToAlbums = async () => {
    if (selected.size === 0 || albumSelection.size === 0) return;
    setAssigningAlbums(true);
    try {
      const response = await fetch("/api/uploads/bulk", {
        method: "POST",
        credentials: "same-origin",
        headers: workspaceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          ids: Array.from(selected),
          action: "add-to-albums",
          albumIds: Array.from(albumSelection)
        })
      });
      const payload = (await response.json()) as { updated?: number };
      if (!response.ok) {
        throw new Error(responseMessage(payload, "加入相册失败"));
      }
      setNotice(
        `已将 ${payload.updated ?? selected.size} 张图片加入 ${albumSelection.size} 个相册。`
      );
      const selectedIds = new Set(selected);
      const chosenAlbumIds = Array.from(albumSelection);
      setData((current) => ({
        ...current,
        images: current.images.map((image) =>
          selectedIds.has(image.id)
            ? {
                ...image,
                albumIds: Array.from(
                  new Set([...image.albumIds, ...chosenAlbumIds])
                )
              }
            : image
        )
      }));
      setSelected(new Set());
      setAlbumSelection(new Set());
      setAlbumPickerOpen(false);
    } catch (requestError) {
      setNotice(
        requestError instanceof Error ? requestError.message : "加入相册失败"
      );
    } finally {
      setAssigningAlbums(false);
    }
  };

  const runBulkAction = async (
    action: "set-public-visibility" | "set-favorite",
    options: {
      busy: "public" | "private" | "favorite" | "unfavorite";
      publicVisible?: boolean;
      favorite?: boolean;
      success: (updated: number) => string;
    }
  ) => {
    if (selected.size === 0 || bulkBusy) return;
    setBulkBusy(options.busy);
    try {
      const response = await fetch("/api/uploads/bulk", {
        method: "POST",
        credentials: "same-origin",
        headers: workspaceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          ids: Array.from(selected),
          action,
          publicVisible: options.publicVisible,
          favorite: options.favorite
        })
      });
      const payload = (await response.json()) as { updated?: number };
      if (!response.ok) {
        throw new Error(responseMessage(payload, "批量操作失败"));
      }
      const selectedIds = new Set(selected);
      setData((current) => ({
        ...current,
        images: current.images.map((image) =>
          selectedIds.has(image.id)
            ? {
                ...image,
                publicVisible:
                  options.publicVisible ?? image.publicVisible,
                favorite: options.favorite ?? image.favorite
              }
            : image
        )
      }));
      setNotice(options.success(payload.updated ?? selected.size));
      setSelected(new Set());
    } catch (requestError) {
      setNotice(
        requestError instanceof Error ? requestError.message : "批量操作失败"
      );
    } finally {
      setBulkBusy(null);
    }
  };

  const trashSelected = async () => {
    if (selected.size === 0) return;
    setDeleting(true);
    setBulkBusy("trash");
    try {
      const response = await fetch("/api/uploads/bulk", {
        method: "POST",
        credentials: "same-origin",
        headers: workspaceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          ids: Array.from(selected),
          action: "trash"
        })
      });
      const payload = (await response.json()) as { updated?: number };
      if (!response.ok) {
        throw new Error(responseMessage(payload, "批量操作失败"));
      }
      const selectedIds = new Set(selected);
      const removed = data.images.filter((image) =>
        selectedIds.has(image.id)
      ).length;
      const nextTotal = Math.max(0, data.total - removed);
      const nextTotalPages = Math.max(1, Math.ceil(nextTotal / pageSize));
      setData((current) => ({
        ...current,
        images: current.images.filter((image) => !selectedIds.has(image.id)),
        total: nextTotal,
        totalPages: nextTotalPages
      }));
      setNotice(`已将 ${payload.updated ?? selected.size} 张图片移入回收站。`);
      setConfirmOpen(false);
      setSelected(new Set());
      if (page > nextTotalPages) setPage(nextTotalPages);
    } catch (requestError) {
      setNotice(
        requestError instanceof Error ? requestError.message : "批量操作失败"
      );
    } finally {
      setDeleting(false);
      setBulkBusy(null);
    }
  };

  const selectionLabel = useMemo(
    () => (selected.size > 0 ? `已选择 ${selected.size} 张` : `${data.total} 张图片`),
    [data.total, selected.size]
  );
  const selectedImages = useMemo(
    () => data.images.filter((image) => selected.has(image.id)),
    [data.images, selected]
  );
  const selectedPublicCount = selectedImages.filter(
    (image) => image.publicVisible
  ).length;
  const selectedFavoriteCount = selectedImages.filter(
    (image) => image.favorite
  ).length;
  const visiblePages = useMemo(
    () => paginationWindow(data.page, data.totalPages),
    [data.page, data.totalPages]
  );

  return (
    <AppShell activeKey="library">
      <main className="workspace-page library-page">
        <header className="library-header">
          <div>
            <span className="library-eyebrow">IMAGE LIBRARY</span>
            <h1>图片库</h1>
            <p>搜索、筛选和批量管理工作区中的图片资产。</p>
          </div>
          <Button asChild>
            <Link href="/upload">
              <ImagePlus aria-hidden="true" size={17} />
              上传图片
            </Link>
          </Button>
        </header>

        <section className="library-toolbar" aria-label="图片筛选工具">
          <label className="library-search">
            <Search aria-hidden="true" size={17} />
            <span className="sr-only">搜索图片名称</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索图片名称"
              type="search"
              value={query}
            />
            {query && (
              <button
                aria-label="清空搜索"
                onClick={() => setQuery("")}
                type="button"
              >
                <X size={15} />
              </button>
            )}
          </label>

          <label className="library-select">
            <SlidersHorizontal aria-hidden="true" size={15} />
            <span className="sr-only">格式筛选</span>
            <select
              onChange={(event) => {
                setFormat(event.target.value as FormatFilter);
                setPage(1);
              }}
              value={format}
            >
              <option value="all">全部格式</option>
              <option value="jpeg">JPG</option>
              <option value="png">PNG</option>
              <option value="webp">WebP</option>
              <option value="gif">GIF</option>
              <option value="avif">AVIF</option>
            </select>
          </label>

          <label className="library-select">
            <span className="sr-only">排序方式</span>
            <select
              onChange={(event) => {
                setSort(event.target.value as SortMode);
                setPage(1);
              }}
              value={sort}
            >
              <option value="newest">最新上传</option>
              <option value="oldest">最早上传</option>
              <option value="name">按名称</option>
              <option value="size">按大小</option>
            </select>
          </label>

          <div className="library-view-toggle" role="group" aria-label="视图">
            <button
              aria-label="网格视图"
              aria-pressed={view === "grid"}
              className={view === "grid" ? "is-active" : ""}
              onClick={() => setView("grid")}
              type="button"
            >
              <Grid2X2 size={17} />
            </button>
            <button
              aria-label="列表视图"
              aria-pressed={view === "list"}
              className={view === "list" ? "is-active" : ""}
              onClick={() => setView("list")}
              type="button"
            >
              <List size={18} />
            </button>
          </div>

          <label className="library-select library-page-size">
            <span className="sr-only">每页图片数量</span>
            <select
              aria-label="每页图片数量"
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              value={pageSize}
            >
              {pageSizeOptions.map((value) => (
                <option key={value} value={value}>
                  每页 {value} 张
                </option>
              ))}
            </select>
          </label>
        </section>

        <div className={cn("library-selection", selected.size > 0 && "is-active")}>
          <button
            aria-pressed={allSelected}
            className={allSelected ? "is-selected" : ""}
            disabled={data.images.length === 0}
            onClick={togglePage}
            type="button"
          >
            <span>{allSelected && <Check size={13} />}</span>
            {allSelected ? "取消本页全选" : "选择本页"}
          </button>
          <span>
            {selectionLabel}
            {selected.size > 0 && (
              <small>
                {selectedPublicCount} 公开 · {selectedFavoriteCount} 收藏
              </small>
            )}
          </span>
          {selected.size > 0 && (
            <>
              <Button
                disabled={bulkBusy !== null}
                onClick={() =>
                  void runBulkAction("set-public-visibility", {
                    busy: "public",
                    publicVisible: true,
                    success: (updated) => `已公开 ${updated} 张图片。`
                  })
                }
                size="compact"
                variant="secondary"
              >
                {bulkBusy === "public" ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Eye size={15} />
                )}
                公开
              </Button>
              <Button
                disabled={bulkBusy !== null}
                onClick={() =>
                  void runBulkAction("set-public-visibility", {
                    busy: "private",
                    publicVisible: false,
                    success: (updated) => `已隐藏 ${updated} 张图片。`
                  })
                }
                size="compact"
                variant="secondary"
              >
                {bulkBusy === "private" ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <EyeOff size={15} />
                )}
                隐藏
              </Button>
              <Button
                disabled={bulkBusy !== null}
                onClick={() =>
                  void runBulkAction("set-favorite", {
                    busy: "favorite",
                    favorite: true,
                    success: (updated) => `已收藏 ${updated} 张图片。`
                  })
                }
                size="compact"
                variant="secondary"
              >
                {bulkBusy === "favorite" ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Heart size={15} />
                )}
                收藏
              </Button>
              <Button
                disabled={bulkBusy !== null}
                onClick={() =>
                  void runBulkAction("set-favorite", {
                    busy: "unfavorite",
                    favorite: false,
                    success: (updated) => `已取消收藏 ${updated} 张图片。`
                  })
                }
                size="compact"
                variant="secondary"
              >
                {bulkBusy === "unfavorite" ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Heart size={15} />
                )}
                取消收藏
              </Button>
              <Button onClick={openAlbumPicker} size="compact" variant="secondary">
                <Album size={15} />
                加入相册
              </Button>
              <Button
                onClick={() => setConfirmOpen(true)}
                size="compact"
                variant="danger"
                disabled={bulkBusy !== null}
              >
                <Trash2 size={15} />
                移入回收站
              </Button>
            </>
          )}
        </div>

        {notice && (
          <p className="library-notice" role="status">
            {notice}
          </p>
        )}

        {loading ? (
          <div className={cn("library-skeleton", view === "list" && "is-list")}>
            {Array.from({ length: view === "grid" ? 8 : 6 }).map((_, index) => (
              <span key={index} />
            ))}
          </div>
        ) : error ? (
          <div className="library-state">
            <RefreshCw size={27} />
            <h2>图片库加载失败</h2>
            <p>{error}</p>
            <Button onClick={() => setReloadKey((value) => value + 1)}>
              重新加载
            </Button>
          </div>
        ) : data.images.length === 0 ? (
          <div className="library-state">
            <FileImage size={30} />
            <h2>{debouncedQuery || format !== "all" ? "没有匹配图片" : "图片库还是空的"}</h2>
            <p>
              {debouncedQuery || format !== "all"
                ? "调整搜索词或格式筛选后再试。"
                : "上传第一张图片后，它会出现在这里。"}
            </p>
            <Button asChild variant="secondary">
              <Link href="/upload">打开上传工作台</Link>
            </Button>
          </div>
        ) : (
          <ol className={cn("library-results", `is-${view}`)}>
            {data.images.map((image) => {
              const isSelected = selected.has(image.id);
              return (
                <li
                  className={cn("library-item", isSelected && "is-selected")}
                  key={image.id}
                >
                  <button
                    aria-label={`${isSelected ? "取消选择" : "选择"} ${image.name}`}
                    aria-pressed={isSelected}
                    className="library-item__check"
                    onClick={() => toggleSelection(image.id)}
                    type="button"
                  >
                    {isSelected && <Check size={14} />}
                  </button>
                  <Link
                    aria-label={`查看 ${image.name} 详情`}
                    className="library-item__preview"
                    href={`/library/${image.id}`}
                  >
                    <img
                      alt={image.name}
                      decoding="async"
                      height={image.height}
                      loading="lazy"
                      src={image.thumbnailUrl}
                      width={image.width}
                    />
                  </Link>
                  <div className="library-item__badges" aria-label="图片状态">
                    <span className={image.publicVisible ? "is-public" : ""}>
                      {image.publicVisible ? "公开" : "私密"}
                    </span>
                    {image.albumIds.length > 0 && (
                      <span>{image.albumIds.length} 相册</span>
                    )}
                    {image.favorite && <span className="is-favorite">收藏</span>}
                  </div>
                  <div className="library-item__info">
                    <strong title={image.name}>{image.name}</strong>
                    <span>
                      {image.format.toUpperCase()} · {image.width} × {image.height}
                    </span>
                    <small>{formatBytes(image.size)} · {formatDate(image.createdAt)}</small>
                  </div>
                  <a
                    aria-label={`打开 ${image.name} 原图`}
                    className="library-item__open"
                    href={image.originalUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLink size={15} />
                  </a>
                </li>
              );
            })}
          </ol>
        )}

        {!loading && !error && data.total > 0 && (
          <nav className="library-pagination" aria-label="图片库分页">
            <Button
              disabled={data.page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              size="compact"
              variant="secondary"
            >
              <ChevronLeft size={16} />
              上一页
            </Button>
            <span>
              第 {data.page} / {data.totalPages} 页 · 共 {data.total} 张
            </span>
            <span className="library-pagination__pages" aria-label="选择页码">
              {visiblePages.map((pageNumber) => (
                <button
                  aria-current={pageNumber === data.page ? "page" : undefined}
                  key={pageNumber}
                  onClick={() => setPage(pageNumber)}
                  type="button"
                >
                  {pageNumber}
                </button>
              ))}
            </span>
            <Button
              disabled={data.page >= data.totalPages}
              onClick={() =>
                setPage((value) => Math.min(data.totalPages, value + 1))
              }
              size="compact"
              variant="secondary"
            >
              下一页
              <ChevronRight size={16} />
            </Button>
          </nav>
        )}
      </main>

      {confirmOpen && (
        <div className="library-confirm-backdrop">
          <section
            aria-describedby="library-delete-description"
            aria-labelledby="library-delete-title"
            aria-modal="true"
            className="library-confirm"
            role="dialog"
          >
            <span><Trash2 size={22} /></span>
            <h2 id="library-delete-title">移入回收站？</h2>
            <p id="library-delete-description">
              已选择 {selected.size} 张图片。原文件会保留，可在后续回收站中恢复。
            </p>
            <div>
              <Button
                disabled={deleting}
                onClick={() => setConfirmOpen(false)}
                variant="ghost"
              >
                取消
              </Button>
              <Button disabled={deleting} onClick={() => void trashSelected()} variant="danger">
                {deleting ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
                确认移入
              </Button>
            </div>
          </section>
        </div>
      )}

      {albumPickerOpen && (
        <div
          className="library-confirm-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setAlbumPickerOpen(false);
          }}
        >
          <section
            aria-describedby="library-album-description"
            aria-labelledby="library-album-title"
            aria-modal="true"
            className="library-confirm library-album-dialog"
            role="dialog"
          >
            <span>
              <Album size={22} />
            </span>
            <h2 id="library-album-title">加入相册</h2>
            <p id="library-album-description">
              已选择 {selected.size} 张图片。图片会继续保留在图片库，也可以同时出现在多个相册中。
            </p>
            <label className="library-album-search">
              <Search aria-hidden="true" size={16} />
              <input
                autoFocus
                onChange={(event) => setAlbumQuery(event.target.value)}
                placeholder="搜索相册"
                type="search"
                value={albumQuery}
              />
            </label>
            <div className="library-album-list">
              {albumsLoading ? (
                <div className="library-album-empty">
                  <LoaderCircle className="spin" size={18} />
                  正在读取相册
                </div>
              ) : filteredAlbums.length === 0 ? (
                <div className="library-album-empty">
                  {albums.length === 0
                    ? "还没有相册，先去相册页创建一个。"
                    : "没有匹配的相册。"}
                </div>
              ) : (
                filteredAlbums.map((album) => {
                  const checked = albumSelection.has(album.id);
                  return (
                    <button
                      aria-pressed={checked}
                      className={checked ? "is-selected" : ""}
                      key={album.id}
                      onClick={() => toggleAlbumSelection(album.id)}
                      type="button"
                    >
                      <span>{checked && <Check size={13} />}</span>
                      <strong>{album.name}</strong>
                      <small>{album.imageCount} 张图片</small>
                    </button>
                  );
                })
              )}
            </div>
            <div>
              <Button
                disabled={assigningAlbums}
                onClick={() => setAlbumPickerOpen(false)}
                variant="ghost"
              >
                取消
              </Button>
              <Button
                disabled={
                  assigningAlbums || selected.size === 0 || albumSelection.size === 0
                }
                onClick={() => void addSelectedToAlbums()}
              >
                {assigningAlbums ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Album size={16} />
                )}
                确认加入
              </Button>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
