import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID
} from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import {
  requireSession,
  type Principal
} from "./access.js";
import { PublicError } from "./errors.js";
import {
  migrateAppState,
  type AppState,
  type AppStore,
  type BackupSettings,
  type RemoteStorageSettings,
  type StorageProvider,
  type StoredBackup,
  type StoredStorageMigration
} from "./store.js";
import type { MaintenanceGate } from "./maintenance.js";
type LegacyBackupState = Omit<Partial<AppState>, "schemaVersion"> & {
  schemaVersion: number;
};

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const MAX_BACKUP_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_BACKUP_ENVELOPE_BYTES = 256 * 1024 * 1024;
const MAX_BACKUP_TOTAL_FILE_BYTES = 128 * 1024 * 1024;
const MAX_BACKUP_SINGLE_FILE_BYTES = 24 * 1024 * 1024;
const MAX_BACKUP_FILES = 5000;
const MAX_BACKUP_COMPRESSION_RATIO = 200;

type InfrastructureOptions = {
  store: AppStore;
  dataDirectory: string;
  now: () => Date;
  authenticate: (request: FastifyRequest) => Principal;
  maintenance: MaintenanceGate;
};

type RemoteInput = {
  endpoint?: string;
  bucket?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  publicBaseUrl?: string | null;
  pathStyle?: boolean;
};

type SettingsBody = {
  storage?: {
    active?: StorageProvider;
    s3?: RemoteInput;
    r2?: RemoteInput;
  };
  delivery?: {
    customDomain?: string | null;
    linkTemplate?: string;
    hotlinkEnabled?: boolean;
    allowedReferers?: string[];
    allowEmptyReferer?: boolean;
    signedUrls?: boolean;
    signedUrlTtlSeconds?: number;
  };
  backup?: Partial<
    Pick<
      BackupSettings,
      "scheduleEnabled" | "intervalHours" | "retentionCount"
    >
  >;
};

type StorageTestBody = {
  provider: StorageProvider;
  config?: RemoteInput;
};

type MigrationBody = {
  source: StorageProvider;
  target: StorageProvider;
};

type IdParams = { id: string };

type RuntimeRemoteConfig = Omit<
  RemoteStorageSettings,
  "secretAccessKeyCiphertext"
> & {
  secretAccessKey: string;
};

type BackupEnvelope = {
  format: "ou-image-backup-v1";
  createdAt: string;
  manifest: {
    stateSha256: string;
    files: Array<{
      path: string;
      size: number;
      sha256: string;
    }>;
  };
  state: LegacyBackupState;
  files: Array<{
    path: string;
    contentBase64: string;
  }>;
};

const remoteSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    endpoint: { type: "string", minLength: 8, maxLength: 500 },
    bucket: { type: "string", minLength: 1, maxLength: 128 },
    region: { type: "string", minLength: 1, maxLength: 80 },
    accessKeyId: { type: "string", minLength: 1, maxLength: 256 },
    secretAccessKey: { type: "string", minLength: 8, maxLength: 512 },
    publicBaseUrl: {
      anyOf: [
        { type: "string", minLength: 8, maxLength: 500 },
        { type: "null" }
      ]
    },
    pathStyle: { type: "boolean" }
  }
} as const;

const idParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 80 }
  }
} as const;

function requireOwner(
  request: FastifyRequest,
  authenticate: InfrastructureOptions["authenticate"]
) {
  const principal = authenticate(request);
  requireSession(principal);
  if (principal.user.role !== "owner") {
    throw new PublicError(403, "OWNER_REQUIRED", "仅站点所有者可执行该操作");
  }
  return principal;
}

function secretKey() {
  const secret = process.env.OU_SECRET_KEY;
  if (!secret) return null;
  return createHash("sha256").update(secret).digest();
}

function encryptSecret(value: string) {
  const key = secretKey();
  if (!key) {
    throw new PublicError(
      400,
      "SECRET_KEY_REQUIRED",
      "配置 OU_SECRET_KEY 后才能保存远端存储密钥"
    );
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(".");
}

function decryptSecret(value: string) {
  const key = secretKey();
  if (!key) {
    throw new PublicError(
      400,
      "SECRET_KEY_REQUIRED",
      "当前环境缺少 OU_SECRET_KEY"
    );
  }
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (
    version !== "v1" ||
    !ivValue ||
    !tagValue ||
    !encryptedValue
  ) {
    throw new PublicError(
      500,
      "INVALID_ENCRYPTED_SECRET",
      "远端存储密钥记录无效"
    );
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivValue, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new PublicError(
      500,
      "SECRET_DECRYPTION_FAILED",
      "无法解密远端存储密钥"
    );
  }
}

function normalizeUrl(value: string, code: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new PublicError(400, code, "请输入有效的 HTTP 或 HTTPS 地址");
  }
}

