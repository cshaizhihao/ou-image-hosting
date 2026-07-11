"use client";

import { Button, cn } from "@ou-image/ui";
import {
  Album,
  ArrowRight,
  Check,
  Edit3,
  FolderOpen,
  FolderPlus,
  ImageIcon,
  LoaderCircle,
  Plus,
  Search,
  Trash2,
  X
} from "lucide-react";
import Link from "next/link";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
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
  imageCount: number;
  createdAt: string;
  updatedAt: string;
};

type DialogMode = "create" | "edit";

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
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

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

  useEffect(() => {
    if (!dialogOpen && !deleteAlbum) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDialogOpen(false);
        setDeleteAlbum(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialogOpen, deleteAlbum]);

  const totalImages = useMemo(
    () => albums.reduce((total, album) => total + album.imageCount, 0),
    [albums]
  );

  const filteredAlbums = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return albums;
    return albums.filter(
      (album) =>
        album.name.toLocaleLowerCase().includes(keyword) ||
        album.description.toLocaleLowerCase().includes(keyword)
    );
  }, [albums, query]);

  const openCreateDialog = () => {
    setDialogMode("create");
    setEditingAlbum(null);
    setName("");
    setDescription("");
    setError("");
    setDialogOpen(true);
  };

  const openEditDialog = (album: AlbumItem) => {
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
                    <Button asChild size="compact" variant="secondary">
                      <Link href={`/albums/${album.id}`}>
                        <FolderOpen aria-hidden="true" size={15} />
                        打开
                      </Link>
                    </Button>
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

      {dialogOpen && (
        <div
          className={styles.dialogBackdrop}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setDialogOpen(false);
          }}
        >
          <section
            aria-labelledby="album-dialog-title"
            aria-modal="true"
            className={styles.dialog}
            role="dialog"
          >
            <div className={styles.dialogHead}>
              <div className={styles.dialogTitle}>
                <span>
                  <FolderPlus aria-hidden="true" size={18} />
                </span>
                <div>
                  <strong id="album-dialog-title">{dialogTitle}</strong>
                  <small>{dialogSubtitle}</small>
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
          </section>
        </div>
      )}

      {deleteAlbum && (
        <div
          className={styles.dialogBackdrop}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setDeleteAlbum(null);
          }}
        >
          <section
            aria-describedby="delete-album-description"
            aria-labelledby="delete-album-title"
            aria-modal="true"
            className={cn(styles.dialog, styles.confirmDialog)}
            role="dialog"
          >
            <div className={styles.confirmIcon}>
              <Trash2 aria-hidden="true" size={22} />
            </div>
            <h2 id="delete-album-title">删除相册「{deleteAlbum.name}」？</h2>
            <p id="delete-album-description">
              这只会移除相册分类和图片归属关系，原图片仍会保留在图片库和其他相册里。
            </p>
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
          </section>
        </div>
      )}
    </AppShell>
  );
}
