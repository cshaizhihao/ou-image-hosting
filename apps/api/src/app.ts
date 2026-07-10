import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { access, constants, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  normalizeEmail,
  validatePassword,
  verifyPassword
} from "./security.js";
import {
  AppStore,
  type AppState,
  type StoredUser,
  type ThemePreference
} from "./store.js";

const SESSION_COOKIE = "ou_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_DURATION_MS = 30 * 60 * 1000;
const LOGIN_LOCK_MS = 10 * 60 * 1000;

class PublicError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

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

function publicUser(user: StoredUser) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    theme: user.theme,
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
  const appOrigin =
    options.appOrigin ?? process.env.APP_ORIGIN ?? "http://localhost:3000";
  const exposeDevelopmentResetToken =
    options.exposeDevelopmentResetToken ??
    (process.env.NODE_ENV !== "production" &&
      process.env.EXPOSE_DEVELOPMENT_RESET_TOKEN === "true");
  const now = options.now ?? (() => new Date());

  await store.initialize();

  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === "production" ? "info" : "warn",
      redact: {
        paths: [
          "req.headers.cookie",
          "req.headers.authorization",
          "req.body.password",
          "req.body.token"
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
    const origin = request.headers.origin;
    if (origin && origin !== appOrigin) {
      throw new PublicError(403, "INVALID_ORIGIN", "请求来源未获授权");
    }
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "same-origin");
    return payload;
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
        userAgent: request.headers["user-agent"]?.slice(0, 300)
      });
    });
    setSessionCookie(reply, token);
  };

  const authenticatedUser = (request: FastifyRequest) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) {
      throw new PublicError(401, "UNAUTHENTICATED", "请先登录");
    }
    const state = store.snapshot();
    const timestamp = now().getTime();
    const session = state.sessions.find(
      (item) =>
        item.tokenHash === hashOpaqueToken(token) &&
        new Date(item.expiresAt).getTime() > timestamp
    );
    const user = session
      ? state.users.find((item) => item.id === session.userId)
      : undefined;
    if (!user) {
      throw new PublicError(401, "UNAUTHENTICATED", "登录状态已失效");
    }
    return { user, session };
  };

  app.get("/health", async () => ({
    status: "ok",
    service: "ou-image-api",
    version: "0.3.0"
  }));

  app.get("/setup/status", async () => {
    const state = store.snapshot();
    return {
      setupComplete: state.setupComplete,
      site: state.site
        ? {
            siteName: state.site.siteName,
            registrationEnabled: state.site.registrationEnabled,
            defaultStorage: state.site.defaultStorage,
            theme: state.site.theme
          }
        : null
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
        state.site = {
          siteName,
          registrationEnabled: request.body.registrationEnabled ?? false,
          defaultStorage: "local",
          theme: request.body.theme ?? "system"
        };
        state.users.push({
          id: userId,
          email,
          displayName,
          passwordHash,
          role: "owner",
          theme: request.body.theme ?? "system",
          onboardingCompleted: false,
          failedLoginCount: 0,
          createdAt: timestamp,
          updatedAt: timestamp
        });
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
        draft.users.push({
          id: userId,
          email,
          displayName,
          passwordHash,
          role: "member",
          theme: "system",
          onboardingCompleted: false,
          failedLoginCount: 0,
          createdAt: timestamp,
          updatedAt: timestamp
        });
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

      await store.update((draft) => {
        const current = draft.users.find((item) => item.id === user.id);
        if (!current) return;
        current.failedLoginCount = 0;
        delete current.lockedUntil;
        current.updatedAt = timestamp.toISOString();
      });
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
    const { user } = authenticatedUser(request);
    return { user: publicUser(user) };
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

  return app;
}