function normalizeOrigin(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    return url.origin.toLowerCase();
  } catch {
    throw new PublicError(
      400,
      "INVALID_ALLOWED_REFERER",
      "防盗链来源必须是有效的 HTTP 或 HTTPS 地址"
    );
  }
}

function validateTemplate(value: string) {
  const template = value.trim();
  if (
    !template ||
    template.length > 500 ||
    template.includes("\\") ||
    template.includes("..") ||
    /(?:javascript|data|vbscript):/i.test(template) ||
    !template.includes("{id}") ||
    (!template.includes("{path}") && !template.includes("{variant}"))
  ) {
    throw new PublicError(
      400,
      "INVALID_LINK_TEMPLATE",
      "链接模板必须安全并包含 {path} 或 {id}/{variant}"
    );
  }
  return template;
}

function validateRemote(
  value: RemoteStorageSettings,
  requireSecret: boolean
) {
  if (
    !value.endpoint ||
    !value.bucket ||
    !value.region ||
    !value.accessKeyId ||
    (requireSecret && !value.secretAccessKeyCiphertext)
  ) {
    throw new PublicError(
      400,
      "INCOMPLETE_STORAGE_CONFIG",
      "远端存储配置不完整"
    );
  }
}

function mergeRemote(
  existing: RemoteStorageSettings | undefined,
  input: RemoteInput,
  provider: "s3" | "r2"
) {
  const merged: RemoteStorageSettings = {
    endpoint: input.endpoint
      ? normalizeUrl(input.endpoint, "INVALID_STORAGE_ENDPOINT")
      : existing?.endpoint ?? "",
    bucket: input.bucket?.trim() ?? existing?.bucket ?? "",
    region:
      input.region?.trim() ??
      existing?.region ??
      (provider === "r2" ? "auto" : ""),
    accessKeyId:
      input.accessKeyId?.trim() ?? existing?.accessKeyId ?? "",
    secretAccessKeyCiphertext: input.secretAccessKey
      ? encryptSecret(input.secretAccessKey)
      : existing?.secretAccessKeyCiphertext,
    publicBaseUrl:
      input.publicBaseUrl === null
        ? undefined
        : input.publicBaseUrl
          ? normalizeUrl(input.publicBaseUrl, "INVALID_PUBLIC_BASE_URL")
          : existing?.publicBaseUrl,
    pathStyle: input.pathStyle ?? existing?.pathStyle ?? true
  };
  validateRemote(merged, false);
  return merged;
}

function publicRemote(value: RemoteStorageSettings | undefined) {
  if (!value) {
    return {
      endpoint: "",
      bucket: "",
      region: "",
      accessKeyId: "",
      publicBaseUrl: undefined,
      pathStyle: true,
      secretConfigured: false
    };
  }
  return {
    endpoint: value.endpoint,
    bucket: value.bucket,
    region: value.region,
    accessKeyId: value.accessKeyId,
    publicBaseUrl: value.publicBaseUrl,
    pathStyle: value.pathStyle,
    secretConfigured: Boolean(value.secretAccessKeyCiphertext)
  };
}

function publicSettings(state: AppState) {
  return {
    storage: {
      active: state.storageSettings.active,
      local: { configured: true },
      s3: publicRemote(state.storageSettings.s3),
      r2: publicRemote(state.storageSettings.r2)
    },
    delivery: state.deliverySettings,
    backup: state.backupSettings
  };
}

