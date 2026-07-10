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
  schemaVersion: 6;
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
  workspaceMembers: StoredWorkspaceMember[];
  workspaceInvitations: StoredWorkspaceInvitation[];
  apiTokens: StoredApiToken[];
  loginChallenges: StoredLoginChallenge[];
  auditEvents: StoredAuditEvent[];
};

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
  schemaVersion: 6,
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
  workspaceMembers: [],
  workspaceInvitations: [],
  apiTokens: [],
  loginChallenges: [],
  auditEvents: []
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
};

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
  const migratedWorkspace = migrateWorkspaceState(parsed);
  return {
    ...initialState(),
    ...parsed,
    schemaVersion: 6,
    users: (parsed.users ?? []).map((user) => ({
      ...user,
      notificationPreferences:
        user.notificationPreferences ?? defaultNotificationPreferences(),
      notificationReadEventIds: user.notificationReadEventIds ?? []
    })),
    sessions: parsed.sessions ?? [],
    passwordResets: parsed.passwordResets ?? [],
    images: (parsed.images ?? []).map(migrateImage),
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
    backups: parsed.backups ?? [],
    storageMigrations: parsed.storageMigrations ?? [],
    workspaces: migratedWorkspace.workspaces,
    workspaceMembers: migratedWorkspace.workspaceMembers,
    workspaceInvitations: parsed.workspaceInvitations ?? [],
    apiTokens: (parsed.apiTokens ?? []).map((token) => ({
      ...token,
      ipAllowlist: token.ipAllowlist ?? []
    })),
    loginChallenges: parsed.loginChallenges ?? [],
    auditEvents: parsed.auditEvents ?? []
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
        parsed.schemaVersion !== 6 ||
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
        !parsed.workspaceMembers ||
        !parsed.workspaceInvitations ||
        !parsed.apiTokens ||
        !parsed.loginChallenges ||
        !parsed.auditEvents ||
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
      this.state = draft;
      await this.persist(draft);
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
