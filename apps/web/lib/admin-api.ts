import {
  ApiError,
  apiRequest,
  getStoredWorkspaceId,
  normalizeSessionBootstrap,
  setStoredWorkspaceId,
  workspaceHeaders,
  type SessionUser,
  type WorkspaceRole
} from "./api";

export type MemberRole = WorkspaceRole;

export type TeamMember = {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  role: MemberRole;
  status: "active";
  joinedAt: string;
  lastActiveAt?: string;
  isCurrentUser: boolean;
};

export type WorkspaceInvitation = {
  id: string;
  email: string;
  role: Exclude<MemberRole, "owner">;
  status: "pending" | "accepted" | "expired" | "revoked";
  createdAt: string;
  expiresAt: string;
};

export type ApiTokenRecord = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  ipAllowlist: string[];
  status: "active" | "revoked" | "expired";
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
};

export type AuditEntry = {
  id: string;
  actor: {
    id?: string;
    displayName: string;
    email?: string;
  };
  action: string;
  result: "success" | "failure";
  resource?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type AuditActorOption = {
  id: string;
  displayName: string;
  email: string;
};

export type ProfileSettings = {
  id: string;
  email: string;
  displayName: string;
  theme: "light" | "dark" | "system";
  siteRole: "owner" | "member";
};

export type SecuritySettings = {
  twoFactorEnabled: boolean;
  recoveryCodesRemaining?: number;
  passwordUpdatedAt?: string;
};

export type ActiveSession = {
  id: string;
  current: boolean;
  userAgent?: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

export type WorkspaceSettings = {
  id: string;
  name: string;
  description?: string;
  role: MemberRole;
};

export type NotificationCategory = "security" | "collaboration" | "system";

export type NotificationItem = {
  id: string;
  category: NotificationCategory;
  action: string;
  result: "success" | "failure";
  read: boolean;
  createdAt: string;
  actorUserId?: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, string | number | boolean>;
};

export type NotificationFeed = {
  notifications: NotificationItem[];
  unreadCount: number;
  badgeSuppressed: boolean;
};

export type NotificationPreferences = {
  security: boolean;
  collaboration: boolean;
  system: boolean;
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
    timezone: string;
  };
};

type RawMember = {
  id: string;
  user: {
    id: string;
    email: string;
    displayName: string;
  };
  role: MemberRole;
  createdAt: string;
  updatedAt: string;
};

type RawInvitation = {
  id: string;
  email: string;
  role: Exclude<MemberRole, "owner">;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  acceptedAt?: string;
};

type RawApiToken = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  ipAllowlist: string[];
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
};

type RawAuditEvent = {
  id: string;
  actorUserId?: string;
  actorType: "session" | "api-token" | "system";
  action: string;
  result: "success" | "failure";
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, string | number | boolean>;
  createdAt: string;
};

function currentWorkspacePath(suffix = "") {
  const workspaceId = getStoredWorkspaceId();
  if (!workspaceId) {
    throw new Error("尚未选择工作区");
  }
  return `/workspaces/${encodeURIComponent(workspaceId)}${suffix}`;
}

async function ensureWorkspaceId() {
  const storedWorkspaceId = getStoredWorkspaceId();
  if (storedWorkspaceId) return storedWorkspaceId;
  const payload = await apiRequest<{
    user: SessionUser;
    workspaces?: WorkspaceSettings[];
    defaultWorkspace?: WorkspaceSettings;
  }>("/auth/session");
  const bootstrap = normalizeSessionBootstrap(payload);
  setStoredWorkspaceId(bootstrap.defaultWorkspace.id);
  return bootstrap.defaultWorkspace.id;
}

