export type ThemePreference = "light" | "dark" | "system";
export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  role: "owner" | "member";
  theme: ThemePreference;
  onboardingCompleted: boolean;
  createdAt: string;
};

export type BackofficeAccess = {
  allowed: boolean;
  role: "owner" | "admin" | "member";
  workspaceId?: string;
};

export type WorkspaceSummary = {
  id: string;
  name: string;
  role: WorkspaceRole;
  description?: string;
  memberCount?: number;
  createdAt?: string;
};

export type SessionBootstrap = {
  user: SessionUser;
  workspaces: WorkspaceSummary[];
  defaultWorkspace: WorkspaceSummary;
  backoffice: BackofficeAccess;
};

const WORKSPACE_STORAGE_KEY = "ou-workspace-id";

export type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string
  ) {
    super(message);
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const isFormData =
    typeof FormData !== "undefined" && init.body instanceof FormData;
  const shouldAttachWorkspace = path !== "/auth/session";
  const requestHeaders = new Headers(init.headers);
  if (init.body && !isFormData && !requestHeaders.has("content-type")) {
    requestHeaders.set("content-type", "application/json");
  }

  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: shouldAttachWorkspace
      ? workspaceHeaders(requestHeaders)
      : requestHeaders
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
    throw new ApiError(
      payload.error?.message ?? "请求失败，请稍后再试",
      response.status,
      payload.error?.code ?? "REQUEST_FAILED"
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function workspaceHeaders(initial?: HeadersInit) {
  const headers = new Headers(initial);
  const workspaceId =
    typeof window !== "undefined"
      ? window.localStorage.getItem(WORKSPACE_STORAGE_KEY)
      : null;
  if (workspaceId && !headers.has("x-workspace-id")) {
    headers.set("x-workspace-id", workspaceId);
  }
  return headers;
}

export function getStoredWorkspaceId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
}

export function setStoredWorkspaceId(workspaceId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WORKSPACE_STORAGE_KEY, workspaceId);
}

export function clearStoredWorkspaceId() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
}

export function normalizeSessionBootstrap(payload: {
  user: SessionUser;
  workspaces?: WorkspaceSummary[];
  defaultWorkspace?: WorkspaceSummary;
  backoffice?: BackofficeAccess;
}): SessionBootstrap {
  const fallback: WorkspaceSummary = {
    id: "default",
    name: "默认工作区",
    role: payload.user.role === "owner" ? "owner" : "viewer"
  };
  const workspaces =
    payload.workspaces && payload.workspaces.length > 0
      ? payload.workspaces
      : [payload.defaultWorkspace ?? fallback];
  const defaultWorkspace =
    payload.defaultWorkspace ??
    workspaces.find((workspace) => workspace.role === "owner") ??
    workspaces[0] ??
    fallback;
  const backoffice = payload.backoffice ?? {
    allowed: payload.user.role === "owner",
    role: payload.user.role === "owner" ? "owner" : "member",
    workspaceId:
      payload.user.role === "owner" ? defaultWorkspace.id : undefined
  };
  return { user: payload.user, workspaces, defaultWorkspace, backoffice };
}

export function applyTheme(theme: ThemePreference) {
  const effective =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  window.localStorage.setItem("ou-theme", theme);
  document.documentElement.dataset.theme = effective;
}
