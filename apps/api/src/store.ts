import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type ThemePreference = "light" | "dark" | "system";

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
  name: string;
  description: string;
  coverImageId?: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredTag = {
  id: string;
  userId: string;
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

export type AppState = {
  schemaVersion: 5;
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
  schemaVersion: 5,
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
  storageMigrations: []
});

type MigratableImage = Omit<
  StoredImage,
  | "currentVersionId"
  | "versions"
  | "updatedAt"
  | "favorite"
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
    albumIds: image.albumIds ?? [],
    tagIds: image.tagIds ?? [],
    updatedAt: image.updatedAt ?? image.createdAt
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
      const parsed = JSON.parse(contents) as Partial<AppState>;
      this.state = {
        ...initialState(),
        ...parsed,
        schemaVersion: 5,
        users: parsed.users ?? [],
        sessions: parsed.sessions ?? [],
        passwordResets: parsed.passwordResets ?? [],
        images: (parsed.images ?? []).map(migrateImage),
        imageShares: parsed.imageShares ?? [],
        albums: parsed.albums ?? [],
        tags: parsed.tags ?? [],
        storageSettings: parsed.storageSettings ?? initialState().storageSettings,
        deliverySettings:
          parsed.deliverySettings ?? initialState().deliverySettings,
        backupSettings: parsed.backupSettings ?? initialState().backupSettings,
        backups: parsed.backups ?? [],
        storageMigrations: parsed.storageMigrations ?? []
      };
      if (
        parsed.schemaVersion !== 5 ||
        !parsed.images ||
        !parsed.imageShares ||
        !parsed.albums ||
        !parsed.tags ||
        !parsed.storageSettings ||
        !parsed.deliverySettings ||
        !parsed.backupSettings ||
        !parsed.backups ||
        !parsed.storageMigrations ||
        parsed.images.some(
          (image) =>
            !image.currentVersionId ||
            !image.versions ||
            !image.updatedAt ||
            !("favorite" in image) ||
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
