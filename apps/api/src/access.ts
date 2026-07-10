import type { FastifyRequest } from "fastify";
import { createHmac, randomUUID } from "node:crypto";
import { BlockList, isIP } from "node:net";
import { PublicError } from "./errors.js";
import type {
  ApiTokenScope,
  AppState,
  StoredApiToken,
  StoredAuditEvent,
  StoredSession,
  StoredUser,
  StoredWorkspace,
  WorkspaceRole
} from "./store.js";

export type Principal = {
  kind: "session" | "api-token";
  user: StoredUser;
  workspace: StoredWorkspace;
  workspaceId: string;
  role: WorkspaceRole;
  scopes: ApiTokenScope[];
  session?: StoredSession;
  apiToken?: StoredApiToken;
};

export type Capability = "read" | "write" | "admin" | "owner";

const roleLevel: Record<WorkspaceRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4
};

const capabilityLevel: Record<Capability, number> = {
  read: 1,
  write: 2,
  admin: 3,
  owner: 4
};

export function requireCapability(
  principal: Principal,
  capability: Capability,
  tokenScopes: ApiTokenScope[] = []
) {
  if (roleLevel[principal.role] < capabilityLevel[capability]) {
    throw new PublicError(403, "INSUFFICIENT_ROLE", "当前工作区权限不足");
  }
  if (principal.kind === "api-token") {
    if (capability === "admin" || capability === "owner") {
      throw new PublicError(
        403,
        "API_TOKEN_RESTRICTED",
        "API Token 不能访问团队或安全管理功能"
      );
    }
    if (
      tokenScopes.length === 0 ||
      !tokenScopes.some((scope) => principal.scopes.includes(scope))
    ) {
      throw new PublicError(403, "TOKEN_SCOPE_DENIED", "API Token scope 不足");
    }
  }
}

export function requireSession(principal: Principal) {
  if (principal.kind !== "session" || !principal.session) {
    throw new PublicError(
      403,
      "API_TOKEN_RESTRICTED",
      "该操作只能通过登录会话完成"
    );
  }
  return principal.session;
}

function ipv4FromNumber(value: number) {
  return [24, 16, 8, 0]
    .map((shift) => (value >>> shift) & 255)
    .join(".");
}

function ipv6Value(value: string) {
  let address = value.toLowerCase();
  if (address.includes(".")) {
    const lastColon = address.lastIndexOf(":");
    const ipv4 = address.slice(lastColon + 1);
    if (isIP(ipv4) !== 4) {
      throw new PublicError(400, "INVALID_IP_ALLOWLIST", "IP 白名单格式无效");
    }
    const octets = ipv4.split(".").map(Number);
    address =
      address.slice(0, lastColon + 1) +
      ((octets[0]! << 8) | octets[1]!).toString(16) +
      ":" +
      ((octets[2]! << 8) | octets[3]!).toString(16);
  }
  const halves = address.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (
    halves.length > 2 ||
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  ) {
    throw new PublicError(400, "INVALID_IP_ALLOWLIST", "IP 白名单格式无效");
  }
  const groups = [
    ...left,
    ...Array.from({ length: Math.max(0, missing) }, () => "0"),
    ...right
  ];
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))
  ) {
    throw new PublicError(400, "INVALID_IP_ALLOWLIST", "IP 白名单格式无效");
  }
  return groups.reduce(
    (result, group) => (result << 16n) | BigInt(parseInt(group, 16)),
    0n
  );
}

function ipv6FromValue(value: bigint) {
  const groups = Array.from({ length: 8 }, (_item, index) =>
    Number((value >> BigInt((7 - index) * 16)) & 0xffffn).toString(16)
  );
  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < groups.length; ) {
    if (groups[index] !== "0") {
      index += 1;
      continue;
    }
    let end = index;
    while (end < groups.length && groups[end] === "0") end += 1;
    if (end - index > bestLength && end - index >= 2) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }
  if (bestStart < 0) return groups.join(":");
  return `${groups.slice(0, bestStart).join(":")}::${groups
    .slice(bestStart + bestLength)
    .join(":")}`;
}

function mappedIpv4(value: bigint) {
  return value >> 32n === 0xffffn
    ? ipv4FromNumber(Number(value & 0xffffffffn))
    : undefined;
}

function canonicalIp(value: string) {
  const lower = value.toLowerCase();
  const version = isIP(lower);
  if (version === 4) return lower.split(".").map(Number).join(".");
  if (version === 6) {
    const numeric = ipv6Value(lower);
    return mappedIpv4(numeric) ?? ipv6FromValue(numeric);
  }
  throw new PublicError(400, "INVALID_IP_ALLOWLIST", "IP 白名单格式无效");
}

function ipv4Network(address: string, prefix: number) {
  const value = address
    .split(".")
    .map(Number)
    .reduce((result, octet) => ((result << 8) | octet) >>> 0, 0);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return ipv4FromNumber((value & mask) >>> 0);
}