function runtimeRemote(
  state: AppState,
  provider: "s3" | "r2",
  override?: RemoteInput
) {
  const stored = state.storageSettings[provider];
  const endpoint = override?.endpoint
    ? normalizeUrl(override.endpoint, "INVALID_STORAGE_ENDPOINT")
    : stored?.endpoint ?? "";
  const bucket = override?.bucket?.trim() ?? stored?.bucket ?? "";
  const region =
    override?.region?.trim() ??
    stored?.region ??
    (provider === "r2" ? "auto" : "");
  const accessKeyId =
    override?.accessKeyId?.trim() ?? stored?.accessKeyId ?? "";
  const secretAccessKey =
    override?.secretAccessKey ??
    (stored?.secretAccessKeyCiphertext
      ? decryptSecret(stored.secretAccessKeyCiphertext)
      : "");
  const publicBaseUrl =
    override?.publicBaseUrl === null
      ? undefined
      : override?.publicBaseUrl
        ? normalizeUrl(override.publicBaseUrl, "INVALID_PUBLIC_BASE_URL")
        : stored?.publicBaseUrl;
  const config: RuntimeRemoteConfig = {
    endpoint,
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl,
    pathStyle: override?.pathStyle ?? stored?.pathStyle ?? true
  };
  if (
    !config.endpoint ||
    !config.bucket ||
    !config.region ||
    !config.accessKeyId ||
    !config.secretAccessKey
  ) {
    throw new PublicError(
      400,
      "INCOMPLETE_STORAGE_CONFIG",
      "远端存储配置不完整"
    );
  }
  return config;
}

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function awsEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function remoteUrl(config: RuntimeRemoteConfig, key?: string) {
  const url = new URL(config.endpoint);
  const keyPath = key
    ? key.split("/").map(awsEncode).join("/")
    : "";
  if (config.pathStyle) {
    url.pathname = `/${awsEncode(config.bucket)}${keyPath ? `/${keyPath}` : ""}`;
  } else {
    url.hostname = `${config.bucket}.${url.hostname}`;
    url.pathname = keyPath ? `/${keyPath}` : "/";
  }
  return url;
}

async function signedS3Request(
  config: RuntimeRemoteConfig,
  method: "HEAD" | "PUT",
  timestamp: Date,
  key?: string,
  body?: Buffer
) {
  const url = remoteUrl(config, key);
  const amzDate = timestamp
    .toISOString()
    .replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(body ?? Buffer.alloc(0));
  const canonicalHeaders =
    `host:${url.host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method,
    url.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const scope = `${date}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256(canonicalRequest)
  ].join("\n");
  const dateKey = hmac(`AWS4${config.secretAccessKey}`, date);
  const regionKey = hmac(dateKey, config.region);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(url, {
    method,
    headers: {
      authorization,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...(body ? { "content-type": "application/octet-stream" } : {})
    },
    body: body ? new Uint8Array(body).buffer : undefined
  });
  if (!response.ok) {
    throw new PublicError(
      400,
      "REMOTE_STORAGE_FAILED",
      `远端存储返回 HTTP ${response.status}`
    );
  }
}

async function listFiles(root: string, relative = "") {
  const directory = path.join(root, relative);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, child)));
    } else if (entry.isFile()) {
      files.push(child);
    }
  }
  return files;
}

function safeRelativePath(value: string) {
  if (
    !value ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new PublicError(
      400,
      "INVALID_BACKUP_PATH",
      "备份包含不安全的文件路径"
    );
  }
  return value;
}

function safeDataPath(root: string, relative: string) {
  const safe = safeRelativePath(relative);
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, safe);
  if (!target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new PublicError(
      400,
      "INVALID_BACKUP_PATH",
      "备份包含不安全的文件路径"
    );
  }
  return target;
}

function backupLimit(message: string): never {
  throw new PublicError(400, "BACKUP_LIMIT_EXCEEDED", message);
}

function validIso(value: unknown) {
  return (
    typeof value === "string" &&
    value.length <= 50 &&
    Number.isFinite(new Date(value).getTime())
  );
}

