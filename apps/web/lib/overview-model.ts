import type {
  SessionBootstrap,
  WorkspaceSummary
} from "./api";

export type OverviewSummary = {
  count: number;
  bytes: number;
  quotaBytes: number;
};

export type OverviewStorageTone = "calm" | "watch" | "danger";

export function selectOverviewWorkspace(
  bootstrap: SessionBootstrap,
  storedWorkspaceId: string | null
) {
  return (
    bootstrap.workspaces.find(
      (workspace) => workspace.id === storedWorkspaceId
    ) ?? bootstrap.defaultWorkspace
  );
}

export function overviewRoleLabel(workspace: WorkspaceSummary) {
  return {
    owner: "所有者",
    admin: "管理员",
    editor: "编辑者",
    viewer: "只读"
  }[workspace.role];
}

export function overviewQuotaPercent(summary: OverviewSummary) {
  if (summary.quotaBytes <= 0) return 0;
  return Math.min(100, Math.round((summary.bytes / summary.quotaBytes) * 100));
}

export function overviewStorageTone(
  summary: OverviewSummary
): OverviewStorageTone {
  const percent = overviewQuotaPercent(summary);
  if (percent >= 90) return "danger";
  if (percent >= 70) return "watch";
  return "calm";
}

export function overviewStorageLabel(summary: OverviewSummary) {
  const percent = overviewQuotaPercent(summary);
  if (summary.quotaBytes <= 0) return "未设置容量上限";
  if (percent >= 90) return "容量接近上限";
  if (percent >= 70) return "容量使用偏高";
  if (summary.count === 0) return "等待第一张图片";
  return "容量状态健康";
}

export function overviewAverageImageBytes(summary: OverviewSummary) {
  if (summary.count <= 0) return 0;
  return Math.round(summary.bytes / summary.count);
}

export function formatOverviewBytes(value: number) {
  if (value < 1024) return `${Math.max(0, value).toFixed(0)} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}
