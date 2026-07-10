"use client";

import { Badge, Button, cn } from "@ou-image/ui";
import {
  Album as AlbumIcon,
  Check,
  FileImage,
  FolderPlus,
  Heart,
  ImageIcon,
  LoaderCircle,
  Merge,
  Palette,
  RefreshCw,
  RotateCcw,
  Save,
  Tags as TagsIcon,
  Trash2,
  X
} from "lucide-react";
import Link from "next/link";
import {
  type ComponentType,
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";
import { apiRequest } from "@/lib/api";
import { AppShell } from "./app-shell";
import styles from "./organization-hub.module.css";

export type OrganizationMode = "albums" | "tags" | "favorites" | "trash";

type OrganizedImage = {
  id: string;
  name: string;
  size: number;
  format: "jpeg" | "png" | "webp" | "gif" | "avif";
  width: number;
  height: number;
  thumbnailUrl: string;
  originalUrl: string;
  favorite?: boolean;
  albumIds?: string[];
  tagIds?: string[];
  createdAt: string;
  deletedAt?: string;
};

type Album = {
  id: string;
  name: string;
  description: string;
  coverImageId?: string;
  coverThumbnailUrl?: string;
  imageCount: number;
  createdAt: string;
  updatedAt: string;
};

type Tag = {
  id: string;
  name: string;
  color: string;
  imageCount: number;
  createdAt: string;
  updatedAt: string;
};

type ImageListResponse = { images: OrganizedImage[]; total: number };

const tagColors = [
  "#EF8F8F",
  "#E3A34F",
  "#6FAF87",
  "#5E9ACD",
  "#8B79C6",
  "#6D6D69"
];

const modeCopy = {
  albums: {
    eyebrow: "ALBUMS",
    title: "相册",
    description: "用有意义的集合组织图片，并为每个相册设置封面。",
    empty: "还没有相册"
  },
  tags: {
    eyebrow: "TAGS",
    title: "标签",
    description: "用颜色和名称建立灵活、可合并的分类体系。",
    empty: "还没有标签"
  },
  favorites: {
    eyebrow: "FAVORITES",
    title: "收藏",
    description: "集中查看你标记的重要图片，随时移出收藏。",
    empty: "还没有收藏图片"
  },
  trash: {
    eyebrow: "TRASH",
    title: "回收站",
    description: "恢复误删图片，或永久清除所有版本和分享记录。",
    empty: "回收站是空的"
  }
} as const;

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function requestMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function OrganizationHub({ mode }: { mode: OrganizationMode }) {
  const copy = modeCopy[mode];
  const [albums, setAlbums] = useState<Album[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [images, setImages] = useState<OrganizedImage[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleteDialog, setDeleteDialog] = useState<
    "resource" | "images" | null
  >(null);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createColor, setCreateColor] = useState(tagColors[0]);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editColor, setEditColor] = useState(tagColors[0]);
  const [mergeTargetId, setMergeTargetId] = useState("");

  const selectedAlbum = albums.find((album) => album.id === selectedResourceId);
  const selectedTag = tags.find((tag) => tag.id === selectedResourceId);
  const selectedResource = selectedAlbum ?? selectedTag;

  const loadResources = useCallback(async () => {
    if (mode !== "albums" && mode !== "tags") return;
    setLoading(true);
    setError("");
    try {
      if (mode === "albums") {
        const payload = await apiRequest<{ albums: Album[] }>("/albums");
        setAlbums(payload.albums);
        setSelectedResourceId((current) =>
          payload.albums.some((album) => album.id === current)
            ? current
            : (payload.albums[0]?.id ?? "")
        );
      } else {
        const payload = await apiRequest<{ tags: Tag[] }>("/tags");
        setTags(payload.tags);
        setSelectedResourceId((current) =>
          payload.tags.some((tag) => tag.id === current)
            ? current
            : (payload.tags[0]?.id ?? "")
        );
      }
    } catch (requestError) {
      setError(requestMessage(requestError, `${copy.title}加载失败`));
    } finally {
      setLoading(false);
    }
  }, [copy.title, mode]);

  const loadImages = useCallback(async () => {
    let endpoint = "";
    if (mode === "favorites") endpoint = "/favorites";
    if (mode === "trash") endpoint = "/trash";
    if (mode === "albums" && selectedResourceId) {
      endpoint = `/albums/${selectedResourceId}/images`;
    }
    if (mode === "tags" && selectedResourceId) {
      endpoint = `/tags/${selectedResourceId}/images`;
    }
    if (!endpoint) {
      setImages([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const payload = await apiRequest<ImageListResponse>(endpoint);
      setImages(payload.images);
      setSelectedImages(new Set());
    } catch (requestError) {
      setError(requestMessage(requestError, "图片列表加载失败"));
    } finally {
      setLoading(false);
    }
  }, [mode, selectedResourceId]);

  useEffect(() => {
    void loadResources();
  }, [loadResources]);

  useEffect(() => {
    void loadImages();
  }, [loadImages]);

  useEffect(() => {
    if (selectedAlbum) {
      setEditName(selectedAlbum.name);
      setEditDescription(selectedAlbum.description);
    }
    if (selectedTag) {
      setEditName(selectedTag.name);
      setEditColor(selectedTag.color);
      setMergeTargetId(
        tags.find((tag) => tag.id !== selectedTag.id)?.id ?? ""
      );
    }
  }, [selectedAlbum, selectedTag, tags]);

  const reload = async () => {
    await loadResources();
    await loadImages();
  };

  const createResource = async () => {
    if (!createName.trim()) return;
    setBusy("create");
    setNotice("");
    try {
      if (mode === "albums") {
        const payload = await apiRequest<{ album: Album }>("/albums", {
          method: "POST",
          body: JSON.stringify({
            name: createName.trim(),
            description: createDescription.trim()
          })
        });
        setAlbums((current) => [payload.album, ...current]);
        setSelectedResourceId(payload.album.id);
      } else {
        const payload = await apiRequest<{ tag: Tag }>("/tags", {
          method: "POST",
          body: JSON.stringify({
            name: createName.trim(),
            color: createColor
          })
        });
        setTags((current) => [payload.tag, ...current]);
        setSelectedResourceId(payload.tag.id);
      }
      setCreateName("");
      setCreateDescription("");
      setNotice(`${mode === "albums" ? "相册" : "标签"}已创建。`);
    } catch (requestError) {
      setNotice(requestMessage(requestError, "创建失败"));
    } finally {
      setBusy("");
    }
  };

  const saveResource = async () => {
    if (!selectedResource || !editName.trim()) return;
    setBusy("save");
    try {
      if (mode === "albums") {
        const payload = await apiRequest<{ album: Album }>(
          `/albums/${selectedResource.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              name: editName.trim(),
              description: editDescription.trim()
            })
          }
        );
        setAlbums((current) =>
          current.map((album) =>
            album.id === payload.album.id ? payload.album : album
          )
        );
      } else {
        const payload = await apiRequest<{ tag: Tag }>(
          `/tags/${selectedResource.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              name: editName.trim(),
              color: editColor
            })
          }
        );
        setTags((current) =>
          current.map((tag) =>
            tag.id === payload.tag.id ? payload.tag : tag
          )
        );
      }
      setNotice("修改已保存。");
    } catch (requestError) {
      setNotice(requestMessage(requestError, "保存失败"));
    } finally {
      setBusy("");
    }
  };

  const deleteResource = async () => {
    if (!selectedResource) return;
    setBusy("delete-resource");
    try {
      await apiRequest<void>(
        `/${mode === "albums" ? "albums" : "tags"}/${selectedResource.id}`,
        { method: "DELETE" }
      );
      if (mode === "albums") {
        setAlbums((current) =>
          current.filter((album) => album.id !== selectedResource.id)
        );
      } else {
        setTags((current) =>
          current.filter((tag) => tag.id !== selectedResource.id)
        );
      }
      setSelectedResourceId("");
      setImages([]);
      setDeleteDialog(null);
      setNotice(`${mode === "albums" ? "相册" : "标签"}已删除，图片仍保留。`);
    } catch (requestError) {
      setNotice(requestMessage(requestError, "删除失败"));
    } finally {
      setBusy("");
    }
  };

  const mergeTag = async () => {
    if (!selectedTag || !mergeTargetId) return;
    setBusy("merge");
    try {
      await apiRequest(`/tags/${selectedTag.id}/merge`, {
        method: "POST",
        body: JSON.stringify({ targetTagId: mergeTargetId })
      });
      setNotice("标签已合并，图片关联已迁移。");
      await loadResources();
    } catch (requestError) {
      setNotice(requestMessage(requestError, "标签合并失败"));
    } finally {
      setBusy("");
    }
  };

  const setCover = async (imageId: string) => {
    if (!selectedAlbum) return;
    setBusy(`cover-${imageId}`);
    try {
      const payload = await apiRequest<{ album: Album }>(
        `/albums/${selectedAlbum.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ coverImageId: imageId })
        }
      );
      setAlbums((current) =>
        current.map((album) =>
          album.id === payload.album.id ? payload.album : album
        )
      );
      setNotice("相册封面已更新。");
    } catch (requestError) {
      setNotice(requestMessage(requestError, "封面更新失败"));
    } finally {
      setBusy("");
    }
  };

  const removeFavorite = async (imageId: string) => {
    setBusy(`favorite-${imageId}`);
    try {
      await apiRequest(`/uploads/${imageId}/organization`, {
        method: "PATCH",
        body: JSON.stringify({ favorite: false })
      });
      setImages((current) => current.filter((image) => image.id !== imageId));
      setNotice("已移出收藏。");
    } catch (requestError) {
      setNotice(requestMessage(requestError, "收藏更新失败"));
    } finally {
      setBusy("");
    }
  };

  const toggleSelected = (imageId: string) => {
    setSelectedImages((current) => {
      const next = new Set(current);
      if (next.has(imageId)) next.delete(imageId);
      else next.add(imageId);
      return next;
    });
  };

  const allSelected =
    images.length > 0 && images.every((image) => selectedImages.has(image.id));

  const toggleAll = () => {
    setSelectedImages(
      allSelected ? new Set() : new Set(images.map((image) => image.id))
    );
  };

  const applyTrashAction = async (action: "restore" | "delete") => {
    if (selectedImages.size === 0) return;
    setBusy(action);
    try {
      const payload = await apiRequest<{
        restored?: number;
        deleted?: number;
        updated?: number;
      }>("/trash/bulk", {
          method: "POST",
          body: JSON.stringify({
            ids: Array.from(selectedImages),
            action
          })
        });
      const affected =
        (action === "restore" ? payload.restored : payload.deleted) ??
        payload.updated ??
        selectedImages.size;
      setImages((current) =>
        current.filter((image) => !selectedImages.has(image.id))
      );
      setSelectedImages(new Set());
      setDeleteDialog(null);
      setNotice(
        action === "restore"
          ? `已恢复 ${affected} 张图片。`
          : `已永久删除 ${affected} 张图片及其全部版本。`
      );
    } catch (requestError) {
      setNotice(requestMessage(requestError, "回收站操作失败"));
    } finally {
      setBusy("");
    }
  };

  const resourceItems = mode === "albums" ? albums : tags;
  const itemCount = useMemo(() => {
    if (mode === "albums") return albums.length;
    if (mode === "tags") return tags.length;
    return images.length;
  }, [albums.length, images.length, mode, tags.length]);

  return (
    <AppShell activeKey={mode}>
      <main className={cn("workspace-page", styles.page)}>
        <header className={styles.header}>
          <div>
            <span>{copy.eyebrow}</span>
            <h1>{copy.title}</h1>
            <p>{copy.description}</p>
          </div>
          <Badge tone="info">{itemCount} 项</Badge>
        </header>

        {notice && (
          <p className={styles.notice} role="status">
            <Check size={15} />
            {notice}
            <button aria-label="关闭提示" onClick={() => setNotice("")} type="button">
              <X size={14} />
            </button>
          </p>
        )}

        {(mode === "albums" || mode === "tags") ? (
          <div className={styles.resourceLayout}>
            <aside className={styles.resourceSidebar}>
              <section className={styles.createPanel}>
                <div>
                  {mode === "albums" ? <FolderPlus size={18} /> : <TagsIcon size={18} />}
                  <span>
                    <strong>新建{mode === "albums" ? "相册" : "标签"}</strong>
                    <small>建立一个清晰的新分类</small>
                  </span>
                </div>
                <label>
                  <span>名称</span>
                  <input
                    maxLength={60}
                    onChange={(event) => setCreateName(event.target.value)}
                    placeholder={mode === "albums" ? "例如：产品截图" : "例如：待发布"}
                    value={createName}
                  />
                </label>
                {mode === "albums" ? (
                  <label>
                    <span>描述</span>
                    <textarea
                      maxLength={240}
                      onChange={(event) => setCreateDescription(event.target.value)}
                      placeholder="说明这个相册用于什么"
                      value={createDescription}
                    />
                  </label>
                ) : (
                  <div className={styles.colorPicker}>
                    <span>颜色</span>
                    <div>
                      {tagColors.map((color) => (
                        <button
                          aria-label={`选择颜色 ${color}`}
                          className={createColor === color ? styles.colorActive : undefined}
                          key={color}
                          onClick={() => setCreateColor(color)}
                          style={{ "--tag-color": color } as React.CSSProperties}
                          type="button"
                        />
                      ))}
                    </div>
                  </div>
                )}
                <Button
                  disabled={!createName.trim() || busy === "create"}
                  onClick={() => void createResource()}
                >
                  {busy === "create" ? <LoaderCircle className={styles.spin} size={16} /> : <FolderPlus size={16} />}
                  创建
                </Button>
              </section>

              <nav className={styles.resourceList} aria-label={`${copy.title}列表`}>
                {resourceItems.map((item) => (
                  <button
                    className={selectedResourceId === item.id ? styles.resourceActive : undefined}
                    key={item.id}
                    onClick={() => setSelectedResourceId(item.id)}
                    type="button"
                  >
                    {mode === "albums" ? (
                      <span className={styles.albumCover}>
                        {("coverThumbnailUrl" in item && item.coverThumbnailUrl) ? (
                          <img alt="" src={item.coverThumbnailUrl} />
                        ) : (
                          <AlbumIcon size={18} />
                        )}
                      </span>
                    ) : (
                      <span
                        className={styles.tagDot}
                        style={{ "--tag-color": (item as Tag).color } as React.CSSProperties}
                      />
                    )}
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.imageCount} 张图片</small>
                    </span>
                  </button>
                ))}
                {!loading && resourceItems.length === 0 && (
                  <p>{copy.empty}</p>
                )}
              </nav>
            </aside>

            <section className={styles.resourceContent}>
              {selectedResource ? (
                <>
                  <div className={styles.editPanel}>
                    <div className={styles.editHeading}>
                      <span>
                        {mode === "albums" ? <AlbumIcon size={18} /> : <Palette size={18} />}
                      </span>
                      <div>
                        <strong>编辑{mode === "albums" ? "相册" : "标签"}</strong>
                        <small>{selectedResource.imageCount} 张图片 · 更新于 {formatDate(selectedResource.updatedAt)}</small>
                      </div>
                    </div>
                    <div className={styles.editFields}>
                      <label>
                        <span>名称</span>
                        <input
                          maxLength={60}
                          onChange={(event) => setEditName(event.target.value)}
                          value={editName}
                        />
                      </label>
                      {mode === "albums" ? (
                        <label>
                          <span>描述</span>
                          <input
                            maxLength={240}
                            onChange={(event) => setEditDescription(event.target.value)}
                            value={editDescription}
                          />
                        </label>
                      ) : (
                        <label>
                          <span>颜色</span>
                          <select
                            onChange={(event) => setEditColor(event.target.value)}
                            value={editColor}
                          >
                            {tagColors.map((color) => (
                              <option key={color} value={color}>{color}</option>
                            ))}
                          </select>
                        </label>
                      )}
                      <Button disabled={busy === "save"} onClick={() => void saveResource()} variant="secondary">
                        {busy === "save" ? <LoaderCircle className={styles.spin} size={15} /> : <Save size={15} />}
                        保存
                      </Button>
                      <Button onClick={() => setDeleteDialog("resource")} variant="ghost">
                        <Trash2 size={15} />
                        删除
                      </Button>
                    </div>
                    {mode === "tags" && tags.length > 1 && (
                      <div className={styles.mergeRow}>
                        <Merge size={16} />
                        <span>合并到</span>
                        <select
                          onChange={(event) => setMergeTargetId(event.target.value)}
                          value={mergeTargetId}
                        >
                          {tags
                            .filter((tag) => tag.id !== selectedTag?.id)
                            .map((tag) => (
                              <option key={tag.id} value={tag.id}>{tag.name}</option>
                            ))}
                        </select>
                        <Button disabled={!mergeTargetId || busy === "merge"} onClick={() => void mergeTag()} size="compact">
                          合并标签
                        </Button>
                      </div>
                    )}
                  </div>
                  <ImageCollection
                    busy={busy}
                    images={images}
                    mode={mode}
                    onSetCover={setCover}
                    selectedAlbum={selectedAlbum}
                  />
                </>
              ) : (
                <EmptyState copy={copy.empty} icon={mode === "albums" ? AlbumIcon : TagsIcon} />
              )}
            </section>
          </div>
        ) : (
          <section className={styles.simplePanel}>
            {mode === "trash" && images.length > 0 && (
              <div className={styles.trashToolbar}>
                <button
                  aria-pressed={allSelected}
                  onClick={toggleAll}
                  type="button"
                >
                  <span>{allSelected && <Check size={13} />}</span>
                  {allSelected ? "取消全选" : "全选"}
                </button>
                <strong>{selectedImages.size > 0 ? `已选择 ${selectedImages.size} 张` : `${images.length} 张图片`}</strong>
                <div>
                  <Button
                    disabled={selectedImages.size === 0 || busy === "restore"}
                    onClick={() => void applyTrashAction("restore")}
                    size="compact"
                    variant="secondary"
                  >
                    <RotateCcw size={15} />
                    恢复
                  </Button>
                  <Button
                    disabled={selectedImages.size === 0}
                    onClick={() => setDeleteDialog("images")}
                    size="compact"
                    variant="danger"
                  >
                    <Trash2 size={15} />
                    永久删除
                  </Button>
                </div>
              </div>
            )}
            {loading ? (
              <div className={styles.loading}><LoaderCircle className={styles.spin} size={24} />正在加载</div>
            ) : error ? (
              <div className={styles.errorState}>
                <RefreshCw size={24} />
                <strong>加载失败</strong>
                <span>{error}</span>
                <Button onClick={() => void reload()} size="compact">重试</Button>
              </div>
            ) : images.length === 0 ? (
              <EmptyState copy={copy.empty} icon={mode === "favorites" ? Heart : Trash2} />
            ) : (
              <div className={styles.imageGrid}>
                {images.map((image) => (
                  <article className={selectedImages.has(image.id) ? styles.imageSelected : undefined} key={image.id}>
                    {mode === "trash" && (
                      <button
                        aria-label={`${selectedImages.has(image.id) ? "取消选择" : "选择"} ${image.name}`}
                        className={styles.check}
                        onClick={() => toggleSelected(image.id)}
                        type="button"
                      >
                        {selectedImages.has(image.id) && <Check size={14} />}
                      </button>
                    )}
                    {mode === "trash" ? (
                      <div className={styles.trashPreview}>
                        <img alt={image.name} src={image.thumbnailUrl} />
                      </div>
                    ) : (
                      <Link href={`/library/${image.id}`}>
                        <img alt={image.name} src={image.thumbnailUrl} />
                      </Link>
                    )}
                    <div>
                      <strong>{image.name}</strong>
                      <small>{image.format.toUpperCase()} · {image.width} × {image.height} · {formatBytes(image.size)}</small>
                      {mode === "trash" && <time>删除于 {formatDate(image.deletedAt)}</time>}
                    </div>
                    {mode === "favorites" && (
                      <button
                        aria-label={`移出收藏 ${image.name}`}
                        disabled={busy === `favorite-${image.id}`}
                        className={styles.favorite}
                        onClick={() => void removeFavorite(image.id)}
                        type="button"
                      >
                        <Heart fill="currentColor" size={16} />
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {deleteDialog && (
        <div className={styles.dialogBackdrop}>
          <section aria-modal="true" className={styles.dialog} role="dialog">
            <span><Trash2 size={22} /></span>
            <h2>{deleteDialog === "images" ? "永久删除这些图片？" : `删除这个${mode === "albums" ? "相册" : "标签"}？`}</h2>
            <p>
              {deleteDialog === "images"
                ? `将永久删除 ${selectedImages.size} 张图片、所有历史版本与分享链接，此操作无法撤销。`
                : "图片文件不会删除，但现有分类关联将被解除。"}
            </p>
            <div>
              <Button onClick={() => setDeleteDialog(null)} variant="ghost">取消</Button>
              <Button
                disabled={Boolean(busy)}
                onClick={() =>
                  void (deleteDialog === "images"
                    ? applyTrashAction("delete")
                    : deleteResource())
                }
                variant="danger"
              >
                {busy ? <LoaderCircle className={styles.spin} size={16} /> : <Trash2 size={16} />}
                确认删除
              </Button>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}

function ImageCollection({
  busy,
  images,
  mode,
  onSetCover,
  selectedAlbum
}: {
  busy: string;
  images: OrganizedImage[];
  mode: "albums" | "tags";
  onSetCover: (imageId: string) => Promise<void>;
  selectedAlbum?: Album;
}) {
  if (images.length === 0) {
    return <EmptyState copy="这个分类中还没有图片，可在图片详情页添加。" icon={ImageIcon} />;
  }
  return (
    <div className={styles.collection}>
      <div className={styles.collectionHead}>
        <div><FileImage size={17} /><span><strong>分类图片</strong><small>{images.length} 张</small></span></div>
      </div>
      <div className={styles.imageGrid}>
        {images.map((image) => (
          <article key={image.id}>
            <Link href={`/library/${image.id}`}>
              <img alt={image.name} src={image.thumbnailUrl} />
            </Link>
            <div>
              <strong>{image.name}</strong>
              <small>{image.format.toUpperCase()} · {image.width} × {image.height}</small>
            </div>
            {mode === "albums" && (
              <button
                aria-label={`设为封面 ${image.name}`}
                className={styles.coverButton}
                disabled={busy === `cover-${image.id}`}
                onClick={() => void onSetCover(image.id)}
                type="button"
              >
                {selectedAlbum?.coverImageId === image.id ? <Check size={15} /> : <ImageIcon size={15} />}
              </button>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function EmptyState({
  copy,
  icon: Icon
}: {
  copy: string;
  icon: ComponentType<{ size?: number }>;
}) {
  return (
    <div className={styles.empty}>
      <span><Icon size={26} /></span>
      <strong>{copy}</strong>
      <small>上传或整理图片后，这里会自动更新。</small>
    </div>
  );
}
