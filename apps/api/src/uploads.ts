import multipart from "@fastify/multipart";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import sharp from "sharp";
import {
  assertDeliveryAccess,
  buildDeliveryUrl,
  canonicalFilePath
} from "./delivery.js";
import {
  requireCapability,
  type Principal
} from "./access.js";
import { PublicError } from "./errors.js";
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
type BulkBody = {
  ids: string[];
  action: "trash";
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
    albumIds: image.albumIds,
    tagIds: image.tagIds,
    createdAt: image.createdAt,
    updatedAt: image.updatedAt,
    deletedAt: image.deletedAt
  };
}

function sanitizeFilename(value: string) {
  const cleaned = path
    .basename(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return (cleaned || `image-${Date.now()}`).slice(0, 180);
}

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  const [a = -1, b = -1] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateAddress(address: string) {
  if (isIP(address) === 4) return isPrivateIpv4(address);
  const normalized = address.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
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
  return url;
}

async function readRemoteImage(rawUrl: string, maximumBytes: number) {
  const url = await assertRemoteUrl(rawUrl);
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        accept: "image/avif,image/webp,image/png,image/jpeg,image/gif",
        "user-agent": "OU-Image-Hosting/1.0.3"
      }
    });
  } catch {
    throw new PublicError(400, "REMOTE_FETCH_FAILED", "无法读取远程图片");
  }
  if (!response.ok || !response.body) {
    throw new PublicError(400, "REMOTE_FETCH_FAILED", "远程图片响应不可用");
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maximumBytes) {
    throw new PublicError(413, "FILE_TOO_LARGE", "图片超过工作区上传上限");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new PublicError(413, "FILE_TOO_LARGE", "图片超过工作区上传上限");
    }
    chunks.push(value);
  }
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return {
    buffer,
    filename: sanitizeFilename(path.basename(url.pathname) || "remote-image"),
    mime: response.headers.get("content-type")?.split(";")[0] ?? ""
  };
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

  const ingest = async ({
    buffer,
    filename,
    mime,
    principal
  }: {
    buffer: Buffer;
    filename: string;
    mime: string;
    principal: Principal;
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
      return {
        image: publicImage(
          { ...existing, deletedAt: undefined },
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
            action: { type: "string", enum: ["trash"] }
          }
        }
      }
    },
    async (request) => {
      const principal = authenticate(request);
      requireCapability(principal, "write", ["images:delete"]);
      const ids = new Set(request.body.ids);
      const timestamp = now().toISOString();
      const updated = await store.update((state) => {
        let count = 0;
        state.images.forEach((image) => {
          if (
            ids.has(image.id) &&
            image.workspaceId === principal.workspaceId &&
            !image.deletedAt
          ) {
            image.deletedAt = timestamp;
            image.updatedAt = timestamp;
            count += 1;
          }
        });
        return count;
      });
      return { updated };
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