export function normalizeIpAllowlist(values: string[] | undefined) {
  const normalized = (values ?? []).map((raw) => {
    const value = raw.trim();
    const parts = value.split("/");
    if (parts.length === 1) return canonicalIp(value);
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new PublicError(
        400,
        "INVALID_IP_ALLOWLIST",
        "IP 白名单格式无效"
      );
    }
    const rawVersion = isIP(parts[0]);
    if (rawVersion === 0) {
      throw new PublicError(400, "INVALID_IP_ALLOWLIST", "IP 白名单格式无效");
    }
    const rawIpv6 = rawVersion === 6 ? ipv6Value(parts[0]) : undefined;
    const mappedAddress =
      rawIpv6 === undefined ? undefined : mappedIpv4(rawIpv6);
    const rawPrefix = Number(parts[1]);
    if (mappedAddress) {
      if (
        !Number.isInteger(rawPrefix) ||
        rawPrefix < 96 ||
        rawPrefix > 128 ||
        String(rawPrefix) !== parts[1]
      ) {
        throw new PublicError(
          400,
          "INVALID_IP_ALLOWLIST",
          "IPv4-mapped IPv6 CIDR 前缀必须为 96 至 128"
        );
      }
      const mappedPrefix = rawPrefix - 96;
      if (ipv4Network(mappedAddress, mappedPrefix) !== mappedAddress) {
        throw new PublicError(400, "INVALID_IP_ALLOWLIST", "CIDR 必须使用网络地址");
      }
      return `${mappedAddress}/${mappedPrefix}`;
    }
    const address = canonicalIp(parts[0]);
    const version = isIP(address);
    const prefix = rawPrefix;
    const maximum = version === 4 ? 32 : 128;
    if (
      !Number.isInteger(prefix) ||
      prefix < 0 ||
      prefix > maximum ||
      String(prefix) !== parts[1]
    ) {
      throw new PublicError(
        400,
        "INVALID_IP_ALLOWLIST",
        "CIDR 前缀长度无效"
      );
    }
    if (version === 4 && ipv4Network(address, prefix) !== address) {
      throw new PublicError(
        400,
        "INVALID_IP_ALLOWLIST",
        "CIDR 必须使用网络地址"
      );
    }
    if (version === 6) {
      const numeric = ipv6Value(address);
      const mask =
        prefix === 0
          ? 0n
          : ((1n << BigInt(prefix)) - 1n) << BigInt(128 - prefix);
      if ((numeric & mask) !== numeric) {
        throw new PublicError(
          400,
          "INVALID_IP_ALLOWLIST",
          "CIDR 必须使用网络地址"
        );
      }
    }
    return `${address}/${prefix}`;
  });
  return [...new Set(normalized)];
}

export function isIpAllowed(requestIp: string, allowlist: string[]) {
  if (allowlist.length === 0) return true;
  const ip = canonicalIp(requestIp);
  const list = new BlockList();
  for (const rule of allowlist) {
    const [address, prefixValue] = rule.split("/");
    if (!address) return false;
    const version = isIP(address);
    const family = version === 4 ? "ipv4" : "ipv6";
    if (prefixValue === undefined) {
      list.addAddress(address!, family);
    } else {
      list.addSubnet(address!, Number(prefixValue), family);
    }
  }
  return list.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");
}

export function hashRequestIp(request: FastifyRequest) {
  const secret = process.env.OU_SECRET_KEY;
  if (!secret) return undefined;
  const value =
    request.ip ||
    request.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    "unknown";
  return createHmac("sha256", secret).update(value).digest("base64url");
}

const sensitiveAuditKey =
  /password|token|authorization|cookie|secret|recovery|code|ciphertext/i;

export function sanitizeAuditMetadata(
  metadata: Record<string, string | number | boolean> | undefined
) {
  if (!metadata) return undefined;
  const entries = Object.entries(metadata)
    .filter(
      ([key, value]) =>
        key.length > 0 &&
        key.length <= 64 &&
        !sensitiveAuditKey.test(key) &&
        (typeof value === "number" ||
          typeof value === "boolean" ||
          typeof value === "string")
    )
    .slice(0, 16)
    .map(([key, value]) => [
      key,
      typeof value === "string" ? value.slice(0, 200) : value
    ]);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function addAuditEvent(
  state: AppState,
  input: {
    principal?: Principal;
    workspaceId?: string;
    global?: boolean;
    action: string;
    result: "success" | "failure";
    resourceType?: string;
    resourceId?: string;
    metadata?: Record<string, string | number | boolean>;
    ipHash?: string;
    createdAt: string;
  }
) {
  const event: StoredAuditEvent = {
    id: randomUUID(),
    workspaceId: input.global
      ? undefined
      : input.workspaceId ?? input.principal?.workspaceId,
    actorUserId: input.principal?.user.id,
    actorType: input.principal?.kind ?? "system",
    action: input.action,
    result: input.result,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    metadata: sanitizeAuditMetadata(input.metadata),
    ipHash: input.ipHash,
    createdAt: input.createdAt
  };
  state.auditEvents.push(event);
  return event;
}
