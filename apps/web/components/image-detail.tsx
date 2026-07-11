"use client";

import { Badge, Button, cn } from "@ou-image/ui";
import {
  Album,
  ArrowLeft,
  Check,
  Clipboard,
  Code2,
  Download,
  ExternalLink,
  FileCode2,
  FileImage,
  FlipHorizontal2,
  FlipVertical2,
  History,
  Heart,
  ImageIcon,
  Link2,
  LoaderCircle,
  LockKeyhole,
  QrCode,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Share2,
  ShieldCheck,
  Tags,
  Trash2,
  X,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";
import { apiRequest } from "@/lib/api";
import { AppShell } from "./app-shell";
import { ShareQrCode } from "./share-qr-code";
import styles from "./image-detail.module.css";

type ImageFormat = "jpeg" | "png" | "webp" | "gif" | "avif";
type TransformAction =
  | "rotate-left"
  | "rotate-right"
  | "flip-horizontal"
  | "flip-vertical"
  | "convert-format";
type DirectTransformAction = Exclude<TransformAction, "convert-format">;

const directTransforms: Array<{
  action: DirectTransformAction;
  label: string;
  Icon: LucideIcon;
}> = [
  { action: "rotate-left", label: "向左旋转", Icon: RotateCcw },
  { action: "rotate-right", label: "向右旋转", Icon: RotateCw },
  { action: "flip-horizontal", label: "水平翻转", Icon: FlipHorizontal2 },
  { action: "flip-vertical", label: "垂直翻转", Icon: FlipVertical2 }
];

type ImageVersion = {
  id: string;
  operation:
    | "original"
    | TransformAction
    | "restore";
  sourceVersionId?: string;
  size: number;
  mime: string;
  format: ImageFormat;
  width: number;
  height: number;
  sha256: string;
  createdAt: string;
  originalUrl: string;
};

type ImageShare = {
  id: string;
  passwordRequired: boolean;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  accessCount: number;
  lastAccessedAt?: string;
};

type ImageDetail = {
  id: string;
  name: string;
  size: number;
  mime: string;
  format: ImageFormat;
  width: number;
  height: number;
  sha256: string;
  currentVersionId: string;
  favorite: boolean;
  albumIds: string[];
  tagIds: string[];
  originalUrl: string;
  thumbnailUrl: string;
  createdAt: string;
  updatedAt: string;
  versions: ImageVersion[];
  shares: ImageShare[];
};

type ImageResponse = { image: ImageDetail };
type OrganizationImageResponse = {
  image: Pick<
    ImageDetail,
    | "id"
    | "name"
    | "size"
    | "mime"
    | "format"
    | "width"
    | "height"
    | "sha256"
    | "favorite"
    | "albumIds"
    | "tagIds"
    | "originalUrl"
    | "thumbnailUrl"
    | "createdAt"
    | "updatedAt"
  >;
};
type AlbumOption = {
  id: string;
  name: string;
  description: string;
  imageCount: number;
};
type TagOption = {
  id: string;
  name: string;
  color: string;
  imageCount: number;
};
type ShareResponse = {
  share: ImageShare;
  token: string;
  publicUrl: string;
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function operationName(operation: ImageVersion["operation"]) {
  return {
    original: "原始版本",
    "rotate-left": "向左旋转",
    "rotate-right": "向右旋转",
    "flip-horizontal": "水平翻转",
    "flip-vertical": "垂直翻转",
    "convert-format": "格式转换",
    restore: "恢复版本"
  }[operation];
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function ImageDetailView({
  imageId,
  returnHref = "/library",
  returnLabel = "返回图片库"
}: {
  imageId: string;
  returnHref?: string;
  returnLabel?: string;
}) {
  const [image, setImage] = useState<ImageDetail | null>(null);
  const [albums, setAlbums] = useState<AlbumOption[]>([]);
  const [tags, setTags] = useState<TagOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [name, setName] = useState("");
  const [targetFormat, setTargetFormat] = useState<"jpeg" | "png" | "webp">(
    "webp"
  );
  const [quality, setQuality] = useState(86);
  const [sharePassword, setSharePassword] = useState("");
  const [shareExpiry, setShareExpiry] = useState("168");
  const [createdShareUrl, setCreatedShareUrl] = useState("");
  const [restoreVersion, setRestoreVersion] = useState<ImageVersion | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [imagePayload, albumPayload, tagPayload] = await Promise.all([
        apiRequest<ImageResponse>(`/uploads/${imageId}`),
        apiRequest<{ albums: AlbumOption[] }>("/albums"),
        apiRequest<{ tags: TagOption[] }>("/tags")
      ]);
      setImage(imagePayload.image);
      setAlbums(albumPayload.albums);
      setTags(tagPayload.tags);
      setName(imagePayload.image.name);
      if (["jpeg", "png", "webp"].includes(imagePayload.image.format)) {
        setTargetFormat(
          imagePayload.image.format as "jpeg" | "png" | "webp"
        );
      }
    } catch (requestError) {
      setError(errorMessage(requestError, "图片详情加载失败"));
    } finally {
      setLoading(false);
    }
  }, [imageId]);

  useEffect(() => {
    void load();
  }, [load]);

  const absoluteUrl = useMemo(() => {
    if (!image || typeof window === "undefined") return "";
    return new URL(image.originalUrl, window.location.origin).href;
  }, [image]);

  const copy = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(message);
    } catch {
      setNotice("复制失败，请手动选择文本。");
    }
  };

  const copyOptions = image
    ? [
        {
          label: "URL",
          icon: Link2,
          value: absoluteUrl
        },
        {
          label: "Markdown",
          icon: FileCode2,
          value: `![${image.name.replaceAll("]", "\\]")}](${absoluteUrl})`
        },
        {
          label: "HTML",
          icon: Code2,
          value: `<img src="${escapeHtml(absoluteUrl)}" alt="${escapeHtml(image.name)}" />`
        },
        {
          label: "BBCode",
          icon: Clipboard,
          value: `[img]${absoluteUrl}[/img]`
        }
      ]
    : [];

  const rename = async () => {
    if (!image || !name.trim() || name.trim() === image.name) return;
    setBusy("rename");
    setNotice("");
    try {
      const payload = await apiRequest<ImageResponse>(`/uploads/${image.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim() })
      });
      setImage(payload.image);
      setName(payload.image.name);
      setNotice("图片名称已更新。");
    } catch (requestError) {
      setNotice(errorMessage(requestError, "重命名失败"));
    } finally {
      setBusy("");
    }
  };

  const updateOrganization = async (
    patch: Partial<
      Pick<ImageDetail, "favorite" | "albumIds" | "tagIds">
    >,
    message: string
  ) => {
    if (!image) return;
    const organizationKey = Object.keys(patch)[0] ?? "organization";
    setBusy(`organization-${organizationKey}`);
    setNotice("");
    try {
      const payload = await apiRequest<OrganizationImageResponse>(
        `/uploads/${image.id}/organization`,
        {
          method: "PATCH",
          body: JSON.stringify(patch)
        }
      );
      setImage((current) =>
        current ? { ...current, ...payload.image } : current
      );
      setNotice(message);
    } catch (requestError) {
      setNotice(errorMessage(requestError, "图片整理失败"));
    } finally {
      setBusy("");
    }
  };

  const toggleRelation = (
    kind: "albumIds" | "tagIds",
    relationId: string
  ) => {
    if (!image) return;
    const current = image[kind];
    const next = current.includes(relationId)
      ? current.filter((id) => id !== relationId)
      : [...current, relationId];
    void updateOrganization(
      { [kind]: next },
      kind === "albumIds" ? "相册归属已更新。" : "标签已更新。"
    );
  };

  const transform = async (action: TransformAction) => {
    if (!image) return;
    setBusy(action);
    setNotice("");
    try {
      const body =
        action === "convert-format"
          ? { action, format: targetFormat, quality }
          : { action, quality };
      const payload = await apiRequest<ImageResponse & { version: ImageVersion }>(
        `/uploads/${image.id}/transform`,
        {
          method: "POST",
          body: JSON.stringify(body)
        }
      );
      setImage(payload.image);
      setName(payload.image.name);
      setNotice(`${operationName(payload.version.operation)}已完成。`);
    } catch (requestError) {
      setNotice(errorMessage(requestError, "图片编辑失败"));
    } finally {
      setBusy("");
    }
  };

  const restore = async () => {
    if (!image || !restoreVersion) return;
    setBusy(`restore-${restoreVersion.id}`);
    try {
      const payload = await apiRequest<ImageResponse & { version: ImageVersion }>(
        `/uploads/${image.id}/versions/${restoreVersion.id}/restore`,
        { method: "POST" }
      );
      setImage(payload.image);
      setName(payload.image.name);
      setRestoreVersion(null);
      setNotice("已恢复到所选版本，并保留当前版本记录。");
    } catch (requestError) {
      setNotice(errorMessage(requestError, "版本恢复失败"));
    } finally {
      setBusy("");
    }
  };

  const createShare = async () => {
    if (!image) return;
    setBusy("share");
    setNotice("");
    try {
      const expiresInHours =
        shareExpiry === "never" ? undefined : Number(shareExpiry);
      const payload = await apiRequest<ShareResponse>(
        `/uploads/${image.id}/shares`,
        {
          method: "POST",
          body: JSON.stringify({
            ...(sharePassword ? { password: sharePassword } : {}),
            ...(expiresInHours ? { expiresInHours } : {})
          })
        }
      );
      const publicUrl = new URL(payload.publicUrl, window.location.origin).href;
      setCreatedShareUrl(publicUrl);
      setSharePassword("");
      setImage((current) =>
        current
          ? { ...current, shares: [payload.share, ...current.shares] }
          : current
      );
      setNotice("分享链接已创建；令牌只在本次创建后展示。");
    } catch (requestError) {
      setNotice(errorMessage(requestError, "创建分享失败"));
    } finally {
      setBusy("");
    }
  };

  const revokeShare = async (shareId: string) => {
    if (!image) return;
    setBusy(`share-${shareId}`);
    try {
      await apiRequest<void>(`/uploads/${image.id}/shares/${shareId}`, {
        method: "DELETE"
      });
      setImage((current) =>
        current
          ? {
              ...current,
              shares: current.shares.map((share) =>
                share.id === shareId
                  ? { ...share, revokedAt: new Date().toISOString() }
                  : share
              )
            }
          : current
      );
      setNotice("分享链接已撤销。");
    } catch (requestError) {
      setNotice(errorMessage(requestError, "撤销分享失败"));
    } finally {
      setBusy("");
    }
  };

  return (
    <AppShell activeKey="library">
      <main className={cn("workspace-page", styles.page)}>
        <header className={styles.header}>
          <div>
            <Link className={styles.back} href={returnHref}>
              <ArrowLeft size={16} />
              {returnLabel}
            </Link>
            <span className={styles.eyebrow}>IMAGE DETAIL</span>
            <h1>{image?.name ?? "图片详情"}</h1>
            <p>查看元数据、复制外链、编辑图片并管理分享版本。</p>
          </div>
          {image && (
            <Button asChild variant="secondary">
              <a href={image.originalUrl} rel="noreferrer" target="_blank">
                <ExternalLink size={16} />
                打开原图
              </a>
            </Button>
          )}
        </header>

        {notice && (
          <p className={styles.notice} role="status">
            <Check size={15} />
            {notice}
          </p>
        )}

        {loading ? (
          <div className={styles.loading}>
            <LoaderCircle className={styles.spin} size={24} />
            正在读取图片详情
          </div>
        ) : error || !image ? (
          <section className={styles.state}>
            <FileImage size={32} />
            <h2>无法打开图片详情</h2>
            <p>{error || "图片不存在或已进入回收站。"}</p>
            <Button onClick={() => void load()}>
              <RefreshCw size={16} />
              重新加载
            </Button>
          </section>
        ) : (
          <>
            <section className={styles.hero}>
              <div className={styles.preview}>
                <img
                  alt={image.name}
                  key={image.currentVersionId}
                  src={`${image.originalUrl}?v=${encodeURIComponent(image.currentVersionId)}`}
                />
              </div>
              <div className={styles.summary}>
                <div className={styles.summaryTitle}>
                  <span>
                    <ImageIcon size={17} />
                  </span>
                  <div>
                    <small>当前版本</small>
                    <strong>{image.name}</strong>
                  </div>
                  <Badge tone="info">{image.format.toUpperCase()}</Badge>
                </div>
                <dl className={styles.metadata}>
                  <div><dt>尺寸</dt><dd>{image.width} × {image.height}</dd></div>
                  <div><dt>文件大小</dt><dd>{formatBytes(image.size)}</dd></div>
                  <div><dt>MIME</dt><dd>{image.mime}</dd></div>
                  <div><dt>创建时间</dt><dd>{formatDate(image.createdAt)}</dd></div>
                  <div><dt>更新时间</dt><dd>{formatDate(image.updatedAt)}</dd></div>
                </dl>
                <div className={styles.hash}>
                  <span>SHA-256</span>
                  <code>{image.sha256}</code>
                  <button
                    aria-label="复制 SHA-256"
                    onClick={() => void copy(image.sha256, "SHA-256 已复制。")}
                    type="button"
                  >
                    <Clipboard size={15} />
                  </button>
                </div>
              </div>
            </section>

            <div className={styles.columns}>
              <div className={styles.primaryColumn}>
                <section className={styles.panel}>
                  <div className={styles.panelHead}>
                    <div><Link2 size={18} /><span><strong>引用与外链</strong><small>适配常见发布格式</small></span></div>
                  </div>
                  <div className={styles.copyGrid}>
                    {copyOptions.map(({ label, icon: Icon, value }) => (
                      <button
                        key={label}
                        onClick={() => void copy(value, `${label} 已复制。`)}
                        type="button"
                      >
                        <Icon size={17} />
                        <span><strong>{label}</strong><small>{value}</small></span>
                        <Clipboard size={14} />
                      </button>
                    ))}
                  </div>
                </section>

                <section className={styles.panel}>
                  <div className={styles.panelHead}>
                    <div><Save size={18} /><span><strong>图片编辑</strong><small>每次编辑都会生成可恢复版本</small></span></div>
                  </div>
                  <div className={styles.renameRow}>
                    <label>
                      <span>图片名称</span>
                      <input
                        maxLength={180}
                        onChange={(event) => setName(event.target.value)}
                        value={name}
                      />
                    </label>
                    <Button
                      disabled={busy === "rename" || name.trim() === image.name}
                      onClick={() => void rename()}
                      variant="secondary"
                    >
                      {busy === "rename" ? <LoaderCircle className={styles.spin} size={16} /> : <Save size={16} />}
                      保存名称
                    </Button>
                  </div>
                  <div className={styles.transformGrid}>
                    {directTransforms.map(({ action, label, Icon }) => (
                      <button
                        disabled={Boolean(busy)}
                        key={action}
                        onClick={() => void transform(action)}
                        type="button"
                      >
                        {busy === action ? <LoaderCircle className={styles.spin} size={19} /> : <Icon size={19} />}
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className={styles.convert}>
                    <label>
                      <span>目标格式</span>
                      <select
                        onChange={(event) => setTargetFormat(event.target.value as "jpeg" | "png" | "webp")}
                        value={targetFormat}
                      >
                        <option value="webp">WebP</option>
                        <option value="jpeg">JPEG</option>
                        <option value="png">PNG</option>
                      </select>
                    </label>
                    <label className={styles.quality}>
                      <span>质量 <strong>{quality}</strong></span>
                      <input
                        max={100}
                        min={1}
                        onChange={(event) => setQuality(Number(event.target.value))}
                        type="range"
                        value={quality}
                      />
                    </label>
                    <Button
                      disabled={Boolean(busy)}
                      onClick={() => void transform("convert-format")}
                    >
                      {busy === "convert-format" ? <LoaderCircle className={styles.spin} size={16} /> : <RefreshCw size={16} />}
                      生成新版本
                    </Button>
                  </div>
                </section>

                <section className={styles.panel}>
                  <div className={styles.panelHead}>
                    <div><History size={18} /><span><strong>版本历史</strong><small>{image.versions.length} 个可恢复版本</small></span></div>
                  </div>
                  <ol className={styles.versionList}>
                    {image.versions.map((version) => {
                      const current = version.id === image.currentVersionId;
                      return (
                        <li className={current ? styles.currentVersion : undefined} key={version.id}>
                          <span className={styles.versionIcon}><History size={16} /></span>
                          <div>
                            <strong>{operationName(version.operation)}</strong>
                            <small>{version.format.toUpperCase()} · {version.width} × {version.height} · {formatBytes(version.size)}</small>
                            <time>{formatDate(version.createdAt)}</time>
                          </div>
                          {current ? (
                            <Badge tone="success">当前</Badge>
                          ) : (
                            <Button
                              onClick={() => setRestoreVersion(version)}
                              size="compact"
                              variant="ghost"
                            >
                              恢复
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </section>
              </div>

              <aside className={styles.sideColumn}>
                <section className={styles.panel}>
                  <div className={styles.panelHead}>
                    <div>
                      <Album size={18} />
                      <span>
                        <strong>整理图片</strong>
                        <small>收藏、相册与标签</small>
                      </span>
                    </div>
                  </div>
                  <div className={styles.organization}>
                    <button
                      aria-pressed={image.favorite}
                      className={image.favorite ? styles.favoriteActive : undefined}
                      disabled={busy === "organization-favorite"}
                      onClick={() =>
                        void updateOrganization(
                          { favorite: !image.favorite },
                          image.favorite ? "已移出收藏。" : "已加入收藏。"
                        )
                      }
                      type="button"
                    >
                      {busy === "organization-favorite" ? (
                        <LoaderCircle className={styles.spin} size={17} />
                      ) : (
                        <Heart
                          fill={image.favorite ? "currentColor" : "none"}
                          size={17}
                        />
                      )}
                      <span>
                        <strong>{image.favorite ? "已收藏" : "加入收藏"}</strong>
                        <small>在收藏页面快速找到这张图片</small>
                      </span>
                    </button>

                    <div className={styles.relationGroup}>
                      <div>
                        <Album size={15} />
                        <span>相册</span>
                        <small>{image.albumIds.length} 个</small>
                      </div>
                      {albums.length === 0 ? (
                        <p>
                          还没有相册，前往 <Link href="/albums">相册页面</Link> 创建。
                        </p>
                      ) : (
                        <div className={styles.relationChips}>
                          {albums.map((album) => {
                            const selected = image.albumIds.includes(album.id);
                            return (
                              <button
                                aria-pressed={selected}
                                className={selected ? styles.relationActive : undefined}
                                disabled={busy === "organization-albumIds"}
                                key={album.id}
                                onClick={() => toggleRelation("albumIds", album.id)}
                                type="button"
                              >
                                {selected && <Check size={12} />}
                                {album.name}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className={styles.relationGroup}>
                      <div>
                        <Tags size={15} />
                        <span>标签</span>
                        <small>{image.tagIds.length} 个</small>
                      </div>
                      {tags.length === 0 ? (
                        <p>
                          还没有标签，前往 <Link href="/tags">标签页面</Link> 创建。
                        </p>
                      ) : (
                        <div className={styles.relationChips}>
                          {tags.map((tag) => {
                            const selected = image.tagIds.includes(tag.id);
                            return (
                              <button
                                aria-pressed={selected}
                                className={selected ? styles.relationActive : undefined}
                                disabled={busy === "organization-tagIds"}
                                key={tag.id}
                                onClick={() => toggleRelation("tagIds", tag.id)}
                                style={{ "--tag-color": tag.color } as CSSProperties}
                                type="button"
                              >
                                <span className={styles.relationDot} />
                                {selected && <Check size={12} />}
                                {tag.name}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                <section className={styles.panel}>
                  <div className={styles.panelHead}>
                    <div><Share2 size={18} /><span><strong>创建分享</strong><small>可设置密码和有效期</small></span></div>
                  </div>
                  <div className={styles.shareForm}>
                    <label>
                      <span>有效期</span>
                      <select onChange={(event) => setShareExpiry(event.target.value)} value={shareExpiry}>
                        <option value="24">24 小时</option>
                        <option value="168">7 天</option>
                        <option value="720">30 天</option>
                        <option value="never">永不过期</option>
                      </select>
                    </label>
                    <label>
                      <span>访问密码 <small>可选，至少 4 位</small></span>
                      <input
                        autoComplete="new-password"
                        minLength={4}
                        onChange={(event) => setSharePassword(event.target.value)}
                        placeholder="不填写则公开访问"
                        type="password"
                        value={sharePassword}
                      />
                    </label>
                    <Button
                      disabled={busy === "share" || (sharePassword.length > 0 && sharePassword.length < 4)}
                      onClick={() => void createShare()}
                    >
                      {busy === "share" ? <LoaderCircle className={styles.spin} size={16} /> : <Share2 size={16} />}
                      创建分享链接
                    </Button>
                  </div>
                </section>

                <section className={styles.panel}>
                  <div className={styles.panelHead}>
                    <div><LockKeyhole size={18} /><span><strong>分享记录</strong><small>访问统计与撤销状态</small></span></div>
                  </div>
                  {image.shares.length === 0 ? (
                    <div className={styles.shareEmpty}>
                      <Share2 size={22} />
                      <span>尚未创建分享链接</span>
                    </div>
                  ) : (
                    <ul className={styles.shareList}>
                      {image.shares.map((share) => (
                        <li key={share.id}>
                          <div>
                            <span className={cn(styles.shareStatus, share.revokedAt && styles.revoked)} />
                            <p>
                              <strong>{share.revokedAt ? "已撤销" : "有效链接"}</strong>
                              <small>
                                {share.passwordRequired ? "密码保护" : "公开访问"} · {share.accessCount} 次访问
                              </small>
                              <time>{share.expiresAt ? `到期 ${formatDate(share.expiresAt)}` : "永不过期"}</time>
                            </p>
                          </div>
                          {!share.revokedAt && (
                            <button
                              aria-label="撤销分享链接"
                              disabled={busy === `share-${share.id}`}
                              onClick={() => void revokeShare(share.id)}
                              type="button"
                            >
                              {busy === `share-${share.id}` ? <LoaderCircle className={styles.spin} size={15} /> : <Trash2 size={15} />}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <a className={styles.download} download href={image.originalUrl}>
                  <Download size={17} />
                  下载当前版本
                </a>
              </aside>
            </div>
          </>
        )}
      </main>

      {restoreVersion && (
        <div className={styles.dialogBackdrop}>
          <section aria-modal="true" className={styles.dialog} role="dialog">
            <span><History size={22} /></span>
            <h2>恢复这个版本？</h2>
            <p>
              将恢复 {formatDate(restoreVersion.createdAt)} 的 {restoreVersion.format.toUpperCase()} 版本。
              当前版本不会删除，仍可从历史中恢复。
            </p>
            <div>
              <Button onClick={() => setRestoreVersion(null)} variant="ghost">取消</Button>
              <Button disabled={Boolean(busy)} onClick={() => void restore()}>
                {busy.startsWith("restore-") ? <LoaderCircle className={styles.spin} size={16} /> : <History size={16} />}
                确认恢复
              </Button>
            </div>
          </section>
        </div>
      )}

      {createdShareUrl && (
        <div className={styles.dialogBackdrop}>
          <section
            aria-labelledby="share-ready-title"
            aria-modal="true"
            className={cn(styles.dialog, styles.shareDialog)}
            role="dialog"
          >
            <button
              aria-label="关闭分享链接浮窗"
              className={styles.dialogClose}
              onClick={() => setCreatedShareUrl("")}
              type="button"
            >
              <X size={16} />
            </button>
            <span>
              <ShieldCheck size={22} />
            </span>
            <h2 id="share-ready-title">分享已就绪</h2>
            <p>请立即复制链接；出于安全考虑，令牌之后不会再次显示。</p>
            <code className={styles.shareUrl}>{createdShareUrl}</code>
            <div className={styles.shareDialogActions}>
              <Button
                onClick={() => void copy(createdShareUrl, "分享链接已复制。")}
                variant="secondary"
              >
                <Clipboard size={16} />
                复制链接
              </Button>
              <Button asChild variant="ghost">
                <a href={createdShareUrl} rel="noreferrer" target="_blank">
                  <ExternalLink size={16} />
                  预览
                </a>
              </Button>
            </div>
            <div className={styles.shareDialogQr}>
              <QrCode size={16} />
              <ShareQrCode value={createdShareUrl} />
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
