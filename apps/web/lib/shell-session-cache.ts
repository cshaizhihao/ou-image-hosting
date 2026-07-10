import type {
  SessionBootstrap,
  SessionUser,
  WorkspaceSummary
} from "./api";

export type ShellSessionSnapshot = {
  user: SessionUser;
  workspaces: WorkspaceSummary[];
  currentWorkspace: WorkspaceSummary;
};

let snapshot: ShellSessionSnapshot | null = null;

export function readShellSessionSnapshot() {
  return snapshot;
}

export function writeShellSessionSnapshot(
  bootstrap: SessionBootstrap,
  workspaceId: string
) {
  const currentWorkspace =
    bootstrap.workspaces.find((workspace) => workspace.id === workspaceId) ??
    bootstrap.defaultWorkspace;
  snapshot = {
    user: bootstrap.user,
    workspaces: bootstrap.workspaces,
    currentWorkspace
  };
  return snapshot;
}

export function switchShellSessionWorkspace(workspace: WorkspaceSummary) {
  if (!snapshot) return;
  snapshot = {
    ...snapshot,
    currentWorkspace: workspace
  };
}

export function clearShellSessionSnapshot() {
  snapshot = null;
}
