import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type ThemePreference = "light" | "dark" | "system";

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

export function defaultNotificationPreferences(): NotificationPreferences {
  return {
    security: true,
    collaboration: true,
    system: true,
    quietHours: {
      enabled: false,
      start: "22:00",
      end: "08:00",
      timezone: "UTC"
    }
  };
}

export type SiteConfig = {
  siteName: string;
  siteDescription: string;
  registrationEnabled: boolean;
  defaultStorage: "local";
  theme: ThemePreference;
};

export type StoredUser = {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  role: "owner" | "member";
  theme: ThemePreference;
  onboardingCompleted: boolean;
  failedLoginCount: number;
  lockedUntil?: string;
  passwordUpdatedAt?: string;
  totpSecretCiphertext?: string;
  totpEnabledAt?: string;
  lastTotpStep?: number;
  recoveryCodeHashes?: string[];
  notificationPreferences?: NotificationPreferences;
  notificationReadEventIds?: string[];
  createdAt: string;
  updatedAt: string;
};

export type StoredSession = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  userAgent?: string;
  ipHash?: string;
};

export type StoredPasswordReset = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
};

export type StoredImage = {
  id: string;
  userId: string;
  workspaceId: string;
  name: string;
  size: number;
  mime: string;
  format: "jpeg" | "png" | "webp" | "gif" | "avif";
  width: number;
  height: number;
  sha256: string;
  originalKey: string;
  thumbnailKey: string;
  currentVersionId: string;
  versions: StoredImageVersion[];
  favorite: boolean;
  favoriteUserIds: string[];
  albumIds: string[];
  tagIds: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

export type StoredImageVersion = {
  id: string;
  operation:
    | "original"
    | "rotate-left"
    | "rotate-right"
    | "flip-horizontal"
    | "flip-vertical"
    | "convert-format"
    | "restore";
  sourceVersionId?: string;
  size: number;
  mime: string;
  format: StoredImage["format"];
  width: number;
  height: number;
  sha256: string;
  originalKey: string;
  thumbnailKey: string;
  createdAt: string;
};

export type StoredImageShare = {
  id: string;
  imageId: string;
  userId: string;
  workspaceId: string;
  tokenHash: string;
  passwordHash?: string;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  accessCount: number;
  lastAccessedAt?: string;
};

export type StoredAlbum = {
  id: string;
  userId: string;
  workspaceId: string;
  name: string;
  description: string;
  coverImageId?: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredTag = {
  id: string;
  userId: string;
  workspaceId: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
};

export type StorageProvider = "local" | "s3" | "r2";

export type RemoteStorageSettings = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKeyCiphertext?: string;
  publicBaseUrl?: string;
  pathStyle: boolean;
};

export type StorageSettings = {
  active: StorageProvider;
  s3?: RemoteStorageSettings;
  r2?: RemoteStorageSettings;
};

export type DeliverySettings = {
  customDomain?: string;
  linkTemplate: string;
  hotlinkEnabled: boolean;
  allowedReferers: string[];
  allowEmptyReferer: boolean;
  signedUrls: boolean;
  signedUrlTtlSeconds: number;
};

export type BackupSettings = {
  scheduleEnabled: boolean;
  intervalHours: number;
  retentionCount: number;
  lastBackupAt?: string;
};

export type StoredBackup = {
  id: string;
  status: "running" | "completed" | "failed";
  archiveKey: string;
  createdBy: string;
  createdAt: string;
  completedAt?: string;
  size?: number;
  fileCount: number;
  checksum?: string;
  error?: string;
  retriedAt?: string;
  retryInProgress?: boolean;
};

export type StoredStorageMigration = {
  id: string;
  source: StorageProvider;
  target: StorageProvider;
  status: "running" | "completed" | "failed";
  total: number;
  completed: number;
  failed: number;
  createdBy: string;
  createdAt: string;
  completedAt?: string;
  error?: string;
  retriedAt?: string;
  retryInProgress?: boolean;
};

export type WorkspaceSettings = {
  uploadMaxBytes: number;
  allowedFormats: StoredImage["format"][];
  processingQuality: number;
  thumbnailWidth: number;
  timezone: string;
  locale: "zh-CN" | "en-US";
  defaultAppearance: ThemePreference;
};

export type StoredWorkspaceSettings = WorkspaceSettings & {
  workspaceId: string;
  updatedAt: string;
};

export type StoredSystemEvent = {
  id: string;
  workspaceId?: string;
  type: "job.retry";
  resourceId?: string;
  metadata?: Record<string, string | number | boolean>;
  createdAt: string;
};

export type StoredAnalyticsDaily = {
  workspaceId: string;
  date: string;
  uploads: number;
  uploadedLogicalBytes: number;
  shareViews: number;
  imageShareViews: Record<string, number>;
};

export type AnalyticsCoverageState = {
  trackingStartedAt: string;
  status: "complete" | "partial";
};

export type StoredAnalyticsCoverage = {
  workspaceId: string;
  uploads: AnalyticsCoverageState;
  shareViews: AnalyticsCoverageState;
};

export type StoredSystemStatusResult = {
  id: string;
  checkedAt: string;
  overall: "operational" | "degraded" | "down";
  latencyMs: number;
  services: Array<{
    id: string;
    status:
      | "operational"
      | "degraded"
      | "down"
      | "not-configured"
      | "configured-not-in-use"
      | "reachable"
      | "unknown";
    label: string;
    mode: string;
    inUse: boolean;
    checked: boolean;
    latencyMs: number;
    detail?: string;
  }>;
};

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";

export type StoredWorkspace = {
  id: string;
  name: string;
  description: string;
  slug: string;
  personal: boolean;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredWorkspaceMember = {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: string;
  updatedAt: string;
};

export type StoredWorkspaceInvitation = {
  id: string;
  workspaceId: string;
  email: string;
  role: Exclude<WorkspaceRole, "owner">;
  tokenHash: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  acceptedAt?: string;
  acceptedBy?: string;
};

export type ApiTokenScope =
  | "images:read"
  | "images:write"
  | "images:delete"
  | "organization:read"
  | "organization:write"
  | "shares:read"
  | "shares:write"
  | "analytics:read";

export type StoredApiToken = {
  id: string;
  workspaceId: string;
  userId: string;
  name: string;
  prefix: string;
  tokenHash: string;
  scopes: ApiTokenScope[];
  ipAllowlist: string[];
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
};

export type StoredLoginChallenge = {
  id: string;
  userId: string;
  purpose: "login" | "mfa-setup";
  sessionId?: string;
  tokenHash: string;
  secretCiphertext?: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
};

export type StoredAuditEvent = {
  id: string;
  workspaceId?: string;
  actorUserId?: string;
  actorType: "session" | "api-token" | "system";
  action: string;
  result: "success" | "failure";
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, string | number | boolean>;
  ipHash?: string;
  createdAt: string;
};

export type AppState = {
  schemaVersion: 7;
  setupComplete: boolean;
  site?: SiteConfig;
  users: StoredUser[];
  sessions: StoredSession[];
  passwordResets: StoredPasswordReset[];
  images: StoredImage[];
  imageShares: StoredImageShare[];
  albums: StoredAlbum[];
  tags: StoredTag[];
  storageSettings: StorageSettings;
  deliverySettings: DeliverySettings;
  backupSettings: BackupSettings;
  backups: StoredBackup[];
  storageMigrations: StoredStorageMigration[];
  workspaces: StoredWorkspace[];
  workspaceSettings: StoredWorkspaceSettings[];
  workspaceMembers: StoredWorkspaceMember[];
  workspaceInvitations: StoredWorkspaceInvitation[];
  apiTokens: StoredApiToken[];
  loginChallenges: StoredLoginChallenge[];
  auditEvents: StoredAuditEvent[];
  systemEvents: StoredSystemEvent[];
  analyticsDaily: StoredAnalyticsDaily[];
  analyticsCoverage: StoredAnalyticsCoverage[];
  systemStatusHistory: StoredSystemStatusResult[];
};

export function defaultWorkspaceSettings(
  workspaceId: string,
  updatedAt = new Date(0).toISOString()
): StoredWorkspaceSettings {
  return {
    workspaceId,
    uploadMaxBytes: 20 * 1024 * 1024,
    allowedFormats: ["jpeg", "png", "webp", "gif", "avif"],
    processingQuality: 85,
    thumbnailWidth: 480,
    timezone: "Asia/Shanghai",
    locale: "zh-CN",
    defaultAppearance: "system",
    updatedAt
  };
}

export function calculateImageStorageBytes(images: StoredImage[]) {
  const files = new Map<string, number>();
  for (const image of images) {
    for (const version of image.versions) {
      if (!files.has(version.originalKey)) {
        files.set(version.originalKey, version.size);
      }
    }
  }
  return [...files.values()].reduce((total, size) => total + size, 0);
}

const initialState = (): AppState => ({
  schemaVersion: 7,
  setupComplete: false,
  users: [],
  sessions: [],
  passwordResets: [],
  images: [],
  imageShares: [],
  albums: [],
  tags: [],
  storageSettings: {
    active: "local"
  },
  deliverySettings: {
    linkTemplate: "{domain}/api/files/{id}/{variant}",
    hotlinkEnabled: false,
    allowedReferers: [],
    allowEmptyReferer: true,
    signedUrls: false,
    signedUrlTtlSeconds: 3600
  },
  backupSettings: {
    scheduleEnabled: false,
    intervalHours: 24,
    retentionCount: 7
  },
  backups: [],
  storageMigrations: [],
  workspaces: [],
  workspaceSettings: [],
  workspaceMembers: [],
  workspaceInvitations: [],
  apiTokens: [],
  loginChallenges: [],
  auditEvents: [],
  systemEvents: [],
  analyticsDaily: [],
  analyticsCoverage: [],
  systemStatusHistory: []
});

type MigratableImage = Omit<
  StoredImage,
  | "currentVersionId"
  | "versions"
  | "updatedAt"
  | "favorite"
  | "favoriteUserIds"
  | "workspaceId"
  | "albumIds"
  | "tagIds"
> &
  Partial<
    Pick<
      StoredImage,
      | "currentVersionId"
      | "versions"
      | "updatedAt"
      | "favorite"
      | "favoriteUserIds"
      | "workspaceId"
      | "albumIds"
      | "tagIds"
    >
  >;

function migrateImage(image: MigratableImage): StoredImage {
  const originalVersionId = `original-${image.id}`;
  const versions =
    image.versions && image.versions.length > 0
      ? image.versions
      : [
          {
            id: originalVersionId,
            operation: "original" as const,
            size: image.size,
            mime: image.mime,
            format: image.format,
            width: image.width,
            height: image.height,
            sha256: image.sha256,
            originalKey: image.originalKey,
            thumbnailKey: image.thumbnailKey,
            createdAt: image.createdAt
          }
        ];
  const currentVersionId =
    image.currentVersionId &&
    versions.some((version) => version.id === image.currentVersionId)
      ? image.currentVersionId
      : versions.at(-1)!.id;
  return {
    ...image,
    currentVersionId,
    versions,
    favorite: image.favorite ?? false,
    favoriteUserIds:
      image.favoriteUserIds ??
      (image.favorite ? [image.userId] : []),
    workspaceId: image.workspaceId ?? `personal-${image.userId}`,
    albumIds: image.albumIds ?? [],
    tagIds: image.tagIds ?? [],
    updatedAt: image.updatedAt ?? image.createdAt
  };
}

type MigratableAppState = Omit<Partial<AppState>, "schemaVersion"> & {
  schemaVersion?: number;
  shareAccessEvents?: Array<{
    workspaceId?: string;
    imageId?: string;
    createdAt?: string;
  }>;
};

function validTimezone(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

const MAX_ANALYTICS_COUNT = 1_000_000_000;
const MAX_ANALYTICS_BYTES = 1_000_000_000_000_000;
const MAX_JOB_COUNT = 10_000_000;
const MAX_JOB_BYTES = 1_000_000_000_000_000;
const storageProviders = new Set<StorageProvider>(["local", "s3", "r2"]);
const systemStatuses = new Set<
  StoredSystemStatusResult["services"][number]["status"]
>([
  "operational",
  "degraded",
  "down",
  "not-configured",
  "configured-not-in-use",
  "reachable",
  "unknown"
]);

function isStorageProvider(value: unknown): value is StorageProvider {
  return (
    typeof value === "string" &&
    storageProviders.has(value as StorageProvider)
  );
}

function isSystemServiceStatus(
  value: unknown
): value is StoredSystemStatusResult["services"][number]["status"] {
  return (
    typeof value === "string" &&
    systemStatuses.has(
      value as StoredSystemStatusResult["services"][number]["status"]
    )
  );
}

function isSystemOverall(
  value: unknown
): value is StoredSystemStatusResult["overall"] {
  return (
    value === "operational" || value === "degraded" || value === "down"
  );
}

const serviceDefinitions = {
  "metadata-store": {
    label: "元数据存储",
    mode: "single-process-json",
    inUse: true
  },
  "local-storage": {
    label: "本地存储",
    mode: "filesystem",
    inUse: true
  },
  "image-processing": {
    label: "图片处理",
    mode: "sharp-in-process",
    inUse: true
  },
  queue: {
    label: "任务队列",
    mode: "inline-single-process",
    inUse: true
  },
  postgresql: {
    label: "PostgreSQL",
    mode: "external",
    inUse: false
  },
  redis: {
    label: "Redis",
    mode: "external",
    inUse: false
  },
  cdn: {
    label: "CDN",
    mode: "external",
    inUse: undefined
  }
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSafeInteger(
  value: unknown,
  maximum: number,
  fallback = 0
) {
  return Number.isSafeInteger(value) &&
    Number(value) >= 0 &&
    Number(value) <= maximum
    ? Number(value)
    : fallback;
}

function normalizeIso(value: unknown) {
  if (typeof value !== "string" || value.length > 50) return undefined;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime())
    ? timestamp.toISOString()
    : undefined;
}

function validCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const timestamp = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    timestamp.getUTCFullYear() === year &&
    timestamp.getUTCMonth() === month! - 1 &&
    timestamp.getUTCDate() === day
  );
}

function normalizeCoverageState(
  value: Partial<AnalyticsCoverageState> | undefined,
  fallback: string
): AnalyticsCoverageState | undefined {
  const trackingStartedAt = normalizeIso(value?.trackingStartedAt);
  if (
    !trackingStartedAt ||
    (value?.status !== "complete" && value?.status !== "partial")
  ) {
    return undefined;
  }
  return { trackingStartedAt, status: value.status };
}

function normalizeBackup(
  value: unknown,
  interruptedAt: string
): StoredBackup | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.id.length < 1 ||
    value.id.length > 100 ||
    typeof value.createdBy !== "string" ||
    value.createdBy.length < 1 ||
    value.createdBy.length > 100 ||
    typeof value.archiveKey !== "string" ||
    value.archiveKey.length < 9 ||
    value.archiveKey.length > 300 ||
    !/^backups\/[A-Za-z0-9._/-]+$/.test(value.archiveKey) ||
    value.archiveKey.includes("..") ||
    (value.status !== "running" &&
      value.status !== "completed" &&
      value.status !== "failed")
  ) {
    return undefined;
  }
  const createdAt = normalizeIso(value.createdAt);
  if (!createdAt) return undefined;
  const status = value.status === "running" ? "failed" : value.status;
  const completedAt =
    value.status === "running"
      ? interruptedAt
      : normalizeIso(value.completedAt);
  if (status === "completed" && !completedAt) return undefined;
  const size =
    value.size === undefined
      ? undefined
      : normalizeSafeInteger(value.size, MAX_JOB_BYTES, -1);
  if (size === -1) return undefined;
  if (
    value.checksum !== undefined &&
    (typeof value.checksum !== "string" ||
      !/^[a-f0-9]{64}$/i.test(value.checksum))
  ) {
    return undefined;
  }
  const fileCount = normalizeSafeInteger(
    value.fileCount,
    MAX_JOB_COUNT,
    -1
  );
  if (fileCount < 0) return undefined;
  return {
    id: value.id,
    status,
    archiveKey: value.archiveKey,
    createdBy: value.createdBy,
    createdAt,
    completedAt,
    size,
    fileCount,
    checksum: value.checksum?.toLowerCase(),
    error:
      value.status === "running"
        ? "interrupted by process restart"
        : typeof value.error === "string"
          ? value.error.slice(0, 300)
          : undefined,
    retriedAt: normalizeIso(value.retriedAt),
    retryInProgress: false
  };
}

