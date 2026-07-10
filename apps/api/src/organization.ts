import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { buildDeliveryUrl } from "./delivery.js";
import { PublicError } from "./errors.js";
import type {
  AppState,
  AppStore,
  StoredAlbum,
  StoredImage,
  StoredTag,
  StoredUser
} from "./store.js";

type OrganizationRouteOptions = {
  store: AppStore;
  dataDirectory: string;
  now: () => Date;
  authenticate: (request: FastifyRequest) => {
    user: StoredUser;
    session: { id: string };
  };
};

type IdParams = { id: string };
type AlbumBody = {
  name: string;
  description?: string;
  coverImageId?: string;
};
type AlbumPatchBody = {
  name?: string;
  description?: string;
  coverImageId?: string | null;
};
type TagBody = { name: string; color: string };
type TagPatchBody = { name?: string; color?: string };
type MergeTagBody = { targetTagId: string };
type OrganizationBody = {
  favorite?: boolean;
  albumIds?: string[];
  tagIds?: string[];
};
type TrashBody = {
  ids: string[];
  action: "restore" | "delete";
};

const idParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 80 }
  }
} as const;

const idArraySchema = {
  type: "array",
  maxItems: 100,
  uniqueItems: true,
  items: { type: "string", minLength: 1, maxLength: 80 }
} as const;

function publicImage(
  image: StoredImage,
  state: AppState,
  timestamp: Date
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
    favorite: image.favorite,
    albumIds: image.albumIds,
    tagIds: image.tagIds,
    createdAt: image.createdAt,
    updatedAt: image.updatedAt,
    deletedAt: image.deletedAt
  };
}

function publicAlbum(
  album: StoredAlbum,
  state: AppState,
  timestamp: Date
) {
  const cover = album.coverImageId
    ? state.images.find(
        (image) =>
          image.id === album.coverImageId &&
          image.userId === album.userId &&
          !image.deletedAt
      )
    : undefined;
  return {
    id: album.id,
    name: album.name,
    description: album.description,
    coverImageId: album.coverImageId,
    coverThumbnailUrl: cover
      ? buildDeliveryUrl(state, cover.id, "thumbnail", timestamp)
      : undefined,
    imageCount: state.images.filter(
      (image) =>
        image.userId === album.userId &&
        !image.deletedAt &&
        image.albumIds.includes(album.id)
    ).length,
    createdAt: album.createdAt,
    updatedAt: album.updatedAt
  };
}

function publicTag(tag: StoredTag, state: AppState) {
  return {
    id: tag.id,
    name: tag.name,
    color: tag.color,
    imageCount: state.images.filter(
      (image) =>
        image.userId === tag.userId &&
        !image.deletedAt &&
        image.tagIds.includes(tag.id)
    ).length,
    createdAt: tag.createdAt,
    updatedAt: tag.updatedAt
  };
}

function validateName(value: string, maximum: number, code: string) {
  const name = value.trim();
  if (!name || name.length > maximum) {
    throw new PublicError(400, code, "名称不能为空或超过长度限制");
  }
  return name;
}

function validateDescription(value: string | undefined) {
  const description = value?.trim() ?? "";
  if (description.length > 240) {
    throw new PublicError(
      400,
      "INVALID_ALBUM_DESCRIPTION",
      "相册描述不能超过 240 个字符"
    );
  }
  return description;
}

function normalizeColor(value: string) {
  if (!/^#[0-9A-Fa-f]{6}$/.test(value)) {
    throw new PublicError(
      400,
      "INVALID_TAG_COLOR",
      "标签颜色必须是六位十六进制颜色"
    );
  }
  return value.toUpperCase();
}

function findOwnedImage(
  state: AppState,
  id: string,
  userId: string,
  includeDeleted = false
) {
  const image = state.images.find(
    (item) =>
      item.id === id &&
      item.userId === userId &&
      (includeDeleted || !item.deletedAt)
  );
  if (!image) {
    throw new PublicError(404, "IMAGE_NOT_FOUND", "图片不存在");
  }
  return image;
}

function findAlbum(state: AppState, id: string, userId: string) {
  const album = state.albums.find(
    (item) => item.id === id && item.userId === userId
  );
  if (!album) {
    throw new PublicError(404, "ALBUM_NOT_FOUND", "相册不存在");
  }
  return album;
}

function findTag(state: AppState, id: string, userId: string) {
  const tag = state.tags.find(
    (item) => item.id === id && item.userId === userId
  );
  if (!tag) {
    throw new PublicError(404, "TAG_NOT_FOUND", "标签不存在");
  }
  return tag;
}

function validateCover(
  state: AppState,
  coverImageId: string | undefined,
  userId: string
) {
  if (coverImageId) {
    findOwnedImage(state, coverImageId, userId);
  }
}

