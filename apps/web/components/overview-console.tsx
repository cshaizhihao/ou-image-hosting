"use client";

import { Button } from "@ou-image/ui";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Database,
  FileImage,
  FolderCog,
  HardDrive,
  ImageUp,
  LoaderCircle,
  Settings,
  ShieldCheck,
  Sparkles,
  Users
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  apiRequest,
  getStoredWorkspaceId,
  normalizeSessionBootstrap,
  type SessionUser,
  type WorkspaceSummary
} from "@/lib/api";
import {
  formatOverviewBytes,
  overviewAverageImageBytes,
  overviewQuotaPercent,
  overviewRoleLabel,
  overviewStorageLabel,
  overviewStorageTone,
  selectOverviewWorkspace,
  type OverviewSummary
} from "@/lib/overview-model";
import { AppShell } from "./app-shell";
import styles from "./overview-console.module.css";

type OverviewData = {
  user: SessionUser;
  workspace: WorkspaceSummary;
  summary: OverviewSummary;
};

export function OverviewConsole() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    Promise.all([
      apiRequest<{
        user: SessionUser;
        workspaces?: WorkspaceSummary[];
        defaultWorkspace?: WorkspaceSummary;
      }>("/auth/session", { signal: controller.signal }),
      apiRequest<OverviewSummary>("/uploads/summary", {
        signal: controller.signal
      })
    ])
      .then(([sessionPayload, summary]) => {
        const bootstrap = normalizeSessionBootstrap(sessionPayload);
        setData({
          user: bootstrap.user,
          workspace: selectOverviewWorkspace(
            bootstrap,
            getStoredWorkspaceId()
          ),
          summary
        });
      })
      .catch((requestError) => {
        if ((requestError as Error).name !== "AbortError") {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "概况数据加载失败"
          );
        }
      });

    return () => controller.abort();
  }, []);

  const quotaPercent = data ? overviewQuotaPercent(data.summary) : 0;
  const storageTone = data ? overviewStorageTone(data.summary) : "calm";
  const storageLabel = data ? overviewStorageLabel(data.summary) : "";
  const averageImageBytes = data
    ? overviewAverageImageBytes(data.summary)
    : 0;
  const isSiteOwner = data?.user.role === "owner";

  return (
    <AppShell activeKey="overview">
      <main className={`workspace-page ${styles.page}`}>
        <header className={styles.header}>
          <div className={styles.headerCopy}>
            <span className={styles.eyebrow}>WORKSPACE OVERVIEW</span>
            <h1>概览</h1>
            <p>从这里确认工作区状态、存储容量并继续日常操作。</p>
          </div>
          <Button asChild>
            <Link href="/">
              前往上传
              <ArrowRight aria-hidden="true" size={17} />
            </Link>
          </Button>
        </header>

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        {!data && !error ? (
          <section
            aria-live="polite"
            className={styles.loading}
            role="status"
          >
            <LoaderCircle aria-hidden="true" size={26} />
            <strong>正在汇总工作区概况</strong>
            <span>图片与存储数据会自动更新。</span>
          </section>
        ) : data ? (
          <>
            <section
              aria-label="工作区健康状态"
              className={styles.heroPanel}
              data-tone={storageTone}
            >
              <div className={styles.heroCopy}>
                <span>
                  <Sparkles aria-hidden="true" size={16} />
                  {storageLabel}
                </span>
                <h2>
                  {data.summary.count > 0
                    ? "图片空间运行正常"
                    : "工作区已经准备好"}
                </h2>
                <p>
                  {data.summary.count > 0
                    ? `当前工作区有 ${data.summary.count} 张图片，平均每张约 ${formatOverviewBytes(
                        averageImageBytes
                      )}。`
                    : "上传第一张图片后，这里会展示容量、水位和整理建议。"}
                </p>
              </div>
              <div className={styles.capacityRing}>
                <svg aria-hidden="true" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="48" />
                  <circle
                    cx="60"
                    cy="60"
                    r="48"
                    style={{
                      strokeDashoffset: `${301.59 - (301.59 * quotaPercent) / 100}`
                    }}
                  />
                </svg>
                <strong>{quotaPercent}%</strong>
                <span>容量水位</span>
              </div>
              <div className={styles.heroActions}>
                <Button asChild>
                  <Link href="/upload">
                    去上传
                    <ArrowRight aria-hidden="true" size={16} />
                  </Link>
                </Button>
                {isSiteOwner && (
                  <Button asChild variant="secondary">
                    <Link href="/storage">
                      检查存储
                      <Settings aria-hidden="true" size={16} />
                    </Link>
                  </Button>
                )}
              </div>
            </section>

            <section aria-label="工作区摘要" className={styles.metrics}>
              <article className={styles.metric}>
                <span className={styles.metricIcon}>
                  <FileImage aria-hidden="true" size={20} />
                </span>
                <div>
                  <span>现有图片</span>
                  <strong>{data.summary.count}</strong>
                  <p>当前工作区中可用的图片资产。</p>
                  <div className={styles.metricBars} aria-hidden="true">
                    <span style={{ transform: `scaleX(${Math.min(1, data.summary.count / 24)})` }} />
                  </div>
                </div>
              </article>

              <article className={styles.metric}>
                <span className={styles.metricIcon}>
                  <HardDrive aria-hidden="true" size={20} />
                </span>
                <div>
                  <span>已用存储</span>
                  <strong>{formatOverviewBytes(data.summary.bytes)}</strong>
                  <p>包含当前工作区实际占用的图片数据。</p>
                  <small>
                    平均 {formatOverviewBytes(averageImageBytes)} / 张
                  </small>
                </div>
              </article>

              <article className={styles.metric}>
                <span className={styles.metricIcon}>
                  <Database aria-hidden="true" size={20} />
                </span>
                <div>
                  <span>容量使用率</span>
                  <strong>{quotaPercent}%</strong>
                  <div className={styles.quotaTrack} aria-hidden="true">
                    <span
                      style={{ transform: `scaleX(${quotaPercent / 100})` }}
                    />
                  </div>
                  <p>
                    {formatOverviewBytes(data.summary.bytes)} /{" "}
                    {data.summary.quotaBytes > 0
                      ? formatOverviewBytes(data.summary.quotaBytes)
                      : "未限额"}
                  </p>
                  <small>{storageLabel}</small>
                </div>
              </article>

              <article className={styles.metric}>
                <span className={styles.metricIcon}>
                  <Users aria-hidden="true" size={20} />
                </span>
                <div>
                  <span>当前工作区</span>
                  <strong>{data.workspace.name}</strong>
                  <p>
                    你的权限：{overviewRoleLabel(data.workspace)}
                    {data.workspace.memberCount
                      ? ` · ${data.workspace.memberCount} 位成员`
                      : ""}
                  </p>
                  <small>{data.user.displayName || data.user.email}</small>
                </div>
              </article>
            </section>

            <section className={styles.setup}>
              <span className={styles.setupIcon}>
                {isSiteOwner ? (
                  <FolderCog aria-hidden="true" size={24} />
                ) : (
                  <ShieldCheck aria-hidden="true" size={24} />
                )}
              </span>
              <div className={styles.setupCopy}>
                <span>
                  {isSiteOwner ? "STORAGE SETUP" : "WORKSPACE READY"}
                </span>
                <h2>
                  {isSiteOwner ? "配置和检查存储" : "工作区已经可以使用"}
                </h2>
                <p>
                  {isSiteOwner
                    ? "本地存储可直接使用；如需 Amazon S3、Cloudflare R2 或迁移数据，请前往存储中心。"
                    : "存储连接由站点所有者管理，你可以继续浏览或上传权限范围内的图片。"}
                </p>
              </div>
              {isSiteOwner && (
                <Button asChild variant="secondary">
                  <Link href="/storage">
                    配置存储
                    <ArrowRight aria-hidden="true" size={16} />
                  </Link>
                </Button>
              )}
            </section>

            <section aria-label="快捷操作" className={styles.quickGrid}>
              <Link className={styles.quickLink} href="/upload">
                <span className={styles.quickIcon}>
                  <ImageUp aria-hidden="true" size={20} />
                </span>
                <div>
                  <strong>上传图片</strong>
                  <p>拖入文件或从剪贴板快速添加图片。</p>
                </div>
                <ArrowRight aria-hidden="true" size={17} />
              </Link>
              <Link className={styles.quickLink} href="/library">
                <span className={styles.quickIcon}>
                  <FileImage aria-hidden="true" size={20} />
                </span>
                <div>
                  <strong>打开图片库</strong>
                  <p>查看、筛选并整理已有图片资产。</p>
                </div>
                <ArrowRight aria-hidden="true" size={17} />
              </Link>
              <Link className={styles.quickLink} href="/albums">
                <span className={styles.quickIcon}>
                  <Database aria-hidden="true" size={20} />
                </span>
                <div>
                  <strong>整理相册</strong>
                  <p>按项目和主题建立清晰的图片集合。</p>
                </div>
                <ArrowRight aria-hidden="true" size={17} />
              </Link>
              <Link className={styles.quickLink} href="/analytics">
                <span className={styles.quickIcon}>
                  <BarChart3 aria-hidden="true" size={20} />
                </span>
                <div>
                  <strong>查看数据统计</strong>
                  <p>确认上传趋势、分享访问和格式分布。</p>
                </div>
                <ArrowRight aria-hidden="true" size={17} />
              </Link>
              <Link className={styles.quickLink} href="/settings">
                <span className={styles.quickIcon}>
                  <CheckCircle2 aria-hidden="true" size={20} />
                </span>
                <div>
                  <strong>站点与公共上传</strong>
                  <p>配置首页文案、Logo 和公共图床开关。</p>
                </div>
                <ArrowRight aria-hidden="true" size={17} />
              </Link>
            </section>
          </>
        ) : null}
      </main>
    </AppShell>
  );
}