function normalizeStorageMigration(
  value: unknown,
  interruptedAt: string
): StoredStorageMigration | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.id.length < 1 ||
    value.id.length > 100 ||
    typeof value.createdBy !== "string" ||
    value.createdBy.length < 1 ||
    value.createdBy.length > 100 ||
    !isStorageProvider(value.source) ||
    !isStorageProvider(value.target) ||
    value.source === value.target ||
    (value.status !== "running" &&
      value.status !== "completed" &&
      value.status !== "failed")
  ) {
    return undefined;
  }
  const createdAt = normalizeIso(value.createdAt);
  if (!createdAt) return undefined;
  const total = normalizeSafeInteger(value.total, MAX_JOB_COUNT, -1);
  const completed = normalizeSafeInteger(value.completed, MAX_JOB_COUNT, -1);
  const failed = normalizeSafeInteger(value.failed, MAX_JOB_COUNT, -1);
  if (
    total < 0 ||
    completed < 0 ||
    failed < 0 ||
    completed + failed > total
  ) {
    return undefined;
  }
  const status = value.status === "running" ? "failed" : value.status;
  const completedAt =
    value.status === "running"
      ? interruptedAt
      : normalizeIso(value.completedAt);
  if (status === "completed" && !completedAt) return undefined;
  return {
    id: value.id,
    source: value.source,
    target: value.target,
    status,
    total,
    completed,
    failed,
    createdBy: value.createdBy,
    createdAt,
    completedAt,
    error:
      value.status === "running"
        ? "interrupted by process restart"
        : typeof value.error === "string"
          ? value.error.slice(0, 300)
          : undefined,
    retriedAt: normalizeIso(value.retriedAt),
    retryInProgress: false
  };
}