function validateRelations(
  state: AppState,
  userId: string,
  albumIds: string[] | undefined,
  tagIds: string[] | undefined
) {
  if (albumIds) {
    const valid = new Set(
      state.albums
        .filter((album) => album.userId === userId)
        .map((album) => album.id)
    );
    if (albumIds.some((id) => !valid.has(id))) {
      throw new PublicError(
        400,
        "INVALID_ALBUM_IDS",
        "包含不存在或无权访问的相册"
      );
    }
  }
  if (tagIds) {
    const valid = new Set(
      state.tags.filter((tag) => tag.userId === userId).map((tag) => tag.id)
    );
    if (tagIds.some((id) => !valid.has(id))) {
      throw new PublicError(
        400,
        "INVALID_TAG_IDS",
        "包含不存在或无权访问的标签"
      );
    }
  }
}

function storagePath(storageRoot: string, key: string) {
  const root = path.resolve(storageRoot);
  const target = path.resolve(root, key);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new PublicError(500, "INVALID_STORAGE_KEY", "图片存储记录无效");
  }
  return target;
}

async function removeFile(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function imageCollection(
  images: StoredImage[],
  state: AppState,
  timestamp: Date
) {
  return {
    images: images.map((image) => publicImage(image, state, timestamp)),
    total: images.length
  };
}

export function registerOrganizationRoutes(
  app: FastifyInstance,
  options: OrganizationRouteOptions
) {
  const { store, dataDirectory, now, authenticate } = options;
  const storageRoot = path.join(dataDirectory, "storage");

  app.get("/albums", async (request) => {
    const { user } = authenticate(request);
    const state = store.snapshot();
    return {
      albums: state.albums
        .filter((album) => album.userId === user.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((album) => publicAlbum(album, state, now()))
    };
  });

  app.post<{ Body: AlbumBody }>(
    "/albums",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 60 },
            description: { type: "string", maxLength: 240 },
            coverImageId: {
              type: "string",
              minLength: 1,
              maxLength: 80
            }
          }
        }
      }
    },
    async (request, reply) => {
      const { user } = authenticate(request);
      const state = store.snapshot();
      validateCover(state, request.body.coverImageId, user.id);
      const timestamp = now().toISOString();
      const album: StoredAlbum = {
        id: randomUUID(),
        userId: user.id,
        name: validateName(request.body.name, 60, "INVALID_ALBUM_NAME"),
        description: validateDescription(request.body.description),
        coverImageId: request.body.coverImageId,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      await store.update((draft) => {
        validateCover(draft, album.coverImageId, user.id);
        draft.albums.push(album);
      });
      return reply.status(201).send({
        album: publicAlbum(album, store.snapshot(), now())
      });
    }
  );

  app.patch<{ Params: IdParams; Body: AlbumPatchBody }>(
    "/albums/:id",
    {
      schema: {
        params: idParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 60 },
            description: { type: "string", maxLength: 240 },
            coverImageId: {
              anyOf: [
                { type: "string", minLength: 1, maxLength: 80 },
                { type: "null" }
              ]
            }
          }
        }
      }
    },
    async (request) => {
      const { user } = authenticate(request);
      const timestamp = now().toISOString();
      const album = await store.update((state) => {
        const current = findAlbum(state, request.params.id, user.id);
        if (request.body.coverImageId) {
          validateCover(state, request.body.coverImageId, user.id);
        }
        if (request.body.name !== undefined) {
          current.name = validateName(
            request.body.name,
            60,
            "INVALID_ALBUM_NAME"
          );
        }
        if (request.body.description !== undefined) {
          current.description = validateDescription(
            request.body.description
          );
        }
        if (request.body.coverImageId === null) {
          delete current.coverImageId;
        } else if (request.body.coverImageId !== undefined) {
          current.coverImageId = request.body.coverImageId;
        }
        current.updatedAt = timestamp;
        return current;
      });
      return { album: publicAlbum(album, store.snapshot(), now()) };
    }
  );

  app.delete<{ Params: IdParams }>(
    "/albums/:id",
    { schema: { params: idParamsSchema } },
    async (request, reply) => {
      const { user } = authenticate(request);
      const timestamp = now().toISOString();
      await store.update((state) => {
        findAlbum(state, request.params.id, user.id);
        state.albums = state.albums.filter(
          (album) => album.id !== request.params.id
        );
        state.images.forEach((image) => {
          if (image.userId === user.id) {
            const albumIds = image.albumIds.filter(
              (albumId) => albumId !== request.params.id
            );
            if (albumIds.length !== image.albumIds.length) {
              image.albumIds = albumIds;
              image.updatedAt = timestamp;
            }
          }
        });
      });
      return reply.status(204).send();
    }
  );

  app.get<{ Params: IdParams }>(
    "/albums/:id/images",
    { schema: { params: idParamsSchema } },
    async (request) => {
      const { user } = authenticate(request);
      const state = store.snapshot();
      findAlbum(state, request.params.id, user.id);
      return imageCollection(
        state.images
          .filter(
            (image) =>
              image.userId === user.id &&
              !image.deletedAt &&
              image.albumIds.includes(request.params.id)
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        state,
        now()
      );
    }
  );

  app.get("/tags", async (request) => {
    const { user } = authenticate(request);
    const state = store.snapshot();
    return {
      tags: state.tags
        .filter((tag) => tag.userId === user.id)
        .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
        .map((tag) => publicTag(tag, state))
    };
  });

  app.post<{ Body: TagBody }>(
    "/tags",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name", "color"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 40 },
            color: {
              type: "string",
              pattern: "^#[0-9A-Fa-f]{6}$"
            }
          }
        }
      }
    },
    async (request, reply) => {
      const { user } = authenticate(request);
      const timestamp = now().toISOString();
      const tag: StoredTag = {
        id: randomUUID(),
        userId: user.id,
        name: validateName(request.body.name, 40, "INVALID_TAG_NAME"),
        color: normalizeColor(request.body.color),
        createdAt: timestamp,
        updatedAt: timestamp
      };
      await store.update((state) => {
        state.tags.push(tag);
      });
      return reply.status(201).send({
        tag: publicTag(tag, store.snapshot())
      });
    }
  );

  app.patch<{ Params: IdParams; Body: TagPatchBody }>(
    "/tags/:id",
    {
      schema: {
        params: idParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 40 },
            color: {
              type: "string",
              pattern: "^#[0-9A-Fa-f]{6}$"
            }
          }
        }
      }
    },
    async (request) => {
      const { user } = authenticate(request);
      const timestamp = now().toISOString();
      const tag = await store.update((state) => {
        const current = findTag(state, request.params.id, user.id);
        if (request.body.name !== undefined) {
          current.name = validateName(
            request.body.name,
            40,
            "INVALID_TAG_NAME"
          );
        }
        if (request.body.color !== undefined) {
          current.color = normalizeColor(request.body.color);
        }
        current.updatedAt = timestamp;
        return current;
      });
      return { tag: publicTag(tag, store.snapshot()) };
    }
  );

  app.delete<{ Params: IdParams }>(
    "/tags/:id",
    { schema: { params: idParamsSchema } },
    async (request, reply) => {
      const { user } = authenticate(request);
      const timestamp = now().toISOString();
      await store.update((state) => {
        findTag(state, request.params.id, user.id);
        state.tags = state.tags.filter((tag) => tag.id !== request.params.id);
        state.images.forEach((image) => {
          if (image.userId === user.id) {
            const tagIds = image.tagIds.filter(
              (tagId) => tagId !== request.params.id
            );
            if (tagIds.length !== image.tagIds.length) {
              image.tagIds = tagIds;
              image.updatedAt = timestamp;
            }
          }
        });
      });
      return reply.status(204).send();
    }
  );

  app.post<{ Params: IdParams; Body: MergeTagBody }>(
    "/tags/:id/merge",
    {
      schema: {
        params: idParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["targetTagId"],
          properties: {
            targetTagId: {
              type: "string",
              minLength: 1,
              maxLength: 80
            }
          }
        }
      }
    },
    async (request) => {
      const { user } = authenticate(request);
      const timestamp = now().toISOString();
      if (request.params.id === request.body.targetTagId) {
        throw new PublicError(
          400,
          "INVALID_TAG_MERGE",
          "不能将标签合并到自身"
        );
      }
      const result = await store.update((state) => {
        findTag(state, request.params.id, user.id);
        const target = findTag(state, request.body.targetTagId, user.id);
        let mergedImages = 0;
        state.images.forEach((image) => {
          if (
            image.userId === user.id &&
            image.tagIds.includes(request.params.id)
          ) {
            image.tagIds = [
              ...new Set([
                ...image.tagIds.filter(
                  (tagId) => tagId !== request.params.id
                ),
                target.id
              ])
            ];
            image.updatedAt = timestamp;
            mergedImages += 1;
          }
        });
        state.tags = state.tags.filter(
          (tag) => tag.id !== request.params.id
        );
        target.updatedAt = timestamp;
        return { target, mergedImages };
      });
      return {
        tag: publicTag(result.target, store.snapshot()),
        mergedImages: result.mergedImages
      };
    }
  );

  app.get<{ Params: IdParams }>(
    "/tags/:id/images",
    { schema: { params: idParamsSchema } },
    async (request) => {
      const { user } = authenticate(request);
      const state = store.snapshot();
      findTag(state, request.params.id, user.id);
      return imageCollection(
        state.images
          .filter(
            (image) =>
              image.userId === user.id &&
              !image.deletedAt &&
              image.tagIds.includes(request.params.id)
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        state,
        now()
      );
    }
  );

  app.patch<{ Params: IdParams; Body: OrganizationBody }>(
    "/uploads/:id/organization",
    {
      schema: {
        params: idParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            favorite: { type: "boolean" },
            albumIds: idArraySchema,
            tagIds: idArraySchema
          }
        }
      }
    },
    async (request) => {
      const { user } = authenticate(request);
      const timestamp = now().toISOString();
      const image = await store.update((state) => {
        const current = findOwnedImage(
          state,
          request.params.id,
          user.id
        );
        validateRelations(
          state,
          user.id,
          request.body.albumIds,
          request.body.tagIds
        );
        if (request.body.favorite !== undefined) {
          current.favorite = request.body.favorite;
        }
        if (request.body.albumIds !== undefined) {
          current.albumIds = request.body.albumIds;
        }
        if (request.body.tagIds !== undefined) {
          current.tagIds = request.body.tagIds;
        }
        current.updatedAt = timestamp;
        return current;
      });
      return { image: publicImage(image, store.snapshot(), now()) };
    }
  );

  app.get("/favorites", async (request) => {
    const { user } = authenticate(request);
    const state = store.snapshot();
    return imageCollection(
      state.images
        .filter(
          (image) =>
            image.userId === user.id &&
            !image.deletedAt &&
            image.favorite
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      state,
      now()
    );
  });

  app.get("/trash", async (request) => {
    const { user } = authenticate(request);
    const state = store.snapshot();
    return imageCollection(
      state.images
        .filter(
          (image) => image.userId === user.id && Boolean(image.deletedAt)
        )
        .sort((a, b) =>
          (b.deletedAt ?? "").localeCompare(a.deletedAt ?? "")
        ),
      state,
      now()
    );
  });

  app.post<{ Body: TrashBody }>(
    "/trash/bulk",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["ids", "action"],
          properties: {
            ids: {
              ...idArraySchema,
              minItems: 1
            },
            action: {
              type: "string",
              enum: ["restore", "delete"]
            }
          }
        }
      }
    },
    async (request) => {
      const { user } = authenticate(request);
      const ids = new Set(request.body.ids);
      const state = store.snapshot();
      const images = state.images.filter(
        (image) =>
          ids.has(image.id) &&
          image.userId === user.id &&
          Boolean(image.deletedAt)
      );
      if (images.length !== ids.size) {
        throw new PublicError(
          400,
          "INVALID_TRASH_IDS",
          "包含不存在、未删除或无权访问的图片"
        );
      }

      if (request.body.action === "restore") {
        const timestamp = now().toISOString();
        const restored = await store.update((draft) => {
          let count = 0;
          draft.images.forEach((image) => {
            if (
              ids.has(image.id) &&
              image.userId === user.id &&
              image.deletedAt
            ) {
              delete image.deletedAt;
              image.updatedAt = timestamp;
              count += 1;
            }
          });
          return count;
        });
        return { restored };
      }

      const deletion = await store.update((draft) => {
        const timestamp = now().toISOString();
        const targets = draft.images.filter(
          (image) =>
            ids.has(image.id) &&
            image.userId === user.id &&
            Boolean(image.deletedAt)
        );
        if (targets.length !== ids.size) {
          throw new PublicError(
            400,
            "INVALID_TRASH_IDS",
            "包含不存在、未删除或无权访问的图片"
          );
        }
        const candidateKeys = new Set<string>();
        targets.forEach((image) => {
          image.versions.forEach((version) => {
            candidateKeys.add(version.originalKey);
            candidateKeys.add(version.thumbnailKey);
          });
          candidateKeys.add(image.originalKey);
          candidateKeys.add(image.thumbnailKey);
        });
        draft.images = draft.images.filter((image) => !ids.has(image.id));
        draft.imageShares = draft.imageShares.filter(
          (share) => !ids.has(share.imageId)
        );
        draft.albums.forEach((album) => {
          if (
            album.userId === user.id &&
            album.coverImageId &&
            ids.has(album.coverImageId)
          ) {
            delete album.coverImageId;
            album.updatedAt = timestamp;
          }
        });
        const retainedKeys = new Set<string>();
        draft.images.forEach((image) => {
          image.versions.forEach((version) => {
            retainedKeys.add(version.originalKey);
            retainedKeys.add(version.thumbnailKey);
          });
          retainedKeys.add(image.originalKey);
          retainedKeys.add(image.thumbnailKey);
        });
        return {
          deleted: targets.length,
          keys: [...candidateKeys].filter((key) => !retainedKeys.has(key))
        };
      });

      for (const key of deletion.keys) {
        await removeFile(storagePath(storageRoot, key));
      }
      return { deleted: deletion.deleted };
    }
  );
}
