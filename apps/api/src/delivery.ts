import type { FastifyRequest } from "fastify";
import {
  createHash,
  createHmac,
  timingSafeEqual
} from "node:crypto";
import { PublicError } from "./errors.js";
import type { AppState } from "./store.js";

function deliveryKey() {
  const secret = process.env.OU_SECRET_KEY;
  if (!secret) return null;
  return createHash("sha256").update(secret).digest();
}

function encodeVariant(variant: string) {
  return variant.split("/").map(encodeURIComponent).join("/");
}

export function canonicalFilePath(id: string, variant: string) {
  return `/files/${encodeURIComponent(id)}/${encodeVariant(variant)}`;
}

function signPath(path: string, expires: number) {
  const key = deliveryKey();
  if (!key) {
    throw new PublicError(
      500,
      "SIGNING_KEY_UNAVAILABLE",
      "签名链接密钥不可用"
    );
  }
  return createHmac("sha256", key)
    .update(`${path}\n${expires}`)
    .digest("hex");
}

export function buildDeliveryUrl(
  state: AppState,
  id: string,
  variant: string,
  timestamp: Date
) {
  const settings = state.deliverySettings;
  const domain = settings.customDomain ?? "";
  const encodedId = encodeURIComponent(id);
  const encodedVariant = encodeVariant(variant);
  const path = `files/${encodedId}/${encodedVariant}`;
  let url = settings.linkTemplate
    .replaceAll("{domain}", domain)
    .replaceAll("{id}", encodedId)
    .replaceAll("{variant}", encodedVariant)
    .replaceAll("{path}", path);

  if (settings.signedUrls) {
    const expires =
      Math.floor(timestamp.getTime() / 1000) +
      settings.signedUrlTtlSeconds;
    const canonicalPath = canonicalFilePath(id, variant);
    const signature = signPath(canonicalPath, expires);
    const separator = url.includes("?") ? "&" : "?";
    url = `${url}${separator}expires=${expires}&signature=${signature}`;
  }
  return url;
}

function safeEqualHex(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) {
    return false;
  }
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function assertDeliveryAccess(
  request: FastifyRequest,
  state: AppState,
  path: string,
  timestamp: Date
) {
  const settings = state.deliverySettings;
  if (settings.signedUrls) {
    const query = request.query as {
      expires?: string;
      signature?: string;
    };
    const expires = Number(query.expires);
    if (
      !Number.isSafeInteger(expires) ||
      expires <= Math.floor(timestamp.getTime() / 1000) ||
      !query.signature ||
      !safeEqualHex(query.signature, signPath(path, expires))
    ) {
      throw new PublicError(
        403,
        "INVALID_FILE_SIGNATURE",
        "文件链接签名无效或已过期"
      );
    }
  }

  if (!settings.hotlinkEnabled) return;
  const referer = request.headers.referer;
  if (!referer) {
    if (settings.allowEmptyReferer) return;
    throw new PublicError(403, "HOTLINK_BLOCKED", "该文件不允许直接访问");
  }
  let origin: string;
  try {
    origin = new URL(referer).origin.toLowerCase();
  } catch {
    throw new PublicError(403, "HOTLINK_BLOCKED", "请求来源未获授权");
  }
  if (
    !settings.allowedReferers.some(
      (allowed) => allowed.toLowerCase() === origin
    )
  ) {
    throw new PublicError(403, "HOTLINK_BLOCKED", "请求来源未获授权");
  }
}
