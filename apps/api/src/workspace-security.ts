import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { randomBytes, randomUUID } from "node:crypto";
import {
  addAuditEvent,
  hashRequestIp,
  normalizeIpAllowlist,
  requireCapability,
  requireSession,
  type Principal
} from "./access.js";
import { PublicError } from "./errors.js";
import {
  isSiteBackofficeWorkspace,
  requireBackofficeAccess
} from "./site-access.js";
import {
  createOpaqueToken,
  createRecoveryCodes,
  createTotpSecret,
  decryptSensitive,
  encryptSensitive,
  hashOpaqueToken,
  hashPassword,
  normalizeEmail,
  validatePassword,
  verifyPassword,
  verifyTotp
} from "./security.js";
import {
  defaultNotificationPreferences,
  defaultWorkspaceSettings
} from "./store.js";
import type {
  ApiTokenScope,
  AppState,
  AppStore,
  NotificationPreferences,
  StoredAuditEvent,
  StoredLoginChallenge,
  StoredUser,
  WorkspaceRole
} from "./store.js";

type Options = {
  store: AppStore;
  now: () => Date;
  authenticate: (request: FastifyRequest) => Principal;
  createSession: (
    userId: string,
    request: FastifyRequest,
    reply: FastifyReply
  ) => Promise<void>;
};

type IdParams = { id: string };
type WorkspaceMemberParams = { id: string; userId: string };
type InvitationParams = { id: string; invitationId: string };
type InviteTokenParams = { token: string };
type SessionParams = { id: string };
type AuditQuery = {
  action?: string;
  result?: "success" | "failure";
  actorUserId?: string;
};
type NotificationCategory = "security" | "collaboration" | "system";

const idSchema = {
  type: "string",
  minLength: 1,
  maxLength: 100
} as const;

const allScopes: ApiTokenScope[] = [
  "images:read",
  "images:write",
  "images:delete",
  "organization:read",
  "organization:write",
  "shares:read",
  "shares:write",
  "analytics:read"
];

const notificationTimePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

function notificationCategory(action: string): NotificationCategory {
  if (
    /^(mfa\.|password\.|session\.|api_token\.|auth\.)/.test(action)
  ) {
    return "security";
  }
  if (/^(workspace\.|member\.|invitation\.)/.test(action)) {
    return "collaboration";
  }
  return "system";
}

function preferencesFor(user: StoredUser): NotificationPreferences {
  const defaults = defaultNotificationPreferences();
  return {
    ...defaults,
    ...(user.notificationPreferences ?? {}),
    quietHours: {
      ...defaults.quietHours,
      ...(user.notificationPreferences?.quietHours ?? {})
    }
  };
}

