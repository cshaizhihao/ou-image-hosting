import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Fastify, {
  LogController,
  type FastifyReply,
  type FastifyRequest
} from "fastify";
import {
  access,
  constants,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  hashRequestIp,
  isIpAllowed,
  normalizeIpAllowlist,
  type Principal
} from "./access.js";
import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  normalizeEmail,
  validatePassword,
  verifyPassword
} from "./security.js";
import { PublicError } from "./errors.js";
import {
  AppStore,
  defaultSiteConfig,
  defaultNotificationPreferences,
  defaultWorkspaceSettings,
  type AppState,
  type StoredApiToken,
  type StoredUser,
  type ThemePreference
} from "./store.js";
import { registerUploadRoutes } from "./uploads.js";
import { registerInfrastructureRoutes } from "./infrastructure.js";
import { registerWorkspaceSecurityRoutes } from "./workspace-security.js";
import { registerOperationsRoutes } from "./operations.js";
import { MaintenanceGate } from "./maintenance.js";

const SESSION_COOKIE = "ou_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_DURATION_MS = 30 * 60 * 1000;
const LOGIN_LOCK_MS = 10 * 60 * 1000;

type BuildAppOptions = {
  store?: AppStore;
  dataDirectory?: string;
  appOrigin?: string;
  exposeDevelopmentResetToken?: boolean;
  now?: () => Date;
};

type SetupBody = {
  siteName: string;
  displayName: string;
  email: string;
  password: string;
  registrationEnabled?: boolean;
  theme?: ThemePreference;
};

type LoginBody = { email: string; password: string };
type RegisterBody = LoginBody & { displayName: string };
type ForgotBody = { email: string };
type ResetBody = { token: string; password: string };
type ProfileBody = {
  displayName?: string;
  theme?: ThemePreference;
  onboardingCompleted?: boolean;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const themeValues = ["light", "dark", "system"] as const;
const principalByRequest = new WeakMap<FastifyRequest, Principal>();

export function redactCapabilityUrl(value: string) {
  return value
    .replace(/(\/shares\/)[^/?#]+/g, "$1[REDACTED]")
    .replace(/(\/invites\/)[^/?#]+/g, "$1[REDACTED]");
}

function publicSiteStatus(site: AppState["site"]) {
  return site
    ? {
        siteName: site.siteName,
        siteDescription: site.siteDescription,
        siteLogoUrl: site.siteLogoUrl,
        registrationEnabled: site.registrationEnabled,
        publicUploadEnabled: site.publicUploadEnabled,
        publicGalleryEnabled: site.publicGalleryEnabled,
        publicUploadDefaultPublic: site.publicUploadDefaultPublic,
        publicHeroTitle: site.publicHeroTitle,
        publicHeroDescription: site.publicHeroDescription,
        loginEyebrow: site.loginEyebrow,
        loginHeroTitle: site.loginHeroTitle,
        loginHeroDescription: site.loginHeroDescription,
        defaultStorage: site.defaultStorage,
        theme: site.theme
      }
    : null;
}

function normalizeOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    throw new Error("APP_ORIGIN 必须是有效的绝对 URL");
  }
}

function publicUser(user: StoredUser) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    theme: user.theme,
    mfaEnabled: Boolean(user.totpEnabledAt),
    onboardingCompleted: user.onboardingCompleted,
    createdAt: user.createdAt
  };
}

function assertEmail(email: string) {
  const normalized = normalizeEmail(email);
  if (!emailPattern.test(normalized) || normalized.length > 254) {
    throw new PublicError(400, "INVALID_EMAIL", "请输入有效的邮箱地址");
  }
  return normalized;
}

function assertDisplayName(value: string) {
  const displayName = value.trim();
  if (displayName.length < 2 || displayName.length > 40) {
    throw new PublicError(400, "INVALID_DISPLAY_NAME", "显示名称需要 2 至 40 个字符");
  }
  return displayName;
}

function assertPassword(value: string) {
  const issues = validatePassword(value);
  if (issues.length > 0) {
    throw new PublicError(400, "WEAK_PASSWORD", issues[0] ?? "密码强度不足");
  }
}

function useSecureCookies() {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  return process.env.NODE_ENV === "production";
}

function trustedProxyConfiguration() {
  if (process.env.TRUST_PROXY !== "true") return false;
  const configured = process.env.TRUST_PROXY_ADDRESSES
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const trusted = normalizeIpAllowlist(configured);
  if (trusted.length === 0) {
    throw new Error("TRUST_PROXY=true 时必须配置 TRUST_PROXY_ADDRESSES");
  }
  return trusted;
}

function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureCookies(),
    path: "/",
    maxAge: SESSION_DURATION_MS / 1000
  });
}

