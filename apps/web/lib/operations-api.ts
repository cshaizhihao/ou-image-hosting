import {
  apiRequest,
  getStoredWorkspaceId,
  normalizeSessionBootstrap,
  type SessionUser,
  type WorkspaceRole,
  type WorkspaceSummary
} from "./api";

export type AnalyticsRange = "7d" | "30d" | "90d";

export type AnalyticsPoint = {
  label: string;
  timestamp: string;
  uploads: number;
  uploadedLogicalBytes: number;
  shareViews: number;
};

export type AnalyticsFormat = {
  format: string;
  count: number;
  activeCurrentVersionBytes: number;
  percentage: number;
};

export type AnalyticsTopImage = {
  id: string;
  name: string;
  format: string;
  size: number;
  shareViews: number;
  createdAt: string;
  thumbnailUrl?: string;
};

export type AnalyticsData = {
  range: AnalyticsRange;
  dataCoverage: {
    uploads: {
      status: "complete" | "partial";
      trackingStartedAt: string;
    };
    shareViews: {
      status: "complete" | "partial";
      trackingStartedAt: string;
      unattributedCount: number;
    };
  };
  summary: {
    imageCount: number;
    uploadCount: number;
    shareViews: number;
    unattributedShareViews: number;
    deduplicatedOriginalBytes: number;
  };
  series: AnalyticsPoint[];
  formatDistribution: AnalyticsFormat[];
  topImages: AnalyticsTopImage[];
};

export type SystemOverall =
  | "operational"
  | "degraded"
  | "down"
  | "unknown";

export type ServiceStatus =
  | "operational"
  | "reachable"
  | "degraded"
  | "down"
  | "not-configured"
  | "configured-not-in-use"
  | "unknown";

export type ServiceHealth = {
  id: string;
  label: string;
  status: ServiceStatus;
  mode: string;
  inUse: boolean;
  checked: boolean;
  detail: string;
  latencyMs?: number;
};

export type SystemJob = {
  id: string;
  kind: "backup" | "storage-migration";
  label: string;
  status: "running" | "completed" | "failed";
  createdAt?: string;
  completedAt?: string;
  retryable: boolean;
  progress?: {
    completed: number;
    total: number;
    failed: number;
  };
  errorCode?: string;
};

export type SystemEvent = {
  id: string;
  type: "system.check";
  result: "success" | "degraded" | "failure";
  message: string;
  createdAt: string;
};

export type SystemStatusData = {
  overall: SystemOverall;
  checkedAt: string | null;
  services: ServiceHealth[];
  events: SystemEvent[];
};

export type SiteSettingsData = {
  siteName: string;
  siteDescription: string;
  siteLogoUrl: string;
  registrationEnabled: boolean;
  publicUploadEnabled: boolean;
  publicUploadRequiresLogin: boolean;
  publicGalleryEnabled: boolean;
  publicGalleryShowUploader: boolean;
  publicGalleryShowFileName: boolean;
  publicGalleryShowUploadTime: boolean;
  publicUploadDefaultPublic: boolean;
  publicUploadAnonymousPerMinute: number;
  publicUploadAnonymousPerDay: number;
  publicUploadAnonymousDailyBytes: number;
  publicUploadAuthenticatedPerMinute: number;
  publicUploadAuthenticatedPerDay: number;
  publicUploadAuthenticatedDailyBytes: number;
  publicUploadHumanVerificationEnabled: boolean;
  publicUploadBlockedIps: string[];
  publicHeroTitle: string;
  publicHeroDescription: string;
  loginEyebrow: string;
  loginHeroTitle: string;
  loginHeroDescription: string;
  theme: "light" | "dark" | "system";
  accentPreset: "coral" | "forest" | "ocean" | "amber";
};

export type WorkspaceConfiguration = {
  uploadMaxBytes: number;
  effectiveUploadMaxBytes: number;
  allowedFormats: string[];
  processingQuality: number;
  thumbnailWidth: number;
  timezone: string;
  locale: "zh-CN" | "en-US";
  defaultAppearance: "light" | "dark" | "system";
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function invalidAnalytics(): never {
  throw new Error("统计数据契约无效");
}

function analyticsRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalidAnalytics();
  }
  return value as UnknownRecord;
}

