"use client";

import { Badge, Button, cn } from "@ou-image/ui";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ServerCog
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  checkSystemStatus,
  getCurrentAccess,
  getJobs,
  getSystemStatus,
  retryJob,
  type ServiceStatus,
  type SystemJob,
  type SystemOverall,
  type SystemStatusData
} from "@/lib/operations-api";
import { ApiError } from "@/lib/api";
import {
  AccessDenied,
  EmptyPanel,
  LoadingPanel,
  ManagementHeader,
  ManagementNotice,
  ManagementPage,
  formatManagementDate,
  requestMessage
} from "./management-ui";
import styles from "./operations.module.css";

const overallCopy: Record<SystemOverall, string> = {
  operational: "运行正常",
  degraded: "部分降级",
  down: "服务异常",
  unknown: "尚未检查"
};

const serviceCopy: Record<ServiceStatus, string> = {
  operational: "运行正常",
  reachable: "连接可用",
  degraded: "部分降级",
  down: "不可用",
  "not-configured": "未配置",
  "configured-not-in-use": "已配置未启用",
  unknown: "未知"
};

const jobCopy: Record<SystemJob["status"], string> = {
  running: "运行中",
  completed: "已完成",
  failed: "失败"
};

function healthTone(status: ServiceStatus | SystemOverall) {
  if (status === "operational" || status === "reachable") {
    return "success" as const;
  }
  if (
    status === "not-configured" ||
    status === "configured-not-in-use" ||
    status === "unknown"
  ) {
    return undefined;
  }
  return "warning" as const;
}

function jobTone(status: SystemJob["status"]) {
  if (status === "completed") return "success" as const;
  if (status === "running") return "info" as const;
  return "warning" as const;
}

function progressPercentage(job: SystemJob) {
  if (!job.progress || job.progress.total <= 0) return 0;
  return Math.min(100, (job.progress.completed / job.progress.total) * 100);
}