export const adminEndpoints = {
  session: "/auth/session",
  teamMembers: () => currentWorkspacePath("/members"),
  invitations: () => currentWorkspacePath("/invitations"),
  tokens: "/api-tokens",
  audit: "/audit",
  auditExport: "/audit/export",
  notifications: "/notifications",
  notificationPreferences: "/me/notifications",
  profile: "/me",
  password: "/me/password",
  security: "/me/security",
  twoFactorSetup: "/auth/2fa/setup",
  twoFactorConfirm: "/auth/2fa/confirm",
  twoFactorDisable: "/auth/2fa/disable",
  recoveryCodes: "/auth/2fa/recovery-codes",
  sessions: "/auth/sessions",
  workspace: () => currentWorkspacePath()
} as const;

function profileFromUser(user: SessionUser): ProfileSettings {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    theme: user.theme,
    siteRole: user.role
  };
}

function memberFromRaw(
  member: RawMember,
  currentUserId: string
): TeamMember {
  return {
    id: member.id,
    userId: member.user.id,
    email: member.user.email,
    displayName: member.user.displayName,
    role: member.role,
    status: "active",
    joinedAt: member.createdAt,
    lastActiveAt: member.updatedAt,
    isCurrentUser: member.user.id === currentUserId
  };
}

function invitationFromRaw(
  invitation: RawInvitation
): WorkspaceInvitation {
  const status: WorkspaceInvitation["status"] = invitation.revokedAt
    ? "revoked"
    : invitation.acceptedAt
      ? "accepted"
      : new Date(invitation.expiresAt).getTime() <= Date.now()
        ? "expired"
        : "pending";
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    status,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt
  };
}

function tokenFromRaw(token: RawApiToken): ApiTokenRecord {
  const status: ApiTokenRecord["status"] = token.revokedAt
    ? "revoked"
    : token.expiresAt &&
        new Date(token.expiresAt).getTime() <= Date.now()
      ? "expired"
      : "active";
  return {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    scopes: token.scopes,
    ipAllowlist: token.ipAllowlist,
    status,
    createdAt: token.createdAt,
    expiresAt: token.expiresAt,
    lastUsedAt: token.lastUsedAt
  };
}

export async function getTeam() {
  await ensureWorkspaceId();
  const [sessionPayload, workspacePayload, membersPayload, invitationsPayload] =
    await Promise.all([
      apiRequest<{ user: SessionUser }>(adminEndpoints.session),
      apiRequest<{ workspace: WorkspaceSettings }>(adminEndpoints.workspace()),
      apiRequest<{ members: RawMember[] }>(adminEndpoints.teamMembers()),
      apiRequest<{ invitations: RawInvitation[] }>(
        adminEndpoints.invitations()
      )
    ]);
  return {
    members: membersPayload.members.map((member) =>
      memberFromRaw(member, sessionPayload.user.id)
    ),
    invitations: invitationsPayload.invitations.map(invitationFromRaw),
    workspaceRole: workspacePayload.workspace.role
  };
}

export async function createInvitation(input: {
  email: string;
  role: Exclude<MemberRole, "owner">;
}) {
  await ensureWorkspaceId();
  const payload = await apiRequest<{
    invitation: RawInvitation;
    token: string;
    inviteUrl: string;
  }>(adminEndpoints.invitations(), {
    method: "POST",
    body: JSON.stringify(input)
  });
  return {
    invitation: invitationFromRaw(payload.invitation),
    inviteUrl: payload.inviteUrl
  };
}