function analyticsList(value: unknown) {
  return Array.isArray(value) ? value : invalidAnalytics();
}

function analyticsText(value: unknown) {
  return typeof value === "string" ? value : invalidAnalytics();
}

function analyticsNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : invalidAnalytics();
}

function normalizeRange(value: unknown, fallback: AnalyticsRange): AnalyticsRange {
  return value === "7d" || value === "30d" || value === "90d"
    ? value
    : fallback;
}

function parseAnalytics(payload: unknown, requestedRange: AnalyticsRange) {
  const source = analyticsRecord(payload);
  const range = normalizeRange(source.range, requestedRange);
  if (source.range !== range) invalidAnalytics();
  const summary = analyticsRecord(source.summary);
  const rawSeries = analyticsList(source.series);
  const dataCoverage = analyticsRecord(source.dataCoverage);
  const uploadCoverage = analyticsRecord(dataCoverage.uploads);
  const shareViewCoverage = analyticsRecord(dataCoverage.shareViews);
  const uploadCoverageStatus = analyticsText(uploadCoverage.status);
  const shareViewCoverageStatus = analyticsText(shareViewCoverage.status);
  if (
    uploadCoverageStatus !== "complete" &&
    uploadCoverageStatus !== "partial"
  ) {
    invalidAnalytics();
  }
  if (
    shareViewCoverageStatus !== "complete" &&
    shareViewCoverageStatus !== "partial"
  ) {
    invalidAnalytics();
  }
  const series = rawSeries.map((item, index): AnalyticsPoint => {
    const point = analyticsRecord(item);
    const timestamp = analyticsText(point.date);
    return {
      label: timestamp,
      timestamp,
      uploads: analyticsNumber(point.uploads),
      uploadedLogicalBytes: analyticsNumber(point.uploadedLogicalBytes),
      shareViews: analyticsNumber(point.shareViews)
    };
  });
  const rawFormats = analyticsList(source.formatDistribution);
  const formatTotal = rawFormats.reduce((total, item) => {
    const format = analyticsRecord(item);
    return total + analyticsNumber(format.count);
  }, 0);
  return {
    range,
    dataCoverage: {
      uploads: {
        status: uploadCoverageStatus,
        trackingStartedAt: analyticsText(uploadCoverage.trackingStartedAt)
      },
      shareViews: {
        status: shareViewCoverageStatus,
        trackingStartedAt: analyticsText(shareViewCoverage.trackingStartedAt),
        unattributedCount: analyticsNumber(
          shareViewCoverage.unattributedCount
        )
      }
    },
    summary: {
      imageCount: analyticsNumber(summary.imageCount),
      uploadCount: analyticsNumber(summary.uploadCount),
      shareViews: analyticsNumber(summary.shareViews),
      unattributedShareViews: analyticsNumber(summary.unattributedShareViews),
      deduplicatedOriginalBytes: analyticsNumber(
        summary.deduplicatedOriginalBytes
      )
    },
    series,
    formatDistribution: rawFormats.map((item): AnalyticsFormat => {
      const format = analyticsRecord(item);
      const count = analyticsNumber(format.count);
      return {
        format: analyticsText(format.format).toUpperCase(),
        count,
        activeCurrentVersionBytes: analyticsNumber(
          format.activeCurrentVersionBytes
        ),
        percentage: formatTotal > 0 ? (count / formatTotal) * 100 : 0
      };
    }),
    topImages: analyticsList(source.topImages).map(
      (item): AnalyticsTopImage => {
      const image = analyticsRecord(item);
      const thumbnailUrl =
        image.thumbnailUrl === undefined
          ? undefined
          : analyticsText(image.thumbnailUrl);
      return {
        id: analyticsText(image.id),
        name: analyticsText(image.name),
        format: analyticsText(image.format).toUpperCase(),
        size: analyticsNumber(image.size),
        shareViews: analyticsNumber(image.shareViews),
        createdAt: analyticsText(image.createdAt),
        thumbnailUrl
      };
    })
  } satisfies AnalyticsData;
}

function invalidSystem(): never {
  throw new Error("系统状态数据契约无效");
}

function systemRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalidSystem();
  }
  return value as UnknownRecord;
}

