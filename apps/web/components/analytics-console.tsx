"use client";

import { Badge, Button, cn } from "@ou-image/ui";
import {
  Activity,
  Database,
  Eye,
  FileImage,
  RefreshCw
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getAnalytics,
  type AnalyticsData,
  type AnalyticsPoint,
  type AnalyticsRange
} from "@/lib/operations-api";
import { ApiError } from "@/lib/api";
import {
  AccessDenied,
  EmptyPanel,
  LoadingPanel,
  ManagementHeader,
  ManagementNotice,
  ManagementPage,
  requestMessage
} from "./management-ui";
import styles from "./operations.module.css";

const rangeOptions: Array<{ value: AnalyticsRange; label: string }> = [
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "90d", label: "90 天" }
];

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { notation: "compact" }).format(value);
}

function formatBytes(value: number) {
  if (value < 1024) return `${value.toFixed(0)} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function buildLine(
  series: AnalyticsPoint[],
  key: "uploads" | "shareViews",
  width: number,
  height: number
) {
  if (series.length === 0) return "";
  const max = Math.max(1, ...series.map((point) => point[key]));
  const left = 28;
  const top = 20;
  const usableWidth = width - left - 18;
  const usableHeight = height - top - 30;
  return series
    .map((point, index) => {
      const x =
        series.length === 1
          ? left + usableWidth / 2
          : left + (index / (series.length - 1)) * usableWidth;
      const y = top + usableHeight - (point[key] / max) * usableHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function AnalyticsConsole() {
  const [range, setRange] = useState<AnalyticsRange>("30d");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await getAnalytics(range));
      setDenied(false);
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 403) {
        setDenied(true);
      } else {
        setError(requestMessage(requestError, "分析数据加载失败"));
      }
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const chart = useMemo(() => {
    const series = data?.series ?? [];
    return {
      uploads: buildLine(series, "uploads", 680, 250),
      shareViews: buildLine(series, "shareViews", 680, 250)
    };
  }, [data]);

  const empty =
    data &&
    data.series.length === 0 &&
    data.formatDistribution.length === 0 &&
    data.topImages.length === 0 &&
    Object.values(data.summary).every((value) => value === 0);

  return (
    <ManagementPage activeKey="analytics">
      <ManagementHeader
        action={
          <div className={styles.headerTools}>
            <div aria-label="统计时间范围" className={styles.rangeControl}>
              {rangeOptions.map((option) => (
                <button
                  aria-pressed={range === option.value}
                  className={cn(range === option.value && styles.rangeActive)}
                  key={option.value}
                  onClick={() => setRange(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <Button onClick={() => void load()} size="compact" variant="ghost">
              <RefreshCw aria-hidden="true" size={15} />
              刷新
            </Button>
          </div>
        }
        description="只用真实上传与分享访问事件，观察工作区内容增长节奏。"
        eyebrow="WORKSPACE SIGNALS"
        title="数据统计"
      />

      {error && (
        <ManagementNotice onClose={() => setError("")} tone="error">
          {error}
        </ManagementNotice>
      )}

      {loading && !data ? (
        <section className={styles.panel}>
          <LoadingPanel label="正在汇总工作区趋势" />
        </section>
      ) : denied ? (
        <section className={styles.panel}>
          <AccessDenied />
        </section>
      ) : empty ? (
        <section className={styles.panel}>
          <EmptyPanel
            description="产生上传与访问记录后，这里会显示真实趋势。"
            icon={Activity}
            title="当前范围没有统计数据"
          />
        </section>
      ) : data ? (
        <>
          <section className={styles.kpiGrid} aria-label="统计摘要">
            {[
              {
                icon: FileImage,
                label: "当前图片",
                value: formatNumber(data.summary.imageCount),
                note: "工作区现有图片"
              },
              {
                icon: FileImage,
                label: "期间新增",
                value: formatNumber(data.summary.uploadCount),
                note: `最近 ${rangeOptions.find((item) => item.value === range)?.label}`
              },
              {
                icon: Eye,
                label: "真实分享访问",
                value: formatNumber(data.summary.shareViews),
                note: "仅统计已记录的分享访问事件"
              },
              {
                icon: Database,
                label: "原图版本占用",
                value: formatBytes(data.summary.deduplicatedOriginalBytes),
                note: "去重后的原图版本，不含缩略图"
              }
            ].map((item) => {
              const Icon = item.icon;
              return (
                <article className={styles.kpiCard} key={item.label}>
                  <span><Icon aria-hidden="true" size={19} /></span>
                  <small>{item.label}</small>
                  <strong>{item.value}</strong>
                  <p>{item.note}</p>
                </article>
              );
            })}
          </section>

          <section className={styles.analyticsGrid}>
            <article className={cn(styles.panel, styles.trendPanel)}>
              <div className={styles.panelHead}>
                <div>
                  <span>TREND</span>
                  <h2>新增图片与分享访问趋势</h2>
                  <p>两条曲线分别按自身峰值归一化，不把历史累计访问伪装成每日数据。</p>
                </div>
                <div className={styles.legend}>
                  <span><i className={styles.legendPink} />分享访问</span>
                  <span><i className={styles.legendInk} />新增图片</span>
                </div>
              </div>
              {data.dataCoverage.uploads.status === "partial" && (
                <div className={styles.trackingNotice}>
                  新增图片趋势从{" "}
                  {new Intl.DateTimeFormat("zh-CN", {
                    year: "numeric",
                    month: "short",
                    day: "numeric"
                  }).format(
                    new Date(data.dataCoverage.uploads.trackingStartedAt)
                  )}{" "}
                  开始完整记录，更早的上传历史不会补入每日曲线。
                </div>
              )}
              {data.dataCoverage.shareViews.status === "partial" && (
                <div className={styles.trackingNotice}>
                  分享访问趋势从本版本开始记录（
                  {new Intl.DateTimeFormat("zh-CN", {
                    year: "numeric",
                    month: "short",
                    day: "numeric"
                  }).format(
                    new Date(
                      data.dataCoverage.shareViews.trackingStartedAt
                    )
                  )}
                  ）。此前{" "}
                  {formatNumber(
                    data.dataCoverage.shareViews.unattributedCount
                  )}{" "}
                  次历史分享访问未分配到每日曲线。
                </div>
              )}
              {data.series.length ? (
                <>
                  <svg
                    aria-labelledby="analytics-chart-title analytics-chart-desc"
                    className={styles.chart}
                    role="img"
                    viewBox="0 0 680 250"
                  >
                    <title id="analytics-chart-title">新增图片与分享访问趋势图</title>
                    <desc id="analytics-chart-desc">
                      最近所选时间范围内，每日新增图片数量和真实分享访问数量变化。
                    </desc>
                    {[48, 92, 136, 180].map((y) => (
                      <line
                        className={styles.chartGrid}
                        key={y}
                        x1="28"
                        x2="662"
                        y1={y}
                        y2={y}
                      />
                    ))}
                    <polyline
                      className={styles.chartUploads}
                      fill="none"
                      points={chart.uploads}
                    />
                    <polyline
                      className={styles.chartViews}
                      fill="none"
                      points={chart.shareViews}
                    />
                    {data.series.map((point, index) => {
                      const visible =
                        index === 0 ||
                        index === data.series.length - 1 ||
                        index === Math.floor(data.series.length / 2);
                      if (!visible) return null;
                      const x =
                        data.series.length === 1
                          ? 345
                          : 28 + (index / (data.series.length - 1)) * 634;
                      return (
                        <text
                          className={styles.chartLabel}
                          key={`${point.timestamp}-${index}`}
                          textAnchor={
                            index === 0
                              ? "start"
                              : index === data.series.length - 1
                                ? "end"
                                : "middle"
                          }
                          x={x}
                          y="232"
                        >
                          {point.label}
                        </text>
                      );
                    })}
                  </svg>
                  <table className="sr-only">
                    <caption>新增图片与分享访问趋势数据摘要</caption>
                    <thead>
                      <tr><th>时间</th><th>新增图片</th><th>分享访问</th><th>新增存储</th></tr>
                    </thead>
                    <tbody>
                      {data.series.map((point) => (
                        <tr key={point.timestamp}>
                          <td>{point.label}</td>
                          <td>{point.uploads}</td>
                          <td>{point.shareViews}</td>
                          <td>{formatBytes(point.uploadedLogicalBytes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <div className={styles.inlineEmpty}>暂无趋势点</div>
              )}
            </article>

            <article className={styles.panel}>
              <div className={styles.panelHead}>
                <div>
                  <span>FORMAT MIX</span>
                  <h2>格式分布</h2>
                  <p>按图片数量计算当前格式结构。</p>
                </div>
              </div>
              <div className={styles.formatList}>
                {data.formatDistribution.map((format) => (
                  <div key={format.format}>
                    <div>
                      <strong>{format.format}</strong>
                      <span>{format.count} 张 · {format.percentage.toFixed(1)}%</span>
                    </div>
                    <div className={styles.formatTrack}>
                      <span
                        style={{
                          transform: `scaleX(${Math.min(100, format.percentage) / 100})`
                        }}
                      />
                    </div>
                    <small>{formatBytes(format.activeCurrentVersionBytes)}</small>
                  </div>
                ))}
                {data.formatDistribution.length === 0 && (
                  <div className={styles.inlineEmpty}>暂无格式分布</div>
                )}
              </div>
            </article>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <span>TOP CONTENT</span>
                <h2>热门图片</h2>
                <p>按当前范围内真实分享访问次数排序。</p>
              </div>
              <Badge tone="info">{data.topImages.length} 项</Badge>
            </div>
            {data.topImages.length ? (
              <div className={styles.topImages}>
                {data.topImages.map((image, index) => (
                  <article key={image.id}>
                    <span className={styles.rank}>#{index + 1}</span>
                    <div className={styles.topThumb}>
                      {image.thumbnailUrl ? (
                        <img alt="" src={image.thumbnailUrl} />
                      ) : (
                        <FileImage aria-hidden="true" size={18} />
                      )}
                    </div>
                    <div>
                      <strong>{image.name}</strong>
                      <span>{formatNumber(image.shareViews)} 次分享访问</span>
                    </div>
                    <small>{image.format} · {formatBytes(image.size)}</small>
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.inlineEmpty}>暂无热门图片</div>
            )}
          </section>
        </>
      ) : null}
    </ManagementPage>
  );
}
