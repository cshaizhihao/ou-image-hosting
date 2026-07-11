import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import {
  access,
  constants,
  mkdir,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { isIP } from "node:net";
import sharp from "sharp";
import {
  addAuditEvent,
  hashRequestIp,
  requireCapability,
  requireSession,
  type Principal
} from "./access.js";
import { PublicError } from "./errors.js";
import { requireBackofficeAccess } from "./site-access.js";
import {
  calculateImageStorageBytes,
  defaultSiteConfig,
  normalizePublicFeatureCards,
  defaultWorkspaceSettings,
  type AppState,
  type AppStore,
  type StoredBackup,
  type StoredStorageMigration,
  type StoredSystemStatusResult,
  type WorkspaceSettings
} from "./store.js";

type Options = {
  store: AppStore;
  dataDirectory: string;
  appOrigin: string;
  now: () => Date;
  authenticate: (request: FastifyRequest) => Principal;
};

type AnalyticsRange = "7d" | "30d" | "90d";
type JobKind = "backup" | "storage-migration";

const GLOBAL_UPLOAD_HARD_CAP = 20 * 1024 * 1024;
const formats = ["jpeg", "png", "webp", "gif", "avif", "heic", "heif"] as const;
const themes = ["light", "dark", "system"] as const;
const jobParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "id"],
  properties: {
    kind: {
      type: "string",
      enum: ["backup", "storage-migration"]
    },
    id: { type: "string", minLength: 1, maxLength: 100 }
  }
} as const;

function requireSiteOwner(
  request: FastifyRequest,
  authenticate: Options["authenticate"]
) {
  const principal = authenticate(request);
  requireSession(principal);
  if (principal.user.role !== "owner") {
    throw new PublicError(
      403,
      "OWNER_REQUIRED",
      "仅站点所有者可执行该操作"
    );
  }
  return principal;
}

function requireSiteBackoffice(
  request: FastifyRequest,
  authenticate: Options["authenticate"],
  state: AppState
) {
  const principal = authenticate(request);
  requireSession(principal);
  requireBackofficeAccess(state, principal);
  return principal;
}

function normalizePublicUploadIp(value: string) {
  const normalized = value.trim().toLowerCase();
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const result = mapped ?? normalized;
  if (isIP(result) === 0) {
    throw new PublicError(400, "INVALID_IP_ADDRESS", "请输入有效的 IPv4 或 IPv6 地址");
  }
  return result;
}

function assertTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(
      new Date()
    );
  } catch {
    throw new PublicError(400, "INVALID_TIMEZONE", "时区名称无效");
  }
}

function settingsFor(state: AppState, workspaceId: string) {
  return (
    state.workspaceSettings.find(
      (settings) => settings.workspaceId === workspaceId
    ) ?? defaultWorkspaceSettings(workspaceId)
  );
}

function publicWorkspaceSettings(state: AppState, workspaceId: string) {
  const settings = settingsFor(state, workspaceId);
  return {
    uploadMaxBytes: settings.uploadMaxBytes,
    allowedFormats: settings.allowedFormats,
    processingQuality: settings.processingQuality,
    thumbnailWidth: settings.thumbnailWidth,
    timezone: settings.timezone,
    locale: settings.locale,
    defaultAppearance: settings.defaultAppearance,
    effectiveUploadMaxBytes: Math.min(
      GLOBAL_UPLOAD_HARD_CAP,
      settings.uploadMaxBytes
    )
  };
}

function publicSiteSettings(site: AppState["site"]) {
  if (!site) {
    throw new PublicError(503, "SITE_NOT_READY", "站点尚未完成初始化");
  }
  return {
    siteName: site.siteName,
    siteDescription: site.siteDescription,
    siteLogoUrl: site.siteLogoUrl,
    registrationEnabled: site.registrationEnabled,
    publicUploadEnabled: site.publicUploadEnabled,
    publicUploadRequiresLogin: site.publicUploadRequiresLogin,
    publicGalleryEnabled: site.publicGalleryEnabled,
    publicGalleryShowUploader: site.publicGalleryShowUploader,
    publicGalleryShowFileName: site.publicGalleryShowFileName,
    publicGalleryShowUploadTime: site.publicGalleryShowUploadTime,
    publicUploadDefaultPublic: site.publicUploadDefaultPublic,
    publicUploadAnonymousPerMinute: site.publicUploadAnonymousPerMinute,
    publicUploadAnonymousPerDay: site.publicUploadAnonymousPerDay,
    publicUploadAnonymousDailyBytes: site.publicUploadAnonymousDailyBytes,
    publicUploadAuthenticatedPerMinute: site.publicUploadAuthenticatedPerMinute,
    publicUploadAuthenticatedPerDay: site.publicUploadAuthenticatedPerDay,
    publicUploadAuthenticatedDailyBytes: site.publicUploadAuthenticatedDailyBytes,
    publicUploadHumanVerificationEnabled: site.publicUploadHumanVerificationEnabled,
    publicUploadLivePhotoEnabled: site.publicUploadLivePhotoEnabled,
    publicUploadBlockedIps: site.publicUploadBlockedIps,
    publicHeroTitle: site.publicHeroTitle,
    publicHeroDescription: site.publicHeroDescription,
    publicFeatureCards: site.publicFeatureCards,
    loginEyebrow: site.loginEyebrow,
    loginHeroTitle: site.loginHeroTitle,
    loginHeroDescription: site.loginHeroDescription,
    theme: site.theme,
    accentPreset: site.accentPreset
  };
}