function validSystemServiceState(
  service: StoredSystemStatusResult["services"][number]
) {
  if (
    ["metadata-store", "local-storage", "image-processing"].includes(
      service.id
    )
  ) {
    return (
      service.inUse &&
      service.checked &&
      ["operational", "down"].includes(service.status)
    );
  }
  if (service.id === "queue") {
    return (
      service.inUse &&
      service.checked &&
      service.status === "operational"
    );
  }
  if (service.id === "postgresql" || service.id === "redis") {
    return (
      !service.inUse &&
      !service.checked &&
      ["configured-not-in-use", "not-configured"].includes(
        service.status
      )
    );
  }
  if (service.id === "cdn") {
    return service.status === "not-configured"
      ? !service.inUse && !service.checked
      : service.inUse &&
          service.checked &&
          ["operational", "degraded"].includes(service.status);
  }
  return false;
}

function normalizeSystemStatus(
  value: unknown
): StoredSystemStatusResult | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.id.length < 1 ||
    value.id.length > 100 ||
    !isSystemOverall(value.overall)
  ) {
    return undefined;
  }
  const checkedAt = normalizeIso(value.checkedAt);
  const latencyMs = normalizeSafeInteger(value.latencyMs, 3_600_000, -1);
  if (!checkedAt || latencyMs < 0 || !Array.isArray(value.services)) {
    return undefined;
  }
  const services: StoredSystemStatusResult["services"] = [];
  for (const service of value.services.slice(0, 7)) {
    if (!isRecord(service)) continue;
    if (typeof service.id !== "string") continue;
    const definition =
      serviceDefinitions[
        service.id as keyof typeof serviceDefinitions
      ];
    if (
      !definition ||
      service.label !== definition.label ||
      service.mode !== definition.mode ||
      (definition.inUse !== undefined &&
        service.inUse !== definition.inUse) ||
      typeof service.inUse !== "boolean" ||
      typeof service.checked !== "boolean" ||
      !isSystemServiceStatus(service.status) ||
      typeof service.detail !== "string" ||
      service.detail.length < 1 ||
      service.detail.length > 200
    ) {
      continue;
    }
    const serviceLatency = normalizeSafeInteger(
      service.latencyMs,
      3_600_000,
      -1
    );
    if (serviceLatency < 0) continue;
    const normalizedService: StoredSystemStatusResult["services"][number] = {
      id: service.id,
      label: definition.label,
      status: service.status,
      mode: definition.mode,
      inUse: service.inUse,
      checked: service.checked,
      detail: service.detail,
      latencyMs: serviceLatency
    };
    if (!validSystemServiceState(normalizedService)) continue;
    services.push(normalizedService);
  }
  if (
    services.length !== 7 ||
    new Set(services.map((service) => service.id)).size !== 7
  ) {
    return undefined;
  }
  return {
    id: value.id,
    checkedAt,
    overall: value.overall,
    latencyMs,
    services
  };
}