function systemList(value: unknown) {
  return Array.isArray(value) ? value : invalidSystem();
}

function systemText(value: unknown) {
  return typeof value === "string" ? value : invalidSystem();
}

function systemNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : invalidSystem();
}

function systemBoolean(value: unknown) {
  return typeof value === "boolean" ? value : invalidSystem();
}

function parseJob(value: unknown): SystemJob {
  const item = systemRecord(value);
  const kind = systemText(item.kind);
  const status = systemText(item.status);
  if (kind !== "backup" && kind !== "storage-migration") invalidSystem();
  if (status !== "running" && status !== "completed" && status !== "failed") {
    invalidSystem();
  }
  const progressSource =
    item.progress === undefined ? undefined : systemRecord(item.progress);
  return {
    id: systemText(item.id),
    kind,
    label: systemText(item.label),
    status,
    createdAt: systemText(item.createdAt),
    completedAt:
      item.completedAt === undefined ? undefined : systemText(item.completedAt),
    retryable: systemBoolean(item.retryable),
    progress: progressSource
      ? {
          completed: systemNumber(progressSource.completed),
          total: systemNumber(progressSource.total),
          failed: systemNumber(progressSource.failed)
        }
      : undefined,
    errorCode:
      item.errorCode === undefined ? undefined : systemText(item.errorCode)
  };
}

function parseServices(value: unknown): ServiceHealth[] {
  return systemList(value).map((raw) => {
    const item = systemRecord(raw);
    const status = systemText(item.status);
    if (
      status !== "operational" &&
      status !== "reachable" &&
      status !== "degraded" &&
      status !== "down" &&
      status !== "not-configured" &&
      status !== "configured-not-in-use" &&
      status !== "unknown"
    ) {
      invalidSystem();
    }
    return {
      id: systemText(item.id),
      label: systemText(item.label),
      status,
      mode: systemText(item.mode),
      inUse: systemBoolean(item.inUse),
      checked: systemBoolean(item.checked),
      detail: systemText(item.detail),
      latencyMs:
        item.latencyMs === undefined ? undefined : systemNumber(item.latencyMs)
    };
  });
}

function parseSystemStatus(payload: unknown): SystemStatusData {
  const source = systemRecord(payload);
  const overall = systemText(source.overall);
  if (
    overall !== "operational" &&
    overall !== "degraded" &&
    overall !== "down" &&
    overall !== "unknown"
  ) {
    invalidSystem();
  }
  return {
    overall,
    checkedAt:
      source.checkedAt === null ? null : systemText(source.checkedAt),
    services: parseServices(source.services),
    events: systemList(source.events).map((raw): SystemEvent => {
      const item = systemRecord(raw);
      const type = systemText(item.type);
      const result = systemText(item.result);
      if (type !== "system.check") invalidSystem();
      if (
        result !== "success" &&
        result !== "degraded" &&
        result !== "failure"
      ) {
        invalidSystem();
      }
      return {
        id: systemText(item.id),
        type,
        result,
        message: systemText(item.message),
        createdAt: systemText(item.createdAt)
      };
    })
  };
}

