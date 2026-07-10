import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  requireCapability,
  type Principal
} from "./access.js";
import { buildDeliveryUrl } from "./delivery.js";
import { PublicError } from "./errors.js";
import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  verifyPassword
} from "./security.js";
import type {
  AppState,
  StoredImage,
  StoredImageShare,
  StoredImageVersion
} from "./store.js";
import {
  calculateImageStorageBytes,
  type AppStore
} from "./store.js";

const MAX_PIXELS = 80_000_000;
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

type ImageDetailRouteOptions = {
  store: AppStore;
  dataDirectory: string;
  now: () => Date;
  quotaBytes: number;
  authenticate: (request: FastifyRequest) => Principal;
};

type IdParams = { id: string };
type VersionParams = IdParams & { versionId: string };
type ShareParams = IdParams & { shareId: string };
type PublicShareParams = { token: string };
type RenameBody = { name: string };
type TransformBody = {
  action:
    | "rotate-left"
    | "rotate-right"
    | "flip-horizontal"
    | "flip-vertical"
    | "convert-format";
  format?: "jpeg" | "png" | "webp";
  quality?: number;
};
type CreateShareBody = {
  password?: string;
  expiresInHours?: number;
};
type AccessShareBody = { password?: string };

const idParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 80 }
  }
} as const;

function imageUrl(
  image: StoredImage,
  state: AppState,
  timestamp: Date
) {
  return {
    thumbnailUrl: buildDeliveryUrl(
      state,
      image.id,
      "thumbnail",
      timestamp
    ),
    originalUrl: buildDeliveryUrl(state, image.id, "original", timestamp)
  };
}

function publicVersion(
  imageId: string,
  version: StoredImageVersion,
  state: AppState,
  timestamp: Date
) {
  return {
    id: version.id,
    operation: version.operation,
    sourceVersionId: version.sourceVersionId,
    size: version.size,
    mime: version.mime,
    format: version.format,
    width: version.width,
    height: version.height,
    sha256: version.sha256,
    createdAt: version.createdAt,
    originalUrl: buildDeliveryUrl(
      state,
      imageId,
      `versions/${version.id}`,
      timestamp
    )
  };
}

function publicShare(share: StoredImageShare) {
  return {
    id: share.id,
    passwordRequired: Boolean(share.passwordHash),
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    revokedAt: share.revokedAt,
    accessCount: share.accessCount,
    lastAccessedAt: share.lastAccessedAt
  };
}

function visibleShares(
  state: AppState,
  imageId: string,
  principal: Principal
) {
  const allowed =
    principal.kind === "session" ||
    principal.scopes.includes("shares:read");
  if (!allowed) return [];
  return state.imageShares.filter(
    (share) =>
      share.imageId === imageId &&
      share.workspaceId === principal.workspaceId
  );
}

function publicDetail(
  image: StoredImage,
  shares: StoredImageShare[],
  state: AppState,
  timestamp: Date,
  userId: string
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
    currentVersionId: image.currentVersionId,
    favorite: image.favoriteUserIds.includes(userId),
    albumIds: image.albumIds,
    tagIds: image.tagIds,
    createdAt: image.createdAt,
    updatedAt: image.updatedAt,
    ...imageUrl(image, state, timestamp),
    versions: image.versions
      .slice()
      .reverse()
      .map((version) =>
        publicVersion(image.id, version, state, timestamp)
      ),
    shares: shares
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(publicShare)
  };
}

function assertImageName(value: string) {
  const name = value.trim();
  if (
    !name ||
    name === "." ||
    name === ".." ||
    /[\\/\u0000-\u001f\u007f]/.test(name)
  ) {
    throw new PublicError(400, "INVALID_IMAGE_NAME", "图片名称包含无效字符");
  }
  return name;
}