function normalizeWorkspaceSettings(
  workspaceId: string,
  updatedAt: string,
  value: Partial<StoredWorkspaceSettings> | undefined
) {
  const defaults = defaultWorkspaceSettings(workspaceId, updatedAt);
  const allowedFormats = Array.isArray(value?.allowedFormats)
    ? [...new Set(value.allowedFormats)].filter((format) =>
        ["jpeg", "png", "webp", "gif", "avif"].includes(format)
      )
    : defaults.allowedFormats;
  const integer = (
    candidate: unknown,
    minimum: number,
    maximum: number,
    fallback: number
  ) =>
    Number.isInteger(candidate) &&
    Number(candidate) >= minimum &&
    Number(candidate) <= maximum
      ? Number(candidate)
      : fallback;
  return {
    workspaceId,
    uploadMaxBytes: integer(
      value?.uploadMaxBytes,
      1024 * 1024,
      1024 * 1024 * 1024,
      defaults.uploadMaxBytes
    ),
    allowedFormats:
      allowedFormats.length > 0 ? allowedFormats : defaults.allowedFormats,
    processingQuality: integer(
      value?.processingQuality,
      1,
      100,
      defaults.processingQuality
    ),
    thumbnailWidth: integer(
      value?.thumbnailWidth,
      64,
      4096,
      defaults.thumbnailWidth
    ),
    timezone: validTimezone(value?.timezone)
      ? value!.timezone!
      : defaults.timezone,
    locale:
      value?.locale === "en-US" || value?.locale === "zh-CN"
        ? value.locale
        : defaults.locale,
    defaultAppearance: ["light", "dark", "system"].includes(
      value?.defaultAppearance ?? ""
    )
      ? value!.defaultAppearance!
      : defaults.defaultAppearance,
    updatedAt:
      typeof value?.updatedAt === "string" ? value.updatedAt : updatedAt
  } satisfies StoredWorkspaceSettings;
}

