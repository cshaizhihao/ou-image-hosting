"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Badge, Button, cn } from "@ou-image/ui";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Download,
  Eye,
  Filter,
  RefreshCw,
  ShieldAlert,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  exportAuditCsv,
  getAuditEntries,
  type AuditActorOption,
  type AuditEntry
} from "@/lib/admin-api";
import { ApiError } from "@/lib/api";
import {
  AccessDenied,
  EmptyPanel,
  LoadingPanel,
  ManagementHeader,
  ManagementNotice,
  ManagementPage,
  formatManagementDate,
  managementStyles as styles,
  requestMessage
} from "./management-ui";

type AuditFilters = {
  actorUserId: string;
  action: string;
  result: string;
};

const emptyFilters: AuditFilters = {
  actorUserId: "",
  action: "",
  result: ""
};

const actionCopy: Record<string, string> = {
  "workspace.create": "创建工作区",
  "workspace.update": "更新工作区",
  "member.role.update": "修改成员角色",
  "member.remove": "移除成员",
  "invitation.create": "创建邀请",
  "api_token.create": "创建 API Token",
  "password.update": "更新密码",
  "mfa.enable": "启用双重验证",
  "mfa.disable": "关闭双重验证"
};

const blockedMetadataKey =
  /(password|secret|token|authorization|cookie|credential|private|ip(address)?)/i;

function sanitizeMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeMetadata);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !blockedMetadataKey.test(key))
        .map(([key, item]) => [key, sanitizeMetadata(item)])
    );
  }
  return value;
}

function resultBadge(result: AuditEntry["result"]) {
  if (result === "success") return <Badge tone="success">成功</Badge>;
  return <Badge tone="warning">失败</Badge>;
}

function resultIcon(result: AuditEntry["result"]) {
  if (result === "success") return CheckCircle2;
  return AlertTriangle;
}