function dateKey(timestamp: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(timestamp);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function naturalDates(timestamp: Date, days: number, timezone: string) {
  const [year, month, day] = dateKey(timestamp, timezone)
    .split("-")
    .map(Number);
  return Array.from({ length: days }, (_item, index) =>
    new Date(
      Date.UTC(year!, month! - 1, day! - (days - index - 1))
    )
      .toISOString()
      .slice(0, 10)
  );
}

function publicBackupJob(backup: StoredBackup) {
  return {
    id: backup.id,
    kind: "backup" as const,
    label: `备份 ${backup.id.slice(0, 8)}`,
    status: backup.status,
    createdAt: backup.createdAt,
    completedAt: backup.completedAt,
    retryable:
      backup.status === "failed" &&
      !backup.retriedAt &&
      !backup.retryInProgress,
    errorCode: backup.status === "failed" ? "BACKUP_FAILED" : undefined
  };
}

function publicMigrationJob(migration: StoredStorageMigration) {
  return {
    id: migration.id,
    kind: "storage-migration" as const,
    label: `存储迁移 ${migration.source} → ${migration.target}`,
    status: migration.status,
    createdAt: migration.createdAt,
    completedAt: migration.completedAt,
    retryable:
      migration.status === "failed" &&
      !migration.retriedAt &&
      !migration.retryInProgress,
    progress: {
      completed: migration.completed,
      total: migration.total,
      failed: migration.failed
    },
    errorCode:
      migration.status === "failed"
        ? "STORAGE_MIGRATION_FAILED"
        : undefined
  };
}

function statusEvents(history: StoredSystemStatusResult[]) {
  return history.map((result) => ({
    id: result.id,
    type: "system.check" as const,
    result:
      result.overall === "operational"
        ? ("success" as const)
        : result.overall === "degraded"
          ? ("degraded" as const)
          : ("failure" as const),
    message:
      result.overall === "operational"
        ? "系统检查完成"
        : result.overall === "degraded"
          ? "系统检查发现部分服务降级"
          : "系统检查发现核心服务不可用",
    createdAt: result.checkedAt
  }));
}

function baselineServices(): StoredSystemStatusResult["services"] {
  return [
    {
      id: "metadata-store",
      label: "元数据存储",
      status: "unknown",
      mode: "single-process-json",
      inUse: true,
      checked: false,
      detail: "尚未执行检查",
      latencyMs: 0
    },
    {
      id: "local-storage",
      label: "本地存储",
      status: "unknown",
      mode: "filesystem",
      inUse: true,
      checked: false,
      detail: "尚未执行检查",
      latencyMs: 0
    },
    {
      id: "image-processing",
      label: "图片处理",
      status: "unknown",
      mode: "sharp-in-process",
      inUse: true,
      checked: false,
      detail: "尚未执行检查",
      latencyMs: 0
    },
    {
      id: "queue",
      label: "任务队列",
      status: "operational",
      mode: "inline-single-process",
      inUse: true,
      checked: true,
      detail: "任务在当前进程内同步执行",
      latencyMs: 0
    },
    {
      id: "postgresql",
      label: "PostgreSQL",
      status: process.env.DATABASE_URL
        ? "configured-not-in-use"
        : "not-configured",
      mode: "external",
      inUse: false,
      checked: false,
      detail: process.env.DATABASE_URL
        ? "已配置，但当前部署未使用"
        : "未配置",
      latencyMs: 0
    },
    {
      id: "redis",
      label: "Redis",
      status: process.env.REDIS_URL
        ? "configured-not-in-use"
        : "not-configured",
      mode: "external",
      inUse: false,
      checked: false,
      detail: process.env.REDIS_URL
        ? "已配置，但当前部署未使用"
        : "未配置",
      latencyMs: 0
    },
    {
      id: "cdn",
      label: "CDN",
      status: process.env.CDN_BASE_URL ? "unknown" : "not-configured",
      mode: "external",
      inUse: Boolean(process.env.CDN_BASE_URL),
      checked: false,
      detail: process.env.CDN_BASE_URL ? "尚未执行检查" : "未配置",
      latencyMs: 0
    }
  ];
}

function publicStatus(history: StoredSystemStatusResult[]) {
  const latest = history[0];
  if (!latest) {
    return {
      checkedAt: null,
      overall: "unknown" as const,
      services: baselineServices(),
      events: []
    };
  }
  return {
    checkedAt: latest.checkedAt,
    overall: latest.overall,
    services: latest.services,
    events: statusEvents(history)
  };
}

async function timedService(
  input: {
    id: string;
    label: string;
    mode: string;
    inUse: boolean;
  },
  check: () => Promise<string | undefined>
): Promise<StoredSystemStatusResult["services"][number]> {
  const started = Date.now();
  try {
    const detail = await check();
    return {
      ...input,
      status: "operational",
      checked: true,
      detail,
      latencyMs: Date.now() - started
    };
  } catch {
    return {
      ...input,
      status: "down",
      checked: true,
      detail: `${input.label} check failed`,
      latencyMs: Date.now() - started
    };
  }
}

async function performSystemCheck(
  store: AppStore,
  dataDirectory: string,
  timestamp: Date
): Promise<StoredSystemStatusResult> {
  const started = Date.now();
  const storageRoot = path.join(dataDirectory, "storage");
  const core = await Promise.all([
    timedService(
      {
        id: "metadata-store",
        label: "元数据存储",
        mode: "single-process-json",
        inUse: true
      },
      async () => {
        const probeId = randomUUID();
        const temporaryPath = path.join(
          dataDirectory,
          `.metadata-probe-${probeId}.tmp`
        );
        const renamedPath = path.join(
          dataDirectory,
          `.metadata-probe-${probeId}.ok`
        );
        await mkdir(dataDirectory, { recursive: true });
        try {
          await writeFile(temporaryPath, "ok", {
            encoding: "utf8",
            mode: 0o600
          });
          await rename(temporaryPath, renamedPath);
          await unlink(renamedPath);
          return `JSON 元数据结构 v${store.snapshot().schemaVersion}，持久化写入可用`;
        } catch {
          await Promise.allSettled([
            unlink(temporaryPath),
            unlink(renamedPath)
          ]);
          throw new Error("metadata persistence unavailable");
        }
      }
    ),
    timedService(
      {
        id: "local-storage",
        label: "本地存储",
        mode: "filesystem",
        inUse: true
      },
      async () => {
        await mkdir(storageRoot, { recursive: true });
        await access(storageRoot, constants.R_OK | constants.W_OK);
        return "可读取且可写入";
      }
    ),
    timedService(
      {
        id: "image-processing",
        label: "图片处理",
        mode: "sharp-in-process",
        inUse: true
      },
      async () => {
        await sharp({
          create: {
            width: 1,
            height: 1,
            channels: 3,
            background: "#000000"
          }
        })
          .png()
          .toBuffer();
        return "Sharp 处理管线可用";
      }
    )
  ]);
  const queue: StoredSystemStatusResult["services"][number] = {
    id: "queue",
    label: "任务队列",
    status: "operational",
    mode: "inline-single-process",
    inUse: true,
    checked: true,
    detail: "任务在当前进程内同步执行",
    latencyMs: 0
  };
  const postgresql: StoredSystemStatusResult["services"][number] = {
    id: "postgresql",
    label: "PostgreSQL",
    status: process.env.DATABASE_URL
      ? "configured-not-in-use"
      : "not-configured",
    mode: "external",
    inUse: false,
    checked: false,
    detail: process.env.DATABASE_URL
      ? "已配置，但当前部署使用 JSON 元数据存储"
      : "未配置",
    latencyMs: 0
  };
  const redis: StoredSystemStatusResult["services"][number] = {
    id: "redis",
    label: "Redis",
    status: process.env.REDIS_URL
      ? "configured-not-in-use"
      : "not-configured",
    mode: "external",
    inUse: false,
    checked: false,
    detail: process.env.REDIS_URL
      ? "已配置，但当前部署使用进程内同步任务"
      : "未配置",
    latencyMs: 0
  };
  let cdn: StoredSystemStatusResult["services"][number] = {
    id: "cdn",
    label: "CDN",
    status: "not-configured",
    mode: "external",
    inUse: false,
    checked: false,
    detail: "未配置",
    latencyMs: 0
  };
  if (process.env.CDN_BASE_URL) {
    const cdnStarted = Date.now();
    try {
      const url = new URL(process.env.CDN_BASE_URL);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      ) {
        throw new Error("invalid");
      }
      const response = await fetch(url, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(2000)
      });
      cdn = {
        ...cdn,
        status: response.status < 500 ? "reachable" : "degraded",
        inUse: true,
        checked: true,
        detail:
          response.status < 500 ? "CDN 端点可访问" : "CDN 端点返回错误",
        latencyMs: Date.now() - cdnStarted
      };
    } catch {
      cdn = {
        ...cdn,
        status: "degraded",
        inUse: true,
        checked: true,
        detail: "CDN 端点不可访问或配置无效",
        latencyMs: Date.now() - cdnStarted
      };
    }
  }
  const services = [...core, queue, postgresql, redis, cdn];
  const coreDown = core.some((service) => service.status === "down");
  return {
    id: randomUUID(),
    checkedAt: timestamp.toISOString(),
    overall: coreDown
      ? "down"
      : cdn.status === "degraded"
        ? "degraded"
        : "operational",
    latencyMs: Date.now() - started,
    services
  };
}

