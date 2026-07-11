import multipart from "@fastify/multipart";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import path from "node:path";
import sharp from "sharp";
import {
  assertDeliveryAccess,
  buildDeliveryUrl,
  canonicalFilePath
} from "./delivery.js";
import {
  addAuditEvent,
  hashRequestIp,
  requireCapability,
  type Principal
} from "./access.js";
import { backofficeAccessFor } from "./site-access.js";
import { PublicError } from "./errors.js";
import {
  hashOpaqueToken,
  signOpaquePayload,
  verifyOpaquePayloadSignature
} from "./security.js";
import { registerImageDetailRoutes } from "./image-details.js";
import { registerOrganizationRoutes } from "./organization.js";
import {
  calculateImageStorageBytes,
  defaultWorkspaceSettings,
  type AppState,
  type AppStore,
  type StoredImage,
  type StoredImageVersion
} from "./store.js";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_REMOTE_SIZE = 20 * 1024 * 1024;
const MAX_PIXELS = 80_000_000;
const REMOTE_UPLOAD_TIMEOUT_MS = 10_000;
const remoteAddressBlockList = new BlockList();

remoteAddressBlockList.addSubnet("0.0.0.0", 8, "ipv4");
remoteAddressBlockList.addSubnet("10.0.0.0", 8, "ipv4");
remoteAddressBlockList.addSubnet("100.64.0.0", 10, "ipv4");
remoteAddressBlockList.addSubnet("127.0.0.0", 8, "ipv4");
remoteAddressBlockList.addSubnet("169.254.0.0", 16, "ipv4");
remoteAddressBlockList.addSubnet("172.16.0.0", 12, "ipv4");
remoteAddressBlockList.addSubnet("192.0.0.0", 24, "ipv4");
remoteAddressBlockList.addSubnet("192.0.2.0", 24, "ipv4");
remoteAddressBlockList.addSubnet("192.168.0.0", 16, "ipv4");
remoteAddressBlockList.addSubnet("198.18.0.0", 15, "ipv4");
remoteAddressBlockList.addSubnet("198.51.100.0", 24, "ipv4");
remoteAddressBlockList.addSubnet("203.0.113.0", 24, "ipv4");
remoteAddressBlockList.addSubnet("224.0.0.0", 4, "ipv4");
remoteAddressBlockList.addSubnet("240.0.0.0", 4, "ipv4");
remoteAddressBlockList.addAddress("::", "ipv6");
remoteAddressBlockList.addAddress("::1", "ipv6");
remoteAddressBlockList.addSubnet("::ffff:0:0", 96, "ipv6");
remoteAddressBlockList.addSubnet("64:ff9b::", 96, "ipv6");
remoteAddressBlockList.addSubnet("100::", 64, "ipv6");
remoteAddressBlockList.addSubnet("2001:db8::", 32, "ipv6");
remoteAddressBlockList.addSubnet("fc00::", 7, "ipv6");
remoteAddressBlockList.addSubnet("fe80::", 10, "ipv6");
remoteAddressBlockList.addSubnet("ff00::", 8, "ipv6");
const supportedFormats = new Set(["jpeg", "png", "webp", "gif", "avif"]);
const extensionByFormat = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  gif: "gif",
  avif: "avif"
} as const;
const mimeByFormat = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif"
} as const;

type UploadRouteOptions = {
  store: AppStore;
  dataDirectory: string;
  now: () => Date;
  authenticate: (request: FastifyRequest) => Principal;
};

