import type {
  SessionBootstrap,
  WorkspaceSummary
} from "./api";

export type OverviewSummary = {
  count: number;
  bytes: number;
  quotaBytes: number;
};

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

export function formatOverviewBytes(value: number) {
  if (value < 1024) return `${Math.max(0, value).toFixed(0)} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}