function replaceExtension(name: string, format: StoredImage["format"]) {
  const extension = extensionByFormat[format];
  const parsed = path.parse(name);
  const base = parsed.name || "image";
  return `${base}.${extension}`;
}

function storagePath(storageRoot: string, key: string) {
  const root = path.resolve(storageRoot);
  const target = path.resolve(root, key);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new PublicError(500, "INVALID_STORAGE_KEY", "图片存储记录无效");
  }
  return target;
}

function findOwnedImage(store: AppStore, id: string, workspaceId: string) {
  const image = store
    .snapshot()
    .images.find(
      (item) =>
        item.id === id &&
        item.workspaceId === workspaceId &&
        !item.deletedAt
    );
  if (!image) {
    throw new PublicError(404, "IMAGE_NOT_FOUND", "图片不存在");
  }
  return image;
}

function findShare(store: AppStore, token: string) {
  const tokenHash = hashOpaqueToken(token);
  const state = store.snapshot();
  const share = state.imageShares.find((item) => item.tokenHash === tokenHash);
  const image = share
    ? state.images.find((item) => item.id === share.imageId && !item.deletedAt)
    : undefined;
  if (!share || !image) {
    throw new PublicError(404, "SHARE_NOT_FOUND", "分享链接不存在");
  }
  return { share, image };
}

function assertShareActive(share: StoredImageShare, timestamp: Date) {
  if (share.revokedAt) {
    throw new PublicError(410, "SHARE_REVOKED", "分享链接已被撤销");
  }
  if (
    share.expiresAt &&
    new Date(share.expiresAt).getTime() <= timestamp.getTime()
  ) {
    throw new PublicError(410, "SHARE_EXPIRED", "分享链接已经过期");
  }
}

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

function sendImage(
  reply: FastifyReply,
  filePath: string,
  mime: string,
  name: string
) {
  reply
    .type(mime)
    .header("cache-control", "private, no-store")
    .header(
      "content-disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(name)}`
    );
  return reply.send(createReadStream(filePath));
}

async function createThumbnail(
  buffer: Buffer,
  width: number,
  quality: number
) {
  return sharp(buffer, {
    animated: false,
    failOn: "error",
    limitInputPixels: MAX_PIXELS
  })
    .rotate()
    .resize({
      width,
      height: width,
      fit: "inside",
      withoutEnlargement: true
    })
    .webp({ quality, effort: 3 })
    .toBuffer();
}

async function transformBuffer(
  input: Buffer,
  body: TransformBody,
  currentFormat: StoredImage["format"]
) {
  if (body.action === "convert-format" && !body.format) {
    throw new PublicError(
      400,
      "FORMAT_REQUIRED",
      "转换格式时必须指定目标格式"
    );
  }
  if (body.action !== "convert-format" && body.format) {
    throw new PublicError(
      400,
      "UNEXPECTED_FORMAT",
      "当前编辑操作不接受目标格式"
    );
  }

  const outputFormat = body.format ?? currentFormat;
  const quality = body.quality ?? 88;
  let pipeline = sharp(input, {
    animated: false,
    failOn: "error",
    limitInputPixels: MAX_PIXELS
  }).rotate();

  if (body.action === "rotate-left") pipeline = pipeline.rotate(-90);
  if (body.action === "rotate-right") pipeline = pipeline.rotate(90);
  if (body.action === "flip-horizontal") pipeline = pipeline.flop();
  if (body.action === "flip-vertical") pipeline = pipeline.flip();

  if (outputFormat === "jpeg") {
    pipeline = pipeline.jpeg({ quality, mozjpeg: true });
  }
  if (outputFormat === "png") pipeline = pipeline.png({ compressionLevel: 6 });
  if (outputFormat === "webp") pipeline = pipeline.webp({ quality, effort: 3 });
  if (outputFormat === "gif") pipeline = pipeline.gif({ effort: 3 });
  if (outputFormat === "avif") pipeline = pipeline.avif({ quality, effort: 3 });

  return {
    buffer: await pipeline.toBuffer(),
    format: outputFormat
  };
}

