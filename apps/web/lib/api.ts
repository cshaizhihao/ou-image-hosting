export type ThemePreference = "light" | "dark" | "system";

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  role: "owner" | "member";
  theme: ThemePreference;
  onboardingCompleted: boolean;
  createdAt: string;
};

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
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers
    }
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