export function AuditConsole() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [actors, setActors] = useState<AuditActorOption[]>([]);
  const [filters, setFilters] = useState<AuditFilters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] =
    useState<AuditFilters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await getAuditEntries({
        actorUserId: appliedFilters.actorUserId || undefined,
        action: appliedFilters.action || undefined,
        result:
          appliedFilters.result === "success" ||
          appliedFilters.result === "failure"
            ? appliedFilters.result
            : undefined,
        page,
        limit
      });
      setEntries(payload.entries);
      setActors(payload.actors);
      setTotal(payload.total);
      setDenied(false);
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 403) {
        setDenied(true);
      } else {
        setError(requestMessage(requestError, "审计记录加载失败"));
      }
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, page, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const successRate = useMemo(() => {
    if (!entries.length) return 0;
    return Math.round(
      (entries.filter((entry) => entry.result === "success").length /
        entries.length) *
        100
    );
  }, [entries]);
  const sanitizedMetadata = useMemo(
    () =>
      selectedEntry?.metadata
        ? (sanitizeMetadata(selectedEntry.metadata) as Record<string, unknown>)
        : {},
    [selectedEntry]
  );

  const applyFilters = () => {
    setPage(1);
    setAppliedFilters(filters);
  };

  const clearFilters = () => {
    setFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    setError("");
    try {
      const payload = await exportAuditCsv({
        actorUserId: appliedFilters.actorUserId || undefined,
        action: appliedFilters.action || undefined,
        result:
          appliedFilters.result === "success" ||
          appliedFilters.result === "failure"
            ? appliedFilters.result
            : undefined
      });
      const url = URL.createObjectURL(payload.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = payload.filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestMessage(requestError, "审计记录导出失败"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <ManagementPage activeKey="audit">
      <ManagementHeader
        action={
          <div className={styles.actionGroup}>
            <Button
              disabled={exporting}
              onClick={() => void exportCsv()}
              variant="secondary"
            >
              <Download aria-hidden="true" size={16} />
              {exporting ? "正在导出" : "导出 CSV"}
            </Button>
            <Button onClick={() => void load()} variant="secondary">
              <RefreshCw aria-hidden="true" size={16} />
              刷新记录
            </Button>
          </div>
        }
        description="追踪工作区中的权限、内容与安全事件。"
        eyebrow="AUDIT TRAIL"
        title="活动与审计"
      />

      {error && (
        <ManagementNotice onClose={() => setError("")} tone="error">
          {error}
        </ManagementNotice>
      )}

      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span><Activity aria-hidden="true" size={19} /></span>
          <small>当前结果</small>
          <strong>{total}</strong>
        </div>
        <div className={styles.metric}>
          <span><CheckCircle2 aria-hidden="true" size={19} /></span>
          <small>本页成功率</small>
          <strong>{successRate}%</strong>
        </div>
        <div className={styles.metric}>
          <span><ShieldAlert aria-hidden="true" size={19} /></span>
          <small>本页异常事件</small>
          <strong>
            {entries.filter((entry) => entry.result !== "success").length}
          </strong>
        </div>
      </div>

      <div className={styles.filterBar}>
        <select
          aria-label="按操作人筛选"
          className={styles.select}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              actorUserId: event.target.value
            }))
          }
          value={filters.actorUserId}
        >
          <option value="">全部操作人</option>
          {actors.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.displayName} · {actor.email}
            </option>
          ))}
        </select>
        <input
          aria-label="按操作类型筛选"
          className={styles.input}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              action: event.target.value
            }))
          }
          placeholder="精确事件名，例如 image.upload"
          value={filters.action}
        />
        <select
          aria-label="按结果筛选"
          className={styles.select}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              result: event.target.value
            }))
          }
          value={filters.result}
        >
          <option value="">全部结果</option>
          <option value="success">成功</option>
          <option value="failure">失败</option>
        </select>
        <div className={styles.filterActions}>
          <Button onClick={applyFilters} size="compact">
            <Filter aria-hidden="true" size={14} />
            筛选
          </Button>
          <Button onClick={clearFilters} size="compact" variant="ghost">
            清除
          </Button>
        </div>
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div>
            <h2>事件时间线</h2>
            <p>敏感凭据、原始 IP 和认证头不会在前端渲染。</p>
          </div>
          <Badge tone="info">第 {page} / {totalPages} 页</Badge>
        </div>

        {loading ? (
          <LoadingPanel label="正在读取审计事件" />
        ) : denied ? (
          <AccessDenied />
        ) : entries.length ? (
          <>
            <div className={styles.auditList}>
              {entries.map((entry) => {
                const ResultIcon = resultIcon(entry.result);
                return (
                  <article key={entry.id}>
                    <span
                      className={cn(
                        styles.auditNode,
                        entry.result !== "success" && styles.auditNodeWarning
                      )}
                    >
                      <ResultIcon aria-hidden="true" size={16} />
                    </span>
                    <div className={styles.auditMain}>
                      <div>
                        <strong>{actionCopy[entry.action] ?? entry.action}</strong>
                        {resultBadge(entry.result)}
                      </div>
                      <p>
                        {entry.actor.displayName}
                        {entry.resource ? ` · ${entry.resource}` : ""}
                      </p>
                    </div>
                    <div className={styles.auditTime}>
                      <Clock3 aria-hidden="true" size={13} />
                      <span>{formatManagementDate(entry.createdAt)}</span>
                    </div>
                    <Button
                      aria-label={`查看 ${actionCopy[entry.action] ?? entry.action} 详情`}
                      onClick={() => setSelectedEntry(entry)}
                      size="icon"
                      variant="ghost"
                    >
                      <Eye aria-hidden="true" size={16} />
                    </Button>
                  </article>
                );
              })}
            </div>
            <div className={styles.pagination}>
              <span>
                共 {total} 条记录，每页 {limit} 条
              </span>
              <div>
                <Button
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  size="compact"
                  variant="secondary"
                >
                  <ChevronLeft aria-hidden="true" size={15} />
                  上一页
                </Button>
                <Button
                  disabled={page >= totalPages}
                  onClick={() =>
                    setPage((current) => Math.min(totalPages, current + 1))
                  }
                  size="compact"
                  variant="secondary"
                >
                  下一页
                  <ChevronRight aria-hidden="true" size={15} />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <EmptyPanel
            description="当前筛选范围内没有事件，尝试清除条件或扩大日期范围。"
            icon={Activity}
            title="没有匹配的审计记录"
          />
        )}
      </section>

      <Dialog.Root
        onOpenChange={(open) => !open && setSelectedEntry(null)}
        open={Boolean(selectedEntry)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className={styles.detailDrawer}>
            <div className={styles.drawerHead}>
              <div>
                <span>EVENT DETAIL</span>
                <Dialog.Title>
                  {selectedEntry
                    ? actionCopy[selectedEntry.action] ?? selectedEntry.action
                    : "审计事件"}
                </Dialog.Title>
                <Dialog.Description>
                  结构化事件详情，敏感字段已过滤。
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button aria-label="关闭详情" className="icon-button">
                  <X aria-hidden="true" size={18} />
                </button>
              </Dialog.Close>
            </div>
            {selectedEntry && (
              <div className={styles.detailContent}>
                <section>
                  <h3>事件</h3>
                  <dl className={styles.detailList}>
                    <div><dt>事件 ID</dt><dd>{selectedEntry.id}</dd></div>
                    <div><dt>结果</dt><dd>{resultBadge(selectedEntry.result)}</dd></div>
                    <div><dt>时间</dt><dd>{formatManagementDate(selectedEntry.createdAt)}</dd></div>
                    <div><dt>资源</dt><dd>{selectedEntry.resource ?? "—"}</dd></div>
                  </dl>
                </section>
                <section>
                  <h3>操作人</h3>
                  <div className={styles.actorCard}>
                    <span>
                      <CircleUserRound aria-hidden="true" size={20} />
                    </span>
                    <div>
                      <strong>{selectedEntry.actor.displayName}</strong>
                      <small>{selectedEntry.actor.email ?? "系统操作"}</small>
                    </div>
                  </div>
                </section>
                {Object.keys(sanitizedMetadata).length > 0 && (
                  <section>
                    <h3>附加字段</h3>
                    <dl className={styles.detailList}>
                      {Object.entries(sanitizedMetadata).map(([key, value]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>
                            {typeof value === "object"
                              ? JSON.stringify(value)
                              : String(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                )}
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </ManagementPage>
  );
}