async function stageBackupArchive(
  archivePath: string,
  backup: StoredBackup,
  stagingStorageRoot: string
) {
  const archiveStat = await stat(archivePath);
  if (
    archiveStat.size <= 0 ||
    archiveStat.size > MAX_BACKUP_ARCHIVE_BYTES
  ) {
    backupLimit("备份归档大小超过安全限制");
  }
  if (backup.size !== undefined && backup.size !== archiveStat.size) {
    throw new PublicError(
      400,
      "BACKUP_CHECKSUM_MISMATCH",
      "备份归档大小校验失败"
    );
  }
  const archive = await readFile(archivePath);
  if (backup.checksum && sha256(archive) !== backup.checksum) {
    throw new PublicError(
      400,
      "BACKUP_CHECKSUM_MISMATCH",
      "备份归档校验失败"
    );
  }
  let expanded: Buffer;
  try {
    expanded = await gunzipAsync(archive, {
      maxOutputLength: MAX_BACKUP_ENVELOPE_BYTES
    });
  } catch {
    throw new PublicError(400, "INVALID_BACKUP", "备份归档无法解析");
  }
  if (
    expanded.byteLength > MAX_BACKUP_ENVELOPE_BYTES ||
    expanded.byteLength / archive.byteLength >
      MAX_BACKUP_COMPRESSION_RATIO
  ) {
    backupLimit("备份归档压缩比或解压大小超过安全限制");
  }
  let envelope: BackupEnvelope;
  try {
    envelope = JSON.parse(expanded.toString("utf8")) as BackupEnvelope;
  } catch {
    throw new PublicError(400, "INVALID_BACKUP", "备份归档无法解析");
  }
  if (
    !envelope ||
    typeof envelope !== "object" ||
    envelope.format !== "ou-image-backup-v1" ||
    !validIso(envelope.createdAt) ||
    !envelope.manifest ||
    typeof envelope.manifest !== "object" ||
    typeof envelope.manifest.stateSha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(envelope.manifest.stateSha256) ||
    !Array.isArray(envelope.manifest.files) ||
    !Array.isArray(envelope.files) ||
    !envelope.state ||
    typeof envelope.state !== "object" ||
    ![5, 6, 7].includes(envelope.state.schemaVersion)
  ) {
    throw new PublicError(400, "INVALID_BACKUP", "备份清单校验失败");
  }
  if (
    envelope.files.length > MAX_BACKUP_FILES ||
    envelope.manifest.files.length > MAX_BACKUP_FILES
  ) {
    backupLimit("备份文件数量超过安全限制");
  }
  const stateJson = JSON.stringify(envelope.state);
  if (
    sha256(stateJson) !== envelope.manifest.stateSha256 ||
    envelope.files.length !== envelope.manifest.files.length
  ) {
    throw new PublicError(400, "INVALID_BACKUP", "备份清单校验失败");
  }
  const migratedState = migrateAppState(envelope.state);
  const encodedByPath = new Map<string, string>();
  for (const file of envelope.files) {
    if (
      !file ||
      typeof file !== "object" ||
      typeof file.path !== "string" ||
      typeof file.contentBase64 !== "string"
    ) {
      throw new PublicError(400, "INVALID_BACKUP", "备份文件记录无效");
    }
    const safe = safeRelativePath(file.path);
    if (
      encodedByPath.has(safe) ||
      file.contentBase64.length >
        Math.ceil(MAX_BACKUP_SINGLE_FILE_BYTES / 3) * 4 + 4
    ) {
      throw new PublicError(
        400,
        "INVALID_BACKUP",
        "备份包含重复路径或超限文件"
      );
    }
    encodedByPath.set(safe, file.contentBase64);
  }
  const manifestPaths = new Set<string>();
  let totalBytes = 0;
  await mkdir(stagingStorageRoot, { recursive: true });
  for (const manifest of envelope.manifest.files) {
    if (
      !manifest ||
      typeof manifest !== "object" ||
      typeof manifest.path !== "string" ||
      !Number.isSafeInteger(manifest.size) ||
      manifest.size < 0 ||
      typeof manifest.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/i.test(manifest.sha256)
    ) {
      throw new PublicError(400, "INVALID_BACKUP", "备份文件清单无效");
    }
    if (manifest.size > MAX_BACKUP_SINGLE_FILE_BYTES) {
      backupLimit("备份包含超过单文件限制的内容");
    }
    const safe = safeRelativePath(manifest.path);
    if (manifestPaths.has(safe)) {
      throw new PublicError(
        400,
        "INVALID_BACKUP",
        "备份包含重复文件路径"
      );
    }
    manifestPaths.add(safe);
    totalBytes += manifest.size;
    if (totalBytes > MAX_BACKUP_TOTAL_FILE_BYTES) {
      backupLimit("备份文件总大小超过安全限制");
    }
    const encoded = encodedByPath.get(safe);
    if (encoded === undefined) {
      throw new PublicError(400, "INVALID_BACKUP", "备份缺少清单文件");
    }
    const content = Buffer.from(encoded, "base64");
    if (
      content.toString("base64") !== encoded ||
      content.byteLength !== manifest.size ||
      sha256(content) !== manifest.sha256
    ) {
      throw new PublicError(
        400,
        "BACKUP_CHECKSUM_MISMATCH",
        "备份文件校验失败"
      );
    }
    const target = safeDataPath(stagingStorageRoot, safe);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, { mode: 0o600 });
  }
  if (manifestPaths.size !== encodedByPath.size) {
    throw new PublicError(400, "INVALID_BACKUP", "备份清单文件不一致");
  }
  return {
    migratedState,
    fileCount: envelope.files.length
  };
}