function visibleNotificationEvents(
  state: AppState,
  principal: Principal
) {
  const user = state.users.find((item) => item.id === principal.user.id)!;
  const preferences = preferencesFor(user);
  return state.auditEvents
    .filter((event) => event.workspaceId === principal.workspaceId)
    .filter((event) => {
      const category = notificationCategory(event.action);
      return (
        preferences[category] &&
        (category !== "security" ||
          event.actorUserId === principal.user.id)
      );
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function legalReadEventIdsForUser(state: AppState, userId: string) {
  const workspaceIds = new Set(
    state.workspaceMembers
      .filter((member) => member.userId === userId)
      .map((member) => member.workspaceId)
  );
  return new Set(
    state.auditEvents
      .filter(
        (event) =>
          Boolean(event.workspaceId && workspaceIds.has(event.workspaceId)) &&
          (notificationCategory(event.action) !== "security" ||
            event.actorUserId === userId)
      )
      .map((event) => event.id)
  );
}

function validateTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(
      new Date()
    );
  } catch {
    throw new PublicError(400, "INVALID_TIMEZONE", "时区名称无效");
  }
}

function quietHoursActive(
  preferences: NotificationPreferences,
  timestamp: Date
) {
  const quiet = preferences.quietHours;
  if (!quiet.enabled) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: quiet.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(timestamp);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const current = hour * 60 + minute;
  const toMinutes = (value: string) => {
    const [hours, minutes] = value.split(":").map(Number);
    return hours! * 60 + minutes!;
  };
  const start = toMinutes(quiet.start);
  const end = toMinutes(quiet.end);
  if (start === end) return false;
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}

function unreadNotificationCount(
  events: StoredAuditEvent[],
  user: StoredUser,
  timestamp: Date
) {
  const preferences = preferencesFor(user);
  if (quietHoursActive(preferences, timestamp)) return 0;
  const read = new Set(user.notificationReadEventIds ?? []);
  return events.filter((event) => !read.has(event.id)).length;
}

function filterAuditEvents(
  state: AppState,
  workspaceId: string,
  query: AuditQuery
) {
  return state.auditEvents
    .filter((event) => event.workspaceId === workspaceId)
    .filter((event) => !query.action || event.action === query.action)
    .filter((event) => !query.result || event.result === query.result)
    .filter(
      (event) =>
        !query.actorUserId || event.actorUserId === query.actorUserId
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function csvCell(value: string | undefined) {
  let text = value ?? "";
  if (/^(?:[ \t\r\n]*[=+\-@]|[\t\r\n])/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function publicWorkspace(
  state: AppState,
  workspaceId: string,
  userId: string
) {
  const workspace = state.workspaces.find((item) => item.id === workspaceId);
  const membership = state.workspaceMembers.find(
    (item) => item.workspaceId === workspaceId && item.userId === userId
  );
  if (!workspace || !membership) return undefined;
  return {
    id: workspace.id,
    name: workspace.name,
    description: workspace.description,
    slug: workspace.slug,
    personal: workspace.personal,
    role: membership.role,
    ownerUserId: workspace.ownerUserId,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt
  };
}

function workspacePrincipal(
  request: FastifyRequest,
  authenticate: Options["authenticate"],
  workspaceId: string
) {
  const principal = authenticate(request);
  requireSession(principal);
  if (principal.workspaceId !== workspaceId) {
    throw new PublicError(404, "WORKSPACE_NOT_FOUND", "工作区不存在");
  }
  return principal;
}

function findMember(state: AppState, workspaceId: string, userId: string) {
  const member = state.workspaceMembers.find(
    (item) => item.workspaceId === workspaceId && item.userId === userId
  );
  if (!member) {
    throw new PublicError(404, "MEMBER_NOT_FOUND", "成员不存在");
  }
  return member;
}

function assertAdminCanManage(
  principal: Principal,
  targetRole: WorkspaceRole,
  nextRole?: WorkspaceRole
) {
  requireCapability(principal, "admin");
  if (
    principal.role !== "owner" &&
    (targetRole === "owner" ||
      targetRole === "admin" ||
      nextRole === "owner" ||
      nextRole === "admin")
  ) {
    throw new PublicError(
      403,
      "OWNER_REQUIRED",
      "仅工作区所有者可管理管理员或所有权"
    );
  }
}

function publicMember(state: AppState, workspaceId: string, userId: string) {
  const member = findMember(state, workspaceId, userId);
  const user = state.users.find((item) => item.id === userId);
  if (!user) throw new PublicError(404, "MEMBER_NOT_FOUND", "成员不存在");
  return {
    id: member.id,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName
    },
    role: member.role,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt
  };
}

function publicInvitation(
  invitation: AppState["workspaceInvitations"][number]
) {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
    revokedAt: invitation.revokedAt,
    acceptedAt: invitation.acceptedAt
  };
}

function publicApiToken(token: AppState["apiTokens"][number]) {
  return {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    scopes: token.scopes,
    ipAllowlist: token.ipAllowlist,
    createdAt: token.createdAt,
    expiresAt: token.expiresAt,
    revokedAt: token.revokedAt,
    lastUsedAt: token.lastUsedAt
  };
}

function activeChallenge(
  challenge: StoredLoginChallenge | undefined,
  timestamp: Date,
  purpose: StoredLoginChallenge["purpose"]
) {
  return Boolean(
    challenge &&
      challenge.purpose === purpose &&
      !challenge.usedAt &&
      new Date(challenge.expiresAt).getTime() > timestamp.getTime()
  );
}

function secondFactorKind(code: string) {
  return /^[0-9]{6}$/.test(code) ? "totp" : "recovery";
}

function validateSecondFactor(
  user: StoredUser,
  code: string,
  timestamp: Date
) {
  if (!user.totpSecretCiphertext || !user.totpEnabledAt) {
    throw new PublicError(400, "MFA_NOT_ENABLED", "双重验证尚未启用");
  }
  if (secondFactorKind(code) === "totp") {
    const step = verifyTotp(
      decryptSensitive(user.totpSecretCiphertext),
      code,
      timestamp
    );
    if (step === undefined) {
      throw new PublicError(400, "INVALID_TOTP", "验证码不正确");
    }
    if (user.lastTotpStep !== undefined && step <= user.lastTotpStep) {
      throw new PublicError(409, "TOTP_REPLAYED", "该验证码已经使用");
    }
    return { kind: "totp" as const, step };
  }
  const hash = hashOpaqueToken(code.trim().toUpperCase());
  const index = (user.recoveryCodeHashes ?? []).indexOf(hash);
  if (index < 0) {
    throw new PublicError(
      400,
      "INVALID_RECOVERY_CODE",
      "恢复码不正确或已经使用"
    );
  }
  return { kind: "recovery" as const, index };
}

function consumeSecondFactor(
  user: StoredUser,
  result: ReturnType<typeof validateSecondFactor>
) {
  if (result.kind === "totp") {
    user.lastTotpStep = result.step;
  } else {
    user.recoveryCodeHashes = (user.recoveryCodeHashes ?? []).filter(
      (_item, index) => index !== result.index
    );
  }
}

function newRecoveryCodes() {
  const codes = createRecoveryCodes();
  return {
    codes,
    hashes: codes.map((code) =>
      hashOpaqueToken(code.trim().toUpperCase())
    )
  };
}

export function registerWorkspaceSecurityRoutes(
  app: FastifyInstance,
  options: Options
) {
  const { store, now, authenticate, createSession } = options;

  app.get("/workspaces", async (request) => {
    const principal = authenticate(request);
    requireSession(principal);
    const state = store.snapshot();
    requireBackofficeAccess(state, principal);
    return {
      workspaces: state.workspaceMembers
        .filter((member) => member.userId === principal.user.id)
        .map((member) =>
          publicWorkspace(state, member.workspaceId, principal.user.id)
        )
        .filter(Boolean)
    };
  });

  app.post<{ Body: { name: string } }>(
    "/workspaces",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 2, maxLength: 60 }
          }
        }
      }
    },
    async (request, reply) => {
      const principal = authenticate(request);
      requireSession(principal);
      requireBackofficeAccess(store.snapshot(), principal, "owner");
      const name = request.body.name.trim();
      const timestamp = now().toISOString();
      const id = randomUUID();
      await store.update((state) => {
        state.workspaces.push({
          id,
          name,
          description: "",
          slug: id,
          personal: false,
          ownerUserId: principal.user.id,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        state.workspaceSettings.push(
          defaultWorkspaceSettings(id, timestamp)
        );
        state.analyticsCoverage.push({
          workspaceId: id,
          uploads: {
            trackingStartedAt: timestamp,
            status: "complete"
          },
          shareViews: {
            trackingStartedAt: timestamp,
            status: "complete"
          }
        });
        state.workspaceMembers.push({
          id: randomUUID(),
          workspaceId: id,
          userId: principal.user.id,
          role: "owner",
          createdAt: timestamp,
          updatedAt: timestamp
        });
        addAuditEvent(state, {
          principal,
          workspaceId: id,
          action: "workspace.create",
          result: "success",
          resourceType: "workspace",
          resourceId: id,
          ipHash: hashRequestIp(request),
          createdAt: timestamp
        });
      });
      return reply.status(201).send({
        workspace: publicWorkspace(
          store.snapshot(),
          id,
          principal.user.id
        )
      });
    }
  );

  app.get<{ Params: IdParams }>(
    "/workspaces/:id",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: idSchema }
        }
      }
    },
    async (request) => {
      const principal = workspacePrincipal(
        request,
        authenticate,
        request.params.id
      );
      requireBackofficeAccess(store.snapshot(), principal);
      return {
        workspace: publicWorkspace(
          store.snapshot(),
          principal.workspaceId,
          principal.user.id
        )
      };
    }
  );

  app.patch<{
    Params: IdParams;
    Body: { name?: string; description?: string };
  }>(
    "/workspaces/:id",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: idSchema }
        },
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            name: { type: "string", minLength: 2, maxLength: 60 },
            description: { type: "string", maxLength: 500 }
          }
        }
      }
    },
    async (request) => {
      const principal = workspacePrincipal(
        request,
        authenticate,
        request.params.id
      );
      requireBackofficeAccess(store.snapshot(), principal);
      requireCapability(principal, "admin");
      const timestamp = now().toISOString();
      await store.update((state) => {
        const workspace = state.workspaces.find(
          (item) => item.id === principal.workspaceId
        );
        if (!workspace) {
          throw new PublicError(404, "WORKSPACE_NOT_FOUND", "工作区不存在");
        }
        if (request.body.name !== undefined) {
          workspace.name = request.body.name.trim();
        }
        if (request.body.description !== undefined) {
          workspace.description = request.body.description.trim();
        }
        workspace.updatedAt = timestamp;
        addAuditEvent(state, {
          principal,
          action: "workspace.update",
          result: "success",
          resourceType: "workspace",
          resourceId: workspace.id,
          ipHash: hashRequestIp(request),
          createdAt: timestamp
        });
      });
      return {
        workspace: publicWorkspace(
          store.snapshot(),
          principal.workspaceId,
          principal.user.id
        )
      };
    }
  );

  app.delete<{ Params: IdParams }>(
    "/workspaces/:id",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: idSchema }
        }
      }
    },
    async (request, reply) => {
      const principal = workspacePrincipal(
        request,
        authenticate,
        request.params.id
      );
      requireBackofficeAccess(store.snapshot(), principal, "owner");
      requireCapability(principal, "owner");
      if (principal.workspace.personal) {
        throw new PublicError(
          400,
          "PERSONAL_WORKSPACE_REQUIRED",
          "个人工作区不能删除"
        );
      }
      const timestamp = now().toISOString();
      await store.update((state) => {
        const id = principal.workspaceId;
        addAuditEvent(state, {
          principal,
          action: "workspace.delete",
          result: "success",
          resourceType: "workspace",
          resourceId: id,
          ipHash: hashRequestIp(request),
          createdAt: timestamp
        });
        state.workspaces = state.workspaces.filter((item) => item.id !== id);
        state.workspaceSettings = state.workspaceSettings.filter(
          (item) => item.workspaceId !== id
        );
        state.analyticsDaily = state.analyticsDaily.filter(
          (item) => item.workspaceId !== id
        );
        state.analyticsCoverage = state.analyticsCoverage.filter(
          (item) => item.workspaceId !== id
        );
        state.systemEvents = state.systemEvents.filter(
          (item) => item.workspaceId !== id
        );
        state.workspaceMembers = state.workspaceMembers.filter(
          (item) => item.workspaceId !== id
        );
        state.workspaceInvitations = state.workspaceInvitations.filter(
          (item) => item.workspaceId !== id
        );
        state.apiTokens = state.apiTokens.filter(
          (item) => item.workspaceId !== id
        );
        state.images = state.images.filter(
          (item) => item.workspaceId !== id
        );
        state.albums = state.albums.filter(
          (item) => item.workspaceId !== id
        );
        state.tags = state.tags.filter((item) => item.workspaceId !== id);
        state.imageShares = state.imageShares.filter(
          (item) => item.workspaceId !== id
        );
      });
      return reply.status(204).send();
    }
  );

  app.get<{ Params: IdParams }>(
    "/workspaces/:id/members",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: idSchema }
        }
      }
    },
    async (request) => {
      const principal = workspacePrincipal(
        request,
        authenticate,
        request.params.id
      );
      requireBackofficeAccess(store.snapshot(), principal);
      requireCapability(principal, "admin");
      const state = store.snapshot();
      return {
        members: state.workspaceMembers
          .filter((item) => item.workspaceId === principal.workspaceId)
          .map((item) =>
            publicMember(state, principal.workspaceId, item.userId)
          )
      };
    }
  );

  app.patch<{
    Params: WorkspaceMemberParams;
    Body: { role: WorkspaceRole };
  }>(
    "/workspaces/:id/members/:userId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id", "userId"],
          properties: { id: idSchema, userId: idSchema }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["role"],
          properties: {
            role: {
              type: "string",
              enum: ["owner", "admin", "editor", "viewer"]
            }
          }
        }
      }
    },
    async (request) => {
      const principal = workspacePrincipal(
        request,
        authenticate,
        request.params.id
      );
      requireBackofficeAccess(store.snapshot(), principal);
      const timestamp = now().toISOString();
      await store.update((state) => {
        const target = findMember(
          state,
          principal.workspaceId,
          request.params.userId
        );
        assertAdminCanManage(principal, target.role, request.body.role);
        if (
          target.role === "owner" &&
          request.body.role !== "owner"
        ) {
          throw new PublicError(
            400,
            "SOLE_OWNER_REQUIRED",
            "请先将所有权转移给其他成员"
          );
        }
        if (request.body.role === "owner") {
          if (isSiteBackofficeWorkspace(state, principal.workspaceId)) {
            throw new PublicError(
              409,
              "SITE_OWNERSHIP_FIXED",
              "站点后台工作区不能转移所有权"
            );
          }
          if (target.userId === principal.user.id) {
            throw new PublicError(
              400,
              "INVALID_OWNERSHIP_TRANSFER",
              "请选择其他成员接收工作区所有权"
            );
          }
          if (principal.role !== "owner") {
            throw new PublicError(
              403,
              "OWNER_REQUIRED",
              "仅工作区所有者可转移所有权"
            );
          }
          const currentOwner = findMember(
            state,
            principal.workspaceId,
            principal.user.id
          );
          currentOwner.role = "admin";
          currentOwner.updatedAt = timestamp;
          const workspace = state.workspaces.find(
            (item) => item.id === principal.workspaceId
          )!;
          workspace.ownerUserId = target.userId;
          workspace.updatedAt = timestamp;
        }
        target.role = request.body.role;
        target.updatedAt = timestamp;
        addAuditEvent(state, {
          principal,
          action: "member.role.update",
          result: "success",
          resourceType: "member",
          resourceId: target.id,
          metadata: { nextRole: request.body.role },
          ipHash: hashRequestIp(request),
          createdAt: timestamp
        });
      });
      return {
        member: publicMember(
          store.snapshot(),
          principal.workspaceId,
          request.params.userId
        )
      };
    }
  );

  app.delete<{ Params: WorkspaceMemberParams }>(
    "/workspaces/:id/members/:userId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id", "userId"],
          properties: { id: idSchema, userId: idSchema }
        }
      }
    },
    async (request, reply) => {
      const principal = workspacePrincipal(
        request,
        authenticate,
        request.params.id
      );
      requireBackofficeAccess(store.snapshot(), principal);
      await store.update((state) => {
        const target = findMember(
          state,
          principal.workspaceId,
          request.params.userId
        );
        assertAdminCanManage(principal, target.role);
        if (target.role === "owner") {
          throw new PublicError(
            400,
            "SOLE_OWNER_REQUIRED",
            "工作区所有者不能被移除"
          );
        }
        state.workspaceMembers = state.workspaceMembers.filter(
          (item) => item.id !== target.id
        );
        addAuditEvent(state, {
          principal,
          action: "member.remove",
          result: "success",
          resourceType: "member",
          resourceId: target.id,
          ipHash: hashRequestIp(request),
          createdAt: now().toISOString()
        });
      });
      return reply.status(204).send();
    }
  );

  app.get<{ Params: IdParams }>(
    "/workspaces/:id/invitations",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: idSchema }
        }
      }
    },
    async (request) => {
      const principal = workspacePrincipal(
        request,
        authenticate,
        request.params.id
      );
      requireBackofficeAccess(store.snapshot(), principal);
      requireCapability(principal, "admin");
      return {
        invitations: store
          .snapshot()
          .workspaceInvitations.filter(
            (item) => item.workspaceId === principal.workspaceId
          )
          .map(publicInvitation)
      };
    }
  );

  app.post<{
    Params: IdParams;
    Body: { email: string; role: Exclude<WorkspaceRole, "owner"> };
  }>(
    "/workspaces/:id/invitations",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: idSchema }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["email", "role"],
          properties: {
            email: { type: "string", minLength: 3, maxLength: 254 },
            role: {
              type: "string",
              enum: ["admin", "editor", "viewer"]
            }
          }
        }
      }
    },
    async (request, reply) => {
      const principal = workspacePrincipal(
        request,
        authenticate,
        request.params.id
      );
      const access = requireBackofficeAccess(store.snapshot(), principal);
      requireCapability(principal, "admin");
      if (access.role !== "owner") {
        throw new PublicError(
          403,
          "OWNER_REQUIRED",
          "仅站点所有者可创建后台成员邀请"
        );
      }
      const email = normalizeEmail(request.body.email);
      const token = createOpaqueToken();
      const timestamp = now();
      const invitation = {
        id: randomUUID(),
        workspaceId: principal.workspaceId,
        email,
        role: request.body.role,
        tokenHash: hashOpaqueToken(token),
        createdBy: principal.user.id,
        createdAt: timestamp.toISOString(),
        expiresAt: new Date(
          timestamp.getTime() + 7 * 24 * 60 * 60 * 1000
        ).toISOString()
      };
      await store.update((state) => {
        if (
          state.workspaceMembers.some(
            (member) =>
              member.workspaceId === principal.workspaceId &&
              state.users.find((user) => user.id === member.userId)?.email ===
                email
          )
        ) {
          throw new PublicError(
            409,
            "ALREADY_MEMBER",
            "该用户已经是工作区成员"
          );
        }
        state.workspaceInvitations.push(invitation);
        addAuditEvent(state, {
          principal,
          action: "invitation.create",
          result: "success",
          resourceType: "invitation",
          resourceId: invitation.id,
          metadata: { role: invitation.role },
          ipHash: hashRequestIp(request),
          createdAt: timestamp.toISOString()
        });
      });
      return reply.status(201).send({
        invitation: publicInvitation(invitation),
        token,
        inviteUrl: `/invites/${token}`
      });
    }
  );

  app.delete<{ Params: InvitationParams }>(
    "/workspaces/:id/invitations/:invitationId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id", "invitationId"],
          properties: { id: idSchema, invitationId: idSchema }
        }
      }
    },
    async (request, reply) => {
      const principal = workspacePrincipal(
        request,
        authenticate,
        request.params.id
      );
      requireBackofficeAccess(store.snapshot(), principal);
      requireCapability(principal, "admin");
      const timestamp = now().toISOString();
      await store.update((state) => {
        const invitation = state.workspaceInvitations.find(
          (item) =>
            item.id === request.params.invitationId &&
            item.workspaceId === principal.workspaceId
        );
        if (!invitation) {
          throw new PublicError(
            404,
            "INVITATION_NOT_FOUND",
            "邀请不存在"
          );
        }
        if (principal.role !== "owner" && invitation.role === "admin") {
          throw new PublicError(
            403,
            "OWNER_REQUIRED",
            "仅工作区所有者可管理管理员邀请"
          );
        }
        invitation.revokedAt ??= timestamp;
        addAuditEvent(state, {
          principal,
          action: "invitation.revoke",
          result: "success",
          resourceType: "invitation",
          resourceId: invitation.id,
          ipHash: hashRequestIp(request),
          createdAt: timestamp
        });
      });
      return reply.status(204).send();
    }
  );

  app.post<{ Params: InviteTokenParams }>(
    "/invites/:token/accept",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["token"],
          properties: {
            token: { type: "string", minLength: 20, maxLength: 200 }
          }
        }
      }
    },
    async (request) => {
      const principal = authenticate(request);
      requireSession(principal);
      const timestamp = now();
      const tokenHash = hashOpaqueToken(request.params.token);
      let workspaceId = "";
      await store.update((state) => {
        const invitation = state.workspaceInvitations.find(
          (item) => item.tokenHash === tokenHash
        );
        if (
          !invitation ||
          invitation.revokedAt ||
          invitation.acceptedAt ||
          new Date(invitation.expiresAt).getTime() <= timestamp.getTime()
        ) {
          throw new PublicError(
            400,
            "INVALID_INVITATION",
            "邀请无效、已过期或已经使用"
          );
        }
        if (invitation.email !== principal.user.email) {
          throw new PublicError(
            403,
            "INVITATION_EMAIL_MISMATCH",
            "请使用受邀邮箱账号接受邀请"
          );
        }
        workspaceId = invitation.workspaceId;
        state.workspaceMembers.push({
          id: randomUUID(),
          workspaceId,
          userId: principal.user.id,
          role: invitation.role,
          createdAt: timestamp.toISOString(),
          updatedAt: timestamp.toISOString()
        });
        invitation.acceptedAt = timestamp.toISOString();
        invitation.acceptedBy = principal.user.id;
        addAuditEvent(state, {
          principal,
          workspaceId,
          action: "invitation.accept",
          result: "success",
          resourceType: "invitation",
          resourceId: invitation.id,
          metadata: { role: invitation.role },
          ipHash: hashRequestIp(request),
          createdAt: timestamp.toISOString()
        });
      });
      return {
        workspace: publicWorkspace(
          store.snapshot(),
          workspaceId,
          principal.user.id
        )
      };
    }
  );

  app.get("/api-tokens", async (request) => {
    const principal = authenticate(request);
    requireSession(principal);
    requireBackofficeAccess(store.snapshot(), principal);
    requireCapability(principal, "admin");
    return {
      tokens: store
        .snapshot()
        .apiTokens.filter(
          (token) => token.workspaceId === principal.workspaceId
        )
        .map(publicApiToken)
    };
  });

  app.post<{
    Body: {
      name: string;
      scopes: ApiTokenScope[];
      expiresInDays?: number;
      ipAllowlist?: string[];
    };
  }>(
    "/api-tokens",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name", "scopes"],
          properties: {
            name: { type: "string", minLength: 2, maxLength: 80 },
            scopes: {
              type: "array",
              minItems: 1,
              maxItems: 8,
              uniqueItems: true,
              items: { type: "string", enum: allScopes }
            },
            expiresInDays: { type: "integer", minimum: 1, maximum: 3650 }
            ,
            ipAllowlist: {
              type: "array",
              maxItems: 20,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 80 }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const principal = authenticate(request);
      requireSession(principal);
      requireBackofficeAccess(store.snapshot(), principal);
      requireCapability(principal, "admin");
      const prefix = randomBytes(6).toString("hex");
      const secret = createOpaqueToken();
      const tokenValue = `ouh_${prefix}_${secret}`;
      const timestamp = now();
      const ipAllowlist = normalizeIpAllowlist(request.body.ipAllowlist);
      const token = {
        id: randomUUID(),
        workspaceId: principal.workspaceId,
        userId: principal.user.id,
        name: request.body.name.trim(),
        prefix,
        tokenHash: hashOpaqueToken(tokenValue),
        scopes: request.body.scopes,
        ipAllowlist,
        createdAt: timestamp.toISOString(),
        expiresAt: request.body.expiresInDays
          ? new Date(
              timestamp.getTime() +
                request.body.expiresInDays * 24 * 60 * 60 * 1000
            ).toISOString()
          : undefined
      };
      await store.update((state) => {
        state.apiTokens.push(token);
        addAuditEvent(state, {
          principal,
          action: "api_token.create",
          result: "success",
          resourceType: "api_token",
          resourceId: token.id,
          metadata: { scopeCount: token.scopes.length },
          ipHash: hashRequestIp(request),
          createdAt: timestamp.toISOString()
        });
      });
      return reply.status(201).send({
        token: publicApiToken(token),
        value: tokenValue
      });
    }
  );

  app.delete<{ Params: IdParams }>(
    "/api-tokens/:id",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: idSchema }
        }
      }
    },
    async (request, reply) => {
      const principal = authenticate(request);
      requireSession(principal);
      requireBackofficeAccess(store.snapshot(), principal);
      requireCapability(principal, "admin");
      const timestamp = now().toISOString();
      await store.update((state) => {
        const token = state.apiTokens.find(
          (item) =>
            item.id === request.params.id &&
            item.workspaceId === principal.workspaceId
        );
        if (!token) {
          throw new PublicError(404, "API_TOKEN_NOT_FOUND", "API Token 不存在");
        }
        token.revokedAt ??= timestamp;
        addAuditEvent(state, {
          principal,
          action: "api_token.revoke",
          result: "success",
          resourceType: "api_token",
          resourceId: token.id,
          ipHash: hashRequestIp(request),
          createdAt: timestamp
        });
      });
      return reply.status(204).send();
    }
  );

  app.get("/auth/sessions", async (request) => {
    const principal = authenticate(request);
    const current = requireSession(principal);
    return {
      sessions: store
        .snapshot()
        .sessions.filter((session) => session.userId === principal.user.id)
        .map((session) => ({
          id: session.id,
          current: session.id === current.id,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          lastSeenAt: session.lastSeenAt,
          userAgent: session.userAgent,
          ipHash: session.ipHash
        }))
    };
  });

  app.post<{ Body: { currentPassword: string; newPassword: string } }>(
    "/me/password",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["currentPassword", "newPassword"],
          properties: {
            currentPassword: { type: "string", minLength: 1, maxLength: 128 },
            newPassword: { type: "string", minLength: 12, maxLength: 128 }
          }
        }
      }
    },
    async (request) => {
      const principal = authenticate(request);
      const session = requireSession(principal);
      if (
        !(await verifyPassword(
          request.body.currentPassword,
          principal.user.passwordHash
        ))
      ) {
        throw new PublicError(
          401,
          "INVALID_CREDENTIALS",
          "当前密码不正确"
        );
      }
      const passwordIssues = validatePassword(request.body.newPassword);
      if (passwordIssues.length > 0) {
        throw new PublicError(
          400,
          "WEAK_PASSWORD",
          passwordIssues[0] ?? "密码强度不足"
        );
      }
      const passwordHash = await hashPassword(request.body.newPassword);
      const timestamp = now().toISOString();
      await store.update((state) => {
        const user = state.users.find(
          (item) => item.id === principal.user.id
        )!;
        user.passwordHash = passwordHash;
        user.passwordUpdatedAt = timestamp;
        user.updatedAt = timestamp;
        state.sessions = state.sessions.filter(
          (item) =>
            item.userId !== principal.user.id || item.id === session.id
        );
        addAuditEvent(state, {
          principal,
          action: "password.update",
          result: "success",
          resourceType: "user",
          resourceId: user.id,
          ipHash: hashRequestIp(request),
          createdAt: timestamp
        });
      });
      return { updated: true };
    }
  );

  app.get("/me/security", async (request) => {
    const principal = authenticate(request);
    requireSession(principal);
    const user = store
      .snapshot()
      .users.find((item) => item.id === principal.user.id)!;
    return {
      twoFactorEnabled: Boolean(user.totpEnabledAt),
      recoveryCodesRemaining: user.recoveryCodeHashes?.length ?? 0,
      passwordUpdatedAt: user.passwordUpdatedAt ?? user.updatedAt
    };
  });

  app.delete<{ Params: SessionParams }>(
    "/auth/sessions/:id",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: idSchema }
        }
      }
    },
    async (request, reply) => {
      const principal = authenticate(request);
      requireSession(principal);
      const timestamp = now().toISOString();
      await store.update((state) => {
        const session = state.sessions.find(
          (item) =>
            item.id === request.params.id &&
            item.userId === principal.user.id
        );
        if (!session) {
          throw new PublicError(404, "SESSION_NOT_FOUND", "会话不存在");
        }
        addAuditEvent(state, {
          principal,
          action: "session.revoke",
          result: "success",
          resourceType: "session",
          resourceId: session.id,
          ipHash: hashRequestIp(request),
          createdAt: timestamp
        });
        state.sessions = state.sessions.filter(
          (item) => item.id !== session.id
        );
      });
      return reply.status(204).send();
    }
  );

  app.delete("/auth/sessions", async (request, reply) => {
    const principal = authenticate(request);
    const current = requireSession(principal);
    const timestamp = now().toISOString();
    await store.update((state) => {
      const revokedCount = state.sessions.filter(
        (item) =>
          item.userId === principal.user.id && item.id !== current.id
      ).length;
      state.sessions = state.sessions.filter(
        (item) =>
          item.userId !== principal.user.id || item.id === current.id
      );
      addAuditEvent(state, {
        principal,
        action: "session.revoke_others",
        result: "success",
        resourceType: "session",
        metadata: { revokedCount },
        ipHash: hashRequestIp(request),
        createdAt: timestamp
      });
    });
    return reply.status(204).send();
  });

  app.get("/me/notifications", async (request) => {
    const principal = authenticate(request);
    requireSession(principal);
    const user = store
      .snapshot()
      .users.find((item) => item.id === principal.user.id)!;
    return { preferences: preferencesFor(user) };
  });

  app.patch<{
    Body: {
      security?: boolean;
      collaboration?: boolean;
      system?: boolean;
      quietHours?: {
        enabled?: boolean;
        start?: string;
        end?: string;
        timezone?: string;
      };
    };
  }>(
    "/me/notifications",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            security: { type: "boolean" },
            collaboration: { type: "boolean" },
            system: { type: "boolean" },
            quietHours: {
              type: "object",
              additionalProperties: false,
              minProperties: 1,
              properties: {
                enabled: { type: "boolean" },
                start: {
                  type: "string",
                  pattern: notificationTimePattern.source
                },
                end: {
                  type: "string",
                  pattern: notificationTimePattern.source
                },
                timezone: { type: "string", minLength: 1, maxLength: 100 }
              }
            }
          }
        }
      }
    },
    async (request) => {
      const principal = authenticate(request);
      requireSession(principal);
      let preferences = defaultNotificationPreferences();
      await store.update((state) => {
        const user = state.users.find(
          (item) => item.id === principal.user.id
        )!;
        const current = preferencesFor(user);
        preferences = {
          ...current,
          ...request.body,
          quietHours: {
            ...current.quietHours,
            ...(request.body.quietHours ?? {})
          }
        };
        if (
          !notificationTimePattern.test(preferences.quietHours.start) ||
          !notificationTimePattern.test(preferences.quietHours.end)
        ) {
          throw new PublicError(
            400,
            "INVALID_QUIET_HOURS",
            "免打扰时间格式无效"
          );
        }
        validateTimezone(preferences.quietHours.timezone);
        user.notificationPreferences = preferences;
        user.updatedAt = now().toISOString();
      });
      return { preferences };
    }
  );

  app.get<{ Querystring: { limit?: string } }>(
    "/notifications",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "string", pattern: "^[0-9]+$" }
          }
        }
      }
    },
    async (request) => {
      const principal = authenticate(request);
      requireSession(principal);
      const state = store.snapshot();
      const user = state.users.find(
        (item) => item.id === principal.user.id
      )!;
      const events = visibleNotificationEvents(state, principal);
      const limit = Math.min(
        100,
        Math.max(1, Number(request.query.limit ?? 30))
      );
      const read = new Set(user.notificationReadEventIds ?? []);
      const preferences = preferencesFor(user);
      const badgeSuppressed = quietHoursActive(preferences, now());
      return {
        notifications: events.slice(0, limit).map((event) => ({
          id: event.id,
          category: notificationCategory(event.action),
          action: event.action,
          read: read.has(event.id),
          createdAt: event.createdAt,
        })),
        unreadCount: unreadNotificationCount(events, user, now()),
        badgeSuppressed
      };
    }
  );

  app.post<{
    Body: { ids?: string[]; all?: boolean };
  }>(
    "/notifications/read",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            ids: {
              type: "array",
              minItems: 1,
              maxItems: 500,
              uniqueItems: true,
              items: idSchema
            },
            all: { type: "boolean" }
          }
        }
      }
    },
    async (request) => {
      const principal = authenticate(request);
      requireSession(principal);
      const hasIds = Boolean(request.body.ids?.length);
      const readAll = request.body.all === true;
      if (hasIds === readAll) {
        throw new PublicError(
          400,
          "INVALID_NOTIFICATION_READ",
          "请指定 ids 或 all=true"
        );
      }
      let unreadCount = 0;
      let readEventIds: string[] = [];
      await store.update((state) => {
        const user = state.users.find(
          (item) => item.id === principal.user.id
        )!;
        const events = visibleNotificationEvents(state, principal);
        const visibleIds = new Set(events.map((event) => event.id));
        const requested = readAll
          ? events.map((event) => event.id)
          : request.body.ids!.filter((id) => visibleIds.has(id));
        const legalIds = legalReadEventIdsForUser(state, principal.user.id);
        const combined = new Set([
          ...requested,
          ...(user.notificationReadEventIds ?? []).filter((id) =>
            legalIds.has(id)
          )
        ]);
        readEventIds = state.auditEvents
          .slice()
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((event) => event.id)
          .filter((id) => combined.has(id) && legalIds.has(id))
          .slice(0, 500);
        user.notificationReadEventIds = readEventIds;
        user.updatedAt = now().toISOString();
        unreadCount = unreadNotificationCount(events, user, now());
      });
      return { readEventIds, unreadCount };
    }
  );

  app.get<{ Querystring: AuditQuery }>(
    "/audit/export",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            action: { type: "string", maxLength: 100 },
            result: { type: "string", enum: ["success", "failure"] },
            actorUserId: idSchema
          }
        }
      }
    },
    async (request, reply) => {
      const principal = authenticate(request);
      requireSession(principal);
      requireBackofficeAccess(store.snapshot(), principal);
      requireCapability(principal, "admin");
      const events = filterAuditEvents(
        store.snapshot(),
        principal.workspaceId,
        request.query
      );
      const header = [
        "createdAt",
        "actorType",
        "actorUserId",
        "action",
        "result",
        "resourceType",
        "resourceId"
      ];
      const rows = events.map((event) =>
        [
          event.createdAt,
          event.actorType,
          event.actorUserId,
          event.action,
          event.result,
          event.resourceType,
          event.resourceId
        ]
          .map(csvCell)
          .join(",")
      );
      reply
        .type("text/csv; charset=utf-8")
        .header(
          "content-disposition",
          'attachment; filename="ou-image-audit.csv"'
        );
      return `\uFEFF${header.map(csvCell).join(",")}\r\n${rows.join(
        "\r\n"
      )}`;
    }
  );

  app.get<{
    Querystring: AuditQuery & {
      page?: string;
      limit?: string;
    };
  }>(
    "/audit",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            action: { type: "string", maxLength: 100 },
            result: { type: "string", enum: ["success", "failure"] },
            actorUserId: idSchema,
            page: { type: "string", pattern: "^[0-9]+$" },
            limit: { type: "string", pattern: "^[0-9]+$" }
          }
        }
      }
    },
    async (request) => {
      const principal = authenticate(request);
      requireSession(principal);
      requireBackofficeAccess(store.snapshot(), principal);
      requireCapability(principal, "admin");
      const page = Math.max(1, Number(request.query.page ?? 1));
      const limit = Math.min(
        100,
        Math.max(1, Number(request.query.limit ?? 30))
      );
      const events = filterAuditEvents(
        store.snapshot(),
        principal.workspaceId,
        request.query
      );
      return {
        events: events.slice((page - 1) * limit, page * limit),
        page,
        limit,
        total: events.length
      };
    }
  );

  app.post<{ Body: { currentPassword: string } }>(
    "/auth/2fa/setup",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["currentPassword"],
          properties: {
            currentPassword: { type: "string", minLength: 1, maxLength: 128 }
          }
        }
      }
    },
    async (request) => {
      const principal = authenticate(request);
      const session = requireSession(principal);
      if (
        !(await verifyPassword(
          request.body.currentPassword,
          principal.user.passwordHash
        ))
      ) {
        throw new PublicError(
          401,
          "INVALID_CREDENTIALS",
          "当前密码不正确"
        );
      }
      if (!process.env.OU_SECRET_KEY) {
        throw new PublicError(
          503,
          "SECRET_KEY_REQUIRED",
          "配置 OU_SECRET_KEY 后才能启用双重验证"
        );
      }
      const currentUser = store
        .snapshot()
        .users.find((item) => item.id === principal.user.id);
      if (currentUser?.totpEnabledAt && currentUser.totpSecretCiphertext) {
        throw new PublicError(
          409,
          "MFA_ALREADY_ENABLED",
          "双重验证已经启用"
        );
      }
      const secret = createTotpSecret();
      const challengeToken = createOpaqueToken();
      const timestamp = now();
      const challenge: StoredLoginChallenge = {
        id: randomUUID(),
        userId: principal.user.id,
        purpose: "mfa-setup",
        sessionId: session.id,
        tokenHash: hashOpaqueToken(challengeToken),
        secretCiphertext: encryptSensitive(secret),
        createdAt: timestamp.toISOString(),
        expiresAt: new Date(timestamp.getTime() + 5 * 60 * 1000).toISOString()
      };
      await store.update((state) => {
        const user = state.users.find(
          (item) => item.id === principal.user.id
        );
        if (user?.totpEnabledAt && user.totpSecretCiphertext) {
          throw new PublicError(
            409,
            "MFA_ALREADY_ENABLED",
            "双重验证已经启用"
          );
        }
        state.loginChallenges = state.loginChallenges.filter(
          (item) =>
            !(
              item.purpose === "mfa-setup" &&
              item.sessionId === session.id &&
              !item.usedAt
            )
        );
        state.loginChallenges.push(challenge);
      });
      const label = encodeURIComponent(
        `OU-Image Hosting:${principal.user.email}`
      );
      return {
        challengeToken,
        manualKey: secret,
        otpauthUri:
          `otpauth://totp/${label}` +
          `?secret=${secret}&issuer=${encodeURIComponent("OU-Image Hosting")}`
      };
    }
  );

  app.post<{ Body: { challengeToken: string; code: string } }>(
    "/auth/2fa/confirm",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["challengeToken", "code"],
          properties: {
            challengeToken: { type: "string", minLength: 20, maxLength: 200 },
            code: { type: "string", pattern: "^[0-9]{6}$" }
          }
        }
      }
    },
    async (request) => {
      const principal = authenticate(request);
      const session = requireSession(principal);
      const timestamp = now();
      const tokenHash = hashOpaqueToken(request.body.challengeToken);
      let recoveryCodes: string[] = [];
      await store.update((state) => {
        const challenge = state.loginChallenges.find(
          (item) => item.tokenHash === tokenHash
        );
        if (
          !activeChallenge(challenge, timestamp, "mfa-setup") ||
          challenge!.userId !== principal.user.id ||
          challenge!.sessionId !== session.id ||
          !challenge!.secretCiphertext
        ) {
          throw new PublicError(
            400,
            "INVALID_MFA_CHALLENGE",
            "双重验证设置挑战无效或已使用"
          );
        }
        const step = verifyTotp(
          decryptSensitive(challenge!.secretCiphertext),
          request.body.code,
          timestamp
        );
        if (step === undefined) {
          throw new PublicError(400, "INVALID_TOTP", "验证码不正确");
        }
        const user = state.users.find(
          (item) => item.id === principal.user.id
        )!;
        const generated = newRecoveryCodes();
        recoveryCodes = generated.codes;
        user.totpSecretCiphertext = challenge!.secretCiphertext;
        user.totpEnabledAt = timestamp.toISOString();
        user.lastTotpStep = step;
        user.recoveryCodeHashes = generated.hashes;
        user.updatedAt = timestamp.toISOString();
        challenge!.usedAt = timestamp.toISOString();
        addAuditEvent(state, {
          principal,
          action: "mfa.enable",
          result: "success",
          resourceType: "user",
          resourceId: user.id,
          ipHash: hashRequestIp(request),
          createdAt: timestamp.toISOString()
        });
      });
      return { enabled: true, recoveryCodes };
    }
  );

  async function verifyMfaPassword(
    principal: Principal,
    currentPassword: string
  ) {
    if (
      !(await verifyPassword(currentPassword, principal.user.passwordHash))
    ) {
      throw new PublicError(
        401,
        "INVALID_CREDENTIALS",
        "当前密码不正确"
      );
    }
  }

  app.post<{ Body: { currentPassword: string; code: string } }>(
    "/auth/2fa/disable",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["currentPassword", "code"],
          properties: {
            currentPassword: { type: "string", minLength: 1, maxLength: 128 },
            code: { type: "string", minLength: 6, maxLength: 32 }
          }
        }
      }
    },
    async (request) => {
      const principal = authenticate(request);
      requireSession(principal);
      const timestamp = now();
      await verifyMfaPassword(principal, request.body.currentPassword);
      await store.update((state) => {
        const user = state.users.find(
          (item) => item.id === principal.user.id
        )!;
        const factor = validateSecondFactor(
          user,
          request.body.code,
          timestamp
        );
        consumeSecondFactor(user, factor);
        delete user.totpSecretCiphertext;
        delete user.totpEnabledAt;
        delete user.lastTotpStep;
        user.recoveryCodeHashes = [];
        user.updatedAt = timestamp.toISOString();
        addAuditEvent(state, {
          principal,
          action: "mfa.disable",
          result: "success",
          resourceType: "user",
          resourceId: user.id,
          ipHash: hashRequestIp(request),
          createdAt: timestamp.toISOString()
        });
      });
      return { enabled: false };
    }
  );

  app.post<{ Body: { currentPassword: string; code: string } }>(
    "/auth/2fa/recovery-codes",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["currentPassword", "code"],
          properties: {
            currentPassword: { type: "string", minLength: 1, maxLength: 128 },
            code: { type: "string", minLength: 6, maxLength: 32 }
          }
        }
      }
    },
    async (request) => {
      const principal = authenticate(request);
      requireSession(principal);
      const timestamp = now();
      await verifyMfaPassword(principal, request.body.currentPassword);
      const generated = newRecoveryCodes();
      await store.update((state) => {
        const user = state.users.find(
          (item) => item.id === principal.user.id
        )!;
        const factor = validateSecondFactor(
          user,
          request.body.code,
          timestamp
        );
        consumeSecondFactor(user, factor);
        user.recoveryCodeHashes = generated.hashes;
        user.updatedAt = timestamp.toISOString();
        addAuditEvent(state, {
          principal,
          action: "mfa.recovery_codes.regenerate",
          result: "success",
          resourceType: "user",
          resourceId: user.id,
          metadata: { recoveryCodesRemaining: generated.hashes.length },
          ipHash: hashRequestIp(request),
          createdAt: timestamp.toISOString()
        });
      });
      return { recoveryCodes: generated.codes };
    }
  );

  app.post<{ Body: { challengeToken: string; code: string } }>(
    "/auth/2fa/login",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["challengeToken", "code"],
          properties: {
            challengeToken: { type: "string", minLength: 20, maxLength: 200 },
            code: { type: "string", minLength: 6, maxLength: 32 }
          }
        }
      }
    },
    async (request, reply) => {
      const timestamp = now();
      const tokenHash = hashOpaqueToken(request.body.challengeToken);
      let userId = "";
      await store.update((state) => {
        const challenge = state.loginChallenges.find(
          (item) => item.tokenHash === tokenHash
        );
        if (!activeChallenge(challenge, timestamp, "login")) {
          throw new PublicError(
            400,
            "INVALID_MFA_CHALLENGE",
            "登录验证挑战无效或已使用"
          );
        }
        const user = state.users.find(
          (item) => item.id === challenge!.userId
        );
        if (!user) {
          throw new PublicError(
            400,
            "INVALID_MFA_CHALLENGE",
            "登录验证挑战无效或已使用"
          );
        }
        const factor = validateSecondFactor(
          user,
          request.body.code,
          timestamp
        );
        consumeSecondFactor(user, factor);
        challenge!.usedAt = timestamp.toISOString();
        user.updatedAt = timestamp.toISOString();
        userId = user.id;
      });
      await createSession(userId, request, reply);
      const user = store.snapshot().users.find((item) => item.id === userId)!;
      return { user: { id: user.id, email: user.email, displayName: user.displayName } };
    }
  );
}
