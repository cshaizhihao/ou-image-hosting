"use client";

import { Button } from "@ou-image/ui";
import {
  Album,
  ArrowRight,
  Check,
  FolderPlus,
  ImageIcon,
  LoaderCircle,
  Plus,
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
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
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
    if (!dialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialogOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialogOpen]);

  const totalImages = useMemo(
    () => albums.reduce((total, album) => total + album.imageCount, 0),
    [albums]
  );

  const createAlbum = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setNotice("");
    setError("");
    try {
      const payload = await apiRequest<{ album: AlbumItem }>("/albums", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim()
        })
      });
      setAlbums((current) => [payload.album, ...current]);
      setName("");
      setDescription("");
      setDialogOpen(false);
      setNotice(`相册「${payload.album.name}」已创建。`);
    } catch (requestError) {
      setError(requestMessage(requestError, "相册创建失败"));
    } finally {
      setCreating(false);
    }
  };

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
          <Button onClick={() => setDialogOpen(true)}>
            <Plus aria-hidden="true" size={17} />
            新建相册
          </Button>
        </header>

        <section className={styles.toolbar} aria-label="相册摘要">
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
            <Button onClick={() => setDialogOpen(true)}>
              <Plus aria-hidden="true" size={17} />
              新建相册
            </Button>
          </section>
        ) : (
          <section className={styles.grid} aria-label="相册列表">
            {albums.map((album) => (
              <Link className={styles.card} href={`/albums/${album.id}`} key={album.id}>
                <span className={styles.cover}>
                  {album.coverThumbnailUrl ? (
                    <img alt="" src={album.coverThumbnailUrl} />
                  ) : (
                    <Album aria-hidden="true" size={42} />
                  )}
                </span>
                <span className={styles.cardBody}>
                  <h2>{album.name}</h2>
                  <p>{album.description || "这个相册还没有描述，打开后可以继续整理图片。"}</p>
                  <span className={styles.cardMeta}>
                    <span>
                      <strong>{album.imageCount}</strong> 张图片
                    </span>
                    <time dateTime={album.updatedAt}>
                      {formatDate(album.updatedAt)}
                    </time>
                  </span>
                </span>
              </Link>
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
            aria-labelledby="create-album-title"
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
                  <strong id="create-album-title">新建相册</strong>
                  <small>建立一个清晰的新分类</small>
                </div>
              </div>
              <button
                aria-label="关闭新建相册窗口"
                className={styles.close}
                onClick={() => setDialogOpen(false)}
                type="button"
              >
                <X aria-hidden="true" size={17} />
              </button>
            </div>

            <form className={styles.form} onSubmit={createAlbum}>
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
                  disabled={creating}
                  onClick={() => setDialogOpen(false)}
                  type="button"
                  variant="ghost"
                >
                  取消
                </Button>
                <Button disabled={!name.trim() || creating} type="submit">
                  {creating ? (
                    <LoaderCircle className={styles.spin} aria-hidden="true" size={16} />
                  ) : (
                    <FolderPlus aria-hidden="true" size={16} />
                  )}
                  创建
                </Button>
              </div>
            </form>
          </section>
        </div>
      )}
    </AppShell>
  );
}
