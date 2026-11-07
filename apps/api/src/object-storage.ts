import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { PublicError } from "./errors.js";
import type { AppState, RemoteStorageSettings } from "./store.js";

export type RemoteInput = {
  endpoint?: string;
  bucket?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  publicBaseUrl?: string | null;
  pathStyle?: boolean;
};

export type RuntimeRemoteConfig = Omit<
  RemoteStorageSettings,
  "secretAccessKeyCiphertext"
> & {
  secretAccessKey: string;
};

export function secretKey() {
  const secret = process.env.OU_SECRET_KEY;
  if (!secret) return null;
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(value: string) {
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

export function normalizeUrl(value: string, code: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new PublicError(400, code, "请输入有效的 HTTP 或 HTTPS 地址");
  }
}

export function runtimeRemote(
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
  const prefix = url.pathname.replace(/\/$/, "");
  const keyPath = key
    ? key.split("/").map(awsEncode).join("/")
    : "";
  if (config.pathStyle) {
    url.pathname = `${prefix}/${awsEncode(config.bucket)}${keyPath ? `/${keyPath}` : ""}`;
  } else {
    url.hostname = `${config.bucket}.${url.hostname}`;
    url.pathname = keyPath ? `${prefix}/${keyPath}` : prefix || "/";
  }
  return url;
}

export async function signedS3Request(
  config: RuntimeRemoteConfig,
  method: "HEAD" | "PUT" | "GET" | "DELETE",
  timestamp: Date,
  key?: string,
  body?: Buffer,
  range?: string
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
  try {
    return await fetch(url, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(method === "HEAD" || method === "DELETE" || key?.startsWith("ou-probes/") ? 8_000 : 60_000),
      headers: {
        authorization,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
        ...(body ? { "content-type": "application/octet-stream" } : {}),
        ...(range ? { range } : {})
      },
      body: body ? new Uint8Array(body).buffer : undefined
    });
  } catch {
    throw new PublicError(502, "REMOTE_STORAGE_UNREACHABLE", "无法访问远端存储");
  }
}

export async function requireRemoteSuccess(response: Response) {
  if (response.ok) return;
  await response.body?.cancel().catch(() => undefined);
  throw new PublicError(502, "REMOTE_STORAGE_FAILED", `远端存储返回 HTTP ${response.status}`);
}