function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureCookies(),
    path: "/"
  });
}

function addPersonalWorkspace(
  state: AppState,
  user: StoredUser
) {
  const workspaceId = `personal-${user.id}`;
  state.workspaces.push({
    id: workspaceId,
    name: `${user.displayName}的空间`,
    description: "",
    slug: workspaceId,
    personal: true,
    ownerUserId: user.id,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  });
  state.workspaceSettings.push(
    defaultWorkspaceSettings(workspaceId, user.updatedAt)
  );
  state.analyticsCoverage.push({
    workspaceId,
    uploads: {
      trackingStartedAt: user.createdAt,
      status: "complete"
    },
    shareViews: {
      trackingStartedAt: user.createdAt,
      status: "complete"
    }
  });
  state.workspaceMembers.push({
    id: randomUUID(),
    workspaceId,
    userId: user.id,
    role: "owner",
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  });
}

function cleanExpired(state: AppState, now: Date) {
  const nowMs = now.getTime();
  state.sessions = state.sessions.filter(
    (session) => new Date(session.expiresAt).getTime() > nowMs
  );
  state.passwordResets = state.passwordResets.filter(
    (reset) =>
      !reset.usedAt && new Date(reset.expiresAt).getTime() > nowMs
  );
}

export async function buildApp(options: BuildAppOptions = {}) {
  const dataDirectory =
    options.dataDirectory ??
    process.env.OU_DATA_DIR ??
    path.resolve(process.cwd(), ".data");
  const store =
    options.store ?? new AppStore(path.join(dataDirectory, "ou-image.json"));
  const appOrigin = normalizeOrigin(
    options.appOrigin ?? process.env.APP_ORIGIN ?? "http://localhost:3000"
  );
  const exposeDevelopmentResetToken =
    options.exposeDevelopmentResetToken ??
    (process.env.NODE_ENV !== "production" &&
      process.env.EXPOSE_DEVELOPMENT_RESET_TOKEN === "true");
  const now = options.now ?? (() => new Date());
  const maintenance = new MaintenanceGate();
  const writeReleases = new WeakMap<FastifyRequest, () => void>();
  const releaseWrite = (request: FastifyRequest) => {
    writeReleases.get(request)?.();
    writeReleases.delete(request);
  };

  await store.initialize();

  const app = Fastify({
    trustProxy: trustedProxyConfiguration(),
    logController: new LogController({ disableRequestLogging: true }),
    logger: {
      level: process.env.NODE_ENV === "production" ? "info" : "warn",
      redact: {
        paths: [
          "req.headers.cookie",
          "req.headers.authorization",
          "req.body.password",
          "req.body.token",
          "req.body.config.secretAccessKey",
          "req.body.storage.s3.secretAccessKey",
          "req.body.storage.r2.secretAccessKey"
        ],
        censor: "[REDACTED]"
      }
    },
    bodyLimit: 64 * 1024
  });

  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    max: 100,
    timeWindow: "1 minute"
  });

  app.addHook("onRequest", async (request) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
    if (maintenance.restoreInProgress) {
      throw new PublicError(
        503,
        "RESTORE_MAINTENANCE",
        "系统正在恢复备份，暂时无法执行写操作"
      );
    }
    const isRestoreRequest =
      request.method === "POST" &&
      /^\/backups\/[^/?]+\/restore(?:\?|$)/.test(request.url);
    if (!isRestoreRequest) {
      writeReleases.set(request, maintenance.beginWrite());
    }
    const origin = request.headers.origin;
    const hasSessionCookie = Boolean(request.cookies[SESSION_COOKIE]);
    const hasBrowserSignal =
      typeof request.headers["sec-fetch-site"] === "string";
    const requiresOrigin = hasSessionCookie || hasBrowserSignal;
    let normalizedOrigin: string | undefined;
    if (origin) {
      try {
        normalizedOrigin = new URL(origin).origin;
      } catch {
        throw new PublicError(403, "INVALID_ORIGIN", "请求来源未获授权");
      }
    }
    if (
      (requiresOrigin && !normalizedOrigin) ||
      (normalizedOrigin && normalizedOrigin !== appOrigin)
    ) {
      throw new PublicError(403, "INVALID_ORIGIN", "请求来源未获授权");
    }
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    if (!reply.hasHeader("cache-control")) {
      reply.header("cache-control", "no-store");
    }
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "same-origin");
    return payload;
  });

  app.addHook("onError", async (request) => {
    releaseWrite(request);
  });

  app.addHook("onTimeout", async (request) => {
    releaseWrite(request);
  });

  app.addHook("onRequestAbort", async (request) => {
    releaseWrite(request);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof PublicError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message }
      });
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      error.statusCode === 429
    ) {
      return reply.status(429).send({
        error: {
          code: "RATE_LIMITED",
          message: "操作过于频繁，请稍后再试"
        }
      });
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      error.statusCode === 400
    ) {
      return reply.status(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: "请求内容不符合要求"
        }
      });
    }
    request.log.error({ err: error }, "request failed");
    return reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "服务暂时不可用" }
    });
  });

  const createSession = async (
    userId: string,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const token = createOpaqueToken();
    const timestamp = now();
    await store.update((state) => {
      cleanExpired(state, timestamp);
      state.sessions.push({
        id: randomUUID(),
        userId,
        tokenHash: hashOpaqueToken(token),
        createdAt: timestamp.toISOString(),
        lastSeenAt: timestamp.toISOString(),
        expiresAt: new Date(
          timestamp.getTime() + SESSION_DURATION_MS
        ).toISOString(),
        userAgent: request.headers["user-agent"]?.slice(0, 300),
        ipHash: hashRequestIp(request)
      });
    });
    setSessionCookie(reply, token);
  };

  const principalForToken = (
    request: FastifyRequest,
    token: StoredApiToken,
    state: AppState
  ): Principal => {
    const timestamp = now().getTime();
    if (
      token.revokedAt ||
      (token.expiresAt &&
        new Date(token.expiresAt).getTime() <= timestamp)
    ) {
      throw new PublicError(401, "INVALID_API_TOKEN", "API Token 无效");
    }
    if (!isIpAllowed(request.ip, token.ipAllowlist ?? [])) {
      throw new PublicError(
        403,
        "TOKEN_IP_DENIED",
        "当前 IP 不在 API Token 白名单中"
      );
    }
    const headerWorkspace = request.headers["x-workspace-id"];
    if (headerWorkspace && headerWorkspace !== token.workspaceId) {
      throw new PublicError(
        403,
        "TOKEN_WORKSPACE_MISMATCH",
        "API Token 固定于创建时的工作区"
      );
    }
    const user = state.users.find((item) => item.id === token.userId);
    const membership = state.workspaceMembers.find(
      (item) =>
        item.workspaceId === token.workspaceId &&
        item.userId === token.userId
    );
    const workspace = state.workspaces.find(
      (item) => item.id === token.workspaceId
    );
    if (!user || !membership || !workspace) {
      throw new PublicError(401, "INVALID_API_TOKEN", "API Token 无效");
    }
    return {
      kind: "api-token",
      user,
      workspace,
      workspaceId: workspace.id,
      role: membership.role,
      scopes: token.scopes,
      apiToken: token
    };
  };

  const authenticatedUser = (request: FastifyRequest): Principal => {
    const authorization = request.headers.authorization;
    const state = store.snapshot();
    if (authorization !== undefined) {
      const match =
        /^Bearer (ouh_([A-Za-z0-9-]+)_[A-Za-z0-9_-]+)$/.exec(
        authorization
      );
      if (!match?.[1]) {
        throw new PublicError(401, "INVALID_API_TOKEN", "API Token 无效");
      }
      const tokenValue = match[1];
      const prefix = match[2];
      const token = state.apiTokens.find(
        (item) =>
          item.prefix === prefix &&
          item.tokenHash === hashOpaqueToken(tokenValue)
      );
      if (!token) {
        throw new PublicError(401, "INVALID_API_TOKEN", "API Token 无效");
      }
      const principal = principalForToken(request, token, state);
      principalByRequest.set(request, principal);
      return principal;
    }
    const token = request.cookies[SESSION_COOKIE];
    if (!token) {
      throw new PublicError(401, "UNAUTHENTICATED", "请先登录");
    }
    const timestamp = now().getTime();
    const session = state.sessions.find(
      (item) =>
        item.tokenHash === hashOpaqueToken(token) &&
        new Date(item.expiresAt).getTime() > timestamp
    );
    if (!session) {
      throw new PublicError(401, "UNAUTHENTICATED", "登录状态已失效");
    }
    const user = state.users.find((item) => item.id === session.userId);
    if (!user) {
      throw new PublicError(401, "UNAUTHENTICATED", "登录状态已失效");
    }
    const workspaceId =
      request.headers["x-workspace-id"]?.toString() ??
      `personal-${user.id}`;
    const membership = state.workspaceMembers.find(
      (item) =>
        item.workspaceId === workspaceId && item.userId === user.id
    );
    const workspace = state.workspaces.find(
      (item) => item.id === workspaceId
    );
    if (!membership || !workspace) {
      throw new PublicError(404, "WORKSPACE_NOT_FOUND", "工作区不存在");
    }
    const principal: Principal = {
      kind: "session",
      user,
      workspace,
      workspaceId,
      role: membership.role,
      scopes: [],
      session
    };
    principalByRequest.set(request, principal);
    return principal;
  };

  app.addHook("onResponse", async (request) => {
    releaseWrite(request);
    const principal = principalByRequest.get(request);
    if (!principal) return;
    const timestamp = now();
    const snapshot = store.snapshot();
    const sessionDue = principal.session
      ? (() => {
          const session = snapshot.sessions.find(
            (item) => item.id === principal.session!.id
          );
          return Boolean(
            session &&
              timestamp.getTime() -
                new Date(session.lastSeenAt).getTime() >=
                5 * 60 * 1000
          );
        })()
      : false;
    const tokenDue = principal.apiToken
      ? (() => {
          const token = snapshot.apiTokens.find(
            (item) => item.id === principal.apiToken!.id
          );
          return Boolean(
            token &&
              (!token.lastUsedAt ||
                timestamp.getTime() -
                  new Date(token.lastUsedAt).getTime() >=
                  5 * 60 * 1000)
          );
        })()
      : false;
    if (!sessionDue && !tokenDue) return;
    await store.update((state) => {
      if (sessionDue && principal.session) {
        const session = state.sessions.find(
          (item) => item.id === principal.session!.id
        );
        if (
          session &&
          timestamp.getTime() -
            new Date(session.lastSeenAt).getTime() >=
            5 * 60 * 1000
        ) {
          session.lastSeenAt = timestamp.toISOString();
        }
      }
      if (tokenDue && principal.apiToken) {
        const token = state.apiTokens.find(
          (item) => item.id === principal.apiToken!.id
        );
        if (
          token &&
          (!token.lastUsedAt ||
            timestamp.getTime() -
              new Date(token.lastUsedAt).getTime() >=
              5 * 60 * 1000)
        ) {
          token.lastUsedAt = timestamp.toISOString();
        }
      }
    });
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "ou-image-api",
    version: "1.2.0"
  }));

  app.get("/health/live", async () => ({
    status: "ok",
    service: "ou-image-api",
    version: "1.2.0"
  }));

  const probeDirectory = async (directory: string, label: string) => {
    await mkdir(directory, { recursive: true });
    await access(directory, constants.R_OK | constants.W_OK);
    const id = randomUUID();
    const temporaryPath = path.join(directory, `.ready-${id}.tmp`);
    const renamedPath = path.join(directory, `.ready-${id}.ok`);
    const value = Buffer.from(id);
    try {
      await writeFile(temporaryPath, value, { mode: 0o600 });
      await rename(temporaryPath, renamedPath);
      const read = await readFile(renamedPath);
      if (!read.equals(value)) throw new Error(`${label} read mismatch`);
      await unlink(renamedPath);
    } catch {
      await Promise.allSettled([
        unlink(temporaryPath),
        unlink(renamedPath)
      ]);
      throw new Error(`${label} unavailable`);
    }
  };

  app.get("/health/ready", async (_request, reply) => {
    if (maintenance.restoreInProgress) {
      return reply.status(503).send({
        status: "not-ready",
        reason: "restore-maintenance"
      });
    }
    try {
      await probeDirectory(dataDirectory, "metadata");
      await probeDirectory(path.join(dataDirectory, "storage"), "storage");
      store.snapshot();
      return {
        status: "ready",
        service: "ou-image-api",
        schemaVersion: 7
      };
    } catch {
      return reply.status(503).send({
        status: "not-ready",
        reason: "storage-unavailable"
      });
    }
  });

  app.get("/setup/status", async () => {
    const state = store.snapshot();
    return {
      setupComplete: state.setupComplete,
      site: publicSiteStatus(state.site)
    };
  });

  app.get("/setup/environment", async () => {
    let writable = true;
    try {
      await mkdir(dataDirectory, { recursive: true });
      await access(dataDirectory, constants.R_OK | constants.W_OK);
    } catch {
      writable = false;
    }
    return {
      checks: [
        {
          key: "node",
          label: "Node.js 运行时",
          status: Number.parseInt(process.versions.node, 10) >= 20 ? "pass" : "fail",
          detail: `当前版本 ${process.versions.node}`
        },
        {
          key: "data-directory",
          label: "数据目录",
          status: writable ? "pass" : "fail",
          detail: writable ? "目录可读写" : "目录不可读写"
        },
        {
          key: "crypto",
          label: "安全随机数与密码散列",
          status: "pass",
          detail: "Node.js crypto 可用"
        }
      ]
    };
  });

  app.post<{ Body: SetupBody }>(
    "/setup",
    {
      config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["siteName", "displayName", "email", "password"],
          properties: {
            siteName: { type: "string", minLength: 2, maxLength: 60 },
            displayName: { type: "string", minLength: 2, maxLength: 40 },
            email: { type: "string", minLength: 3, maxLength: 254 },
            password: { type: "string", minLength: 12, maxLength: 128 },
            registrationEnabled: { type: "boolean" },
            theme: { type: "string", enum: themeValues }
          }
        }
      }
    },
    async (request, reply) => {
      const email = assertEmail(request.body.email);
      const displayName = assertDisplayName(request.body.displayName);
      assertPassword(request.body.password);
      const siteName = request.body.siteName.trim();
      if (siteName.length < 2) {
        throw new PublicError(400, "INVALID_SITE_NAME", "站点名称至少需要 2 个字符");
      }
      const passwordHash = await hashPassword(request.body.password);
      const timestamp = now().toISOString();
      const userId = randomUUID();

      await store.update((state) => {
        if (state.setupComplete) {
          throw new PublicError(409, "ALREADY_CONFIGURED", "站点已经完成初始化");
        }
        state.setupComplete = true;
        state.site = defaultSiteConfig(siteName, {
          registrationEnabled: request.body.registrationEnabled ?? false,
          theme: request.body.theme ?? "system"
        });
        const user: StoredUser = {
          id: userId,
          email,
          displayName,
          passwordHash,
          role: "owner",
          theme: request.body.theme ?? "system",
          onboardingCompleted: false,
          failedLoginCount: 0,
          passwordUpdatedAt: timestamp,
          notificationPreferences: defaultNotificationPreferences(),
          notificationReadEventIds: [],
          createdAt: timestamp,
          updatedAt: timestamp
        };
        state.users.push(user);
        addPersonalWorkspace(state, user);
      });

      await createSession(userId, request, reply);
      return reply.status(201).send({
        site: store.snapshot().site,
        user: publicUser(
          store.snapshot().users.find((user) => user.id === userId)!
        )
      });
    }
  );

  app.post<{ Body: RegisterBody }>(
    "/auth/register",
    {
      config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["displayName", "email", "password"],
          properties: {
            displayName: { type: "string", minLength: 2, maxLength: 40 },
            email: { type: "string", minLength: 3, maxLength: 254 },
            password: { type: "string", minLength: 12, maxLength: 128 }
          }
        }
      }
    },
    async (request, reply) => {
      const state = store.snapshot();
      if (!state.setupComplete || !state.site?.registrationEnabled) {
        throw new PublicError(403, "REGISTRATION_DISABLED", "当前未开放注册");
      }
      const email = assertEmail(request.body.email);
      const displayName = assertDisplayName(request.body.displayName);
      assertPassword(request.body.password);
      if (state.users.some((user) => user.email === email)) {
        throw new PublicError(409, "EMAIL_EXISTS", "该邮箱已注册");
      }
      const passwordHash = await hashPassword(request.body.password);
      const timestamp = now().toISOString();
      const userId = randomUUID();
      await store.update((draft) => {
        if (draft.users.some((user) => user.email === email)) {
          throw new PublicError(409, "EMAIL_EXISTS", "该邮箱已注册");
        }
        const user: StoredUser = {
          id: userId,
          email,
          displayName,
          passwordHash,
          role: "member",
          theme: "system",
          onboardingCompleted: false,
          failedLoginCount: 0,
          passwordUpdatedAt: timestamp,
          notificationPreferences: defaultNotificationPreferences(),
          notificationReadEventIds: [],
          createdAt: timestamp,
          updatedAt: timestamp
        };
        draft.users.push(user);
        addPersonalWorkspace(draft, user);
      });
      await createSession(userId, request, reply);
      return reply.status(201).send({
        user: publicUser(
          store.snapshot().users.find((user) => user.id === userId)!
        )
      });
    }
  );

  const dummyPasswordHash = await hashPassword(
    "OU-Image-Invalid-Password-2026!"
  );

  app.post<{ Body: LoginBody }>(
    "/auth/login",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["email", "password"],
          properties: {
            email: { type: "string", minLength: 3, maxLength: 254 },
            password: { type: "string", minLength: 1, maxLength: 128 }
          }
        }
      }
    },
    async (request, reply) => {
      const email = normalizeEmail(request.body.email);
      const state = store.snapshot();
      if (!state.setupComplete) {
        throw new PublicError(409, "SETUP_REQUIRED", "请先完成站点初始化");
      }
      const user = state.users.find((item) => item.email === email);
      const timestamp = now();
      const locked =
        user?.lockedUntil &&
        new Date(user.lockedUntil).getTime() > timestamp.getTime();
      const valid = await verifyPassword(
        request.body.password,
        user?.passwordHash ?? dummyPasswordHash
      );

      if (!user || !valid || locked) {
        if (user && !locked) {
          await store.update((draft) => {
            const current = draft.users.find((item) => item.id === user.id);
            if (!current) return;
            current.failedLoginCount += 1;
            if (current.failedLoginCount >= 5) {
              current.lockedUntil = new Date(
                timestamp.getTime() + LOGIN_LOCK_MS
              ).toISOString();
              current.failedLoginCount = 0;
            }
            current.updatedAt = timestamp.toISOString();
          });
        }
        throw new PublicError(
          401,
          "INVALID_CREDENTIALS",
          "邮箱或密码不正确"
        );
      }

      let challengeToken: string | undefined;
      await store.update((draft) => {
        const current = draft.users.find((item) => item.id === user.id);
        if (!current) return;
        current.failedLoginCount = 0;
        delete current.lockedUntil;
        current.updatedAt = timestamp.toISOString();
        if (current.totpEnabledAt && current.totpSecretCiphertext) {
          challengeToken = createOpaqueToken();
          draft.loginChallenges = draft.loginChallenges.filter(
            (challenge) =>
              !(
                challenge.userId === current.id &&
                challenge.purpose === "login" &&
                !challenge.usedAt
              )
          );
          draft.loginChallenges.push({
            id: randomUUID(),
            userId: current.id,
            purpose: "login",
            tokenHash: hashOpaqueToken(challengeToken),
            createdAt: timestamp.toISOString(),
            expiresAt: new Date(
              timestamp.getTime() + 5 * 60 * 1000
            ).toISOString()
          });
        }
      });
      if (challengeToken) {
        return reply.status(202).send({
          requiresTwoFactor: true,
          challengeToken
        });
      }
      await createSession(user.id, request, reply);
      return { user: publicUser(user) };
    }
  );

  app.post("/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      const tokenHash = hashOpaqueToken(token);
      await store.update((state) => {
        state.sessions = state.sessions.filter(
          (session) => session.tokenHash !== tokenHash
        );
      });
    }
    clearSessionCookie(reply);
    return reply.status(204).send();
  });

  app.get("/auth/session", async (request) => {
    const principal = authenticatedUser(request);
    const state = store.snapshot();
    const workspaces = state.workspaceMembers
      .filter((membership) => membership.userId === principal.user.id)
      .map((membership) => {
        const workspace = state.workspaces.find(
          (item) => item.id === membership.workspaceId
        );
        return workspace
          ? {
              id: workspace.id,
              name: workspace.name,
              personal: workspace.personal,
              role: membership.role
            }
          : undefined;
      })
      .filter(
        (
          workspace
        ): workspace is {
          id: string;
          name: string;
          personal: boolean;
          role: typeof principal.role;
        } => Boolean(workspace)
      );
    const defaultWorkspace =
      workspaces.find((workspace) => workspace.personal) ?? workspaces[0];
    return {
      user: publicUser(principal.user),
      workspace: {
        id: principal.workspace.id,
        name: principal.workspace.name,
        role: principal.role
      },
      workspaces,
      defaultWorkspace,
      authType: principal.kind
    };
  });

  app.get("/me", async (request) => {
    const principal = authenticatedUser(request);
    return { user: publicUser(principal.user) };
  });

  app.post<{ Body: ForgotBody }>(
    "/auth/forgot-password",
    {
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["email"],
          properties: {
            email: { type: "string", minLength: 3, maxLength: 254 }
          }
        }
      }
    },
    async (request) => {
      const email = normalizeEmail(request.body.email);
      const user = store.snapshot().users.find((item) => item.email === email);
      let resetToken: string | undefined;
      if (user) {
        resetToken = createOpaqueToken();
        const timestamp = now();
        await store.update((state) => {
          state.passwordResets = state.passwordResets.filter(
            (item) => item.userId !== user.id
          );
          state.passwordResets.push({
            id: randomUUID(),
            userId: user.id,
            tokenHash: hashOpaqueToken(resetToken!),
            createdAt: timestamp.toISOString(),
            expiresAt: new Date(
              timestamp.getTime() + RESET_DURATION_MS
            ).toISOString()
          });
        });
      }
      return {
        message: "如果该邮箱存在，我们已创建密码重置请求",
        ...(resetToken && exposeDevelopmentResetToken
          ? { developmentResetToken: resetToken }
          : {})
      };
    }
  );

  app.post<{ Body: ResetBody }>(
    "/auth/reset-password",
    {
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["token", "password"],
          properties: {
            token: { type: "string", minLength: 20, maxLength: 200 },
            password: { type: "string", minLength: 12, maxLength: 128 }
          }
        }
      }
    },
    async (request) => {
      assertPassword(request.body.password);
      const timestamp = now();
      const tokenHash = hashOpaqueToken(request.body.token);
      const state = store.snapshot();
      const reset = state.passwordResets.find(
        (item) =>
          item.tokenHash === tokenHash &&
          !item.usedAt &&
          new Date(item.expiresAt).getTime() > timestamp.getTime()
      );
      if (!reset) {
        throw new PublicError(
          400,
          "INVALID_RESET_TOKEN",
          "重置链接无效或已经过期"
        );
      }
      const passwordHash = await hashPassword(request.body.password);
      await store.update((draft) => {
        const currentReset = draft.passwordResets.find(
          (item) => item.id === reset.id
        );
        const user = draft.users.find((item) => item.id === reset.userId);
        if (!currentReset || !user || currentReset.usedAt) {
          throw new PublicError(
            400,
            "INVALID_RESET_TOKEN",
            "重置链接无效或已经过期"
          );
        }
        currentReset.usedAt = timestamp.toISOString();
        user.passwordHash = passwordHash;
        user.passwordUpdatedAt = timestamp.toISOString();
        user.failedLoginCount = 0;
        delete user.lockedUntil;
        user.updatedAt = timestamp.toISOString();
        draft.sessions = draft.sessions.filter(
          (session) => session.userId !== user.id
        );
      });
      return { message: "密码已更新，请使用新密码登录" };
    }
  );

  app.patch<{ Body: ProfileBody }>(
    "/me",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            displayName: { type: "string", minLength: 2, maxLength: 40 },
            theme: { type: "string", enum: themeValues },
            onboardingCompleted: { type: "boolean" }
          }
        }
      }
    },
    async (request) => {
      const { user } = authenticatedUser(request);
      const timestamp = now().toISOString();
      await store.update((state) => {
        const current = state.users.find((item) => item.id === user.id);
        if (!current) {
          throw new PublicError(401, "UNAUTHENTICATED", "登录状态已失效");
        }
        if (request.body.displayName !== undefined) {
          current.displayName = assertDisplayName(request.body.displayName);
        }
        if (request.body.theme !== undefined) current.theme = request.body.theme;
        if (request.body.onboardingCompleted !== undefined) {
          current.onboardingCompleted = request.body.onboardingCompleted;
        }
        current.updatedAt = timestamp;
      });
      const updated = store.snapshot().users.find((item) => item.id === user.id)!;
      return { user: publicUser(updated) };
    }
  );

  await registerUploadRoutes(app, {
    store,
    dataDirectory,
    now,
    authenticate: authenticatedUser
  });

  registerWorkspaceSecurityRoutes(app, {
    store,
    now,
    authenticate: authenticatedUser,
    createSession
  });
  registerOperationsRoutes(app, {
    store,
    dataDirectory,
    appOrigin,
    now,
    authenticate: authenticatedUser
  });

  registerInfrastructureRoutes(app, {
    store,
    dataDirectory,
    now,
    authenticate: authenticatedUser,
    maintenance
  });

  return app;
}
