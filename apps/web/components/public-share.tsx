"use client";

import { Button } from "@ou-image/ui";
import {
  Download,
  ImageIcon,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck
} from "lucide-react";
import { useEffect, useState } from "react";
import { BrandLockup } from "./auth-shell";
import styles from "./public-share.module.css";

type PublicShareMetadata = {
  share: {
    id: string;
    passwordRequired: boolean;
    createdAt: string;
    expiresAt?: string;
    accessCount: number;
  };
  image: {
    id: string;
    name: string;
    size: number;
    mime: string;
    format: string;
    width: number;
    height: number;
    updatedAt: string;
  };
};

function message(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  return (payload as { error?: { message?: string } }).error?.message ?? fallback;
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

export function PublicShareView({ token }: { token: string }) {
  const [data, setData] = useState<PublicShareMetadata | null>(null);
  const [password, setPassword] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [accessing, setAccessing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem("ou-theme");
    document.documentElement.dataset.theme =
      saved === "dark" ||
      (saved !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches)
        ? "dark"
        : "light";
  }, []);

  useEffect(() => {
    let active = true;
    void fetch(`/api/shares/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(message(payload, "分享链接不可用"));
        if (active) setData(payload as PublicShareMetadata);
      })
      .catch((requestError) => {
        if (active) {
          setError(requestError instanceof Error ? requestError.message : "分享链接不可用");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(
    () => () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    },
    [imageUrl]
  );

  const access = async () => {
    setAccessing(true);
    setError("");
    try {
      const response = await fetch(
        `/api/shares/${encodeURIComponent(token)}/access`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(password ? { password } : {})
        }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(message(payload, "无法访问这张图片"));
      }
      const blob = await response.blob();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      setImageUrl(URL.createObjectURL(blob));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "无法访问这张图片");
    } finally {
      setAccessing(false);
    }
  };

  useEffect(() => {
    if (data && !data.share.passwordRequired && !imageUrl && !accessing) {
      void access();
    }
    // Access is intentionally triggered once after metadata loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <BrandLockup compact />
        <span><ShieldCheck size={15} /> 安全分享</span>
      </header>
      <section className={styles.card}>
        {loading ? (
          <div className={styles.state}>
            <LoaderCircle className={styles.spin} size={26} />
            <h1>正在打开分享</h1>
            <p>读取图片信息与访问策略。</p>
          </div>
        ) : !data ? (
          <div className={styles.state}>
            <LockKeyhole size={30} />
            <h1>分享链接不可用</h1>
            <p>{error || "链接不存在、已撤销或已经过期。"}</p>
          </div>
        ) : (
          <>
            <div className={styles.heading}>
              <span>SHARED WITH OU-IMAGE HOSTING</span>
              <h1>{data.image.name}</h1>
              <p>
                {data.image.format.toUpperCase()} · {data.image.width} × {data.image.height} · {formatBytes(data.image.size)}
              </p>
            </div>
            <div className={styles.preview}>
              {imageUrl ? (
                <img alt={data.image.name} src={imageUrl} />
              ) : (
                <div>
                  <LockKeyhole size={30} />
                  <strong>{data.share.passwordRequired ? "这张图片受密码保护" : "正在加载图片"}</strong>
                  <span>验证成功后会在这里显示原图。</span>
                </div>
              )}
            </div>
            {data.share.passwordRequired && !imageUrl && (
              <form
                className={styles.access}
                onSubmit={(event) => {
                  event.preventDefault();
                  void access();
                }}
              >
                <label>
                  <span>访问密码</span>
                  <input
                    autoComplete="current-password"
                    autoFocus
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="输入分享密码"
                    type="password"
                    value={password}
                  />
                </label>
                <Button disabled={accessing || !password}>
                  {accessing ? <LoaderCircle className={styles.spin} size={16} /> : <LockKeyhole size={16} />}
                  验证并查看
                </Button>
              </form>
            )}
            {error && <p className={styles.error}>{error}</p>}
            {imageUrl && (
              <div className={styles.actions}>
                <a download={data.image.name} href={imageUrl}>
                  <Download size={17} />
                  下载图片
                </a>
                <span><ImageIcon size={15} /> 由 OU-Image Hosting 提供</span>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