function parseSiteSettings(payload: unknown): SiteSettingsData {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("站点设置数据契约无效");
  }
  const settings = (payload as UnknownRecord).settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("站点设置数据契约无效");
  }
  const source = settings as UnknownRecord;
  if (
    typeof source.siteName !== "string" ||
    typeof source.siteDescription !== "string" ||
    typeof source.siteLogoUrl !== "string" ||
    typeof source.registrationEnabled !== "boolean" ||
    typeof source.publicUploadEnabled !== "boolean" ||
    typeof source.publicUploadRequiresLogin !== "boolean" ||
    typeof source.publicGalleryEnabled !== "boolean" ||
    typeof source.publicGalleryShowUploader !== "boolean" ||
    typeof source.publicGalleryShowFileName !== "boolean" ||
    typeof source.publicGalleryShowUploadTime !== "boolean" ||
    typeof source.publicUploadDefaultPublic !== "boolean" ||
    typeof source.publicUploadAnonymousPerMinute !== "number" ||
    typeof source.publicUploadAnonymousPerDay !== "number" ||
    typeof source.publicUploadAnonymousDailyBytes !== "number" ||
    typeof source.publicUploadAuthenticatedPerMinute !== "number" ||
    typeof source.publicUploadAuthenticatedPerDay !== "number" ||
    typeof source.publicUploadAuthenticatedDailyBytes !== "number" ||
    typeof source.publicUploadHumanVerificationEnabled !== "boolean" ||
    !Array.isArray(source.publicUploadBlockedIps) ||
    !source.publicUploadBlockedIps.every((item) => typeof item === "string") ||
    typeof source.publicHeroTitle !== "string" ||
    typeof source.publicHeroDescription !== "string" ||
    typeof source.loginEyebrow !== "string" ||
    typeof source.loginHeroTitle !== "string" ||
    typeof source.loginHeroDescription !== "string" ||
    (source.theme !== "light" &&
      source.theme !== "dark" &&
      source.theme !== "system") ||
    (source.accentPreset !== "coral" &&
      source.accentPreset !== "forest" &&
      source.accentPreset !== "ocean" &&
      source.accentPreset !== "amber")
  ) {
    throw new Error("站点设置数据契约无效");
  }
  return {
    siteName: source.siteName,
    siteDescription: source.siteDescription,
    siteLogoUrl: source.siteLogoUrl,
    registrationEnabled: source.registrationEnabled,
    publicUploadEnabled: source.publicUploadEnabled,
    publicUploadRequiresLogin: source.publicUploadRequiresLogin,
    publicGalleryEnabled: source.publicGalleryEnabled,
    publicGalleryShowUploader: source.publicGalleryShowUploader,
    publicGalleryShowFileName: source.publicGalleryShowFileName,
    publicGalleryShowUploadTime: source.publicGalleryShowUploadTime,
    publicUploadDefaultPublic: source.publicUploadDefaultPublic,
    publicUploadAnonymousPerMinute: source.publicUploadAnonymousPerMinute,
    publicUploadAnonymousPerDay: source.publicUploadAnonymousPerDay,
    publicUploadAnonymousDailyBytes: source.publicUploadAnonymousDailyBytes,
    publicUploadAuthenticatedPerMinute: source.publicUploadAuthenticatedPerMinute,
    publicUploadAuthenticatedPerDay: source.publicUploadAuthenticatedPerDay,
    publicUploadAuthenticatedDailyBytes: source.publicUploadAuthenticatedDailyBytes,
    publicUploadHumanVerificationEnabled:
      source.publicUploadHumanVerificationEnabled,
    publicUploadBlockedIps: source.publicUploadBlockedIps,
    publicHeroTitle: source.publicHeroTitle,
    publicHeroDescription: source.publicHeroDescription,
    loginEyebrow: source.loginEyebrow,
    loginHeroTitle: source.loginHeroTitle,
    loginHeroDescription: source.loginHeroDescription,
    theme: source.theme,
    accentPreset: source.accentPreset
  };
}

function parseWorkspaceSettings(payload: unknown): WorkspaceConfiguration {
  const source = record(payload).settings;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("工作区设置数据契约无效");
  }
  const settings = source as UnknownRecord;
  const uploadMaxBytes = settings.uploadMaxBytes;
  const effectiveUploadMaxBytes = settings.effectiveUploadMaxBytes;
  const processingQuality = settings.processingQuality;
  const thumbnailWidth = settings.thumbnailWidth;
  const locale = settings.locale;
  const defaultAppearance = settings.defaultAppearance;
  if (
    typeof uploadMaxBytes !== "number" ||
    !Number.isFinite(uploadMaxBytes) ||
    typeof effectiveUploadMaxBytes !== "number" ||
    !Number.isFinite(effectiveUploadMaxBytes) ||
    typeof processingQuality !== "number" ||
    !Number.isFinite(processingQuality) ||
    typeof thumbnailWidth !== "number" ||
    !Number.isFinite(thumbnailWidth) ||
    (locale !== "zh-CN" && locale !== "en-US") ||
    (defaultAppearance !== "light" &&
      defaultAppearance !== "dark" &&
      defaultAppearance !== "system") ||
    typeof settings.timezone !== "string" ||
    !Array.isArray(settings.allowedFormats) ||
    !settings.allowedFormats.every((item) => typeof item === "string")
  ) {
    throw new Error("工作区设置数据契约无效");
  }
  return {
    uploadMaxBytes,
    effectiveUploadMaxBytes,
    allowedFormats: settings.allowedFormats.map((item) =>
      (item as string).toLowerCase()
    ),
    processingQuality,
    thumbnailWidth,
    timezone: settings.timezone,
    locale,
    defaultAppearance
  };
}