export function registerImageDetailRoutes(
  app: FastifyInstance,
  options: ImageDetailRouteOptions
) {
  const { store, dataDirectory, now, authenticate, quotaBytes } = options;
  const storageRoot = path.join(dataDirectory, "storage");

  app.get<{ Params: IdParams }>(
    "/uploads/:id",
    { schema: { params: idParamsSchema } },
    async (request) => {
      const principal = authenticate(request);
      requireCapability(principal, "read", ["images:read"]);
      const image = findOwnedImage(
        store,
        request.params.id,
        principal.workspaceId
      );
      const state = store.snapshot();
      return {
        image: publicDetail(
          image,
          visibleShares(state, image.id, principal),
          state,
          now(),
          principal.user.id
        )
      };
    }
  );

  app.get<{ Params: IdParams }>(
    "/uploads/:id/shares",
    { schema: { params: idParamsSchema } },
    async (request) => {
      const principal = authenticate(request);
      requireCapability(principal, "read", ["shares:read"]);
      const image = findOwnedImage(
        store,
        request.params.id,
        principal.workspaceId
      );
      return {
        shares: store
          .snapshot()
          .imageShares.filter(
            (share) =>
              share.imageId === image.id &&
              share.workspaceId === principal.workspaceId
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(publicShare)
      };
    }
  );

  app.patch<{ Params: IdParams; Body: RenameBody }>(
    "/uploads/:id",
    {
      schema: {
        params: idParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 180 }
          }
        }
      }
    },
    async (request) => {
      const principal = authenticate(request);
      requireCapability(principal, "write", ["images:write"]);
      findOwnedImage(store, request.params.id, principal.workspaceId);
      const name = assertImageName(request.body.name);
      const timestamp = now().toISOString();
      const image = await store.update((state) => {
        const current = state.images.find(
          (item) =>
            item.id === request.params.id &&
            item.workspaceId === principal.workspaceId &&
            !item.deletedAt
        );
        if (!current) {
          throw new PublicError(404, "IMAGE_NOT_FOUND", "图片不存在");
        }
        current.name = name;
        current.updatedAt = timestamp;
        return current;
      });
      const state = store.snapshot();
      return {
        image: publicDetail(
          image,
          visibleShares(state, image.id, principal),
          state,
          now(),
          principal.user.id
        )
      };
    }
  );

  app.post<{ Params: IdParams; Body: TransformBody }>(
    "/uploads/:id/transform",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        params: idParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["action"],
          properties: {
            action: {
              type: "string",
              enum: [
                "rotate-left",
                "rotate-right",
                "flip-horizontal",
                "flip-vertical",
                "convert-format"
              ]
            },
            format: { type: "string", enum: ["jpeg", "png", "webp"] },
            quality: { type: "integer", minimum: 1, maximum: 100 }
          }
        }
      }
    },
    async (request, reply) => {
      const principal = authenticate(request);
      requireCapability(principal, "write", ["images:write"]);
      const image = findOwnedImage(
        store,
        request.params.id,
        principal.workspaceId
      );
      const settings =
        store
          .snapshot()
          .workspaceSettings.find(
            (item) => item.workspaceId === principal.workspaceId
          ) ?? {
          processingQuality: 85,
          thumbnailWidth: 480
        };
      const input = await readFile(storagePath(storageRoot, image.originalKey));
      let transformed;
      try {
        transformed = await transformBuffer(
          input,
          {
            ...request.body,
            quality:
              request.body.quality ?? settings.processingQuality
          },
          image.format
        );
      } catch (error) {
        if (error instanceof PublicError) throw error;
        throw new PublicError(400, "TRANSFORM_FAILED", "无法完成图片编辑");
      }
      const metadata = await sharp(transformed.buffer, {
        animated: false,
        failOn: "error",
        limitInputPixels: MAX_PIXELS
      }).metadata();
      if (!metadata.width || !metadata.height) {
        throw new PublicError(400, "TRANSFORM_FAILED", "无法读取编辑后的图片");
      }

      const versionId = randomUUID();
      const timestamp = now().toISOString();
      const usedBytes = calculateImageStorageBytes(store.snapshot().images);
      if (usedBytes + transformed.buffer.byteLength > quotaBytes) {
        throw new PublicError(413, "QUOTA_EXCEEDED", "存储空间不足");
      }
      const originalKey =
        `versions/${image.id}/${versionId}.` +
        extensionByFormat[transformed.format];
      const thumbnailKey = `thumbnails/${image.id}-${versionId}.webp`;
      const originalPath = storagePath(storageRoot, originalKey);
      const thumbnailPath = storagePath(storageRoot, thumbnailKey);
      const thumbnail = await createThumbnail(
        transformed.buffer,
        settings.thumbnailWidth,
        settings.processingQuality
      );
      await mkdir(path.dirname(originalPath), { recursive: true });
      await Promise.all([
        writeFile(originalPath, transformed.buffer, { mode: 0o600 }),
        writeFile(thumbnailPath, thumbnail, { mode: 0o600 })
      ]);

      const version: StoredImageVersion = {
        id: versionId,
        operation: request.body.action,
        sourceVersionId: image.currentVersionId,
        size: transformed.buffer.byteLength,
        mime: mimeByFormat[transformed.format],
        format: transformed.format,
        width: metadata.width,
        height: metadata.height,
        sha256: createHash("sha256").update(transformed.buffer).digest("hex"),
        originalKey,
        thumbnailKey,
        createdAt: timestamp
      };
      const updated = await store.update((state) => {
        const current = state.images.find(
          (item) =>
            item.id === image.id &&
            item.workspaceId === principal.workspaceId &&
            !item.deletedAt
        );
        if (!current) {
          throw new PublicError(404, "IMAGE_NOT_FOUND", "图片不存在");
        }
        current.versions.push(version);
        current.currentVersionId = version.id;
        current.size = version.size;
        current.mime = version.mime;
        current.format = version.format;
        current.width = version.width;
        current.height = version.height;
        current.sha256 = version.sha256;
        current.originalKey = version.originalKey;
        current.thumbnailKey = version.thumbnailKey;
        current.updatedAt = timestamp;
        if (request.body.action === "convert-format") {
          current.name = replaceExtension(current.name, version.format);
        }
        return current;
      });
      const state = store.snapshot();
      return reply.status(201).send({
        image: publicDetail(
          updated,
          visibleShares(state, updated.id, principal),
          state,
          now(),
          principal.user.id
        ),
        version: publicVersion(updated.id, version, state, now())
      });
    }
  );

  app.post<{ Params: VersionParams }>(
    "/uploads/:id/versions/:versionId/restore",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id", "versionId"],
          properties: {
            id: { type: "string", minLength: 1, maxLength: 80 },
            versionId: { type: "string", minLength: 1, maxLength: 80 }
          }
        }
      }
    },
    async (request, reply) => {
      const principal = authenticate(request);
      requireCapability(principal, "write", ["images:write"]);
      const image = findOwnedImage(
        store,
        request.params.id,
        principal.workspaceId
      );
      const source = image.versions.find(
        (version) => version.id === request.params.versionId
      );
      if (!source) {
        throw new PublicError(404, "VERSION_NOT_FOUND", "图片版本不存在");
      }
      const timestamp = now().toISOString();
      const restored: StoredImageVersion = {
        ...source,
        id: randomUUID(),
        operation: "restore",
        sourceVersionId: source.id,
        createdAt: timestamp
      };
      const updated = await store.update((state) => {
        const current = state.images.find(
          (item) =>
            item.id === image.id &&
            item.workspaceId === principal.workspaceId &&
            !item.deletedAt
        );
        if (!current) {
          throw new PublicError(404, "IMAGE_NOT_FOUND", "图片不存在");
        }
        current.versions.push(restored);
        current.currentVersionId = restored.id;
        current.size = restored.size;
        current.mime = restored.mime;
        current.format = restored.format;
        current.width = restored.width;
        current.height = restored.height;
        current.sha256 = restored.sha256;
        current.originalKey = restored.originalKey;
        current.thumbnailKey = restored.thumbnailKey;
        current.name = replaceExtension(current.name, restored.format);
        current.updatedAt = timestamp;
        return current;
      });
      const state = store.snapshot();
      return reply.status(201).send({
        image: publicDetail(
          updated,
          visibleShares(state, updated.id, principal),
          state,
          now(),
          principal.user.id
        ),
        version: publicVersion(updated.id, restored, state, now())
      });
    }
  );

  app.get<{
    Params: VersionParams;
    Querystring: { expires?: string; signature?: string };
  }>(
    "/files/:id/versions/:versionId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id", "versionId"],
          properties: {
            id: { type: "string", minLength: 1, maxLength: 80 },
            versionId: { type: "string", minLength: 1, maxLength: 80 }
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
      const principal = authenticate(request);
      requireCapability(principal, "read", ["images:read"]);
      const state = store.snapshot();
      const image = state.images.find(
        (item) =>
          item.id === request.params.id &&
          item.workspaceId === principal.workspaceId &&
          !item.deletedAt
      );
      const version = image?.versions.find(
        (item) => item.id === request.params.versionId
      );
      if (!image || !version) {
        throw new PublicError(404, "VERSION_NOT_FOUND", "图片版本不存在");
      }
      return sendImage(
        reply,
        storagePath(storageRoot, version.originalKey),
        version.mime,
        replaceExtension(image.name, version.format)
      );
    }
  );

  app.post<{ Params: IdParams; Body: CreateShareBody }>(
    "/uploads/:id/shares",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        params: idParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            password: { type: "string", minLength: 4, maxLength: 128 },
            expiresInHours: {
              type: "integer",
              minimum: 1,
              maximum: 8760
            }
          }
        }
      }
    },
    async (request, reply) => {
      const principal = authenticate(request);
      requireCapability(principal, "write", ["shares:write"]);
      const image = findOwnedImage(
        store,
        request.params.id,
        principal.workspaceId
      );
      const token = createOpaqueToken();
      const timestamp = now();
      const share: StoredImageShare = {
        id: randomUUID(),
        imageId: image.id,
        userId: principal.user.id,
        workspaceId: principal.workspaceId,
        tokenHash: hashOpaqueToken(token),
        passwordHash: request.body.password
          ? await hashPassword(request.body.password)
          : undefined,
        createdAt: timestamp.toISOString(),
        expiresAt: request.body.expiresInHours
          ? new Date(
              timestamp.getTime() + request.body.expiresInHours * 60 * 60 * 1000
            ).toISOString()
          : undefined,
        accessCount: 0
      };
      await store.update((state) => {
        state.imageShares.push(share);
      });
      return reply.status(201).send({
        share: publicShare(share),
        token,
        publicUrl: `/share/${token}`
      });
    }
  );

  app.delete<{ Params: ShareParams }>(
    "/uploads/:id/shares/:shareId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id", "shareId"],
          properties: {
            id: { type: "string", minLength: 1, maxLength: 80 },
            shareId: { type: "string", minLength: 1, maxLength: 80 }
          }
        }
      }
    },
    async (request, reply) => {
      const principal = authenticate(request);
      requireCapability(principal, "write", ["shares:write"]);
      findOwnedImage(store, request.params.id, principal.workspaceId);
      const timestamp = now().toISOString();
      await store.update((state) => {
        const share = state.imageShares.find(
          (item) =>
            item.id === request.params.shareId &&
            item.imageId === request.params.id &&
            item.workspaceId === principal.workspaceId
        );
        if (!share) {
          throw new PublicError(404, "SHARE_NOT_FOUND", "分享链接不存在");
        }
        share.revokedAt ??= timestamp;
      });
      return reply.status(204).send();
    }
  );

  app.get<{ Params: PublicShareParams }>(
    "/shares/:token",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["token"],
          properties: {
            token: { type: "string", minLength: 20, maxLength: 200 }
          }
        }
      }
    },
    async (request) => {
      const { share, image } = findShare(store, request.params.token);
      assertShareActive(share, now());
      return {
        share: {
          id: share.id,
          passwordRequired: Boolean(share.passwordHash),
          createdAt: share.createdAt,
          expiresAt: share.expiresAt,
          accessCount: share.accessCount
        },
        image: {
          id: image.id,
          name: image.name,
          size: image.size,
          mime: image.mime,
          format: image.format,
          width: image.width,
          height: image.height,
          updatedAt: image.updatedAt
        }
      };
    }
  );

  app.post<{ Params: PublicShareParams; Body: AccessShareBody }>(
    "/shares/:token/access",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["token"],
          properties: {
            token: { type: "string", minLength: 20, maxLength: 200 }
          }
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            password: { type: "string", minLength: 1, maxLength: 128 }
          }
        }
      }
    },
    async (request, reply) => {
      const { share, image } = findShare(store, request.params.token);
      const timestamp = now();
      assertShareActive(share, timestamp);
      if (
        share.passwordHash &&
        (!request.body.password ||
          !(await verifyPassword(request.body.password, share.passwordHash)))
      ) {
        throw new PublicError(401, "INVALID_SHARE_PASSWORD", "分享密码不正确");
      }
      await store.update((state) => {
        const current = state.imageShares.find((item) => item.id === share.id);
        if (!current) {
          throw new PublicError(404, "SHARE_NOT_FOUND", "分享链接不存在");
        }
        assertShareActive(current, timestamp);
        current.accessCount += 1;
        current.lastAccessedAt = timestamp.toISOString();
        const settings = state.workspaceSettings.find(
          (item) => item.workspaceId === current.workspaceId
        );
        const date = workspaceDate(
          timestamp,
          settings?.timezone ?? "Asia/Shanghai"
        );
        let daily = state.analyticsDaily.find(
          (item) =>
            item.workspaceId === current.workspaceId && item.date === date
        );
        if (!daily) {
          daily = {
            workspaceId: current.workspaceId,
            date,
            uploads: 0,
            uploadedLogicalBytes: 0,
            shareViews: 0,
            imageShareViews: {}
          };
          state.analyticsDaily.push(daily);
        }
        daily.shareViews += 1;
        daily.imageShareViews[current.imageId] =
          (daily.imageShareViews[current.imageId] ?? 0) + 1;
        if (
          !state.analyticsCoverage.some(
            (item) => item.workspaceId === current.workspaceId
          )
        ) {
          state.analyticsCoverage.push({
            workspaceId: current.workspaceId,
            uploads: {
              trackingStartedAt: timestamp.toISOString(),
              status: "partial"
            },
            shareViews: {
              trackingStartedAt: timestamp.toISOString(),
              status: "complete"
            }
          });
        }
        const retainedDates = new Set(
          state.analyticsDaily
            .filter((item) => item.workspaceId === current.workspaceId)
            .map((item) => item.date)
            .sort((a, b) => b.localeCompare(a))
            .slice(0, 400)
        );
        state.analyticsDaily = state.analyticsDaily.filter(
          (item) =>
            item.workspaceId !== current.workspaceId ||
            retainedDates.has(item.date)
        );
      });
      return sendImage(
        reply,
        storagePath(storageRoot, image.originalKey),
        image.mime,
        image.name
      );
    }
  );
}
