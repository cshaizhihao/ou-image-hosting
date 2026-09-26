import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { randomUUID } from "node:crypto";
import { PublicError } from "./errors.js";
import { runtimeRemote, signedS3Request } from "./infrastructure.js";
import type { AppState, AppStore } from "./store.js";

type RemoteProvider = "s3" | "r2";

export type ObjectStorage = {
  write(key: string, body: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  open(key: string): Promise<Readable>;
  remove(key: string): Promise<void>;
};

function localPath(storageRoot: string, key: string) {
  const root = path.resolve(storageRoot);
  const resolved = path.resolve(root, key);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new PublicError(400, "INVALID_STORAGE_KEY", "存储路径无效");
  }
  return resolved;
}

function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function activeRemote(state: AppState): RemoteProvider | undefined {
  const active = state.storageSettings.active;
  return active === "local" ? undefined : active;
}

// Local copies win so images written before the switch keep working; after
// that the active remote, then any other configured remote, is tried.
function readRemotes(state: AppState): RemoteProvider[] {
  const providers: RemoteProvider[] = [];
  const active = activeRemote(state);
  if (active) providers.push(active);
  for (const provider of ["r2", "s3"] as const) {
    if (
      provider !== active &&
      state.storageSettings[provider]?.secretAccessKeyCiphertext
    ) {
      providers.push(provider);
    }
  }
  return providers;
}

export function createObjectStorage(
  store: AppStore,
  storageRoot: string,
  now: () => Date
): ObjectStorage {
  const remoteGet = async (key: string) => {
    const state = store.snapshot();
    let lastError: unknown;
    for (const provider of readRemotes(state)) {
      try {
        return await signedS3Request(
          runtimeRemote(state, provider),
          "GET",
          now(),
          key
        );
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError instanceof PublicError && lastError.statusCode !== 404) {
      throw lastError;
    }
    throw new PublicError(404, "FILE_NOT_FOUND", "图片文件不存在");
  };

  return {
    async write(key, body) {
      const state = store.snapshot();
      const provider = activeRemote(state);
      if (provider) {
        await signedS3Request(
          runtimeRemote(state, provider),
          "PUT",
          now(),
          key,
          body
        );
        return;
      }
      const target = localPath(storageRoot, key);
      const temporary = `${target}.${randomUUID()}.tmp`;
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(temporary, body, { mode: 0o600 });
      await rename(temporary, target);
    },

    async read(key) {
      try {
        return await readFile(localPath(storageRoot, key));
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      const response = await remoteGet(key);
      return Buffer.from(await response.arrayBuffer());
    },

    async open(key) {
      const file = localPath(storageRoot, key);
      try {
        const stream = createReadStream(file);
        await new Promise<void>((resolve, reject) => {
          stream.once("open", () => resolve());
          stream.once("error", reject);
        });
        return stream;
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      const response = await remoteGet(key);
      if (!response.body) {
        throw new PublicError(404, "FILE_NOT_FOUND", "图片文件不存在");
      }
      return Readable.fromWeb(response.body as WebReadableStream);
    },

    async remove(key) {
      try {
        await unlink(localPath(storageRoot, key));
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      const state = store.snapshot();
      const provider = activeRemote(state);
      if (!provider) return;
      try {
        await signedS3Request(
          runtimeRemote(state, provider),
          "DELETE",
          now(),
          key
        );
      } catch (error) {
        console.error(`remote delete failed for ${key}`, error);
      }
    }
  };
}