export async function getAnalytics(range: AnalyticsRange) {
  const payload = await apiRequest<unknown>(`/analytics?range=${range}`);
  return parseAnalytics(payload, range);
}

export async function getSystemStatus() {
  return parseSystemStatus(await apiRequest<unknown>("/system/status"));
}

export async function checkSystemStatus() {
  return parseSystemStatus(
    await apiRequest<unknown>("/system/status/check", {
      method: "POST",
      body: JSON.stringify({})
    })
  );
}

export async function getJobs() {
  const payload = systemRecord(await apiRequest<unknown>("/jobs"));
  return systemList(payload.jobs).map(parseJob);
}

export async function retryJob(job: Pick<SystemJob, "id" | "kind">) {
  const payload = await apiRequest<unknown>(
    `/jobs/${encodeURIComponent(job.kind)}/${encodeURIComponent(job.id)}/retry`,
    {
      method: "POST",
      body: JSON.stringify({})
    }
  );
  return parseJob(record(payload).job ?? payload);
}

export async function getCurrentWorkspaceRole(): Promise<WorkspaceRole> {
  const payload = await apiRequest<{
    user: SessionUser;
    workspaces?: WorkspaceSummary[];
    defaultWorkspace?: WorkspaceSummary;
  }>("/auth/session");
  const bootstrap = normalizeSessionBootstrap(payload);
  const workspaceId = getStoredWorkspaceId();
  return (
    bootstrap.workspaces.find((workspace) => workspace.id === workspaceId)
      ?.role ?? bootstrap.defaultWorkspace.role
  );
}

export async function getCurrentAccess() {
  const payload = await apiRequest<{
    user: SessionUser;
    workspaces?: WorkspaceSummary[];
    defaultWorkspace?: WorkspaceSummary;
  }>("/auth/session");
  const bootstrap = normalizeSessionBootstrap(payload);
  const workspaceId = getStoredWorkspaceId();
  return {
    siteRole: bootstrap.user.role,
    workspaceRole:
      bootstrap.workspaces.find((workspace) => workspace.id === workspaceId)
        ?.role ?? bootstrap.defaultWorkspace.role
  };
}

export async function getSiteSettings() {
  return parseSiteSettings(await apiRequest<unknown>("/site/settings"));
}

export async function updateSiteSettings(settings: SiteSettingsData) {
  const { publicUploadBlockedIps: _blockedIps, ...editableSettings } = settings;
  return parseSiteSettings(
    await apiRequest<unknown>("/site/settings", {
      method: "PATCH",
      body: JSON.stringify(editableSettings)
    })
  );
}

export async function resetSiteBranding() {
  return parseSiteSettings(
    await apiRequest<unknown>("/site/settings/reset-branding", {
      method: "POST",
      body: JSON.stringify({})
    })
  );
}

export async function blockPublicUploadIp(ip: string) {
  return apiRequest<{ blockedIps: string[] }>("/site/public-upload/ip-blocks", {
    method: "PUT",
    body: JSON.stringify({ ip })
  });
}

export async function unblockPublicUploadIp(ip: string) {
  return apiRequest<{ blockedIps: string[] }>("/site/public-upload/ip-blocks", {
    method: "DELETE",
    body: JSON.stringify({ ip })
  });
}

export async function getWorkspaceConfiguration() {
  return parseWorkspaceSettings(
    await apiRequest<unknown>("/workspace/settings")
  );
}

export async function updateWorkspaceConfiguration(
  settings: Omit<WorkspaceConfiguration, "effectiveUploadMaxBytes">
) {
  return parseWorkspaceSettings(
    await apiRequest<unknown>("/workspace/settings", {
      method: "PATCH",
      body: JSON.stringify(settings)
    })
  );
}