async function switchRestoredStorage(
  store: AppStore,
  storageRoot: string,
  stagedStorageRoot: string,
  rollbackRoot: string,
  migratedState: AppState
) {
  await rm(rollbackRoot, { recursive: true, force: true });
  let previousMoved = false;
  let stagedInstalled = false;
  try {
    try {
      await rename(storageRoot, rollbackRoot);
      previousMoved = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(stagedStorageRoot, storageRoot);
    stagedInstalled = true;
    await store.update((draft) => {
      const backups = draft.backups;
      const migrations = draft.storageMigrations;
      Object.assign(draft, migratedState);
      draft.backups = backups;
      draft.storageMigrations = migrations;
    });
  } catch (error) {
    let rollbackFailure: unknown;
    if (stagedInstalled) {
      try {
        await rm(storageRoot, { recursive: true, force: true });
      } catch (cleanupError) {
        rollbackFailure = cleanupError;
      }
    }
    if (previousMoved && !rollbackFailure) {
      try {
        await rename(rollbackRoot, storageRoot);
      } catch (renameError) {
        rollbackFailure = renameError;
      }
    }
    if (rollbackFailure) {
      throw new Error("restore rollback failed", {
        cause: rollbackFailure
      });
    }
    throw error;
  }
  await rm(rollbackRoot, { recursive: true, force: true }).catch(
    () => undefined
  );
}

function publicBackup(backup: StoredBackup) {
  return {
    id: backup.id,
    status: backup.status,
    createdAt: backup.createdAt,
    completedAt: backup.completedAt,
    size: backup.size,
    fileCount: backup.fileCount,
    checksum: backup.checksum,
    error: backup.error
  };
}

function publicMigration(migration: StoredStorageMigration) {
  return {
    id: migration.id,
    source: migration.source,
    target: migration.target,
    status: migration.status,
    total: migration.total,
    completed: migration.completed,
    failed: migration.failed,
    createdAt: migration.createdAt,
    completedAt: migration.completedAt,
    error: migration.error
  };
}

async function sendBackup(
  reply: FastifyReply,
  filePath: string,
  backup: StoredBackup
) {
  reply
    .type("application/gzip")
    .header("cache-control", "private, no-store")
    .header(
      "content-disposition",
      `attachment; filename="ou-image-backup-${backup.id}.oubackup.gz"`
    );
  return reply.send(createReadStream(filePath));
}

export function registerInfrastructureRoutes(
  app: FastifyInstance,
  options: InfrastructureOptions
) {
  const { store, dataDirectory, now, authenticate, maintenance } = options;
  const storageRoot = path.join(dataDirectory, "storage");
  const backupsRoot = path.join(dataDirectory, "backups");

  app.get("/storage/settings", async (request) => {
    requireOwner(request, authenticate);
    return publicSettings(store.snapshot());
  });

  app.patch<{ Body: SettingsBody }>(
    "/storage/settings",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            storage: {
              type: "object",
              additionalProperties: false,
              minProperties: 1,
              properties: {
                active: {
                  type: "string",
                  enum: ["local", "s3", "r2"]
                },
                s3: remoteSchema,
                r2: remoteSchema
              }
            },
            delivery: {
              type: "object",
              additionalProperties: false,
              minProperties: 1,
              properties: {
                customDomain: {
                  anyOf: [
                    { type: "string", minLength: 8, maxLength: 500 },
                    { type: "null" }
                  ]
                },
                linkTemplate: {
                  type: "string",
                  minLength: 1,
                  maxLength: 500
                },
                hotlinkEnabled: { type: "boolean" },
                allowedReferers: {
                  type: "array",
                  maxItems: 50,
                  uniqueItems: true,
                  items: {
                    type: "string",
                    minLength: 8,
                    maxLength: 500
                  }
                },
                allowEmptyReferer: { type: "boolean" },
                signedUrls: { type: "boolean" },
                signedUrlTtlSeconds: {
                  type: "integer",
                  minimum: 60,
                  maximum: 604800
                }
              }
            },
            backup: {
              type: "object",
              additionalProperties: false,
              minProperties: 1,
              properties: {
                scheduleEnabled: { type: "boolean" },
                intervalHours: {
                  type: "integer",
                  minimum: 1,
                  maximum: 720
                },
                retentionCount: {
                  type: "integer",
                  minimum: 1,
                  maximum: 50
                }
              }
            }
          }
        }
      }
    },
    async (request) => {
      requireOwner(request, authenticate);
      if (
        request.body.storage?.active &&
        request.body.storage.active !== "local"
      ) {
        throw new PublicError(
          400,
          "REMOTE_ACTIVE_UNSUPPORTED",
          "当前版本仅支持本地存储作为活动写入源"
        );
      }
      await store.update((state) => {
        const input = request.body;
        if (input.storage?.s3) {
          state.storageSettings.s3 = mergeRemote(
            state.storageSettings.s3,
            input.storage.s3,
            "s3"
          );
        }
        if (input.storage?.r2) {
          state.storageSettings.r2 = mergeRemote(
            state.storageSettings.r2,
            input.storage.r2,
            "r2"
          );
        }
        if (input.storage?.active) {
          state.storageSettings.active = input.storage.active;
        }

        if (input.delivery) {
          const current = state.deliverySettings;
          if (input.delivery.customDomain === null) {
            delete current.customDomain;
          } else if (input.delivery.customDomain !== undefined) {
            current.customDomain = normalizeUrl(
              input.delivery.customDomain,
              "INVALID_CUSTOM_DOMAIN"
            );
          }
          if (input.delivery.linkTemplate !== undefined) {
            current.linkTemplate = validateTemplate(
              input.delivery.linkTemplate
            );
          }
          if (input.delivery.hotlinkEnabled !== undefined) {
            current.hotlinkEnabled = input.delivery.hotlinkEnabled;
          }
          if (input.delivery.allowedReferers !== undefined) {
            current.allowedReferers = [
              ...new Set(input.delivery.allowedReferers.map(normalizeOrigin))
            ];
          }
          if (input.delivery.allowEmptyReferer !== undefined) {
            current.allowEmptyReferer = input.delivery.allowEmptyReferer;
          }
          if (input.delivery.signedUrls !== undefined) {
            if (input.delivery.signedUrls && !secretKey()) {
              throw new PublicError(
                400,
                "SECRET_KEY_REQUIRED",
                "启用签名链接前必须配置 OU_SECRET_KEY"
              );
            }
            current.signedUrls = input.delivery.signedUrls;
          }
          if (input.delivery.signedUrlTtlSeconds !== undefined) {
            current.signedUrlTtlSeconds =
              input.delivery.signedUrlTtlSeconds;
          }
        }

        if (input.backup) {
          Object.assign(state.backupSettings, input.backup);
        }
      });
      return publicSettings(store.snapshot());
    }
  );

  app.post<{ Body: StorageTestBody }>(
    "/storage/test",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["provider"],
          properties: {
            provider: {
              type: "string",
              enum: ["local", "s3", "r2"]
            },
            config: remoteSchema
          }
        }
      }
    },
    async (request) => {
      requireOwner(request, authenticate);
      const startedAt = Date.now();
      if (request.body.provider === "local") {
        await mkdir(storageRoot, { recursive: true });
        const probe = path.join(
          storageRoot,
          `.ou-storage-probe-${randomUUID()}`
        );
        const value = randomBytes(16);
        await writeFile(probe, value, { mode: 0o600 });
        const read = await readFile(probe);
        await unlink(probe);
        if (!read.equals(value)) {
          throw new PublicError(
            500,
            "LOCAL_STORAGE_FAILED",
            "本地存储读写校验失败"
          );
        }
      } else {
        const config = runtimeRemote(
          store.snapshot(),
          request.body.provider,
          request.body.config
        );
        await signedS3Request(config, "HEAD", now());
      }
      return {
        provider: request.body.provider,
        status: "ok",
        latencyMs: Date.now() - startedAt
      };
    }
  );

  app.get("/storage/health", async (request) => {
    requireOwner(request, authenticate);
    await mkdir(storageRoot, { recursive: true });
    const files = await listFiles(storageRoot);
    let bytes = 0;
    for (const relative of files) {
      bytes += (await stat(path.join(storageRoot, relative))).size;
    }
    const filesystem = await statfs(dataDirectory);
    const state = store.snapshot();
    return {
      active: state.storageSettings.active,
      providers: {
        local: {
          status: "ok",
          files: files.length,
          bytes,
          freeBytes: Number(filesystem.bavail) * Number(filesystem.bsize),
          totalBytes: Number(filesystem.blocks) * Number(filesystem.bsize)
        },
        s3: {
          status: state.storageSettings.s3?.secretAccessKeyCiphertext
            ? "configured"
            : "unconfigured"
        },
        r2: {
          status: state.storageSettings.r2?.secretAccessKeyCiphertext
            ? "configured"
            : "unconfigured"
        }
      }
    };
  });

  app.get("/storage/migrations", async (request) => {
    requireOwner(request, authenticate);
    return {
      migrations: store
        .snapshot()
        .storageMigrations.slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(publicMigration)
    };
  });

  app.post<{ Body: MigrationBody }>(
    "/storage/migrations",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["source", "target"],
          properties: {
            source: {
              type: "string",
              enum: ["local", "s3", "r2"]
            },
            target: {
              type: "string",
              enum: ["local", "s3", "r2"]
            }
          }
        }
      }
    },
    async (request, reply) => {
      const { user } = requireOwner(request, authenticate);
      const timestamp = now();
      const migration: StoredStorageMigration = {
        id: randomUUID(),
        source: request.body.source,
        target: request.body.target,
        status: "running",
        total: 0,
        completed: 0,
        failed: 0,
        createdBy: user.id,
        createdAt: timestamp.toISOString()
      };
      await store.update((state) => {
        state.storageMigrations.push(migration);
      });
      if (
        request.body.source !== "local" ||
        !["s3", "r2"].includes(request.body.target)
      ) {
        const completedAt = now().toISOString();
        await store.update((state) => {
          const current = state.storageMigrations.find(
            (item) => item.id === migration.id
          )!;
          current.status = "failed";
          current.completedAt = completedAt;
          current.error =
            "当前版本仅支持从本地存储迁移到 S3 或 R2";
        });
        throw new PublicError(
          400,
          "UNSUPPORTED_STORAGE_MIGRATION",
          "当前版本仅支持从本地存储迁移到 S3 或 R2"
        );
      }

      let config: RuntimeRemoteConfig;
      try {
        config = runtimeRemote(
          store.snapshot(),
          request.body.target as "s3" | "r2"
        );
      } catch (error) {
        await store.update((state) => {
          const current = state.storageMigrations.find(
            (item) => item.id === migration.id
          )!;
          current.status = "failed";
          current.completedAt = now().toISOString();
          current.error =
            error instanceof Error ? error.message : "远端配置不可用";
        });
        throw error;
      }

      const keys = await listFiles(storageRoot);
      await store.update((state) => {
        const current = state.storageMigrations.find(
          (item) => item.id === migration.id
        )!;
        current.total = keys.length;
      });
      let lastError: string | undefined;
      for (const key of keys) {
        try {
          const body = await readFile(path.join(storageRoot, key));
          await signedS3Request(config, "PUT", now(), key, body);
          await store.update((state) => {
            const current = state.storageMigrations.find(
              (item) => item.id === migration.id
            )!;
            current.completed += 1;
          });
        } catch (error) {
          lastError = error instanceof Error ? error.message : "迁移失败";
          await store.update((state) => {
            const current = state.storageMigrations.find(
              (item) => item.id === migration.id
            )!;
            current.failed += 1;
          });
        }
      }
      const completedAt = now().toISOString();
      const final = await store.update((state) => {
        const current = state.storageMigrations.find(
          (item) => item.id === migration.id
        )!;
        current.status = current.failed > 0 ? "failed" : "completed";
        current.completedAt = completedAt;
        if (lastError) current.error = lastError;
        return current;
      });
      return reply.status(201).send({
        migration: publicMigration(final)
      });
    }
  );

  app.get("/backups", async (request) => {
    requireOwner(request, authenticate);
    return {
      backups: store
        .snapshot()
        .backups.slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(publicBackup)
    };
  });

  app.post("/backups", async (request, reply) => {
    const { user } = requireOwner(request, authenticate);
    const timestamp = now();
    const backup: StoredBackup = {
      id: randomUUID(),
      status: "running",
      archiveKey: `backups/${randomUUID()}.oubackup.gz`,
      createdBy: user.id,
      createdAt: timestamp.toISOString(),
      fileCount: 0
    };
    await store.update((state) => {
      state.backups.push(backup);
    });

    try {
      await mkdir(backupsRoot, { recursive: true });
      const state = store.snapshot();
      state.backups = state.backups.filter((item) => item.id !== backup.id);
      const stateJson = JSON.stringify(state);
      const filePaths = await listFiles(storageRoot);
      if (filePaths.length > MAX_BACKUP_FILES) {
        backupLimit("备份文件数量超过安全限制");
      }
      const files: BackupEnvelope["files"] = [];
      const manifestFiles: BackupEnvelope["manifest"]["files"] = [];
      let totalFileBytes = 0;
      for (const relative of filePaths) {
        const safe = safeRelativePath(relative);
        const fileStat = await stat(path.join(storageRoot, safe));
        if (fileStat.size > MAX_BACKUP_SINGLE_FILE_BYTES) {
          backupLimit("备份包含超过单文件限制的内容");
        }
        totalFileBytes += fileStat.size;
        if (totalFileBytes > MAX_BACKUP_TOTAL_FILE_BYTES) {
          backupLimit("备份文件总大小超过安全限制");
        }
        const content = await readFile(path.join(storageRoot, safe));
        files.push({
          path: safe,
          contentBase64: content.toString("base64")
        });
        manifestFiles.push({
          path: safe,
          size: content.byteLength,
          sha256: sha256(content)
        });
      }
      const envelope: BackupEnvelope = {
        format: "ou-image-backup-v1",
        createdAt: timestamp.toISOString(),
        manifest: {
          stateSha256: sha256(stateJson),
          files: manifestFiles
        },
        state,
        files
      };
      const envelopeBuffer = Buffer.from(JSON.stringify(envelope));
      if (envelopeBuffer.byteLength > MAX_BACKUP_ENVELOPE_BYTES) {
        backupLimit("备份解压后大小超过安全限制");
      }
      const archive = await gzipAsync(envelopeBuffer, {
        level: 6
      });
      if (archive.byteLength > MAX_BACKUP_ARCHIVE_BYTES) {
        backupLimit("备份归档大小超过安全限制");
      }
      const archivePath = safeDataPath(dataDirectory, backup.archiveKey);
      await mkdir(path.dirname(archivePath), { recursive: true });
      await writeFile(archivePath, archive, { mode: 0o600 });
      const completedAt = now().toISOString();
      const completed = await store.update((draft) => {
        const current = draft.backups.find(
          (item) => item.id === backup.id
        )!;
        current.status = "completed";
        current.completedAt = completedAt;
        current.size = archive.byteLength;
        current.fileCount = files.length;
        current.checksum = sha256(archive);
        draft.backupSettings.lastBackupAt = completedAt;
        return current;
      });

      const completedBackups = store
        .snapshot()
        .backups.filter((item) => item.status === "completed")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const expired = completedBackups.slice(
        store.snapshot().backupSettings.retentionCount
      );
      for (const item of expired) {
        try {
          await unlink(safeDataPath(dataDirectory, item.archiveKey));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      if (expired.length > 0) {
        const expiredIds = new Set(expired.map((item) => item.id));
        await store.update((draft) => {
          draft.backups = draft.backups.filter(
            (item) => !expiredIds.has(item.id)
          );
        });
      }
      return reply.status(201).send({
        backup: publicBackup(completed)
      });
    } catch (error) {
      await store.update((state) => {
        const current = state.backups.find((item) => item.id === backup.id);
        if (!current) return;
        current.status = "failed";
        current.completedAt = now().toISOString();
        current.error =
          error instanceof Error ? error.message : "备份创建失败";
      });
      throw error;
    }
  });

  app.get<{ Params: IdParams }>(
    "/backups/:id/download",
    { schema: { params: idParamsSchema } },
    async (request, reply) => {
      requireOwner(request, authenticate);
      const backup = store
        .snapshot()
        .backups.find((item) => item.id === request.params.id);
      if (!backup || backup.status !== "completed") {
        throw new PublicError(404, "BACKUP_NOT_FOUND", "备份不存在");
      }
      return sendBackup(
        reply,
        safeDataPath(dataDirectory, backup.archiveKey),
        backup
      );
    }
  );

  app.post<{ Params: IdParams }>(
    "/backups/:id/restore",
    { schema: { params: idParamsSchema } },
    async (request) => {
      requireOwner(request, authenticate);
      const releaseRestore = await maintenance.beginRestore();
      const operationId = randomUUID();
      const stagingRoot = path.join(
        dataDirectory,
        `.restore-staging-${operationId}`
      );
      const stagedStorageRoot = path.join(stagingRoot, "storage");
      const rollbackRoot = path.join(
        dataDirectory,
        `.restore-rollback-${operationId}`
      );
      try {
        const backup = store
          .snapshot()
          .backups.find((item) => item.id === request.params.id);
        if (!backup || backup.status !== "completed") {
          throw new PublicError(404, "BACKUP_NOT_FOUND", "备份不存在");
        }
        await rm(stagingRoot, { recursive: true, force: true });
        const staged = await stageBackupArchive(
          safeDataPath(dataDirectory, backup.archiveKey),
          backup,
          stagedStorageRoot
        );
        await switchRestoredStorage(
          store,
          storageRoot,
          stagedStorageRoot,
          rollbackRoot,
          staged.migratedState
        );
        return {
          restored: true,
          files: staged.fileCount,
          backup: publicBackup(backup)
        };
      } finally {
        await rm(stagingRoot, { recursive: true, force: true });
        releaseRestore();
      }
    }
  );

  app.delete<{ Params: IdParams }>(
    "/backups/:id",
    { schema: { params: idParamsSchema } },
    async (request, reply) => {
      requireOwner(request, authenticate);
      const backup = store
        .snapshot()
        .backups.find((item) => item.id === request.params.id);
      if (!backup) {
        throw new PublicError(404, "BACKUP_NOT_FOUND", "备份不存在");
      }
      try {
        await unlink(safeDataPath(dataDirectory, backup.archiveKey));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await store.update((state) => {
        state.backups = state.backups.filter(
          (item) => item.id !== request.params.id
        );
      });
      return reply.status(204).send();
    }
  );
}
