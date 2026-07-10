"use client";

import { Badge, Button } from "@ou-image/ui";
import {
  FileImage,
  FolderCog,
  ImagePlus,
  Link2,
  UploadCloud,
  X
} from "lucide-react";
import Link from "next/link";
import { type DragEvent, useEffect, useRef, useState } from "react";
import { AppShell } from "./app-shell";

type PreviewFile = {
  id: string;
  name: string;
  size: number;
  url: string;
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function UploadWorkbench() {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewsRef = useRef<PreviewFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [previews, setPreviews] = useState<PreviewFile[]>([]);

  useEffect(() => {
    previewsRef.current = previews;
  }, [previews]);

  useEffect(() => {
    return () => {
      previewsRef.current.forEach((file) => URL.revokeObjectURL(file.url));
    };
  }, []);

  const appendFiles = (files: FileList | File[]) => {
    const images = Array.from(files).filter((file) =>
      file.type.startsWith("image/")
    );
    setPreviews((current) => [
      ...current,
      ...images.map((file) => ({
        id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
        name: file.name,
        size: file.size,
        url: URL.createObjectURL(file)
      }))
    ]);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    appendFiles(event.dataTransfer.files);
  };

  const removePreview = (id: string) => {
    setPreviews((current) => {
      const target = current.find((file) => file.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((file) => file.id !== id);
    });
  };

  return (
    <AppShell activeKey="upload">
      <main className="workspace-page">
        <div className="page-heading">
          <div>
            <Badge tone="info">默认工作区</Badge>
            <h1>上传图片</h1>
            <p>选择图片并确认内容，存储配置完成后即可建立上传队列。</p>
          </div>
          <Button asChild variant="secondary">
            <Link href="/storage">
              <FolderCog aria-hidden="true" size={17} />
              配置存储
            </Link>
          </Button>
        </div>

        <section className="setup-strip" aria-label="存储状态">
          <div className="setup-strip__icon">
            <FolderCog aria-hidden="true" size={20} />
          </div>
          <div>
            <strong>尚未连接图片存储</strong>
            <span>当前选择的文件只会在浏览器本地预览，不会发送到服务器。</span>
          </div>
          <Button asChild size="compact" variant="secondary">
            <Link href="/storage">前往设置</Link>
          </Button>
        </section>

        <section className="upload-surface">
          <div
            className={`drop-zone${dragging ? " is-dragging" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragging(false);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
          >
            <div className="drop-zone__icon">
              <UploadCloud aria-hidden="true" size={30} strokeWidth={1.7} />
            </div>
            <h2>将图片拖到这里</h2>
            <p>支持 JPG、PNG、WebP、GIF 和 AVIF 图片预览</p>
            <Button onClick={() => inputRef.current?.click()}>
              <ImagePlus aria-hidden="true" size={17} />
              选择图片
            </Button>
            <input
              accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
              className="sr-only"
              multiple
              onChange={(event) => {
                if (event.target.files) appendFiles(event.target.files);
                event.target.value = "";
              }}
              ref={inputRef}
              type="file"
            />
          </div>

          <div className="upload-shortcuts">
            <button onClick={() => inputRef.current?.click()} type="button">
              <ImagePlus aria-hidden="true" size={18} />
              <span>
                <strong>本地文件</strong>
                <small>选择多张图片</small>
              </span>
            </button>
            <button
              onClick={() => {
                window.dispatchEvent(
                  new KeyboardEvent("keydown", { key: "k", metaKey: true })
                );
              }}
              type="button"
            >
              <Link2 aria-hidden="true" size={18} />
              <span>
                <strong>快速导航</strong>
                <small>打开命令面板</small>
              </span>
            </button>
          </div>
        </section>

        <section className="preview-section">
          <div className="section-heading">
            <div>
              <h2>待处理预览</h2>
              <p>
                {previews.length > 0
                  ? `已选择 ${previews.length} 张图片`
                  : "选择图片后可在这里检查文件"}
              </p>
            </div>
            {previews.length > 0 && (
              <Button
                onClick={() => {
                  previews.forEach((file) => URL.revokeObjectURL(file.url));
                  setPreviews([]);
                }}
                size="compact"
                variant="ghost"
              >
                清空
              </Button>
            )}
          </div>

          {previews.length === 0 ? (
            <div className="preview-empty">
              <FileImage aria-hidden="true" size={28} />
              <strong>还没有选择图片</strong>
              <span>拖入文件或点击上方按钮开始预览。</span>
            </div>
          ) : (
            <div className="preview-grid">
              {previews.map((file) => (
                <article className="preview-card" key={file.id}>
                  <div className="preview-card__image">
                    <img alt={file.name} src={file.url} />
                    <button
                      aria-label={`移除 ${file.name}`}
                      onClick={() => removePreview(file.id)}
                      type="button"
                    >
                      <X aria-hidden="true" size={16} />
                    </button>
                  </div>
                  <div className="preview-card__meta">
                    <strong title={file.name}>{file.name}</strong>
                    <span>{formatBytes(file.size)}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </AppShell>
  );
}