function migrateWorkspaceState(parsed: MigratableAppState) {
  const users = parsed.users ?? [];
  const existingWorkspaces = (parsed.workspaces ?? []).map((workspace) => ({
    ...workspace,
    description: workspace.description ?? ""
  }));
  const existingMembers = parsed.workspaceMembers ?? [];
  const workspaces = [...existingWorkspaces];
  const workspaceMembers = [...existingMembers];
  for (const user of users) {
    const workspaceId = `personal-${user.id}`;
    if (!workspaces.some((workspace) => workspace.id === workspaceId)) {
      workspaces.push({
        id: workspaceId,
        name: `${user.displayName}的空间`,
        description: "",
        slug: workspaceId,
        personal: true,
        ownerUserId: user.id,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      });
    }
    if (
      !workspaceMembers.some(
        (member) =>
          member.workspaceId === workspaceId && member.userId === user.id
      )
    ) {
      workspaceMembers.push({
        id: `member-${user.id}`,
        workspaceId,
        userId: user.id,
        role: "owner",
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      });
    }
  }
  return { workspaces, workspaceMembers };
}

export function migrateAppState(parsed: MigratableAppState): AppState {
  const migrationTimestamp = new Date().toISOString();
  const migratedWorkspace = migrateWorkspaceState(parsed);
  const workspaceSettings = migratedWorkspace.workspaces.map((workspace) => {
    const existing = parsed.workspaceSettings?.find(
      (settings) => settings.workspaceId === workspace.id
    );
    return normalizeWorkspaceSettings(
      workspace.id,
      workspace.updatedAt,
      existing
    );
  });
  const workspaceIds = new Set(
    migratedWorkspace.workspaces.map((workspace) => workspace.id)
  );
  const images = (parsed.images ?? []).map(migrateImage);
  const imageWorkspaceIds = new Map(
    images.map((image) => [image.id, image.workspaceId])
  );
  const migratedDaily = new Map<string, StoredAnalyticsDaily>();
  const analyticsDailyItems = Array.isArray(parsed.analyticsDaily)
    ? parsed.analyticsDaily
    : [];
  for (const item of analyticsDailyItems) {
    if (!isRecord(item)) continue;
    if (
      !workspaceIds.has(item.workspaceId) ||
      !validCalendarDate(item.date)
    ) {
      continue;
    }
    const imageShareViews: Record<string, number> = {};
    let trackedShareViews = 0;
    const rawImageShareViews = isRecord(item.imageShareViews)
      ? item.imageShareViews
      : {};
    for (const [imageId, count] of Object.entries(rawImageShareViews).slice(
      0,
      1000
    )) {
      if (
        imageId.length > 100 ||
        imageWorkspaceIds.get(imageId) !== item.workspaceId
      ) {
        continue;
      }
      const normalized = normalizeSafeInteger(
        count,
        MAX_ANALYTICS_COUNT,
        -1
      );
      if (normalized <= 0) continue;
      const accepted = Math.min(
        normalized,
        MAX_ANALYTICS_COUNT - trackedShareViews
      );
      if (accepted <= 0) break;
      imageShareViews[imageId] = accepted;
      trackedShareViews += accepted;
    }
    const key = `${item.workspaceId}:${item.date}`;
    migratedDaily.set(key, {
      workspaceId: item.workspaceId,
      date: item.date,
      uploads: normalizeSafeInteger(
        item.uploads,
        MAX_ANALYTICS_COUNT
      ),
      uploadedLogicalBytes: normalizeSafeInteger(
        item.uploadedLogicalBytes,
        MAX_ANALYTICS_BYTES
      ),
      shareViews: trackedShareViews,
      imageShareViews
    });
  }
  const shareAccessEvents = Array.isArray(parsed.shareAccessEvents)
    ? parsed.shareAccessEvents
    : [];
  for (const event of shareAccessEvents) {
    if (!isRecord(event)) continue;
    if (
      !event.workspaceId ||
      !event.imageId ||
      !event.createdAt ||
      !workspaceIds.has(event.workspaceId)
    ) {
      continue;
    }
    const date = event.createdAt.slice(0, 10);
    if (
      !validCalendarDate(date) ||
      imageWorkspaceIds.get(event.imageId) !== event.workspaceId
    ) {
      continue;
    }
    const key = `${event.workspaceId}:${date}`;
    const daily = migratedDaily.get(key) ?? {
      workspaceId: event.workspaceId,
      date,
      uploads: 0,
      uploadedLogicalBytes: 0,
      shareViews: 0,
      imageShareViews: {}
    };
    if (daily.shareViews < MAX_ANALYTICS_COUNT) {
      daily.shareViews += 1;
      daily.imageShareViews[event.imageId] = Math.min(
        MAX_ANALYTICS_COUNT,
        (daily.imageShareViews[event.imageId] ?? 0) + 1
      );
    }
    migratedDaily.set(key, daily);
  }
  const analyticsDaily = [...migratedDaily.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter(
      (item, index, all) =>
        all
          .filter((candidate) => candidate.workspaceId === item.workspaceId)
          .indexOf(item) < 400
    );
  return {
    ...initialState(),
    ...parsed,
    schemaVersion: 7,
    site: parsed.site
      ? {
          ...parsed.site,
          siteName:
            typeof parsed.site.siteName === "string" &&
            parsed.site.siteName.trim().length >= 2
              ? parsed.site.siteName.trim().slice(0, 60)
              : "OU-Image Hosting",
          siteDescription:
            typeof parsed.site.siteDescription === "string"
              ? parsed.site.siteDescription.trim().slice(0, 500)
              : "",
          registrationEnabled:
            parsed.site.registrationEnabled === true
        }
      : undefined,
    users: (parsed.users ?? []).map((user) => ({
      ...user,
      notificationPreferences:
        user.notificationPreferences ?? defaultNotificationPreferences(),
      notificationReadEventIds: user.notificationReadEventIds ?? []
    })),
    sessions: parsed.sessions ?? [],
    passwordResets: parsed.passwordResets ?? [],
    images,
    imageShares: (parsed.imageShares ?? []).map((share) => ({
      ...share,
      workspaceId: share.workspaceId ?? `personal-${share.userId}`
    })),
    albums: (parsed.albums ?? []).map((album) => ({
      ...album,
      workspaceId: album.workspaceId ?? `personal-${album.userId}`
    })),
    tags: (parsed.tags ?? []).map((tag) => ({
      ...tag,
      workspaceId: tag.workspaceId ?? `personal-${tag.userId}`
    })),
    storageSettings:
      parsed.storageSettings ?? initialState().storageSettings,
    deliverySettings:
      parsed.deliverySettings ?? initialState().deliverySettings,
    backupSettings:
      parsed.backupSettings ?? initialState().backupSettings,
    backups: (Array.isArray(parsed.backups) ? parsed.backups : [])
      .map((backup) => normalizeBackup(backup, migrationTimestamp))
      .filter((backup): backup is StoredBackup => Boolean(backup))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 200),
    storageMigrations: (
      Array.isArray(parsed.storageMigrations)
        ? parsed.storageMigrations
        : []
    )
      .map((migration) =>
        normalizeStorageMigration(migration, migrationTimestamp)
      )
      .filter(
        (migration): migration is StoredStorageMigration =>
          Boolean(migration)
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 200),
    workspaces: migratedWorkspace.workspaces,
    workspaceSettings,
    workspaceMembers: migratedWorkspace.workspaceMembers,
    workspaceInvitations: parsed.workspaceInvitations ?? [],
    apiTokens: (parsed.apiTokens ?? []).map((token) => ({
      ...token,
      ipAllowlist: token.ipAllowlist ?? []
    })),
    loginChallenges: parsed.loginChallenges ?? [],
    auditEvents: parsed.auditEvents ?? [],
    systemEvents: (parsed.systemEvents ?? [])
      .filter(
        (event) =>
          (!event.workspaceId || workspaceIds.has(event.workspaceId)) &&
          event.type === "job.retry"
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 500),
    analyticsDaily,
    analyticsCoverage: migratedWorkspace.workspaces.map((workspace) => {
      const fallback =
        normalizeIso(workspace.createdAt) ?? migrationTimestamp;
      const existing = (
        Array.isArray(parsed.analyticsCoverage)
          ? parsed.analyticsCoverage
          : []
      ).find(
        (coverage) =>
          isRecord(coverage) && coverage.workspaceId === workspace.id
      );
      const canPreserveCoverage = parsed.schemaVersion === 7;
      return {
        workspaceId: workspace.id,
        uploads:
          (canPreserveCoverage
            ? normalizeCoverageState(existing?.uploads, fallback)
            : undefined) ?? {
            trackingStartedAt: fallback,
            status: "partial"
          },
        shareViews:
          (canPreserveCoverage
            ? normalizeCoverageState(existing?.shareViews, fallback)
            : undefined) ?? {
            trackingStartedAt: fallback,
            status: "partial"
          }
      };
    }),
    systemStatusHistory: (
      Array.isArray(parsed.systemStatusHistory)
        ? parsed.systemStatusHistory
        : []
    )
      .map(normalizeSystemStatus)
      .filter(
        (result): result is StoredSystemStatusResult => Boolean(result)
      )
      .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))
      .slice(0, 20)
  };
}