export async function updateMemberRole(userId: string, role: MemberRole) {
  await ensureWorkspaceId();
  const [sessionPayload, payload] = await Promise.all([
    apiRequest<{ user: SessionUser }>(adminEndpoints.session),
    apiRequest<{ member: RawMember }>(
      `${adminEndpoints.teamMembers()}/${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ role })
      }
    )
  ]);
  return {
    member: memberFromRaw(payload.member, sessionPayload.user.id)
  };
}

export async function removeMember(userId: string) {
  await ensureWorkspaceId();
  return apiRequest<void>(
    `${adminEndpoints.teamMembers()}/${encodeURIComponent(userId)}`,
    { method: "DELETE" }
  );
}

export function transferWorkspaceOwnership(userId: string) {
  return updateMemberRole(userId, "owner");
}

export async function revokeInvitation(invitationId: string) {
  await ensureWorkspaceId();
  return apiRequest<void>(
    `${adminEndpoints.invitations()}/${encodeURIComponent(invitationId)}`,
    { method: "DELETE" }
  );
}

export async function getTokens() {
  await ensureWorkspaceId();
  const payload = await apiRequest<{ tokens: RawApiToken[] }>(
    adminEndpoints.tokens
  );
  return payload.tokens.map(tokenFromRaw);
}

export async function createToken(input: {
  name: string;
  scopes: string[];
  expiresInDays?: number;
  ipAllowlist?: string[];
}) {
  await ensureWorkspaceId();
  const payload = await apiRequest<{
    token: RawApiToken;
    value: string;
  }>(adminEndpoints.tokens, {
    method: "POST",
    body: JSON.stringify(input)
  });
  return {
    token: tokenFromRaw(payload.token),
    secret: payload.value
  };
}

export async function revokeToken(tokenId: string) {
  await ensureWorkspaceId();
  return apiRequest<void>(
    `${adminEndpoints.tokens}/${encodeURIComponent(tokenId)}`,
    { method: "DELETE" }
  );
}

export async function getAuditEntries(input: {
  actorUserId?: string;
  action?: string;
  result?: "success" | "failure";
  page: number;
  limit: number;
}) {
  await ensureWorkspaceId();
  const query = new URLSearchParams();
  if (input.actorUserId) query.set("actorUserId", input.actorUserId);
  if (input.action) query.set("action", input.action);
  if (input.result) query.set("result", input.result);
  query.set("page", String(input.page));
  query.set("limit", String(input.limit));

  const [auditPayload, membersPayload] = await Promise.all([
    apiRequest<{
      events: RawAuditEvent[];
      page: number;
      limit: number;
      total: number;
    }>(`${adminEndpoints.audit}?${query.toString()}`),
    apiRequest<{ members: RawMember[] }>(adminEndpoints.teamMembers())
  ]);
  const actors = new Map(
    membersPayload.members.map((member) => [member.user.id, member.user])
  );
  return {
    entries: auditPayload.events.map((event): AuditEntry => {
      const actor = event.actorUserId
        ? actors.get(event.actorUserId)
        : undefined;
      return {
        id: event.id,
        actor: actor
          ? {
              id: actor.id,
              displayName: actor.displayName,
              email: actor.email
            }
          : {
              displayName:
                event.actorType === "api-token" ? "API Token" : "系统"
            },
        action: event.action,
        result: event.result,
        resource: event.resourceType
          ? event.resourceId
            ? `${event.resourceType} · ${event.resourceId}`
            : event.resourceType
          : undefined,
        createdAt: event.createdAt,
        metadata: event.metadata
      };
    }),
    actors: membersPayload.members.map(
      (member): AuditActorOption => ({
        id: member.user.id,
        displayName: member.user.displayName,
        email: member.user.email
      })
    ),
    total: auditPayload.total,
    page: auditPayload.page,
    limit: auditPayload.limit
  };
}

export async function getSettingsData() {
  await ensureWorkspaceId();
  const [
    sessionPayload,
    security,
    sessionsPayload,
    workspacePayload,
    notificationPayload
  ] = await Promise.all([
    apiRequest<{ user: SessionUser }>(adminEndpoints.session),
    apiRequest<SecuritySettings>(adminEndpoints.security),
    apiRequest<{ sessions: ActiveSession[] }>(adminEndpoints.sessions),
    apiRequest<{ workspace: WorkspaceSettings }>(adminEndpoints.workspace()),
    apiRequest<{ preferences: NotificationPreferences }>(
      adminEndpoints.notificationPreferences
    )
  ]);
  return {
    profile: profileFromUser(sessionPayload.user),
    security,
    sessions: sessionsPayload.sessions,
    workspace: workspacePayload.workspace,
    notifications: notificationPayload.preferences
  };
}

export function getNotifications(limit = 20) {
  return apiRequest<NotificationFeed>(
    `${adminEndpoints.notifications}?limit=${limit}`
  );
}

export function markAllNotificationsRead() {
  return apiRequest<{ readEventIds: string[]; unreadCount: number }>(
    `${adminEndpoints.notifications}/read`,
    {
      method: "POST",
      body: JSON.stringify({ all: true })
    }
  );
}

export function updateNotificationPreferences(
  preferences: NotificationPreferences
) {
  return apiRequest<{ preferences: NotificationPreferences }>(
    adminEndpoints.notificationPreferences,
    {
      method: "PATCH",
      body: JSON.stringify(preferences)
    }
  );
}

export async function exportAuditCsv(input: {
  actorUserId?: string;
  action?: string;
  result?: "success" | "failure";
}) {
  const query = new URLSearchParams();
  if (input.actorUserId) query.set("actorUserId", input.actorUserId);
  if (input.action) query.set("action", input.action);
  if (input.result) query.set("result", input.result);
  const suffix = query.size ? `?${query.toString()}` : "";
  const response = await fetch(`/api${adminEndpoints.auditExport}${suffix}`, {
    credentials: "same-origin",
    headers: workspaceHeaders()
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    throw new ApiError(
      payload.error?.message ?? "审计记录导出失败",
      response.status,
      payload.error?.code ?? "AUDIT_EXPORT_FAILED"
    );
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plainName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  let candidate = "ou-image-audit.csv";
  try {
    candidate = encodedName
      ? decodeURIComponent(encodedName)
      : (plainName ?? candidate);
  } catch {
    candidate = plainName ?? candidate;
  }
  const safeName =
    candidate
      .split(/[\\/]/)
      .pop()
      ?.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, "_")
      .trim() || "ou-image-audit.csv";
  return {
    blob: await response.blob(),
    filename: safeName.toLowerCase().endsWith(".csv")
      ? safeName
      : `${safeName}.csv`
  };
}

export async function updateProfile(input: {
  displayName: string;
  theme: ProfileSettings["theme"];
}) {
  const payload = await apiRequest<{ user: SessionUser }>(
    adminEndpoints.profile,
    {
      method: "PATCH",
      body: JSON.stringify(input)
    }
  );
  return { profile: profileFromUser(payload.user) };
}

export function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}) {
  return apiRequest<{ updated: true }>(adminEndpoints.password, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function beginTwoFactorSetup(currentPassword: string) {
  return apiRequest<{
    challengeToken: string;
    manualKey: string;
    otpauthUri: string;
  }>(adminEndpoints.twoFactorSetup, {
    method: "POST",
    body: JSON.stringify({ currentPassword })
  });
}

export function enableTwoFactor(challengeToken: string, code: string) {
  return apiRequest<{ enabled: true; recoveryCodes: string[] }>(
    adminEndpoints.twoFactorConfirm,
    {
      method: "POST",
      body: JSON.stringify({ challengeToken, code })
    }
  );
}

export function disableTwoFactor(input: {
  currentPassword: string;
  code: string;
}) {
  return apiRequest<{ enabled: false }>(adminEndpoints.twoFactorDisable, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function regenerateRecoveryCodes(input: {
  currentPassword: string;
  code: string;
}) {
  return apiRequest<{ recoveryCodes: string[] }>(
    adminEndpoints.recoveryCodes,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function revokeSession(sessionId: string) {
  return apiRequest<void>(
    `${adminEndpoints.sessions}/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" }
  );
}

export function revokeOtherSessions() {
  return apiRequest<void>(adminEndpoints.sessions, {
    method: "DELETE"
  });
}

export async function updateWorkspace(input: {
  name: string;
  description?: string;
}) {
  await ensureWorkspaceId();
  return apiRequest<{ workspace: WorkspaceSettings }>(
    adminEndpoints.workspace(),
    {
      method: "PATCH",
      body: JSON.stringify(input)
    }
  );
}
