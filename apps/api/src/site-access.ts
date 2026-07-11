import type { AppState } from "./store.js";
import type { Principal } from "./access.js";
import { PublicError } from "./errors.js";

export type BackofficeAccess = {
  allowed: boolean;
  role: "owner" | "admin" | "member";
  workspaceId?: string;
};

export function siteOwnerWorkspace(state: AppState) {
  const owner = state.users.find((user) => user.role === "owner");
  if (!owner) return undefined;
  return (
    state.workspaces.find(
      (workspace) => workspace.ownerUserId === owner.id && workspace.personal
    ) ?? state.workspaces.find((workspace) => workspace.ownerUserId === owner.id)
  );
}

export function backofficeAccessFor(
  state: AppState,
  userId: string
): BackofficeAccess {
  const user = state.users.find((item) => item.id === userId);
  if (!user || user.disabledAt) {
    return { allowed: false, role: "member" };
  }
  const workspace = siteOwnerWorkspace(state);
  if (user.role === "owner") {
    return {
      allowed: true,
      role: "owner",
      workspaceId: workspace?.id
    };
  }
  const membership = workspace
    ? state.workspaceMembers.find(
        (item) => item.workspaceId === workspace.id && item.userId === userId
      )
    : undefined;
  return membership?.role === "admin"
    ? { allowed: true, role: "admin", workspaceId: workspace!.id }
    : { allowed: false, role: "member" };
}

export function requireBackofficeAccess(
  state: AppState,
  principal: Principal,
  minimum: "admin" | "owner" = "admin"
) {
  if (principal.kind === "api-token") {
    if (minimum === "owner") {
      throw new PublicError(403, "SITE_OWNER_REQUIRED", "该操作仅限站点所有者");
    }
    return {
      allowed: true,
      role: "admin" as const,
      workspaceId: principal.workspaceId
    };
  }
  const access = backofficeAccessFor(state, principal.user.id);
  if (
    !access.allowed ||
    !access.workspaceId ||
    (access.role !== "owner" && principal.workspaceId !== access.workspaceId) ||
    (minimum === "owner" && access.role !== "owner")
  ) {
    throw new PublicError(
      403,
      "BACKOFFICE_ACCESS_DENIED",
      "当前账号没有后台管理权限"
    );
  }
  return access;
}

export function isSiteBackofficeWorkspace(
  state: AppState,
  workspaceId: string
) {
  return siteOwnerWorkspace(state)?.id === workspaceId;
}