export class AppStore {
  private state: AppState = initialState();
  private queue = Promise.resolve();

  constructor(private readonly filePath: string | null) {}

  async initialize() {
    if (!this.filePath) return;
    try {
      const contents = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(contents) as MigratableAppState;
      this.state = migrateAppState(parsed);
      if (
        parsed.schemaVersion !== 7 ||
        !parsed.images ||
        !parsed.imageShares ||
        !parsed.albums ||
        !parsed.tags ||
        !parsed.storageSettings ||
        !parsed.deliverySettings ||
        !parsed.backupSettings ||
        !parsed.backups ||
        !parsed.storageMigrations ||
        !parsed.workspaces ||
        !parsed.workspaceSettings ||
        !parsed.workspaceMembers ||
        !parsed.workspaceInvitations ||
        !parsed.apiTokens ||
        !parsed.loginChallenges ||
        !parsed.auditEvents ||
        !parsed.systemEvents ||
        !parsed.analyticsDaily ||
        !parsed.analyticsCoverage ||
        !parsed.systemStatusHistory ||
        parsed.images.some(
          (image) =>
            !image.currentVersionId ||
            !image.versions ||
            !image.updatedAt ||
            !("favorite" in image) ||
            !image.favoriteUserIds ||
            !image.workspaceId ||
            !image.albumIds ||
            !image.tagIds
        )
      ) {
        await this.persist(this.state);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.persist(this.state);
    }
  }

  snapshot() {
    return structuredClone(this.state);
  }

  async update<T>(mutate: (draft: AppState) => T | Promise<T>) {
    let result!: T;
    const operation = this.queue.then(async () => {
      const draft = structuredClone(this.state);
      result = await mutate(draft);
      await this.persist(draft);
      this.state = draft;
    });
    this.queue = operation.catch(() => undefined);
    await operation;
    return result;
  }

  private async persist(state: AppState) {
    if (!this.filePath) return;
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporaryPath, this.filePath);
  }
}