export function registerOperationsRoutes(
  app: FastifyInstance,
  options: Options
) {
  const { store, dataDirectory, appOrigin, now, authenticate } = options;
  let statusCheckInFlight = false;
  let jobRetryInFlight = false;

  app.get<{ Querystring: { range?: AnalyticsRange } }>(
    "/analytics",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            range: { type: "string", enum: ["7d", "30d", "90d"] }
          }
        }
      }
    },
    async (request) => {
      const principal = authenticate(request);
      requireBackofficeAccess(store.snapshot(), principal);
      requireCapability(principal, "read", ["analytics:read"]);
      const range = request.query.range ?? "30d";
      const days = Number(range.slice(0, -1));
      const timestamp = now();
      const state = store.snapshot();
      const settings = settingsFor(state, principal.workspaceId);
      const dates = naturalDates(timestamp, days, settings.timezone);
      const dateSet = new Set(dates);
      const images = state.images.filter(
        (image) => image.workspaceId === principal.workspaceId
      );
      const activeImages = images.filter((image) => !image.deletedAt);
      const daily = state.analyticsDaily.filter(
        (item) =>
          item.workspaceId === principal.workspaceId &&
          dateSet.has(item.date)
      );
      const dailyByDate = new Map(daily.map((item) => [item.date, item]));
      const viewCounts = new Map<string, number>();
      for (const item of daily) {
        for (const [imageId, count] of Object.entries(item.imageShareViews)) {
          viewCounts.set(imageId, (viewCounts.get(imageId) ?? 0) + count);
        }
      }
      const totalAccessCount = state.imageShares
        .filter((share) => share.workspaceId === principal.workspaceId)
        .reduce((total, share) => total + share.accessCount, 0);
      const totalTracked = state.analyticsDaily
        .filter((item) => item.workspaceId === principal.workspaceId)
        .reduce((total, item) => total + item.shareViews, 0);
      const coverage = state.analyticsCoverage.find(
        (item) => item.workspaceId === principal.workspaceId
      );
      const series = dates.map((date) => ({
        date,
        uploads: dailyByDate.get(date)?.uploads ?? 0,
        uploadedLogicalBytes:
          dailyByDate.get(date)?.uploadedLogicalBytes ?? 0,
        shareViews: dailyByDate.get(date)?.shareViews ?? 0
      }));
      const response = {
        range,
        summary: {
          imageCount: activeImages.length,
          deduplicatedOriginalBytes: calculateImageStorageBytes(images),
          uploadCount: daily.reduce(
            (total, item) => total + item.uploads,
            0
          ),
          shareViews: daily.reduce(
            (total, item) => total + item.shareViews,
            0
          ),
          unattributedShareViews: Math.max(
            0,
            totalAccessCount - totalTracked
          )
        },
        series,
        formatDistribution: formats
          .map((format) => {
            const matching = activeImages.filter(
              (image) => image.format === format
            );
            return {
              format,
              count: matching.length,
              activeCurrentVersionBytes: matching.reduce(
                (total, image) => total + image.size,
                0
              )
            };
          })
          .filter((item) => item.count > 0),
        topImages: activeImages
          .map((image) => ({
            id: image.id,
            name: image.name,
            format: image.format,
            size: image.size,
            shareViews: viewCounts.get(image.id) ?? 0,
            createdAt: image.createdAt
          }))
          .sort(
            (a, b) =>
              b.shareViews - a.shareViews ||
              b.createdAt.localeCompare(a.createdAt)
          )
          .slice(0, 5),
        dataCoverage: {
          uploads: coverage?.uploads ?? {
            status: "partial" as const,
            trackingStartedAt: settings.updatedAt
          },
          shareViews: {
            status:
              totalAccessCount > totalTracked
                ? ("partial" as const)
                : (coverage?.shareViews.status ?? "partial"),
            trackingStartedAt:
              coverage?.shareViews.trackingStartedAt ??
              settings.updatedAt,
            unattributedCount: Math.max(0, totalAccessCount - totalTracked)
          }
        }
      };
      await store.update((draft) => {
        addAuditEvent(draft, {
          principal,
          action: "analytics.read",
          result: "success",
          resourceType: "analytics",
          metadata: { range },
          ipHash: hashRequestIp(request),
          createdAt: timestamp.toISOString()
        });
      });
      return response;
    }
  );

  app.get("/system/status", async (request) => {
    requireSiteOwner(request, authenticate);
    const history = store
      .snapshot()
      .systemStatusHistory.slice()
      .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt));
    return publicStatus(history);
  });

  app.post(
    "/system/status/check",
    { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } },
    async (request) => {
      const principal = requireSiteOwner(request, authenticate);
      const timestamp = now();
      const latest = store
        .snapshot()
        .systemStatusHistory.slice()
        .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0];
      if (
        latest &&
        timestamp.getTime() - new Date(latest.checkedAt).getTime() < 5000
      ) {
        throw new PublicError(
          429,
          "SYSTEM_CHECK_COOLDOWN",
          "系统检查冷却中"
        );
      }
      if (statusCheckInFlight) {
        throw new PublicError(
          409,
          "SYSTEM_CHECK_IN_PROGRESS",
          "系统检查正在进行"
        );
      }
      statusCheckInFlight = true;
      try {
        const result = await performSystemCheck(
          store,
          dataDirectory,
          timestamp
        );
        await store.update((state) => {
          state.systemStatusHistory = [
            result,
            ...state.systemStatusHistory
          ]
            .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))
            .slice(0, 20);
          addAuditEvent(state, {
            principal,
            global: true,
            action: "system.status.check",
            result:
              result.overall === "down" ? "failure" : "success",
            resourceType: "system",
            resourceId: result.id,
            metadata: { overall: result.overall },
            ipHash: hashRequestIp(request),
            createdAt: timestamp.toISOString()
          });
        });
        return publicStatus(
          store
            .snapshot()
            .systemStatusHistory.slice()
            .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))
        );
      } finally {
        statusCheckInFlight = false;
      }
    }
  );

  app.get("/jobs", async (request) => {
    requireSiteOwner(request, authenticate);
    const state = store.snapshot();
    const jobs = [
      ...state.backups.map(publicBackupJob),
      ...state.storageMigrations.map(publicMigrationJob)
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { jobs };
  });

  app.post<{
    Params: { kind: JobKind; id: string };
  }>(
    "/jobs/:kind/:id/retry",
    {
      config: { rateLimit: { max: 3, timeWindow: "1 minute" } },
      schema: { params: jobParamsSchema }
    },
    async (request) => {
      const principal = requireSiteOwner(request, authenticate);
      if (jobRetryInFlight) {
        throw new PublicError(
          409,
          "JOB_RETRY_IN_PROGRESS",
          "已有任务正在重试"
        );
      }
      jobRetryInFlight = true;
      const timestamp = now();
      try {
        const retry = await store.update((state) => {
          const record =
            request.params.kind === "backup"
              ? state.backups.find((item) => item.id === request.params.id)
              : state.storageMigrations.find(
                  (item) => item.id === request.params.id
                );
          if (!record) {
            throw new PublicError(404, "JOB_NOT_FOUND", "任务不存在");
          }
          if (record.status !== "failed") {
            throw new PublicError(
              409,
              "JOB_NOT_FAILED",
              "只有失败任务可以重试"
            );
          }
          if (record.retryInProgress || record.retriedAt) {
            throw new PublicError(
              409,
              "JOB_ALREADY_RETRIED",
              "该失败任务已经重试"
            );
          }
          if (
            record.completedAt &&
            timestamp.getTime() -
              new Date(record.completedAt).getTime() <
              5000
          ) {
            throw new PublicError(
              429,
              "JOB_RETRY_COOLDOWN",
              "任务重试冷却中"
            );
          }
          record.retryInProgress = true;
          return request.params.kind === "backup"
            ? { kind: "backup" as const }
            : {
                kind: "storage-migration" as const,
                source: (record as StoredStorageMigration).source,
                target: (record as StoredStorageMigration).target
              };
        });
        const headers: Record<string, string> = {
          origin: request.headers.origin ?? appOrigin
        };
        if (request.headers.cookie) headers.cookie = request.headers.cookie;
        const response =
          retry.kind === "backup"
            ? await app.inject({
                method: "POST",
                url: "/backups",
                headers
              })
            : await app.inject({
                method: "POST",
                url: "/storage/migrations",
                headers,
                payload: { source: retry.source, target: retry.target }
              });
        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw new PublicError(
            409,
            "JOB_RETRY_FAILED",
            "任务重试未能成功启动"
          );
        }
        const payload = response.json();
        const job =
          retry.kind === "backup"
            ? publicBackupJob(payload.backup)
            : publicMigrationJob(payload.migration);
        await store.update((state) => {
          const record =
            request.params.kind === "backup"
              ? state.backups.find((item) => item.id === request.params.id)
              : state.storageMigrations.find(
                  (item) => item.id === request.params.id
                );
          if (record) {
            record.retryInProgress = false;
            record.retriedAt = timestamp.toISOString();
          }
          state.systemEvents.push({
            id: randomUUID(),
            type: "job.retry",
            resourceId: request.params.id,
            metadata: {
              kind: request.params.kind,
              replacementId: job.id
            },
            createdAt: timestamp.toISOString()
          });
          state.systemEvents = state.systemEvents
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 500);
          addAuditEvent(state, {
            principal,
            global: true,
            action: "job.retry",
            result: "success",
            resourceType: "job",
            resourceId: request.params.id,
            metadata: {
              kind: request.params.kind,
              replacementId: job.id
            },
            ipHash: hashRequestIp(request),
            createdAt: timestamp.toISOString()
          });
        });
        return { job };
      } catch (error) {
        await store.update((state) => {
          const record =
            request.params.kind === "backup"
              ? state.backups.find((item) => item.id === request.params.id)
              : state.storageMigrations.find(
                  (item) => item.id === request.params.id
                );
          if (record) record.retryInProgress = false;
        });
        throw error;
      } finally {
        jobRetryInFlight = false;
      }
    }
  );

  app.get("/site/settings", async (request) => {
    const principal = requireSiteOwner(request, authenticate);
    const site = store.snapshot().site!;
    await store.update((state) => {
      addAuditEvent(state, {
        principal,
        global: true,
        action: "site.settings.read",
        result: "success",
        resourceType: "site",
        ipHash: hashRequestIp(request),
        createdAt: now().toISOString()
      });
    });
    return {
      settings: publicSiteSettings(site)
    };
  });

  app.patch<{
    Body: {
      siteName?: string;
      siteDescription?: string;
      siteLogoUrl?: string;
      registrationEnabled?: boolean;
      publicUploadEnabled?: boolean;
      publicUploadRequiresLogin?: boolean;
      publicGalleryEnabled?: boolean;
      publicGalleryShowUploader?: boolean;
      publicGalleryShowFileName?: boolean;
      publicGalleryShowUploadTime?: boolean;
      publicUploadDefaultPublic?: boolean;
      publicUploadAnonymousPerMinute?: number;
      publicUploadAnonymousPerDay?: number;
      publicUploadAnonymousDailyBytes?: number;
      publicUploadAuthenticatedPerMinute?: number;
      publicUploadAuthenticatedPerDay?: number;
      publicUploadAuthenticatedDailyBytes?: number;
      publicUploadHumanVerificationEnabled?: boolean;
      publicUploadLivePhotoEnabled?: boolean;
      publicHeroTitle?: string;
      publicHeroDescription?: string;
      publicFeatureCards?: unknown;
      loginEyebrow?: string;
      loginHeroTitle?: string;
      loginHeroDescription?: string;
      theme?: "light" | "dark" | "system";
      accentPreset?: "coral" | "forest" | "ocean" | "amber";
    };
  }>(
    "/site/settings",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            siteName: { type: "string", minLength: 2, maxLength: 60 },
            siteDescription: { type: "string", maxLength: 500 },
            siteLogoUrl: { type: "string", minLength: 1, maxLength: 500 },
            registrationEnabled: { type: "boolean" },
            publicUploadEnabled: { type: "boolean" },
            publicUploadRequiresLogin: { type: "boolean" },
            publicGalleryEnabled: { type: "boolean" },
            publicGalleryShowUploader: { type: "boolean" },
            publicGalleryShowFileName: { type: "boolean" },
            publicGalleryShowUploadTime: { type: "boolean" },
            publicUploadDefaultPublic: { type: "boolean" },
            publicUploadAnonymousPerMinute: { type: "integer", minimum: 1, maximum: 1000 },
            publicUploadAnonymousPerDay: { type: "integer", minimum: 1, maximum: 10000 },
            publicUploadAnonymousDailyBytes: { type: "integer", minimum: 1048576, maximum: 1099511627776 },
            publicUploadAuthenticatedPerMinute: { type: "integer", minimum: 1, maximum: 1000 },
            publicUploadAuthenticatedPerDay: { type: "integer", minimum: 1, maximum: 10000 },
            publicUploadAuthenticatedDailyBytes: { type: "integer", minimum: 1048576, maximum: 1099511627776 },
            publicUploadHumanVerificationEnabled: { type: "boolean" },
            publicUploadLivePhotoEnabled: { type: "boolean" },
            publicHeroTitle: { type: "string", minLength: 1, maxLength: 80 },
            publicHeroDescription: { type: "string", minLength: 1, maxLength: 260 },
            publicFeatureCards: {
              type: "array",
              minItems: 3,
              maxItems: 3,
              items: {
                type: "object",
                required: ["icon", "title", "description"],
                additionalProperties: false,
                properties: {
                  icon: {
                    type: "string",
                    enum: ["image", "shield", "check", "sparkles", "heart", "folder"]
                  },
                  title: { type: "string", minLength: 1, maxLength: 24 },
                  description: { type: "string", minLength: 1, maxLength: 80 }
                }
              }
            },
            loginEyebrow: { type: "string", minLength: 1, maxLength: 80 },
            loginHeroTitle: { type: "string", minLength: 1, maxLength: 80 },
            loginHeroDescription: { type: "string", minLength: 1, maxLength: 260 },
            theme: { type: "string", enum: themes },
            accentPreset: {
              type: "string",
              enum: ["coral", "forest", "ocean", "amber"]
            }
          }
        }
      }
    },
    async (request) => {
      const principal = requireSiteOwner(request, authenticate);
      const timestamp = now().toISOString();
      await store.update((state) => {
        const site = state.site!;
        if (request.body.siteName !== undefined) {
          site.siteName = request.body.siteName.trim();
        }
        if (request.body.siteDescription !== undefined) {
          site.siteDescription = request.body.siteDescription.trim();
        }
        if (request.body.siteLogoUrl !== undefined) {
          site.siteLogoUrl = request.body.siteLogoUrl.trim();
        }
        if (request.body.registrationEnabled !== undefined) {
          site.registrationEnabled = request.body.registrationEnabled;
        }
        if (request.body.publicUploadEnabled !== undefined) {
          site.publicUploadEnabled = request.body.publicUploadEnabled;
        }
        if (request.body.publicUploadRequiresLogin !== undefined) {
          site.publicUploadRequiresLogin =
            request.body.publicUploadRequiresLogin;
        }
        if (request.body.publicGalleryEnabled !== undefined) {
          site.publicGalleryEnabled = request.body.publicGalleryEnabled;
        }
        if (request.body.publicGalleryShowUploader !== undefined) {
          site.publicGalleryShowUploader =
            request.body.publicGalleryShowUploader;
        }
        if (request.body.publicGalleryShowFileName !== undefined) {
          site.publicGalleryShowFileName =
            request.body.publicGalleryShowFileName;
        }
        if (request.body.publicGalleryShowUploadTime !== undefined) {
          site.publicGalleryShowUploadTime =
            request.body.publicGalleryShowUploadTime;
        }
        if (request.body.publicUploadDefaultPublic !== undefined) {
          site.publicUploadDefaultPublic =
            request.body.publicUploadDefaultPublic;
        }
        if (request.body.publicUploadAnonymousPerMinute !== undefined) {
          site.publicUploadAnonymousPerMinute = request.body.publicUploadAnonymousPerMinute;
        }
        if (request.body.publicUploadAnonymousPerDay !== undefined) {
          site.publicUploadAnonymousPerDay = request.body.publicUploadAnonymousPerDay;
        }
        if (request.body.publicUploadAnonymousDailyBytes !== undefined) {
          site.publicUploadAnonymousDailyBytes = request.body.publicUploadAnonymousDailyBytes;
        }
        if (request.body.publicUploadAuthenticatedPerMinute !== undefined) {
          site.publicUploadAuthenticatedPerMinute = request.body.publicUploadAuthenticatedPerMinute;
        }
        if (request.body.publicUploadAuthenticatedPerDay !== undefined) {
          site.publicUploadAuthenticatedPerDay = request.body.publicUploadAuthenticatedPerDay;
        }
        if (request.body.publicUploadAuthenticatedDailyBytes !== undefined) {
          site.publicUploadAuthenticatedDailyBytes = request.body.publicUploadAuthenticatedDailyBytes;
        }
        if (request.body.publicUploadHumanVerificationEnabled !== undefined) {
          site.publicUploadHumanVerificationEnabled = request.body.publicUploadHumanVerificationEnabled;
        }
        if (request.body.publicUploadLivePhotoEnabled !== undefined) {
          site.publicUploadLivePhotoEnabled = request.body.publicUploadLivePhotoEnabled;
        }
        if (request.body.publicHeroTitle !== undefined) {
          site.publicHeroTitle = request.body.publicHeroTitle.trim();
        }
        if (request.body.publicHeroDescription !== undefined) {
          site.publicHeroDescription =
            request.body.publicHeroDescription.trim();
        }
        if (request.body.publicFeatureCards !== undefined) {
          site.publicFeatureCards = normalizePublicFeatureCards(
            request.body.publicFeatureCards
          );
        }
        if (request.body.loginEyebrow !== undefined) {
          site.loginEyebrow = request.body.loginEyebrow.trim();
        }
        if (request.body.loginHeroTitle !== undefined) {
          site.loginHeroTitle = request.body.loginHeroTitle.trim();
        }
        if (request.body.loginHeroDescription !== undefined) {
          site.loginHeroDescription =
            request.body.loginHeroDescription.trim();
        }
        if (request.body.theme !== undefined) {
          site.theme = request.body.theme;
        }
        if (request.body.accentPreset !== undefined) {
          site.accentPreset = request.body.accentPreset;
        }
        addAuditEvent(state, {
          principal,
          global: true,
          action: "site.settings.update",
          result: "success",
          resourceType: "site",
          ipHash: hashRequestIp(request),
          createdAt: timestamp
        });
      });
      const site = store.snapshot().site!;
      return {
        settings: publicSiteSettings(site)
      };
    }
  );

  app.get<{
    Querystring: {
      page?: string;
      limit?: string;
      status?: "all" | "success" | "failure";
    };
  }>(
    "/site/public-upload/audits",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            page: { type: "string", pattern: "^[0-9]+$" },
            limit: { type: "string", pattern: "^[0-9]+$" },
            status: { type: "string", enum: ["all", "success", "failure"] }
          }
        }
      }
    },
    async (request) => {
      requireSiteBackoffice(request, authenticate, store.snapshot());
      const page = Math.max(1, Number(request.query.page ?? 1));
      const limit = Math.min(100, Math.max(1, Number(request.query.limit ?? 30)));
      const status = request.query.status ?? "all";
      const state = store.snapshot();
      const events = state.publicUploadAudits
        .filter((item) => item.status !== "pending")
        .filter((item) => status === "all" || item.status === status)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const total = events.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const safePage = Math.min(page, totalPages);
      return {
        events: events.slice((safePage - 1) * limit, safePage * limit),
        page: safePage,
        limit,
        total,
        totalPages
      };
    }
  );

  app.put<{ Body: { ip: string } }>(
    "/site/public-upload/ip-blocks",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["ip"],
          properties: { ip: { type: "string", minLength: 2, maxLength: 64 } }
        }
      }
    },
    async (request) => {
      const principal = requireSiteBackoffice(request, authenticate, store.snapshot());
      const ip = normalizePublicUploadIp(request.body.ip);
      await store.update((state) => {
        const blocked = state.site!.publicUploadBlockedIps;
        if (!blocked.includes(ip)) {
          if (blocked.length >= 500) {
            throw new PublicError(409, "IP_BLOCKLIST_FULL", "IP 封禁列表已达上限");
          }
          blocked.push(ip);
        }
        addAuditEvent(state, {
          principal,
          global: true,
          action: "public_upload.ip.block",
          result: "success",
          resourceType: "network_address",
          ipHash: hashRequestIp(request),
          createdAt: now().toISOString()
        });
      });
      return { blockedIps: store.snapshot().site!.publicUploadBlockedIps };
    }
  );

  app.delete<{ Body: { ip: string } }>(
    "/site/public-upload/ip-blocks",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["ip"],
          properties: { ip: { type: "string", minLength: 2, maxLength: 64 } }
        }
      }
    },
    async (request) => {
      const principal = requireSiteBackoffice(request, authenticate, store.snapshot());
      const ip = normalizePublicUploadIp(request.body.ip);
      await store.update((state) => {
        state.site!.publicUploadBlockedIps =
          state.site!.publicUploadBlockedIps.filter((item) => item !== ip);
        addAuditEvent(state, {
          principal,
          global: true,
          action: "public_upload.ip.unblock",
          result: "success",
          resourceType: "network_address",
          ipHash: hashRequestIp(request),
          createdAt: now().toISOString()
        });
      });
      return { blockedIps: store.snapshot().site!.publicUploadBlockedIps };
    }
  );

  app.post("/site/settings/reset-branding", async (request) => {
    const principal = requireSiteOwner(request, authenticate);
    const timestamp = now().toISOString();
    await store.update((state) => {
      const site = state.site!;
      const defaults = defaultSiteConfig();
      site.siteName = defaults.siteName;
      site.siteDescription = defaults.siteDescription;
      site.siteLogoUrl = defaults.siteLogoUrl;
      site.publicHeroTitle = defaults.publicHeroTitle;
      site.publicHeroDescription = defaults.publicHeroDescription;
      site.publicFeatureCards = defaults.publicFeatureCards;
      site.loginEyebrow = defaults.loginEyebrow;
      site.loginHeroTitle = defaults.loginHeroTitle;
      site.loginHeroDescription = defaults.loginHeroDescription;
      site.theme = defaults.theme;
      site.accentPreset = defaults.accentPreset;
      addAuditEvent(state, {
        principal,
        global: true,
        action: "site.branding.reset",
        result: "success",
        resourceType: "site",
        ipHash: hashRequestIp(request),
        createdAt: timestamp
      });
    });
    return { settings: publicSiteSettings(store.snapshot().site!) };
  });

  app.get("/workspace/settings", async (request) => {
    const principal = authenticate(request);
    requireSession(principal);
    requireBackofficeAccess(store.snapshot(), principal);
    const response = publicWorkspaceSettings(
      store.snapshot(),
      principal.workspaceId
    );
    await store.update((state) => {
      addAuditEvent(state, {
        principal,
        action: "workspace.settings.read",
        result: "success",
        resourceType: "workspace_settings",
        resourceId: principal.workspaceId,
        ipHash: hashRequestIp(request),
        createdAt: now().toISOString()
      });
    });
    return { settings: response };
  });

  app.patch<{ Body: Partial<WorkspaceSettings> }>(
    "/workspace/settings",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            uploadMaxBytes: {
              type: "integer",
              minimum: 1024 * 1024,
              maximum: 1024 * 1024 * 1024
            },
            allowedFormats: {
              type: "array",
              minItems: 1,
              maxItems: 7,
              uniqueItems: true,
              items: { type: "string", enum: formats }
            },
            processingQuality: {
              type: "integer",
              minimum: 1,
              maximum: 100
            },
            thumbnailWidth: {
              type: "integer",
              minimum: 64,
              maximum: 4096
            },
            timezone: { type: "string", minLength: 1, maxLength: 100 },
            locale: { type: "string", enum: ["zh-CN", "en-US"] },
            defaultAppearance: { type: "string", enum: themes }
          }
        }
      }
    },
    async (request) => {
      const principal = authenticate(request);
      requireSession(principal);
      requireBackofficeAccess(store.snapshot(), principal);
      requireCapability(principal, "admin");
      if (request.body.timezone) assertTimezone(request.body.timezone);
      const timestamp = now().toISOString();
      await store.update((state) => {
        let settings = state.workspaceSettings.find(
          (item) => item.workspaceId === principal.workspaceId
        );
        if (!settings) {
          settings = defaultWorkspaceSettings(
            principal.workspaceId,
            timestamp
          );
          state.workspaceSettings.push(settings);
        }
        Object.assign(settings, request.body, { updatedAt: timestamp });
        addAuditEvent(state, {
          principal,
          action: "workspace.settings.update",
          result: "success",
          resourceType: "workspace_settings",
          resourceId: principal.workspaceId,
          metadata: { fieldCount: Object.keys(request.body).length },
          ipHash: hashRequestIp(request),
          createdAt: timestamp
        });
      });
      return {
        settings: publicWorkspaceSettings(
          store.snapshot(),
          principal.workspaceId
        )
      };
    }
  );
}