function workspaceDate(timestamp: Date, timezone: string) {
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

type UrlUploadBody = { url: string };
type UploadQuery = {
  q?: string;
  format?: "all" | StoredImage["format"];
  page?: string;
  limit?: string;
  sort?: "newest" | "oldest" | "name" | "size";
};
type PublicUploadQuery = {
  publicVisible?: "true" | "false" | "1" | "0";
};
type PublicImagesQuery = {
  sort?: "latest" | "hot" | "random";
  format?: "all" | StoredImage["format"];
  page?: string;
  limit?: string;
};
type BulkBody = {
  ids: string[];
  action:
    | "trash"
    | "add-to-albums"
    | "remove-from-albums"
    | "set-public-visibility"
    | "set-favorite";
  albumIds?: string[];
  publicVisible?: boolean;
  favorite?: boolean;
};

function publicImage(
  image: StoredImage,
  state: AppState,
  timestamp: Date,
  userId?: string
) {
  return {
    id: image.id,
    name: image.name,
    size: image.size,
    mime: image.mime,
    format: image.format,
    width: image.width,
    height: image.height,
    sha256: image.sha256,
    thumbnailUrl: buildDeliveryUrl(
      state,
      image.id,
      "thumbnail",
      timestamp
    ),
    originalUrl: buildDeliveryUrl(state, image.id, "original", timestamp),
    favorite: userId
      ? image.favoriteUserIds.includes(userId)
      : image.favorite,
    publicVisible: image.publicVisible,
    albumIds: image.albumIds,
    tagIds: image.tagIds,
    createdAt: image.createdAt,
    updatedAt: image.updatedAt,
    deletedAt: image.deletedAt
  };
}

function publicImageCard(
  image: StoredImage,
  state: AppState,
  timestamp: Date
) {
  const shareViews = state.analyticsDaily.reduce(
    (total, item) =>
      item.workspaceId === image.workspaceId
        ? total + (item.imageShareViews[image.id] ?? 0)
        : total,
    0
  );
  const uploader = state.users.find((user) => user.id === image.userId);
  return {
    id: image.id,
    name: state.site?.publicGalleryShowFileName ? image.name : undefined,
    size: image.size,
    mime: image.mime,
    format: image.format,
    width: image.width,
    height: image.height,
    shareViews,
    uploaderName: state.site?.publicGalleryShowUploader
      ? uploader?.displayName ?? "OU 用户"
      : undefined,
    thumbnailUrl: buildDeliveryUrl(state, image.id, "thumbnail", timestamp),
    originalUrl: buildDeliveryUrl(state, image.id, "original", timestamp),
    createdAt: state.site?.publicGalleryShowUploadTime
      ? image.createdAt
      : undefined
  };
}

function seededRandom(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function publicUploadPrincipal(state: AppState): Principal {
  const owner = state.users.find((user) => user.role === "owner") ?? state.users[0];
  if (!owner) {
    throw new PublicError(503, "SITE_NOT_READY", "站点尚未完成初始化");
  }
  const workspaceId = `personal-${owner.id}`;
  const workspace =
    state.workspaces.find((item) => item.id === workspaceId) ??
    state.workspaces.find((item) => item.ownerUserId === owner.id);
  if (!workspace) {
    throw new PublicError(503, "WORKSPACE_NOT_READY", "默认工作区不可用");
  }
  return {
    kind: "session",
    user: owner,
    workspace,
    workspaceId: workspace.id,
    role: "owner",
    scopes: []
  };
}

function sanitizeFilename(value: string) {
  const cleaned = path
    .basename(value)
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim();
  return (cleaned || `image-${Date.now()}`).slice(0, 180);
}

function normalizedSourceIp(value: string) {
  const normalized = value.trim().toLowerCase();
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ?? normalized;
}

function minuteBucket(timestamp: Date) {
  return timestamp.toISOString().slice(0, 16);
}

function challengeToken(
  first: number,
  second: number,
  expiresAt: number
) {
  const payload = Buffer.from(
    JSON.stringify({ id: randomUUID(), first, second, expiresAt })
  ).toString("base64url");
  return `${payload}.${signOpaquePayload(payload)}`;
}

function parseChallengeToken(token: string) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !verifyOpaquePayloadSignature(payload, signature)) {
    throw new PublicError(400, "HUMAN_CHALLENGE_INVALID", "人机验证已失效，请重新获取");
  }
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      id?: unknown;
      first?: unknown;
      second?: unknown;
      expiresAt?: unknown;
    };
    if (
      typeof value.id !== "string" ||
      typeof value.first !== "number" ||
      typeof value.second !== "number" ||
      typeof value.expiresAt !== "number"
    ) {
      throw new Error("invalid challenge payload");
    }
    return value as { id: string; first: number; second: number; expiresAt: number };
  } catch {
    throw new PublicError(400, "HUMAN_CHALLENGE_INVALID", "人机验证已失效，请重新获取");
  }
}

function isPrivateAddress(address: string) {
  const family = isIP(address);
  if (family !== 4 && family !== 6) return true;
  return remoteAddressBlockList.check(address, family === 4 ? "ipv4" : "ipv6");
}

async function assertRemoteUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PublicError(400, "INVALID_URL", "请输入有效的图片网址");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new PublicError(400, "INVALID_URL", "只支持 HTTP 或 HTTPS 图片网址");
  }
  if (url.username || url.password) {
    throw new PublicError(400, "INVALID_URL", "图片网址不能包含登录凭证");
  }
  let addresses;
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new PublicError(400, "REMOTE_FETCH_FAILED", "无法解析远程图片地址");
  }
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isPrivateAddress(address))
  ) {
    throw new PublicError(400, "BLOCKED_URL", "该网址指向受保护的网络地址");
  }
  const selected = addresses[0];
  if (!selected) {
    throw new PublicError(400, "REMOTE_FETCH_FAILED", "无法解析远程图片地址");
  }
  return { url, address: selected.address, family: selected.family };
}

async function readRemoteImage(rawUrl: string, maximumBytes: number) {
  const { url, address, family } = await assertRemoteUrl(rawUrl);
  return new Promise<{ buffer: Buffer; filename: string; mime: string }>(
    (resolve, reject) => {
      const requestImpl = url.protocol === "https:" ? httpsRequest : httpRequest;
      const request = requestImpl(
        url,
        {
          family,
          headers: {
            accept: "image/avif,image/webp,image/png,image/jpeg,image/gif",
            "user-agent": "OU-Image-Hosting/1.0.0"
          },
          lookup: (_hostname, _options, callback) => {
            callback(null, address, family);
          },
          servername: url.hostname,
          timeout: REMOTE_UPLOAD_TIMEOUT_MS
        },
        (response) => {
          const statusCode = response.statusCode ?? 0;
          if (statusCode < 200 || statusCode >= 300) {
            response.resume();
            reject(new PublicError(400, "REMOTE_FETCH_FAILED", "远程图片响应不可用"));
            return;
          }
          const declaredLength = Number(response.headers["content-length"] ?? 0);
          if (declaredLength > maximumBytes) {
            response.destroy();
            reject(new PublicError(413, "FILE_TOO_LARGE", "图片超过工作区上传上限"));
            return;
          }
          const chunks: Buffer[] = [];
          let total = 0;
          response.on("data", (chunk: Buffer) => {
            total += chunk.byteLength;
            if (total > maximumBytes) {
              response.destroy(
                new PublicError(413, "FILE_TOO_LARGE", "图片超过工作区上传上限")
              );
              return;
            }
            chunks.push(Buffer.from(chunk));
          });
          response.on("end", () => {
            resolve({
              buffer: Buffer.concat(chunks),
              filename: sanitizeFilename(path.basename(url.pathname) || "remote-image"),
              mime: String(response.headers["content-type"] ?? "").split(";")[0] ?? ""
            });
          });
          response.on("error", reject);
        }
      );
      request.on("timeout", () => {
        request.destroy(new PublicError(400, "REMOTE_FETCH_FAILED", "远程图片读取超时"));
      });
      request.on("error", (error) => {
        reject(
          error instanceof PublicError
            ? error
            : new PublicError(400, "REMOTE_FETCH_FAILED", "无法读取远程图片")
        );
      });
      request.end();
    }
  );
}