export function SystemConsole() {
  const [status, setStatus] = useState<SystemStatusData | null>(null);
  const [jobs, setJobs] = useState<SystemJob[]>([]);
  const [siteOwner, setSiteOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState("");
  const [busyJob, setBusyJob] = useState("");
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const access = await getCurrentAccess();
      const owner = access.siteRole === "owner";
      setSiteOwner(owner);
      if (!owner) {
        setDenied(true);
        setStatus(null);
        setJobs([]);
        return;
      }
      const [systemPayload, jobPayload] = await Promise.all([
        getSystemStatus(),
        getJobs()
      ]);
      setStatus(systemPayload);
      setJobs(jobPayload);
      setDenied(false);
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 403) {
        setDenied(true);
      } else {
        setError(requestMessage(requestError, "系统状态加载失败"));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runCheck = async () => {
    setChecking(true);
    setError("");
    try {
      setStatus(await checkSystemStatus());
    } catch (requestError) {
      setError(requestMessage(requestError, "主动系统检查失败"));
    } finally {
      setChecking(false);
    }
  };

  const retry = async (job: SystemJob) => {
    setBusyJob(job.id);
    setError("");
    try {
      const next = await retryJob(job);
      setJobs((current) =>
        current.map((item) => (item.id === job.id ? next : item))
      );
    } catch (requestError) {
      setError(requestMessage(requestError, "任务重试失败"));
    } finally {
      setBusyJob("");
    }
  };

  const failedJobs = useMemo(
    () => jobs.filter((job) => job.status === "failed").length,
    [jobs]
  );

  return (
    <ManagementPage activeKey="system">
      <ManagementHeader
        action={
          <Button
            disabled={checking || !siteOwner}
            onClick={() => void runCheck()}
            variant="secondary"
          >
            {checking ? (
              <LoaderCircle className={styles.spin} size={16} />
            ) : (
              <RefreshCw aria-hidden="true" size={16} />
            )}
            立即检查
          </Button>
        }
        description="查看实例服务模式、真实探测结果与全站后台任务。"
        eyebrow="SYSTEM PULSE"
        title="系统状态"
      />

      {error && (
        <ManagementNotice onClose={() => setError("")} tone="error">
          {error}
        </ManagementNotice>
      )}

      {loading && !status ? (
        <section className={styles.panel}>
          <LoadingPanel label="正在读取最近一次系统状态" />
        </section>
      ) : denied ? (
        <section className={styles.panel}>
          <AccessDenied />
        </section>
      ) : status ? (
        <>
          <section className={styles.healthHero}>
            <div>
              <span
                className={cn(
                  styles.healthPulse,
                  styles[`health_${status.overall}`]
                )}
              />
              <div>
                <small>当前总体状态</small>
                <strong>{overallCopy[status.overall]}</strong>
              </div>
            </div>
            <span>
              {status.checkedAt
                ? `最近检查 ${formatManagementDate(status.checkedAt)}`
                : "尚未执行主动检查"}
            </span>
          </section>

          <section className={styles.healthGrid} aria-label="服务健康矩阵">
            {status.services.map((service) => (
              <article className={styles.healthCard} key={service.id}>
                <div>
                  <span
                    className={cn(
                      styles.serviceDot,
                      styles[`health_${service.status}`]
                    )}
                  />
                  <Badge tone={healthTone(service.status)}>
                    {serviceCopy[service.status]}
                  </Badge>
                </div>
                <strong>{service.label}</strong>
                <p>
                  {service.status === "not-configured"
                    ? "此服务尚未配置，不会被误报为故障。"
                    : service.status === "configured-not-in-use"
                      ? "服务已配置，但当前架构模式未启用该服务。"
                      : service.detail}
                </p>
                <small>
                  {service.mode} · {service.inUse ? "当前使用" : "当前未使用"}
                  {service.checked && service.latencyMs !== undefined
                    ? ` · ${service.latencyMs.toFixed(0)} ms`
                    : ""}
                </small>
              </article>
            ))}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <span>BACKGROUND JOBS</span>
                <h2>后台任务</h2>
                <p>备份与存储迁移任务仅站点 Owner 可见。</p>
              </div>
              <Badge tone={failedJobs ? "warning" : "success"}>
                {failedJobs ? `${failedJobs} 个失败` : "运行正常"}
              </Badge>
            </div>
            {jobs.length ? (
              <div className={styles.jobList}>
                {jobs.map((job) => (
                  <article key={`${job.kind}-${job.id}`}>
                    <span className={styles.jobIcon}>
                      {job.status === "failed" ? (
                        <AlertTriangle aria-hidden="true" size={17} />
                      ) : job.status === "completed" ? (
                        <CheckCircle2 aria-hidden="true" size={17} />
                      ) : (
                        <DatabaseZap aria-hidden="true" size={17} />
                      )}
                    </span>
                    <div>
                      <div>
                        <strong>{job.label}</strong>
                        <Badge tone={jobTone(job.status)}>
                          {jobCopy[job.status]}
                        </Badge>
                      </div>
                      <small>
                        {job.completedAt
                          ? `完成于 ${formatManagementDate(job.completedAt)}`
                          : `创建于 ${formatManagementDate(job.createdAt)}`}
                      </small>
                      {job.errorCode && <p>失败代码：{job.errorCode}</p>}
                      {job.progress && job.status === "running" && (
                        <div
                          aria-label={`任务进度 ${job.progress.completed} / ${job.progress.total}`}
                          className={styles.jobProgress}
                        >
                          <span
                            style={{
                              transform: `scaleX(${progressPercentage(job) / 100})`
                            }}
                          />
                        </div>
                      )}
                    </div>
                    {job.status === "failed" && job.retryable && (
                      <Button
                        disabled={busyJob === job.id}
                        onClick={() => void retry(job)}
                        size="compact"
                        variant="secondary"
                      >
                        {busyJob === job.id ? (
                          <LoaderCircle className={styles.spin} size={14} />
                        ) : (
                          <RotateCcw aria-hidden="true" size={14} />
                        )}
                        重试
                      </Button>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <EmptyPanel
                description="新的备份或迁移任务会出现在这里。"
                icon={ServerCog}
                title="暂无后台任务"
              />
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <span>SYSTEM EVENTS</span>
                <h2>检查时间线</h2>
                <p>只展示后端公开的系统检查事件，不推测未知状态。</p>
              </div>
            </div>
            {status.events.length ? (
              <div className={styles.systemTimeline}>
                {status.events.map((event) => (
                  <article key={event.id}>
                    <span
                      className={cn(
                        styles.timelineNode,
                        styles[
                          `health_${
                            event.result === "success"
                              ? "operational"
                              : event.result === "failure"
                                ? "down"
                                : "degraded"
                          }`
                        ]
                      )}
                    />
                    <div>
                      <strong>{event.message}</strong>
                      <span>
                        {event.result === "success"
                          ? "检查通过"
                          : event.result === "degraded"
                            ? "发现降级"
                            : "检查失败"}
                      </span>
                    </div>
                    <time dateTime={event.createdAt}>
                      <Clock3 aria-hidden="true" size={12} />
                      {formatManagementDate(event.createdAt)}
                    </time>
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.inlineEmpty}>暂无系统检查事件</div>
            )}
          </section>
        </>
      ) : null}
    </ManagementPage>
  );
}
