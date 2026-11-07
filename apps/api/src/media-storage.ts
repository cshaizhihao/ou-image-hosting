import { randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import { PublicError } from "./errors.js";
import { MediaCoordinator } from "./media-coordinator.js";
import { parseByteRange } from "./media-files.js";
import { requireRemoteSuccess, runtimeRemote, signedS3Request, type RuntimeRemoteConfig } from "./object-storage.js";
import type { AppState, AppStore, StorageProvider, StoredImage } from "./store.js";

type Remote = Exclude<StorageProvider, "local">;
type ByteRange = ReturnType<typeof parseByteRange>;

export const storageLabels = {
  local: "本地存储",
  s3: "Amazon S3",
  r2: "Cloudflare R2"
} satisfies Record<StorageProvider, string>;

export function mediaKeys(image: StoredImage) {
  return [image.originalKey, image.thumbnailKey,
    ...image.versions.flatMap((version) => [version.originalKey, version.thumbnailKey]),
    ...(image.livePhotoVideoKey ? [image.livePhotoVideoKey] : [])];
}

function keyProvider(key: string): Remote | undefined {
  const prefix = key.split("/", 1)[0];
  return prefix === "r2" || prefix === "s3" ? prefix : undefined;
}

function missing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function missingMedia() {
  return new PublicError(404, "MEDIA_NOT_FOUND", "文件不存在，请联系管理员检查存储");
}

function copies(state: AppState, key: string) {
  const known = state.storageSettings.copies?.[key] ?? [];
  const legacy = state.storageMigrations.filter((job) => !job.tracksCopies && job.completed > 0 &&
    job.source === "local" && job.target !== "local").map((job) => job.target as Remote);
  const primary = keyProvider(key);
  return [...new Set(primary ? [primary, ...known] : [...known, ...legacy])];
}

export class MediaStorage extends MediaCoordinator {
  readonly root: string;

  constructor(dataDirectory: string, private readonly store: AppStore, private readonly now: () => Date) {
    super();
    this.root = path.resolve(dataDirectory, "storage");
  }

  key(provider: StorageProvider, localKey: string, remoteKey = localKey) {
    return provider === "local" ? localKey : `${provider}/${remoteKey}`;
  }

  localPath(key: string) {
    const target = path.resolve(this.root, key);
    if (!target.startsWith(this.root + path.sep) || key.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new PublicError(500, "INVALID_STORAGE_KEY", "图片存储记录无效");
    }
    return target;
  }

  async probe(state: AppState, provider: StorageProvider, options: { write?: boolean; config?: RuntimeRemoteConfig } = {}) {
    if (provider === "local") {
      await mkdir(this.root, { recursive: true });
      const file = this.localPath(`.ou-storage-probe-${randomUUID()}`);
      const value = randomBytes(16);
      try {
        await writeFile(file, value, { mode: 0o600, flag: "wx" });
        if (!(await readFile(file)).equals(value)) throw new Error("probe mismatch");
      } finally {
        await unlink(file).catch((error) => { if (!missing(error)) throw error; });
      }
      return;
    }
    const config = options.config ?? runtimeRemote(state, provider);
    await requireRemoteSuccess(await signedS3Request(config, "HEAD", this.now()));
    if (!options.write) return;
    const key = `ou-probes/${randomUUID()}`;
    const value = randomBytes(16);
    await requireRemoteSuccess(await signedS3Request(config, "DELETE", this.now(), key));
    try {
      await requireRemoteSuccess(await signedS3Request(config, "PUT", this.now(), key, value));
      const response = await signedS3Request(config, "GET", this.now(), key);
      await requireRemoteSuccess(response);
      if (!Buffer.from(await response.arrayBuffer()).equals(value)) {
        throw new PublicError(502, "REMOTE_STORAGE_FAILED", "远端存储读写校验失败");
      }
    } finally {
      await requireRemoteSuccess(await signedS3Request(config, "DELETE", this.now(), key));
    }
  }

  inUse(state: AppState, provider: Remote) {
    return state.storageSettings.active === provider ||
      Object.values(state.storageSettings.copies ?? {}).some((providers) => providers.includes(provider)) ||
      state.storageMigrations.some((job) => !job.tracksCopies && job.target === provider && job.completed > 0) ||
      state.images.some((image) => mediaKeys(image).some((key) => keyProvider(key) === provider)) ||
      (state.storageSettings.pendingDeletes ?? []).some((key) => keyProvider(key) === provider);
  }

  async write(state: AppState, key: string, contents: Buffer, created: string[]) {
    const file = this.localPath(key);
    const provider = keyProvider(key);
    if (provider) {
      created.push(key); // A timed-out PUT can have reached the bucket.
      await requireRemoteSuccess(await signedS3Request(runtimeRemote(state, provider), "PUT", this.now(), key, contents));
      return;
    }
    await mkdir(path.dirname(file), { recursive: true });
    try {
      await writeFile(file, contents, { mode: 0o600, flag: "wx" });
      created.push(key);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }

  async rollbackWrites(created: string[]) {
    const pending: string[] = [];
    const state = this.store.snapshot();
    for (const key of created) {
      // Rollback only the new primary, never an existing migration copy.
      try { await this.remove(state, key, false); }
      catch { pending.push(key); }
    }
    if (pending.length) {
      await this.store.update((draft) => this.queueDeletion(draft, pending)).catch(() => undefined);
    }
  }

  queueDeletion(state: AppState, keys: string[]) {
    if (!keys.length) return;
    state.storageSettings.pendingDeletes = [...new Set([...(state.storageSettings.pendingDeletes ?? []), ...keys])];
  }

  async drainDeletes() {
    const state = this.store.snapshot();
    const pending = state.storageSettings.pendingDeletes ?? [];
    if (!pending.length) return 0;
    const retained = new Set(state.images.flatMap(mediaKeys));
    const completed = new Set<string>();
    const unreachable = new Set<Remote>();
    for (const key of pending) {
      try {
        if (!retained.has(key)) await this.remove(state, key, true, unreachable);
        completed.add(key);
      } catch { /* Keep failed deletions in the persistent queue for retry. */ }
    }
    if (completed.size) await this.store.update((draft) => {
      draft.storageSettings.pendingDeletes = pending.filter((key) => !completed.has(key));
      for (const key of completed) {
        if (!retained.has(key) && draft.storageSettings.copies) delete draft.storageSettings.copies[key];
      }
    });
    return pending.length - completed.size;
  }

  private async remove(state: AppState, key: string, includeCopies = true, unreachable = new Set<Remote>()) {
    await unlink(this.localPath(key)).catch((error) => { if (!missing(error)) throw error; });
    const primary = keyProvider(key);
    for (const provider of includeCopies ? copies(state, key) : primary ? [primary] : []) {
      if (unreachable.has(provider)) throw new Error("Storage deletion will retry");
      try {
        const response = await signedS3Request(runtimeRemote(state, provider), "DELETE", this.now(), key);
        if (response.status !== 404) await requireRemoteSuccess(response);
        else await response.body?.cancel();
      } catch (error) {
        unreachable.add(provider);
        throw error;
      }
    }
  }

  async open(key: string, rangeHeader?: string) {
    const file = this.localPath(key);
    try {
      const local = await stat(file);
      if (local.isFile()) {
        const range = parseByteRange(rangeHeader, local.size);
        return {
          size: local.size, range,
          body: range === "unsatisfiable" ? undefined : createReadStream(file, range ?? undefined)
        };
      }
    } catch (error) {
      if (!missing(error)) throw error;
    }

    const state = this.store.snapshot();
    let failure: unknown;
    for (const provider of copies(state, key)) {
      try {
        const config = runtimeRemote(state, provider);
        let range: ByteRange = null;
        let size: number | undefined;
        if (rangeHeader) {
          const head = await signedS3Request(config, "HEAD", this.now(), key);
          if (head.status === 404) continue;
          await requireRemoteSuccess(head);
          size = this.responseSize(head);
          range = size === undefined ? null : parseByteRange(rangeHeader, size);
          if (range === "unsatisfiable") return { size, range, body: undefined };
        }
        const response = await signedS3Request(config, "GET", this.now(), key, undefined,
          range ? `bytes=${range.start}-${range.end}` : undefined);
        if (response.status === 404) {
          await response.body?.cancel();
          continue;
        }
        await requireRemoteSuccess(response);
        if (!response.body || (range && response.status !== 206)) {
          await response.body?.cancel();
          throw new PublicError(502, "INVALID_STORAGE_RESPONSE", "远端存储返回无效文件");
        }
        return { size: range ? size : this.responseSize(response), range, body: Readable.fromWeb(response.body as ReadableStream<Uint8Array>) };
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure) throw failure;
    throw missingMedia();
  }

  private responseSize(response: Response) {
    const header = response.headers.get("content-length");
    const size = Number(header);
    return header !== null && Number.isSafeInteger(size) && size >= 0 ? size : undefined;
  }

  async read(key: string, maximum = 64 * 1024 * 1024) {
    const media = await this.open(key);
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of media.body!) {
      bytes += chunk.length;
      if (bytes > maximum) throw new PublicError(413, "MEDIA_TOO_LARGE", "存储文件超过处理大小限制");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, bytes);
  }
}