export async function registerUploadRoutes(
  app: FastifyInstance,
  options: UploadRouteOptions
) {
  const { store, dataDirectory, now, authenticate } = options;
  const storageRoot = path.join(dataDirectory, "storage");
  const originalsDirectory = path.join(storageRoot, "originals");
  const thumbnailsDirectory = path.join(storageRoot, "thumbnails");
  const quotaBytes = Number(
    process.env.OU_STORAGE_QUOTA_BYTES ?? 2 * 1024 * 1024 * 1024
  );

  await mkdir(originalsDirectory, { recursive: true });
  await mkdir(thumbnailsDirectory, { recursive: true });
  await app.register(multipart, {
    limits: {
      files: 1,
      fields: 4,
      fileSize: MAX_FILE_SIZE,
      parts: 5
    }
  });

  const consumeHumanChallenge = async (request: FastifyRequest) => {
    const token = request.headers["x-ou-challenge-token"];
    const answer = request.headers["x-ou-challenge-answer"];
    if (typeof token !== "string" || typeof answer !== "string") {
      throw new PublicError(400, "HUMAN_CHALLENGE_REQUIRED", "请先完成人机验证");
    }
    const challenge = parseChallengeToken(token);
    const timestamp = now();
    if (challenge.expiresAt <= timestamp.getTime()) {
      throw new PublicError(400, "HUMAN_CHALLENGE_EXPIRED", "人机验证已过期，请重试");
    }
    const tokenHash = hashOpaqueToken(token);
    const accepted = await store.update((state) => {
      state.publicUploadChallengeUses = state.publicUploadChallengeUses.filter(
        (item) => Date.parse(item.expiresAt) > timestamp.getTime()
      );
      if (
        state.publicUploadChallengeUses.some(
          (item) => item.tokenHash === tokenHash
        )
      ) {
        return false;
      }
      state.publicUploadChallengeUses.push({
        tokenHash,
        expiresAt: new Date(challenge.expiresAt).toISOString()
      });
      return /^\d{1,3}$/.test(answer.trim()) &&
        Number(answer.trim()) === challenge.first + challenge.second;
    });
    if (!accepted) {
      throw new PublicError(400, "HUMAN_CHALLENGE_INVALID", "人机验证答案不正确或已使用");
    }
  };

  const beginPublicUpload = async (input: {
    sourceIp: string;
    authenticated: boolean;
    actorUserId?: string;
    publicVisible: boolean;
  }) => {
    const timestamp = now();
    const minute = minuteBucket(timestamp);
    return store.update((state) => {
      const site = state.site!;
      if (
        site.publicUploadBlockedIps.some(
          (item) => normalizedSourceIp(item) === input.sourceIp
        )
      ) {
        throw new PublicError(403, "PUBLIC_UPLOAD_IP_BLOCKED", "当前网络地址已被禁止上传");
      }
      const perMinute = input.authenticated
        ? site.publicUploadAuthenticatedPerMinute
        : site.publicUploadAnonymousPerMinute;
      let usage = state.publicUploadUsage.find(
        (item) =>
          item.sourceIp === input.sourceIp &&
          item.authenticated === input.authenticated &&
          item.minute === minute
      );
      if (!usage) {
        usage = {
          sourceIp: input.sourceIp,
          authenticated: input.authenticated,
          minute,
          attempts: 0,
          uploads: 0,
          bytes: 0
        };
        state.publicUploadUsage.push(usage);
      }
      if (usage.attempts >= perMinute) {
        throw new PublicError(
          429,
          "PUBLIC_UPLOAD_MINUTE_LIMIT",
          "上传过于频繁，请在一分钟后重试"
        );
      }
      usage.attempts += 1;
      const auditId = randomUUID();
      state.publicUploadAudits.push({
        id: auditId,
        sourceIp: input.sourceIp,
        actorUserId: input.actorUserId,
        fileSize: 0,
        publicVisible: input.publicVisible,
        authenticated: input.authenticated,
        status: "pending",
        createdAt: timestamp.toISOString()
      });
      state.publicUploadAudits = state.publicUploadAudits.slice(-50_000);
      const cutoffMinute = minuteBucket(
        new Date(timestamp.getTime() - 2 * 24 * 60 * 60 * 1000)
      );
      state.publicUploadUsage = state.publicUploadUsage.filter(
        (item) => item.minute >= cutoffMinute
      );
      return { auditId, minute };
    });
  };

  const reservePublicUploadQuota = async (input: {
    auditId: string;
    sourceIp: string;
    authenticated: boolean;
    minute: string;
    bytes: number;
  }) => {
    await store.update((state) => {
      const site = state.site!;
      const day = input.minute.slice(0, 10);
      const daily = state.publicUploadUsage.filter(
        (item) =>
          item.sourceIp === input.sourceIp &&
          item.authenticated === input.authenticated &&
          item.minute.startsWith(day)
      );
      const uploadCount = daily.reduce((total, item) => total + item.uploads, 0);
      const uploadedBytes = daily.reduce((total, item) => total + item.bytes, 0);
      const dailyLimit = input.authenticated
        ? site.publicUploadAuthenticatedPerDay
        : site.publicUploadAnonymousPerDay;
      const byteLimit = input.authenticated
        ? site.publicUploadAuthenticatedDailyBytes
        : site.publicUploadAnonymousDailyBytes;
      if (uploadCount >= dailyLimit) {
        throw new PublicError(429, "PUBLIC_UPLOAD_DAILY_LIMIT", "今日上传数量已达上限，请明天再试");
      }
      if (uploadedBytes + input.bytes > byteLimit) {
        throw new PublicError(429, "PUBLIC_UPLOAD_DAILY_BYTES_LIMIT", "今日上传流量已达上限，请明天再试");
      }
      const usage = state.publicUploadUsage.find(
        (item) =>
          item.sourceIp === input.sourceIp &&
          item.authenticated === input.authenticated &&
          item.minute === input.minute
      );
      if (!usage) {
        throw new PublicError(409, "PUBLIC_UPLOAD_RESERVATION_LOST", "上传状态已失效，请重试");
      }
      usage.uploads += 1;
      usage.bytes += input.bytes;
      const audit = state.publicUploadAudits.find((item) => item.id === input.auditId);
      if (audit) audit.fileSize = input.bytes;
    });
  };

  const finishPublicUpload = async (input: {
    auditId: string;
    sourceIp: string;
    authenticated: boolean;
    minute: string;
    bytes: number;
    imageId?: string;
    duplicate?: boolean;
    failureCode?: string;
    quotaReserved: boolean;
  }) => {
    await store.update((state) => {
      const audit = state.publicUploadAudits.find((item) => item.id === input.auditId);
      if (audit) {
        audit.status = input.failureCode ? "failure" : "success";
        audit.imageId = input.imageId;
        audit.failureCode = input.failureCode;
        audit.completedAt = now().toISOString();
      }
      if (input.quotaReserved && (input.failureCode || input.duplicate)) {
        const usage = state.publicUploadUsage.find(
          (item) =>
            item.sourceIp === input.sourceIp &&
            item.authenticated === input.authenticated &&
            item.minute === input.minute
        );
        if (usage) {
          usage.uploads = Math.max(0, usage.uploads - 1);
          usage.bytes = Math.max(0, usage.bytes - input.bytes);
        }
      }
    });
  };

  const ingest = async ({
    buffer,
    filename,
    mime,
    principal,
    publicVisible = false
  }: {
    buffer: Buffer;
    filename: string;
    mime: string;
    principal: Principal;
    publicVisible?: boolean;
  }) => {
    const state = store.snapshot();
    const settings =
      state.workspaceSettings.find(
        (item) => item.workspaceId === principal.workspaceId
      ) ?? defaultWorkspaceSettings(principal.workspaceId);
    const effectiveMaximum = Math.min(MAX_FILE_SIZE, settings.uploadMaxBytes);
    if (buffer.byteLength === 0) {
      throw new PublicError(400, "EMPTY_FILE", "图片文件不能为空");
    }
    if (buffer.byteLength > effectiveMaximum) {
      throw new PublicError(413, "FILE_TOO_LARGE", "图片超过工作区上传上限");
    }

    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(buffer, {
        animated: true,
        failOn: "error",
        limitInputPixels: MAX_PIXELS
      }).metadata();
    } catch {
      throw new PublicError(400, "INVALID_IMAGE", "文件不是有效的受支持图片");
    }

    const format = metadata.format;
    const width = metadata.width;
    const height = metadata.height;
    if (
      !format ||
      !supportedFormats.has(format) ||
      !width ||
      !height
    ) {
      throw new PublicError(
        415,
        "UNSUPPORTED_IMAGE",
        "仅支持 JPG、PNG、WebP、GIF 和 AVIF"
      );
    }

    const typedFormat = format as StoredImage["format"];
    if (!settings.allowedFormats.includes(typedFormat)) {
      throw new PublicError(
        415,
        "FORMAT_NOT_ALLOWED",
        "该图片格式未被当前工作区允许"
      );
    }

    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const existing = store
      .snapshot()
      .images.find(
        (image) =>
          image.workspaceId === principal.workspaceId &&
          image.sha256 === sha256
      );
    if (existing) {
      if (existing.deletedAt) {
        await store.update((state) => {
          const current = state.images.find((image) => image.id === existing.id);
          if (current) delete current.deletedAt;
        });
      }
      if (publicVisible && !existing.publicVisible) {
        await store.update((state) => {
          const current = state.images.find((image) => image.id === existing.id);
          if (current && current.workspaceId === principal.workspaceId) {
            current.publicVisible = true;
            current.updatedAt = now().toISOString();
          }
        });
      }
      return {
        image: publicImage(
          { ...existing, deletedAt: undefined, publicVisible: publicVisible || existing.publicVisible },
          store.snapshot(),
          now(),
          principal.user.id
        ),
        duplicate: true
      };
    }

    const usedBytes = calculateImageStorageBytes(store.snapshot().images);
    if (usedBytes + buffer.byteLength > quotaBytes) {
      throw new PublicError(413, "QUOTA_EXCEEDED", "存储空间不足");
    }

    const id = randomUUID();
    const originalKey = `originals/${sha256}.${extensionByFormat[typedFormat]}`;
    const thumbnailKey = `thumbnails/${id}.webp`;
    const originalPath = path.join(storageRoot, originalKey);
    const thumbnailPath = path.join(storageRoot, thumbnailKey);

    const thumbnail = await sharp(buffer, {
      animated: false,
      failOn: "error",
      limitInputPixels: MAX_PIXELS
    })
      .rotate()
      .resize({
        width: settings.thumbnailWidth,
        height: settings.thumbnailWidth,
        fit: "inside",
        withoutEnlargement: true
      })
      .webp({ quality: settings.processingQuality, effort: 3 })
      .toBuffer();

    await Promise.all([
      writeFile(originalPath, buffer, { mode: 0o600 }),
      writeFile(thumbnailPath, thumbnail, { mode: 0o600 })
    ]);

    const createdAt = now();
    const timestamp = createdAt.toISOString();
    const originalVersion: StoredImageVersion = {
      id: randomUUID(),
      operation: "original",
      size: buffer.byteLength,
      mime: mimeByFormat[typedFormat],
      format: typedFormat,
      width,
      height,
      sha256,
      originalKey,
      thumbnailKey,
      createdAt: timestamp
    };
    const image: StoredImage = {
      id,
      userId: principal.user.id,
      workspaceId: principal.workspaceId,
      name: sanitizeFilename(filename),
      size: buffer.byteLength,
      mime: mimeByFormat[typedFormat],
      format: typedFormat,
      width,
      height,
      sha256,
      originalKey,
      thumbnailKey,
      currentVersionId: originalVersion.id,
      versions: [originalVersion],
      favorite: false,
      favoriteUserIds: [],
      publicVisible,
      albumIds: [],
      tagIds: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await store.update((state) => {
      state.images.push(image);
      const date = workspaceDate(createdAt, settings.timezone);
      let daily = state.analyticsDaily.find(
        (item) =>
          item.workspaceId === principal.workspaceId && item.date === date
      );
      if (!daily) {
        daily = {
          workspaceId: principal.workspaceId,
          date,
          uploads: 0,
          uploadedLogicalBytes: 0,
          shareViews: 0,
          imageShareViews: {}
        };
        state.analyticsDaily.push(daily);
      }
      daily.uploads += 1;
      daily.uploadedLogicalBytes += image.size;
      const retainedDates = new Set(
        state.analyticsDaily
          .filter((item) => item.workspaceId === principal.workspaceId)
          .map((item) => item.date)
          .sort((a, b) => b.localeCompare(a))
          .slice(0, 400)
      );
      state.analyticsDaily = state.analyticsDaily.filter(
        (item) =>
          item.workspaceId !== principal.workspaceId ||
          retainedDates.has(item.date)
      );
    });
    return {
      image: publicImage(
        image,
        store.snapshot(),
        now(),
        principal.user.id
      ),
      duplicate: false
    };
  };

  app.get("/uploads/summary", async (request) => {
    const principal = authenticate(request);
    requireCapability(principal, "read", ["analytics:read"]);
    const images = store
      .snapshot()
      .images.filter(
        (image) => image.workspaceId === principal.workspaceId
      );
    return {
      count: images.filter((image) => !image.deletedAt).length,
      bytes: calculateImageStorageBytes(images),
      quotaBytes
    };
  });

  app.get<{ Querystring: UploadQuery }>(
    "/uploads",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            q: { type: "string", maxLength: 120 },
            format: {
              type: "string",
              enum: ["all", "jpeg", "png", "webp", "gif", "avif"]
            },
            page: { type: "string", pattern: "^[0-9]+$" },
            limit: { type: "string", pattern: "^[0-9]+$" },
            sort: {
              type: "string",
              enum: ["newest", "oldest", "name", "size"]
            }
          }
        }
      }
    },
    async (request) => {
      const principal = authenticate(request);
      requireCapability(principal, "read", ["images:read"]);
      const page = Math.max(1, Number(request.query.page ?? 1));
      const limit = Math.min(
        100,
        Math.max(1, Number(request.query.limit ?? 24))
      );
      const query = request.query.q?.trim().toLocaleLowerCase() ?? "";
      const format = request.query.format ?? "all";
      const sort = request.query.sort ?? "newest";
      const state = store.snapshot();
      const images = state.images
        .filter((image) => !image.deletedAt)
        .filter(
          (image) => image.workspaceId === principal.workspaceId
        )
        .filter(
          (image) =>
            !query || image.name.toLocaleLowerCase().includes(query)
        )
        .filter((image) => format === "all" || image.format === format)
        .sort((a, b) => {
          if (sort === "oldest") return a.createdAt.localeCompare(b.createdAt);
          if (sort === "name") return a.name.localeCompare(b.name, "zh-CN");
          if (sort === "size") return b.size - a.size;
          return b.createdAt.localeCompare(a.createdAt);
        });
      const total = images.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const safePage = Math.min(page, totalPages);
      const start = (safePage - 1) * limit;
      return {
        images: images
          .slice(start, start + limit)
          .map((image) =>
            publicImage(image, state, now(), principal.user.id)
          ),
        page: safePage,
        limit,
        total,
        totalPages
      };
    }
  );

  app.post<{ Body: BulkBody }>(
    "/uploads/bulk",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["ids", "action"],
          properties: {
            ids: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 80 }
            },
            action: {
              type: "string",
              enum: [
                "trash",
                "add-to-albums",
                "remove-from-albums",
                "set-public-visibility",
                "set-favorite"
              ]
            },
            albumIds: {
              type: "array",
              maxItems: 50,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 80 }
            },
            publicVisible: { type: "boolean" },
            favorite: { type: "boolean" }
          }
        }
      }
    },
    async (request) => {
      const principal = authenticate(request);
      requireCapability(
        principal,
        "write",
        request.body.action === "trash"
          ? ["images:delete"]
          : request.body.action === "set-public-visibility" ||
              request.body.action === "set-favorite"
            ? ["images:write"]
            : ["images:write", "organization:write"]
      );
      const ids = new Set(request.body.ids);
      const albumIds = new Set(request.body.albumIds ?? []);
      const timestamp = now().toISOString();
      const updated = await store.update((state) => {
        let count = 0;
        if (
          request.body.action === "set-public-visibility" &&
          typeof request.body.publicVisible !== "boolean"
        ) {
          throw new PublicError(
            400,
            "PUBLIC_VISIBILITY_REQUIRED",
            "请选择公开或隐藏状态"
          );
        }
        if (
          request.body.action === "set-favorite" &&
          typeof request.body.favorite !== "boolean"
        ) {
          throw new PublicError(
            400,
            "FAVORITE_REQUIRED",
            "请选择收藏或取消收藏状态"
          );
        }
        const nextPublicVisible = request.body.publicVisible === true;
        const nextFavorite = request.body.favorite === true;
        if (
          request.body.action === "add-to-albums" ||
          request.body.action === "remove-from-albums"
        ) {
          if (albumIds.size === 0) {
            throw new PublicError(
              400,
              "ALBUM_REQUIRED",
              "请选择至少一个相册"
            );
          }
          const validAlbumIds = new Set(
            state.albums
              .filter((album) => album.workspaceId === principal.workspaceId)
              .map((album) => album.id)
          );
          if ([...albumIds].some((albumId) => !validAlbumIds.has(albumId))) {
            throw new PublicError(
              400,
              "INVALID_ALBUM_IDS",
              "包含不存在或无权访问的相册"
            );
          }
        }
        state.images.forEach((image) => {
          if (
            ids.has(image.id) &&
            image.workspaceId === principal.workspaceId &&
            !image.deletedAt
          ) {
            if (request.body.action === "trash") {
              image.deletedAt = timestamp;
              image.updatedAt = timestamp;
              state.albums.forEach((album) => {
                if (
                  album.workspaceId === principal.workspaceId &&
                  album.coverImageId === image.id
                ) {
                  delete album.coverImageId;
                  album.coverMode = "auto";
                  album.updatedAt = timestamp;
                }
              });
              count += 1;
            } else if (request.body.action === "set-public-visibility") {
              if (image.publicVisible !== nextPublicVisible) {
                image.publicVisible = nextPublicVisible;
                image.updatedAt = timestamp;
              }
              count += 1;
            } else if (request.body.action === "set-favorite") {
              const favoriteUserIds = new Set(image.favoriteUserIds);
              const hadFavorite = favoriteUserIds.has(principal.user.id);
              if (nextFavorite) {
                favoriteUserIds.add(principal.user.id);
              } else {
                favoriteUserIds.delete(principal.user.id);
              }
              if (hadFavorite !== nextFavorite) {
                image.favoriteUserIds = [...favoriteUserIds];
                image.favorite = image.favoriteUserIds.length > 0;
                image.updatedAt = timestamp;
              }
              count += 1;
            } else {
              const nextAlbumIds = new Set(image.albumIds);
              const before = image.albumIds.join("\u0000");
              if (request.body.action === "add-to-albums") {
                albumIds.forEach((albumId) => nextAlbumIds.add(albumId));
              } else {
                albumIds.forEach((albumId) => nextAlbumIds.delete(albumId));
                albumIds.forEach((albumId) => {
                  if (nextAlbumIds.has(albumId)) return;
                  const album = state.albums.find(
                    (item) =>
                      item.id === albumId &&
                      item.workspaceId === principal.workspaceId &&
                      item.coverImageId === image.id
                  );
                  if (album) {
                    delete album.coverImageId;
                    album.coverMode = "auto";
                    album.updatedAt = timestamp;
                  }
                });
              }
              const next = [...nextAlbumIds];
              if (next.join("\u0000") !== before) {
                image.albumIds = next;
                image.updatedAt = timestamp;
              }
              count += 1;
            }
          }
        });
        return count;
      });
      return {
        updated,
        albumIds:
          request.body.action === "add-to-albums" ||
          request.body.action === "remove-from-albums"
            ? [...albumIds]
            : undefined,
        publicVisible:
          request.body.action === "set-public-visibility"
            ? request.body.publicVisible
            : undefined,
        favorite:
          request.body.action === "set-favorite"
            ? request.body.favorite
            : undefined
      };
    }
  );

  app.post(
    "/uploads",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      bodyLimit: MAX_FILE_SIZE + 1024 * 1024
    },
    async (request, reply) => {
      const principal = authenticate(request);
      requireCapability(principal, "write", ["images:write"]);
      let part;
      try {
        part = await request.file();
      } catch {
        throw new PublicError(413, "FILE_TOO_LARGE", "图片不能超过 20 MB");
      }
      if (!part || part.fieldname !== "file") {
        throw new PublicError(400, "FILE_REQUIRED", "请选择需要上传的图片");
      }
      let buffer: Buffer;
      try {
        buffer = await part.toBuffer();
      } catch {
        throw new PublicError(413, "FILE_TOO_LARGE", "图片不能超过 20 MB");
      }
      const result = await ingest({
        buffer,
        filename: part.filename,
        mime: part.mimetype,
        principal
      });
      return reply.status(result.duplicate ? 200 : 201).send(result);
    }
  );

  app.get("/public/config", async () => {
    const state = store.snapshot();
    const site = state.site;
    if (!state.setupComplete || !site) {
      return {
        setupComplete: false,
        site: null
      };
    }
    return {
      setupComplete: true,
      site: {
        siteName: site.siteName,
        siteDescription: site.siteDescription,
        siteLogoUrl: site.siteLogoUrl,
        publicUploadEnabled: site.publicUploadEnabled,
        publicUploadRequiresLogin: site.publicUploadRequiresLogin,
        publicGalleryEnabled: site.publicGalleryEnabled,
        publicGalleryShowUploader: site.publicGalleryShowUploader,
        publicGalleryShowFileName: site.publicGalleryShowFileName,
        publicGalleryShowUploadTime: site.publicGalleryShowUploadTime,
        publicUploadDefaultPublic: site.publicUploadDefaultPublic,
        publicUploadHumanVerificationEnabled:
          site.publicUploadHumanVerificationEnabled,
        publicUploadLimits: {
          anonymous: {
            perMinute: site.publicUploadAnonymousPerMinute,
            perDay: site.publicUploadAnonymousPerDay,
            dailyBytes: site.publicUploadAnonymousDailyBytes
          },
          authenticated: {
            perMinute: site.publicUploadAuthenticatedPerMinute,
            perDay: site.publicUploadAuthenticatedPerDay,
            dailyBytes: site.publicUploadAuthenticatedDailyBytes
          }
        },
        publicHeroTitle: site.publicHeroTitle,
        publicHeroDescription: site.publicHeroDescription,
        theme: site.theme,
        accentPreset: site.accentPreset
      }
    };
  });

  app.get<{ Querystring: PublicImagesQuery }>(
    "/public/images",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            sort: { type: "string", enum: ["latest", "hot", "random"] },
            format: {
              type: "string",
              enum: ["all", "jpeg", "png", "webp", "gif", "avif"]
            },
            page: { type: "string", pattern: "^[0-9]+$" },
            limit: { type: "string", pattern: "^[0-9]+$" }
          }
        }
      }
    },
    async (request, reply) => {
      const state = store.snapshot();
      reply.header(
        "cache-control",
        state.deliverySettings.signedUrls
          ? "no-store"
          : "public, max-age=20, stale-while-revalidate=60"
      );
      const page = Math.max(1, Number(request.query.page ?? 1));
      const limit = Math.min(
        48,
        Math.max(1, Number(request.query.limit ?? 24))
      );
      if (!state.site?.publicGalleryEnabled) {
        return {
          images: [],
          page: 1,
          limit,
          total: 0,
          totalPages: 1
        };
      }
      const sort = request.query.sort ?? "latest";
      const format = request.query.format ?? "all";
      const timestamp = now();
      const dateSeed = timestamp.toISOString().slice(0, 10);
      const shareViews = new Map<string, number>();
      for (const daily of state.analyticsDaily) {
        for (const [imageId, views] of Object.entries(daily.imageShareViews)) {
          shareViews.set(imageId, (shareViews.get(imageId) ?? 0) + views);
        }
      }
      const candidates = state.images
        .filter((image) => image.publicVisible && !image.deletedAt)
        .filter((image) => format === "all" || image.format === format)
        .map((image) => ({
          image,
          shareViews: shareViews.get(image.id) ?? 0,
          randomRank: seededRandom(`${image.id}:${dateSeed}`)
        }))
        .sort((a, b) => {
          if (sort === "hot") {
            return (
              b.shareViews - a.shareViews ||
              b.image.createdAt.localeCompare(a.image.createdAt)
            );
          }
          if (sort === "random") {
            return b.randomRank - a.randomRank;
          }
          return b.image.createdAt.localeCompare(a.image.createdAt);
        });
      const total = candidates.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const safePage = Math.min(page, totalPages);
      const start = (safePage - 1) * limit;
      return {
        images: candidates
          .slice(start, start + limit)
          .map(({ image }) => publicImageCard(image, state, timestamp)),
        page: safePage,
        limit,
        total,
        totalPages,
        preferences: {
          showUploader: state.site.publicGalleryShowUploader,
          showFileName: state.site.publicGalleryShowFileName,
          showUploadTime: state.site.publicGalleryShowUploadTime
        }
      };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/public/images/:id/hide",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: {
            id: { type: "string", minLength: 1, maxLength: 100 }
          }
        }
      }
    },
    async (request) => {
      const principal = authenticate(request);
      const access = backofficeAccessFor(
        store.snapshot(),
        principal.user.id
      );
      if (principal.kind !== "session" || !access.allowed) {
        throw new PublicError(
          403,
          "PUBLIC_GALLERY_MODERATOR_REQUIRED",
          "只有管理员可以隐藏公共图片"
        );
      }
      const timestamp = now().toISOString();
      await store.update((state) => {
        const image = state.images.find(
          (item) => item.id === request.params.id && !item.deletedAt
        );
        if (!image || !image.publicVisible) {
          throw new PublicError(
            404,
            "PUBLIC_IMAGE_NOT_FOUND",
            "公共图片不存在"
          );
        }
        image.publicVisible = false;
        image.updatedAt = timestamp;
        addAuditEvent(state, {
          principal,
          global: true,
          action: "public_gallery.image.hide",
          result: "success",
          resourceType: "image",
          resourceId: image.id,
          ipHash: hashRequestIp(request),
          createdAt: timestamp
        });
      });
      return { hidden: true };
    }
  );

  app.get("/public/upload-challenge", async () => {
    const state = store.snapshot();
    if (!state.site?.publicUploadEnabled) {
      throw new PublicError(403, "PUBLIC_UPLOAD_DISABLED", "公共上传入口已关闭");
    }
    if (!state.site.publicUploadHumanVerificationEnabled) {
      return { enabled: false };
    }
    const first = randomInt(2, 10);
    const second = randomInt(1, 10);
    const expiresAt = now().getTime() + 5 * 60 * 1000;
    return {
      enabled: true,
      question: `${first} + ${second} = ?`,
      token: challengeToken(first, second, expiresAt),
      expiresAt: new Date(expiresAt).toISOString()
    };
  });

  app.post<{ Querystring: PublicUploadQuery }>(
    "/public/uploads",
    {
      config: { rateLimit: { max: 1_000, timeWindow: "1 minute" } },
      bodyLimit: MAX_FILE_SIZE + 1024 * 1024,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            publicVisible: {
              type: "string",
              enum: ["true", "false", "1", "0"]
            }
          }
        }
      }
    },
    async (request, reply) => {
      const state = store.snapshot();
      if (!state.site?.publicUploadEnabled) {
        throw new PublicError(403, "PUBLIC_UPLOAD_DISABLED", "公共上传入口已关闭");
      }
      let principal: Principal | null = null;
      try {
        principal = authenticate(request);
      } catch (error) {
        if (
          !(error instanceof PublicError) ||
          error.code !== "UNAUTHENTICATED"
        ) {
          throw error;
        }
      }
      if (!principal && state.site.publicUploadRequiresLogin) {
        throw new PublicError(
          401,
          "LOGIN_REQUIRED_FOR_PUBLIC_UPLOAD",
          "管理员已开启登录后上传，请先登录再上传图片"
        );
      }
      const authenticated = Boolean(principal);
      if (!authenticated && state.site.publicUploadHumanVerificationEnabled) {
        await consumeHumanChallenge(request);
      }
      const actorUserId = principal?.user.id;
      principal ??= publicUploadPrincipal(state);
      const sourceIp = normalizedSourceIp(request.ip);
      const publicVisible =
        request.query.publicVisible === undefined
          ? state.site.publicUploadDefaultPublic
          : request.query.publicVisible === "true" ||
            request.query.publicVisible === "1";
      const reservation = await beginPublicUpload({
        sourceIp,
        authenticated,
        actorUserId,
        publicVisible
      });
      let part;
      try {
        part = await request.file();
      } catch {
        await finishPublicUpload({
          ...reservation,
          sourceIp,
          authenticated,
          bytes: 0,
          failureCode: "FILE_TOO_LARGE",
          quotaReserved: false
        });
        throw new PublicError(413, "FILE_TOO_LARGE", "图片不能超过 20 MB");
      }
      if (!part || part.fieldname !== "file") {
        await finishPublicUpload({
          ...reservation,
          sourceIp,
          authenticated,
          bytes: 0,
          failureCode: "FILE_REQUIRED",
          quotaReserved: false
        });
        throw new PublicError(400, "FILE_REQUIRED", "请选择需要上传的图片");
      }
      let buffer: Buffer;
      try {
        buffer = await part.toBuffer();
      } catch {
        await finishPublicUpload({
          ...reservation,
          sourceIp,
          authenticated,
          bytes: 0,
          failureCode: "FILE_TOO_LARGE",
          quotaReserved: false
        });
        throw new PublicError(413, "FILE_TOO_LARGE", "图片不能超过 20 MB");
      }
      let quotaReserved = false;
      try {
        await reservePublicUploadQuota({
          ...reservation,
          sourceIp,
          authenticated,
          bytes: buffer.byteLength
        });
        quotaReserved = true;
        const result = await ingest({
          buffer,
          filename: part.filename,
          mime: part.mimetype,
          principal,
          publicVisible
        });
        await finishPublicUpload({
          ...reservation,
          sourceIp,
          authenticated,
          bytes: buffer.byteLength,
          imageId: result.image.id,
          duplicate: result.duplicate,
          quotaReserved
        });
        return reply.status(result.duplicate ? 200 : 201).send(result);
      } catch (error) {
        await finishPublicUpload({
          ...reservation,
          sourceIp,
          authenticated,
          bytes: buffer.byteLength,
          failureCode:
            error instanceof PublicError ? error.code : "UPLOAD_FAILED",
          quotaReserved
        });
        throw error;
      }
    }
  );

  app.post<{ Body: UrlUploadBody }>(
    "/uploads/from-url",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["url"],
          properties: {
            url: { type: "string", minLength: 8, maxLength: 2048 }
          }
        }
      }
    },
    async (request, reply) => {
      const principal = authenticate(request);
      requireCapability(principal, "write", ["images:write"]);
      const settings =
        store
          .snapshot()
          .workspaceSettings.find(
            (item) => item.workspaceId === principal.workspaceId
          ) ?? defaultWorkspaceSettings(principal.workspaceId);
      const remote = await readRemoteImage(
        request.body.url,
        Math.min(MAX_REMOTE_SIZE, settings.uploadMaxBytes)
      );
      const result = await ingest({
        ...remote,
        principal
      });
      return reply.status(result.duplicate ? 200 : 201).send(result);
    }
  );

  app.get<{
    Params: { id: string; variant: "original" | "thumbnail" };
    Querystring: { expires?: string; signature?: string };
  }>(
    "/files/:id/:variant",
    {
      schema: {
        params: {
          type: "object",
          required: ["id", "variant"],
          properties: {
            id: { type: "string", minLength: 1, maxLength: 80 },
            variant: { type: "string", enum: ["original", "thumbnail"] }
          }
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            expires: { type: "string", pattern: "^[0-9]+$" },
            signature: {
              type: "string",
              pattern: "^[a-fA-F0-9]{64}$"
            }
          }
        }
      }
    },
    async (request, reply) => {
      const state = store.snapshot();
      const image = state.images.find(
        (item) => item.id === request.params.id && !item.deletedAt
      );
      if (!image) {
        throw new PublicError(404, "IMAGE_NOT_FOUND", "图片不存在");
      }
      assertDeliveryAccess(
        request,
        state,
        canonicalFilePath(image.id, request.params.variant),
        now()
      );
      const isThumbnail = request.params.variant === "thumbnail";
      const key = isThumbnail ? image.thumbnailKey : image.originalKey;
      reply
        .type(isThumbnail ? "image/webp" : image.mime)
        .header("cache-control", "public, max-age=60, must-revalidate")
        .header("content-disposition", "inline");
      return reply.send(createReadStream(path.join(storageRoot, key)));
    }
  );

  registerImageDetailRoutes(app, {
    store,
    dataDirectory,
    now,
    authenticate,
    quotaBytes
  });

  registerOrganizationRoutes(app, {
    store,
    dataDirectory,
    now,
    authenticate
  });
}
